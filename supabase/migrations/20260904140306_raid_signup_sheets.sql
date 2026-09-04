-- #900 (part of #640): DB objects for the bot-owned aggregated Discord
-- "signup sheet" -- one message per raid night showing the whole roster's
-- status at a glance, edited in place as people respond, replacing nothing
-- (the existing per-status-change ping from #893's set_own_rsvp()/
-- /rsvp-status stays untouched). All the actual logic -- roster/RSVP
-- queries, role grouping, embed building, message-ID bookkeeping,
-- create-vs-edit -- lives in the bot (wga-raid-bot's new src/signupSheet.ts)
-- via its own service-role Supabase client, same precedent as
-- src/wishlistStatus.ts's fetchNudgeCandidates(). These two objects are
-- what that bot-side logic depends on:
--
--   raid_signup_sheets: pure bookkeeping (which channel/message holds the
--   one edited-in-place embed per team/raid_date), locked to the service
--   role, same shape as raid_rsvp_reminders_sent (#895).
--
--   claim_raid_signup_sheet(): atomic get-or-create so the bot knows
--   whether to create a new message or edit an existing one, and so two
--   near-simultaneous callers don't both create one. A rare remaining race
--   (two truly-simultaneous first-ever calls for a brand-new date) is
--   accepted as self-healing -- see the function's own comment.
--
--   raid_night_info(): raid_schedule/raid_schedule_exceptions precedence,
--   same three tiers as is_optional_raid_night() (20260904122610), but
--   also surfacing start_time/timezone/existence -- the bot needs these for
--   the embed header and its proactive lead-time sweep. Written as
--   plpgsql with explicit branches (matches set_own_rsvp()'s style) rather
--   than a clever single-coalesce SQL one-liner, for clarity.

create table "public"."raid_signup_sheets" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "raid_date" date not null,
    "channel_id" text,
    "message_id" text,
    "updated_at" timestamp with time zone not null default now(),
    unique ("team_id", "raid_date")
);

comment on table public.raid_signup_sheets is
  'Bookkeeping for the bot-owned aggregated signup-sheet Discord message (#900, part of #640): tracks which channel/message holds the one edited-in-place embed per team/raid_date. Written and read only by the bot''s service-role client via claim_raid_signup_sheet(); no read use case for an officer or end user. Mirrors raid_rsvp_reminders_sent''s locked-down shape (#895).';

alter table "public"."raid_signup_sheets" owner to "postgres";
alter table "public"."raid_signup_sheets" enable row level security;

create policy "Claude readers read raid_signup_sheets" on "public"."raid_signup_sheets" for select to "claude_readers" using (true);

-- No other grants: locked to the service role (and claude_readers) only,
-- same as raid_rsvp_reminders_sent.

create or replace function "public"."claim_raid_signup_sheet"(
    "p_team_id" integer,
    "p_raid_date" date,
    "p_channel_id" text
) returns table("message_id" text)
language plpgsql
as $$
declare
  v_channel_id text;
  v_message_id text;
  v_found boolean;
begin
  select r.channel_id, r.message_id into v_channel_id, v_message_id
  from raid_signup_sheets r
  where r.team_id = p_team_id and r.raid_date = p_raid_date
  for update;
  v_found := found;

  if not v_found then
    begin
      insert into raid_signup_sheets (team_id, raid_date, channel_id, message_id, updated_at)
      values (p_team_id, p_raid_date, p_channel_id, null, now());
      return query select null::text;
      return;
    exception when unique_violation then
      -- Rare race: two truly-simultaneous first-ever calls for this date
      -- both missed the row lock above because neither row existed yet to
      -- lock. Self-healing: re-select and fall through to the normal path
      -- below -- worst case is one extra duplicate message, never repeating,
      -- since only one message_id ever survives in the row going forward.
      select r.channel_id, r.message_id into v_channel_id, v_message_id
      from raid_signup_sheets r
      where r.team_id = p_team_id and r.raid_date = p_raid_date
      for update;
    end;
  end if;

  if v_channel_id is distinct from p_channel_id then
    -- Officer reconfigured the channel since this row was created -- the
    -- stored message_id (if any) lives in the old channel and can't be
    -- edited from the new one. Reset so the caller creates a fresh message.
    update raid_signup_sheets
    set channel_id = p_channel_id, message_id = null, updated_at = now()
    where team_id = p_team_id and raid_date = p_raid_date;
    return query select null::text;
    return;
  end if;

  return query select v_message_id;
end;
$$;

alter function "public"."claim_raid_signup_sheet"(integer, date, text) owner to "postgres";

comment on function "public"."claim_raid_signup_sheet"(integer, date, text) is
  'Atomic get-or-create for raid_signup_sheets (#900, part of #640) -- row-locks the (team_id, raid_date) tracking row and tells the bot whether to CREATE (null message_id) or EDIT (non-null) the aggregated signup-sheet embed. Resets message_id to null if the configured channel changed since the row was created. Service-role only -- the bot writes the freshly-created message_id itself afterward, guarded on message_id still being null.';

grant execute on function "public"."claim_raid_signup_sheet"(integer, date, text) to service_role;

create or replace function "public"."raid_night_info"(
    "p_team_id" integer,
    "p_raid_date" date
) returns table("exists" boolean, "start_time" time, "timezone" text, "is_optional" boolean)
language plpgsql
stable
set search_path = public
as $$
declare
  v_weekday integer := extract(dow from p_raid_date);
  v_cancelled boolean;
  v_added raid_schedule_exceptions%rowtype;
  v_rule raid_schedule%rowtype;
begin
  select true into v_cancelled
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'cancelled';

  if v_cancelled then
    return query select false, null::time, null::text, null::boolean;
    return;
  end if;

  select * into v_added
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'added';

  if found then
    return query select true, v_added.start_time, 'America/New_York'::text, v_added.is_optional;
    return;
  end if;

  select * into v_rule
  from raid_schedule
  where team_id = p_team_id and active and weekday = v_weekday;

  if found then
    return query select true, v_rule.start_time, v_rule.timezone, v_rule.is_optional;
    return;
  end if;

  return query select false, null::time, null::text, null::boolean;
end;
$$;

alter function "public"."raid_night_info"(integer, date) owner to "postgres";

comment on function "public"."raid_night_info"(integer, date) is
  'Whether a given raid_date is a real raid night for a team, plus its start_time/timezone/is_optional (#900, part of #640) -- same raid_schedule/raid_schedule_exceptions precedence as is_optional_raid_night() (cancelled exception wins > added exception wins > active recurring rule > not a raid night), extended to surface the fields the bot''s embed header and proactive lead-time sweep need. raid_schedule_exceptions has no timezone column, so an ''added'' night is assumed America/New_York, matching every other place in this schema that treats it as the implicit single timezone. Keep in sync with is_optional_raid_night() and js/calendar.js''s computeRaidNights() if this precedence ever changes.';

grant execute on function "public"."raid_night_info"(integer, date) to service_role;
