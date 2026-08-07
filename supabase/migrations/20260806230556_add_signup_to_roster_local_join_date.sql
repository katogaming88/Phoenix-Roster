-- add_signup_to_roster() used current_date for a new character's join_date,
-- which is the DB session's date in UTC (Supabase's default session
-- timezone), not the raid's local date. Confirmed live: pushing pending
-- roster in the evening EDT/EST landed join_date one calendar day ahead
-- (Aug 6 EDT -> Aug 7 UTC once past 8pm EDT / 9pm EST). Same class of bug
-- the rest of this codebase already accounts for elsewhere (e.g.
-- import_rclc_loot()'s awarded_at, mapSupabaseLoot() in js/common.js) --
-- just missed here since join_date is a plain `date`, not a timestamptz,
-- so there was no obvious "at time zone" spot to reach for.
--
-- Fix: compute today's date in America/New_York explicitly instead of
-- relying on the session's (UTC) current_date. Also fixes the join_date
-- carry-over guard added in 20260806202156 -- it compared against
-- current_date too, so it inherited the same one-day-early cutoff in the
-- evening.
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
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;
