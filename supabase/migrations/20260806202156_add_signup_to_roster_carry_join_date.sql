-- add_signup_to_roster carries team_member_id forward on a main swap
-- (20260803230409) but not join_date -- the new character was a plain
-- insert (no on-conflict match on its own name_realm), so it always landed
-- on current_date, silently resetting the raider's displayed tenure every
-- time they swap mains. A main swap is a continuation of membership, not a
-- new join, same reasoning already applied to team_member_id.
--
-- Same 5-arg signature as the current function, so this replaces it in place.
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
          p_is_trial, current_date,
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

    -- Only overwrite when the new row landed on today's date (the plain-insert
    -- path above) -- a reactivated same-name-realm alt already preserved its
    -- own original join_date via the on-conflict branch and shouldn't be
    -- clobbered with the swapped-from character's date instead.
    if v_archived_join_date is not null then
      update public.players set join_date = v_archived_join_date
       where id = v_player_id and join_date = current_date;
    end if;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;
