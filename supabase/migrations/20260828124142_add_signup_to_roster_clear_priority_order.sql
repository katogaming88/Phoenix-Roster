-- remove_player_priority_order() (20260828022325) only got wired into the
-- explicit "Remove Player" roster flow (js/tabs/tab-roster.js). A main-swap
-- also archives a player row (add_signup_to_roster()'s p_archive_player_id
-- path) but never called it, so a swapped-from character kept showing up in
-- the officer Priority tab, the RCLootCouncil export, and the addon's Full
-- Priority Order panel indefinitely -- the same bug the RPC was written to
-- fix, just reachable through a second door. Confirmed live: today's two
-- Team 1 main-swaps left players 179 and 198 with 20 and 26 stale
-- priority_order rows in the live season (MID2).
--
-- Fix: fold the same cleanup directly into add_signup_to_roster() so it
-- applies regardless of which UI path archives the player, instead of
-- patching every JS call site (there are two today, `git grep` is the only
-- way to be sure there won't be a third later). Scoped to the archived
-- player's team's live season only, same reasoning as the RPC and its
-- backfill (20260828023851): past seasons are a historical record. The live
-- season code isn't stored anywhere as a code -- team_settings.config
-- ->>'seasonName' holds the display name ("Midnight Season 2") -- so this
-- reproduces the same regexp_replace conversion that backfill migration
-- used, since there's still no server-side single source of truth to call
-- instead.
--
-- Same 5-arg signature, so this replaces the function in place.
create or replace function public.add_signup_to_roster(
  p_signup_id integer,
  p_is_trial boolean default true,
  p_archive_player_id integer default null,
  p_is_backup_tank boolean default false,
  p_is_backup_healer boolean default false
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
  v_archived_team_member_id integer;
  v_archived_join_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_live_season text;
begin
  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
  end if;
  if v_signup.status is distinct from 'approved' then
    raise exception 'signup % is not in approved status (is %)',
      p_signup_id, v_signup.status;
  end if;

  insert into public.players (
    team_id, name_realm, class_spec_id, is_trial, join_date,
    is_backup_tank, is_backup_healer
  )
  values (v_signup.team_id, v_signup.signup_name_realm,
          coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id),
          p_is_trial, v_today,
          p_is_backup_tank, p_is_backup_healer)
  on conflict (team_id, name_realm) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial  = case when players.archived_at is not null
                         then excluded.is_trial else players.is_trial end,
        join_date = case when players.archived_at is not null
                         then excluded.join_date else players.join_date end,
        is_backup_tank = case when players.archived_at is not null
                         then excluded.is_backup_tank else players.is_backup_tank end,
        is_backup_healer = case when players.archived_at is not null
                         then excluded.is_backup_healer else players.is_backup_healer end,
        archived_at = null
  returning id into v_player_id;

  if p_archive_player_id is not null then
    select team_member_id, join_date
      into v_archived_team_member_id, v_archived_join_date
      from public.players
     where id = p_archive_player_id and team_id = v_signup.team_id;

    update public.players set archived_at = now(), team_member_id = null
     where id = p_archive_player_id and team_id = v_signup.team_id;

    if v_archived_team_member_id is not null then
      update public.players set team_member_id = v_archived_team_member_id
       where id = v_player_id and team_member_id is null;
    end if;

    -- Only overwrite when the new row is still on today's (local) date. That
    -- covers both the plain-insert path above AND a reactivated same-name-
    -- realm alt: the on-conflict branch already refreshes a reactivated
    -- archived character's join_date to today too (same as it refreshes
    -- is_trial), so there's no "alt's own original date" being protected
    -- here either way -- landing the swapped-from date on top of that
    -- today's-date keeps "main swap = continuation of tenure" true even
    -- when the destination is a known alt, not just a brand-new character.
    if v_archived_join_date is not null then
      update public.players set join_date = v_archived_join_date
       where id = v_player_id and join_date = v_today;
    end if;

    -- Carry attendance history to the new character. Skip any raid_date
    -- the new (destination) player already has its own row for -- that
    -- only happens on a reactivated-alt swap where the alt has independent
    -- attendance, and the unique (team_id, player_id, raid_date)
    -- constraint would otherwise abort the whole swap.
    update public.attendance a set player_id = v_player_id
     where a.player_id = p_archive_player_id
       and a.team_id = v_signup.team_id
       and not exists (
         select 1 from public.attendance b
          where b.team_id = v_signup.team_id
            and b.player_id = v_player_id
            and b.raid_date = a.raid_date
       );

    -- Drop the archived character's standing priority_order rows for the
    -- live season only, same as remove_player_priority_order() -- they no
    -- longer belong on the roster, so they shouldn't keep occupying a slot
    -- in the Priority tab, RCLootCouncil export, or addon panel.
    select regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1')
      into v_live_season
      from public.team_settings ts
     where ts.team_id = v_signup.team_id;

    if v_live_season is not null then
      delete from public.priority_order
       where team_id = v_signup.team_id
         and season = v_live_season
         and player_id = p_archive_player_id;
    end if;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;
