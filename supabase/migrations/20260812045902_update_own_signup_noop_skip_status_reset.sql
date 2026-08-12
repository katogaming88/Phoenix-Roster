-- Two related bugs, both from `season_signups` going stale once an officer
-- manually edits the roster directly (Roster tab class/spec edit, or a
-- rename) instead of going through a fresh signup review:
--
-- 1. update_own_signup() unconditionally reset an 'approved'/'added' signup
--    back to 'pending' (clearing approved_player_id/reviewed_*) on every
--    edit call, even when nothing actually changed. Confirmed live:
--    Khaosmagi (Mage/Arcane, already on the roster as Mage/Arcane) opened
--    their signup and hit Submit without changing anything, kicking their
--    already-approved signup back into the officer review queue for no
--    reason. Kat denied it manually since there was nothing to review.
-- 2. get_own_signup() (the read side, used to pre-fill the "edit your
--    signup" form) only ever reads season_signups' own stored snapshot --
--    it never reflects a manual roster edit made after the signup was
--    added. Confirmed live: Rod renamed Noctrana to Raintotem directly on
--    the roster; Raintotem then opened their signup to re-submit and the
--    form still showed "Noctrana", not their actual current character.
--
-- Both are the same root problem: once a signup is 'added' (linked via
-- approved_player_id to a real players row), that players row -- not the
-- signup's own stored snapshot -- is the source of truth for name/class/
-- spec, since it's the one thing that can still be edited independently by
-- an officer afterward. off_specs/player_note/main_swap/swap_from_name_realm
-- have no roster equivalent to go stale against, so those still come from
-- the signup snapshot as before.
--
-- get_own_signup(): for an 'added' row, prefer the live players row's
-- name_realm/class/spec over the signup's own stored columns.
create or replace function public.get_own_signup(p_team_id integer)
returns table(
  id integer,
  signup_name_realm text,
  class text,
  spec text,
  off_specs text,
  main_swap boolean,
  swap_class text,
  swap_spec text,
  swap_from_name_realm text,
  player_note text,
  status text,
  season text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_season text;
begin
  if v_uid is null then
    return;
  end if;

  select config->>'activeSignupSeason' into v_season
  from public.team_settings where team_id = p_team_id;

  return query
  select s.id,
         coalesce(live.name_realm, s.signup_name_realm),
         coalesce(cs_live.class, cs_main.class),
         coalesce(cs_live.spec, cs_main.spec),
         s.off_specs, s.main_swap,
         cs_swap.class, cs_swap.spec, s.swap_from_name_realm,
         s.player_note, s.status, s.season, s.submitted_at
  from public.season_signups s
  left join public.classes_specs cs_main on cs_main.id = s.class_spec_id
  left join public.classes_specs cs_swap on cs_swap.id = s.swap_class_spec_id
  left join public.players live on live.id = s.approved_player_id
  left join public.classes_specs cs_live on cs_live.id = live.class_spec_id
  where s.team_id = p_team_id
    and s.auth_user_id = v_uid
    and s.season is not distinct from v_season
  order by s.submitted_at desc
  limit 1;
end $$;

-- update_own_signup(): compare the incoming edit against the row's *current
-- truth* -- the live players row (via approved_player_id) when one exists,
-- falling back to the signup's own stored snapshot otherwise (pending/
-- approved-but-not-yet-added rows have no linked player of their own yet).
-- If every meaningful field matches, the update becomes a true no-op --
-- status/approved_player_id/reviewed_*/signup_officer_note are left exactly
-- as they were, so an approved/added signup stays approved/added instead of
-- bouncing back to pending. A genuine change to any of those fields still
-- resets status exactly as before.
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
  v_old_off_specs text;
  v_old_main_swap boolean;
  v_old_swap_from_name_realm text;
  v_old_player_note text;
  v_current_name_realm text;
  v_current_class_spec_id integer;
  v_live_name_realm text;
  v_live_class_spec_id integer;
  v_new_class_spec_id integer;
  v_new_swap_class_spec_id integer;
  v_new_swap_from_name_realm text;
  v_no_change boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Diagnostic-only pre-check, purely for a clearer error message; the real
  -- authorization guard is the UPDATE's WHERE clause below. Also doubles as
  -- the "before" snapshot for the no-change comparison.
  select auth_user_id, status, approved_player_id, team_id, season,
         signup_name_realm, coalesce(swap_class_spec_id, class_spec_id),
         off_specs, main_swap, swap_from_name_realm, player_note
    into v_owner, v_status, v_approved_player_id, v_team_id, v_row_season,
         v_current_name_realm, v_current_class_spec_id,
         v_old_off_specs, v_old_main_swap, v_old_swap_from_name_realm, v_old_player_note
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

  -- An 'added' signup's own stored name/class/spec can go stale the moment
  -- an officer edits the linked player directly (rename, class/spec change)
  -- -- the live players row is the real current truth in that case, not
  -- whatever this signup last recorded.
  if v_approved_player_id is not null then
    select name_realm, class_spec_id into v_live_name_realm, v_live_class_spec_id
    from public.players where id = v_approved_player_id;
    if found then
      v_current_name_realm := v_live_name_realm;
      v_current_class_spec_id := v_live_class_spec_id;
    end if;
  end if;

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  v_new_class_spec_id := case when p_main_swap then null else v_class_spec_id end;
  v_new_swap_class_spec_id := case when p_main_swap then v_class_spec_id else null end;
  v_new_swap_from_name_realm := case when p_main_swap then nullif(p_swap_from_name_realm, '') else null end;

  v_no_change :=
    v_current_name_realm is not distinct from p_name_realm
    and v_current_class_spec_id is not distinct from coalesce(v_new_swap_class_spec_id, v_new_class_spec_id)
    and v_old_off_specs is not distinct from nullif(p_off_specs, '')
    and v_old_main_swap is not distinct from p_main_swap
    and v_old_swap_from_name_realm is not distinct from v_new_swap_from_name_realm
    and v_old_player_note is not distinct from nullif(p_player_note, '');

  update public.season_signups s set
    signup_name_realm = p_name_realm,
    class_spec_id = v_new_class_spec_id,
    off_specs = nullif(p_off_specs, ''),
    main_swap = p_main_swap,
    swap_class_spec_id = v_new_swap_class_spec_id,
    swap_from_name_realm = v_new_swap_from_name_realm,
    player_note = nullif(p_player_note, ''),
    status = case when not v_no_change and s.status in ('approved', 'added') then 'pending' else s.status end,
    approved_player_id = case when not v_no_change and s.status = 'added' then null else s.approved_player_id end,
    reviewed_at = case when not v_no_change and s.status in ('approved', 'added') then null else s.reviewed_at end,
    reviewed_by = case when not v_no_change and s.status in ('approved', 'added') then null else s.reviewed_by end,
    signup_officer_note = case when not v_no_change and s.status in ('approved', 'added') then null else s.signup_officer_note end
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

revoke all on function public.get_own_signup(integer) from public;
revoke execute on function public.get_own_signup(integer) from anon;
grant execute on function public.get_own_signup(integer) to authenticated;
