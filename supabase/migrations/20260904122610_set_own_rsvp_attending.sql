-- #895 (part of #640, Phase 4): lets set_own_rsvp() accept 'Attending' on an
-- optional raid night, and relaxes the bench guard for that one case.
--
-- is_optional_raid_night() ports js/calendar.js's computeRaidNights()
-- precedence into SQL so both this RPC's server-side gate and the
-- optional-rsvp-reminders Edge Function's date-window scan agree on exactly
-- what counts as an optional night, rather than maintaining that precedence
-- in two languages: a cancelled exception on the date wins (not a raid
-- night at all, regardless of the recurring rule); else an added exception
-- on the date wins (is a raid night, optional-ness from that row); else an
-- active raid_schedule row for that weekday (is a raid night, optional-ness
-- from that row); else not a raid night.
create or replace function "public"."is_optional_raid_night"(
    "p_team_id" integer,
    "p_raid_date" date
) returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select is_optional
      from raid_schedule_exceptions
      where team_id = p_team_id
        and raid_date = p_raid_date
        and exception_type = 'added'
    ),
    (
      select rs.is_optional
      from raid_schedule rs
      where rs.team_id = p_team_id
        and rs.active
        and rs.weekday = extract(dow from p_raid_date)
        and not exists (
          select 1 from raid_schedule_exceptions ex
          where ex.team_id = p_team_id
            and ex.raid_date = p_raid_date
            and ex.exception_type = 'cancelled'
        )
    ),
    false
  );
$$;

alter function "public"."is_optional_raid_night"(integer, date) owner to "postgres";

comment on function "public"."is_optional_raid_night"(integer, date) is
  'Whether a given raid_date is an optional raid night for a team, per raid_schedule/raid_schedule_exceptions (#895, part of #640). Shared by set_own_rsvp() (server-side gate on the Attending status and the relaxed bench check) and the optional-rsvp-reminders Edge Function, so the recurring-rule/exception precedence lives in exactly one place. Mirrors js/calendar.js''s computeRaidNights() -- keep both in sync if that precedence ever changes.';

-- Bench players are still blocked entirely on a normal night (nothing to
-- override there -- see the original migration's comment); on an optional
-- night that reasoning doesn't hold, since there is no default status for
-- anyone, bench included, and bench players are exactly the ones who might
-- get pulled in for a bonus/optional clear. 'Attending' itself stays
-- rejected outside an optional night for every caller, bench or not.
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
  v_is_optional boolean;
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

  v_is_optional := is_optional_raid_night(p_team_id, p_raid_date);

  if v_is_bench and not v_is_optional then
    raise exception 'Bench players cannot set an RSVP status.';
  end if;

  if p_status is null then
    delete from raid_rsvps where team_id = p_team_id and player_id = v_player_id and raid_date = p_raid_date;
    return;
  end if;

  if p_status not in ('Attending', 'Late', 'Leaving Early', 'Tentative', 'Absent') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  if p_status = 'Attending' and not v_is_optional then
    raise exception 'Attending is only valid on an optional raid night.';
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

revoke all on function "public"."is_optional_raid_night"(integer, date) from public;
revoke execute on function "public"."is_optional_raid_night"(integer, date) from anon;
grant execute on function "public"."is_optional_raid_night"(integer, date) to authenticated;
