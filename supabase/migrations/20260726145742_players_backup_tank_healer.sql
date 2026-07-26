-- Designated backup tank/backup healer roster flags. Independent booleans,
-- not exclusive to a player's own role (a Melee DPS with an offspec can be
-- the backup tank) and not limited to one holder each -- multiple raiders
-- can carry either designation at once, same as is_trial/is_bench.

alter table public.players
  add column if not exists is_backup_tank boolean not null default false,
  add column if not exists is_backup_healer boolean not null default false;

-- Threaded through the same way is_trial already is: there's no column on
-- season_signups for it, since the designation is only decided at promotion
-- time via a checkbox on the pending roster card (js/tabs/tab-pending-roster.js),
-- not stored on the signup itself.
--
-- Adding the two new params as trailing arguments with defaults still
-- produces a second, distinct overload here rather than replacing the
-- original in place (Postgres only replaces in-place at matching arg count) --
-- confirmed against a local reset, which left both the 3-arg and 5-arg
-- functions callable side by side. Drop the old one explicitly so there's
-- exactly one, and re-grant from scratch: a genuinely new function doesn't
-- inherit the original's grants, and Postgres grants EXECUTE to PUBLIC by
-- default (anon included) for any new function, not just authenticated.
drop function if exists public.add_signup_to_roster(integer, boolean, integer);

create function public.add_signup_to_roster(
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
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;

revoke execute on function public.add_signup_to_roster(integer, boolean, integer, boolean, boolean)
  from public, anon;
grant execute on function public.add_signup_to_roster(integer, boolean, integer, boolean, boolean)
  to authenticated;
