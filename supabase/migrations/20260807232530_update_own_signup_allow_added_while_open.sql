-- update_own_signup() previously locked a signup outright once its status
-- reached 'added' (promoted onto the roster), even while the team's signup
-- window for that season was still open and other raiders were still
-- submitting. That's the wrong bar: an 'added' row the raider can still see
-- via get_own_signup() (scoped to team_settings.config.activeSignupSeason)
-- already implies the season's signups are still open -- get_own_signup only
-- returns a row whose season matches the currently active signup season, so
-- "I'm looking at my added signup" and "signups for this season are still
-- open" are the same fact. Once an officer moves activeSignupSeason on,
-- get_own_signup stops returning the row at all and the raider gets a fresh
-- form instead -- so this only ever unlocks editing during the actual open
-- window, never after.
--
-- Editing an 'added' signup does NOT touch the live players row. It reverts
-- the signup to 'pending' -- same as editing an 'approved'-but-not-yet-
-- promoted signup already did -- so the change goes back through officer
-- review and a fresh add_signup_to_roster() promotion (which upserts by
-- name_realm, so it naturally applies the edited class/spec/name to the
-- existing roster character) rather than silently overwriting the roster
-- unreviewed. approved_player_id is cleared alongside status: the
-- season_signups_player_only_when_added CHECK requires it be null on any
-- non-'added' row.
create or replace function public.update_own_signup(
  p_signup_id integer,
  p_name_realm text,
  p_class text,
  p_spec text,
  p_off_specs text default '',
  p_main_swap boolean default false,
  p_player_note text default null,
  p_swap_from_name_realm text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_approved_player_id integer;
  v_team_id integer;
  v_row_season text;
  v_active_season text;
  v_class_spec_id integer;
  v_updated_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Diagnostic-only pre-check, purely for a clearer error message; the real
  -- authorization guard is the UPDATE's WHERE clause below.
  select auth_user_id, status, approved_player_id, team_id, season
    into v_owner, v_status, v_approved_player_id, v_team_id, v_row_season
  from public.season_signups where id = p_signup_id;

  if v_owner is null or v_owner is distinct from v_uid then
    raise exception 'Signup not found';
  end if;
  if v_status = 'rejected' then
    raise exception 'This signup was not approved and can no longer be edited';
  end if;
  if v_status = 'added' then
    select config->>'activeSignupSeason' into v_active_season
    from public.team_settings where team_id = v_team_id;
    if v_row_season is distinct from v_active_season then
      raise exception 'This signup has already been added to the roster and can no longer be edited';
    end if;
  elsif not (v_status = 'pending' or (v_status = 'approved' and v_approved_player_id is null)) then
    raise exception 'This signup can no longer be edited';
  end if;

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  update public.season_signups s set
    signup_name_realm = p_name_realm,
    class_spec_id = case when p_main_swap then null else v_class_spec_id end,
    off_specs = nullif(p_off_specs, ''),
    main_swap = p_main_swap,
    swap_class_spec_id = case when p_main_swap then v_class_spec_id else null end,
    swap_from_name_realm = case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end,
    player_note = nullif(p_player_note, ''),
    status = case when s.status in ('approved', 'added') then 'pending' else s.status end,
    approved_player_id = case when s.status = 'added' then null else s.approved_player_id end,
    reviewed_at = case when s.status in ('approved', 'added') then null else s.reviewed_at end,
    reviewed_by = case when s.status in ('approved', 'added') then null else s.reviewed_by end,
    signup_officer_note = case when s.status in ('approved', 'added') then null else s.signup_officer_note end
  where s.id = p_signup_id
    and s.auth_user_id = v_uid
    and (
      s.status = 'pending'
      or (s.status = 'approved' and s.approved_player_id is null)
      or (
        s.status = 'added'
        and s.season is not distinct from (
          select config->>'activeSignupSeason' from public.team_settings where team_id = s.team_id
        )
      )
    )
  returning s.id into v_updated_id;

  if not found then
    raise exception 'This signup can no longer be edited';
  end if;

  return v_updated_id;
end $$;

revoke all on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) from public;
revoke execute on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) from anon;
grant execute on function public.update_own_signup(integer, text, text, text, text, boolean, text, text) to authenticated;
