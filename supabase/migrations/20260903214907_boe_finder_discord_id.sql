-- The finder's Discord id on a submitted find (#889). submit_boe_found never
-- read auth.uid(): the finder was the typed name, player_id resolved only when
-- that name matched an unarchived roster character on the chosen team, and the
-- raider read policy was is_own_player(player_id) alone. On prod 24 of 67 rows
-- carry a player_id and 16 of those reach a signed-in member; the other 43 are
-- a typed name and nothing else, every Immolation and Wrathless row among
-- them, since those teams have no roster. A raider who signs in should see
-- the BoEs they reported, on every team, whatever they typed.
--
-- Decided 2026-09-03: the id is stamped server-side inside submit_boe_found
-- from the caller's auth row, null for a signed-out submit, and never
-- client-supplied; the trigger's plain-UPDATE list does not include it, so
-- only this RPC and the backfill below ever write it. A find reported signed
-- out stays visible to the team's officers and the BoE managers only.

alter table public.boe_items add column finder_discord_id text;

comment on column public.boe_items.finder_discord_id is
  'Discord id of the signed-in account that submitted the find, stamped by submit_boe_found() and never client-supplied (#889); null for a signed-out submit. Backfilled from the player chain for rows whose player reached a member.';

-- The caller's Discord id as their auth row carries it: the same
-- raw_user_meta_data ->> 'provider_id' that claim_character() and the admin
-- grant RPCs read, and the string link_auth_user_to_member() matches against
-- team_members.discord_id. Reads auth.users, so SECURITY DEFINER; null for
-- anon and for an auth row with no provider id. EXECUTE for anon as well,
-- because the read policies below are evaluated for anon and would error
-- rather than resolve false without it.
create or replace function public.current_discord_id() returns text
language sql stable security definer set search_path to 'public'
as $$
  select u.raw_user_meta_data ->> 'provider_id'
  from auth.users u
  where u.id = auth.uid();
$$;

comment on function public.current_discord_id() is
  'The caller''s Discord id from their auth row (raw_user_meta_data ->> provider_id); null for anon or an account with none (#889). Gates the raider read of their own BoE finds.';

revoke all on function public.current_discord_id() from public;
grant execute on function public.current_discord_id() to anon, authenticated;

-- submit_boe_found: the same seven arguments #865 left it with, so create or
-- replace keeps the anon and authenticated grants. Body verbatim plus the one
-- new column in the insert.
create or replace function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null,
  p_donate boolean default false,
  p_upgrade_rank text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_item_name text;
  v_season text;
  v_rank text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is null then
    raise exception 'Track is required';
  end if;
  if p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;
  v_rank := nullif(regexp_replace(coalesce(p_upgrade_rank, ''), '\s', '', 'g'), '');
  if v_rank is null then
    raise exception 'Upgrade rank is required';
  end if;
  if v_rank <> all (array['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']) then
    raise exception 'Upgrade rank must be one of 1/6 to 6/6';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  select ts.config ->> 'seasonName' into v_season
  from public.team_settings ts where ts.team_id = p_team_id;

  insert into public.boe_items (team_id, player_id, finder_name, finder_discord_id, item_id, item_name, track, upgrade_rank, season, note, payout_donated)
  values (p_team_id, v_player_id, trim(p_name_realm), public.current_discord_id(), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track, v_rank,
          v_season, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_donate, false))
  returning boe_items.id into v_id;

  return v_id;
end $$;

-- A raider reads their own rows: the character they claimed, or the account
-- they submitted from. Both clauses guard against null, so a row with no id
-- never matches an account with none.
alter policy "Raiders read own boe_items" on public.boe_items
  using (
    public.is_own_player(player_id)
    or (finder_discord_id is not null and finder_discord_id = public.current_discord_id())
  );

-- The listings of a row a raider can read come with it. The subquery runs
-- under boe_items' own policies for the caller, so this admits exactly the
-- listings of the rows the policy above admits; boe_listings had no raider
-- read before, which would have left a blank Listings cell on the page.
create policy "Raiders read own boe_listings" on public.boe_listings
  for select
  using (
    exists (
      select 1 from public.boe_items b
      where b.id = boe_item_id
        and (public.is_own_player(b.player_id)
             or (b.finder_discord_id is not null and b.finder_discord_id = public.current_discord_id()))
    )
  );

-- Backfill: rows whose player reaches a member with a Discord id take it (16
-- on prod as of 2026-09-03). Runs as postgres, so the transition trigger's
-- authenticated-only check does not fire; the is-null guard makes a second
-- run a no-op.
do $$
declare
  v_n integer;
begin
  update public.boe_items b
  set finder_discord_id = tm.discord_id
  from public.players p
  join public.team_members tm on tm.id = p.team_member_id
  where p.id = b.player_id
    and b.finder_discord_id is null
    and tm.discord_id is not null;
  get diagnostics v_n = row_count;
  raise notice 'Backfilled finder_discord_id on % boe_items rows', v_n;
end $$;
