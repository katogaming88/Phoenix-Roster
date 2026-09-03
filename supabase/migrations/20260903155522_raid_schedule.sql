-- #892 (part of #640): schema for the raid calendar's schedule source.
-- Two tables, no materialized event rows: raid_schedule is the officer-owned
-- recurring weekly rule (team_id/weekday/start_time), and
-- raid_schedule_exceptions layers one-off cancellations/additions on top.
-- The actual list of upcoming raid nights is computed on the fly client-side
-- (computeRaidNights() in js/calendar.js) from these two tables for a given
-- date range -- there is no cron needed to extend a rolling horizon of rows,
-- and no cleanup story for stale past-dated rows.
--
-- is_optional (on both tables) flags a night where there is no automatic
-- Present -- every non-bench roster player must explicitly RSVP (#895,
-- Phase 4). Phase 1 only reads this flag to render "No Response"; the RSVP
-- table and reminder system land in later phases.
--
-- RLS mirrors team_raid_progress's public-read/officer-write shape
-- (20260712173929_raid_progression_tables.sql): everyone reads, only
-- officer-tier roles write. Shipped now even though Phase 1 has no write UI
-- yet, so Phase 3's schedule admin tab doesn't need a follow-up migration
-- just for permissions.

create table "public"."raid_schedule" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "weekday" integer not null,
    "start_time" time not null,
    "timezone" text not null default 'America/New_York',
    "duration_minutes" integer not null default 180,
    "active" boolean not null default true,
    "is_optional" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    constraint "raid_schedule_weekday_check" check (("weekday" between 0 and 6)),
    unique ("team_id", "weekday", "start_time")
);

create table "public"."raid_schedule_exceptions" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "raid_date" date not null,
    "exception_type" text not null,
    "start_time" time,
    "duration_minutes" integer,
    "is_optional" boolean not null default false,
    "note" text,
    "created_by" integer references "public"."team_members"("id") on delete set null,
    "created_at" timestamp with time zone not null default now(),
    constraint "raid_schedule_exceptions_type_check" check (("exception_type" = any (array['cancelled'::text, 'added'::text]))),
    unique ("team_id", "raid_date", "exception_type")
);

comment on table public.raid_schedule is
  'The raid calendar''s officer-owned recurring weekly rule (#892, part of #640): one row per weekday/time this team normally raids. is_optional flags a night with no automatic default-Present (#895) -- every non-bench roster player must explicitly RSVP. Raid nights are computed on the fly from this table plus raid_schedule_exceptions (js/calendar.js, computeRaidNights()), not materialized as rows.';

comment on table public.raid_schedule_exceptions is
  'One-off cancellation or addition on top of raid_schedule''s recurring rule (#892) -- exception_type distinguishes skipping a normally-scheduled night from adding an extra one. is_optional only applies to an ''added'' row.';

alter table "public"."raid_schedule" owner to "postgres";
alter table "public"."raid_schedule_exceptions" owner to "postgres";

alter table "public"."raid_schedule" enable row level security;
alter table "public"."raid_schedule_exceptions" enable row level security;

create policy "Claude readers read raid_schedule" on "public"."raid_schedule" for select to "claude_readers" using (true);
create policy "Claude readers read raid_schedule_exceptions" on "public"."raid_schedule_exceptions" for select to "claude_readers" using (true);

create policy "Public read raid_schedule" on "public"."raid_schedule" for select using (true);
create policy "Public read raid_schedule_exceptions" on "public"."raid_schedule_exceptions" for select using (true);

create policy "Officers write raid_schedule" on "public"."raid_schedule"
    using ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_guild_officer"() or "public"."is_site_admin"()))
    with check ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_guild_officer"() or "public"."is_site_admin"()));

create policy "Officers write raid_schedule_exceptions" on "public"."raid_schedule_exceptions"
    using ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_guild_officer"() or "public"."is_site_admin"()))
    with check ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_guild_officer"() or "public"."is_site_admin"()));
