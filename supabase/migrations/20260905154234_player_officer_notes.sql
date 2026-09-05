-- #925: move the officer-only columns off players, which every visitor reads.
--
-- players carries a `Public read players` policy with qual = true, anon holds
-- table-level SELECT on it, and no column-level ACL narrows either. Three
-- columns written by and for officers rode along with the public roster read:
-- officer_notes (notes on three current raiders), archived_reason and
-- archived_reason_detail (why two people were removed). Measured on prod
-- 2026-09-05: an anon read with the publishable key alone returned all of
-- them. That policy's polroles is PUBLIC rather than a role list, and
-- relacl grants authenticated the same SELECT, so every signed-in raider
-- read them too, not only anonymous visitors.
--
-- Why a side table rather than a revoke or a view. Officers and raiders share
-- the `authenticated` role, so a column privilege cannot separate them: the
-- split this data needs is per row (am I an officer of this team) and column
-- privileges are per role. A policy cannot help either, since policies are
-- row-level and cannot hide a column. A view is no use here for the same
-- reason the six existing views over players are harmless: they are all
-- security_invoker, so the base table's RLS applies as the caller and nothing
-- is narrowed. The only view shape that would be a boundary is a
-- definer-rights view, which is the one thing #503 is open to remove. So the
-- columns move to a table whose own policies are the boundary, which is the
-- idiom the request queues already use, and once they are off players there
-- is nothing left for a future public select to name by accident.
--
-- m_plus_note deliberately stays behind. renderProfile() (js/common.js) shows
-- it on the public profile beside the Excluded badge, so it is not an
-- officer-only column despite being officer-written. It holds no rows today
-- and #945 already lists it as a prune candidate.
--
-- archive_player() exists because archived_at stays on players while the
-- reason moves. Removing a raider is one officer action that now spans two
-- tables, and two client writes would leave a window where a player is
-- archived and the reason never landed. The function does both or neither.

create table "public"."player_officer_notes" (
    "player_id" integer primary key references "public"."players"("id") on delete cascade,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "officer_notes" text,
    "archived_reason" text,
    "archived_reason_detail" text,
    "updated_at" timestamp with time zone not null default now(),
    constraint "player_officer_notes_archived_reason_check" check (
      "archived_reason" is null or "archived_reason" in (
        'schedule_conflict',
        'performance',
        'drama',
        'moved_guilds',
        'switching_mains',
        'other'
      )
    )
);

comment on table public.player_officer_notes is
  'Officer-only annotations on a roster slot (#925): the private officer note, and why a player was removed plus the freeform specifics (#476). One row per players row, created on first write. These lived on players until #925, where the table''s public read policy and its table-level anon grant made them readable with the publishable key and by every signed-in raider. m_plus_note stayed on players because the public profile renders it. archived_reason keeps the fixed vocabulary its old CHECK constraint carried.';

alter table "public"."player_officer_notes" owner to "postgres";
alter table "public"."player_officer_notes" enable row level security;

create policy "Claude readers read player_officer_notes" on "public"."player_officer_notes"
  for select to "claude_readers" using (true);

-- The same admission set the columns lived under on players, so nobody who
-- could read or write them before loses access: team officers and team
-- leaders on that team, guild officers anywhere, site admins anywhere.
create policy "Officers write player_officer_notes" on "public"."player_officer_notes"
  for all
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin());

create trigger "trg_player_officer_notes_team_id_check"
  before insert or update on "public"."player_officer_notes"
  for each row execute function "public"."check_team_id_matches_player"();

create trigger "trg_player_officer_notes_updated_at"
  before update on "public"."player_officer_notes"
  for each row execute function "public"."set_updated_at"();

-- Carry the existing values over before the columns go. Only rows with
-- something to say get a row here; the rest are created on first write.
insert into public.player_officer_notes (player_id, team_id, officer_notes, archived_reason, archived_reason_detail)
select id, team_id, officer_notes, archived_reason, archived_reason_detail
  from public.players
 where officer_notes is not null
    or archived_reason is not null
    or archived_reason_detail is not null;

alter table "public"."players"
  drop column "officer_notes",
  drop column "archived_reason",
  drop column "archived_reason_detail";

-- Archiving a player writes archived_at on players and the reason on
-- player_officer_notes. SECURITY INVOKER, so both writes pass the caller's own
-- policies and authorization is not re-implemented here; the explicit check
-- below only exists so an unauthorized caller gets 'Not authorized' rather
-- than the misleading 'already archived' an RLS-filtered UPDATE would produce.
-- Same shape as remove_player_priority_order() (20260828022325).
create function public.archive_player(
  p_player_id integer,
  p_reason text,
  p_detail text
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_team_id integer;
  v_archived_at timestamptz;
begin
  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- archived_at is null guards a double archive: a second call would
  -- otherwise silently rewrite the first reason with the second one.
  update public.players
     set archived_at = now()
   where id = p_player_id
     and archived_at is null
  returning archived_at into v_archived_at;

  if v_archived_at is null then
    raise exception 'Player % is already archived', p_player_id;
  end if;

  -- Only the two archive columns are written on conflict. A player being
  -- removed may already carry an officer note, and blanking it here would
  -- destroy the note at exactly the moment it is most worth keeping.
  insert into public.player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
  values (p_player_id, v_team_id, p_reason, p_detail)
  on conflict (player_id) do update
     set archived_reason = excluded.archived_reason,
         archived_reason_detail = excluded.archived_reason_detail;

  return v_archived_at;
end;
$$;

revoke all on function public.archive_player(integer, text, text) from public;
revoke execute on function public.archive_player(integer, text, text) from anon;
grant execute on function public.archive_player(integer, text, text) to authenticated;
