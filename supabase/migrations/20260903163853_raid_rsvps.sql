-- #893 (part of #640, Phase 2): self-mark raid-night RSVP. A row only
-- exists once a raider overrides the default -- see raid_schedule's header
-- comment (#892) for the default: Present unless players.is_bench, or
-- No Response on an is_optional night (#895). 'Attending' is reserved for
-- that optional-night case and is not accepted by set_own_rsvp() yet; the
-- four raider-facing override statuses are Late/Leaving Early/Tentative/
-- Absent.
--
-- This is forward-looking self-declared intent, not the attendance-of-record
-- (see docs/database-decisions.md, 2026-09-03 entry) -- no sync with
-- public.attendance, which stays the sole input to loot-fairness scoring.

create table "public"."raid_rsvps" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "raid_date" date not null,
    "status" text not null,
    "note" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    constraint "raid_rsvps_status_check" check (("status" = any (array['Attending'::text, 'Late'::text, 'Leaving Early'::text, 'Tentative'::text, 'Absent'::text]))),
    unique ("team_id", "player_id", "raid_date")
);

comment on table public.raid_rsvps is
  'A raider''s self-declared override for one raid night (#893, part of #640) -- absence of a row means the computed default (Present, or Bench via players.is_bench) applies. Forward-looking intent only, never synced into public.attendance. Written only through set_own_rsvp() (SECURITY DEFINER); no direct INSERT/UPDATE/DELETE policy for anyone.';

alter table "public"."raid_rsvps" owner to "postgres";

alter table "public"."raid_rsvps" enable row level security;

create trigger "trg_raid_rsvps_updated_at"
    before update on "public"."raid_rsvps"
    for each row execute function "public"."set_updated_at"();

create policy "Claude readers read raid_rsvps" on "public"."raid_rsvps" for select to "claude_readers" using (true);

create policy "Officers read raid_rsvps" on "public"."raid_rsvps" for select
    using ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_guild_officer"() or "public"."is_site_admin"()));

create policy "Own raid_rsvps read" on "public"."raid_rsvps" for select
    using ("public"."is_own_player"("player_id"));

-- SECURITY DEFINER: derives the caller's own player_id for p_team_id from
-- auth.uid() itself (never trusts a client-supplied player_id), so there is
-- no TOCTOU window to guard against the way update_own_signup()'s row-lookup
-- pattern has to -- every call resolves ownership fresh in the same
-- statement it writes with. A null p_status clears the raider's override
-- (back to the computed default) instead of raising.
create or replace function "public"."set_own_rsvp"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_status" text,
    "p_note" text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_player_id integer;
  v_is_bench boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select p.id, p.is_bench into v_player_id, v_is_bench
  from players p
  join team_members tm on tm.id = p.team_member_id
  where tm.auth_user_id = v_uid
    and p.team_id = p_team_id
    and p.archived_at is null;

  if v_player_id is null then
    raise exception 'No active roster character found for this team.';
  end if;

  if v_is_bench then
    raise exception 'Bench players cannot set an RSVP status.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = v_player_id and raid_date = p_raid_date;
    return;
  end if;

  if p_status not in ('Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  insert into raid_rsvps (team_id, player_id, raid_date, status, note)
  values (p_team_id, v_player_id, p_raid_date, p_status, p_note)
  on conflict (team_id, player_id, raid_date)
  do update set status = excluded.status, note = excluded.note, updated_at = now();
end;
$$;

alter function "public"."set_own_rsvp"(integer, date, text, text) owner to "postgres";

revoke all on function "public"."set_own_rsvp"(integer, date, text, text) from public;
revoke execute on function "public"."set_own_rsvp"(integer, date, text, text) from anon;
grant execute on function "public"."set_own_rsvp"(integer, date, text, text) to authenticated;
