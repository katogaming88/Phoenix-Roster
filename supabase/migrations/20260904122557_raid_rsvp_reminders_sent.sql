-- #895 (part of #640, Phase 4): pure dedup log for the optional-night 24h/2h
-- DM reminder sweep (optional-rsvp-reminders Edge Function, on a pg_cron
-- schedule -- see the sibling cron migration). A row here means "the bot was
-- already asked to DM this player for this raid_date/checkpoint", nothing
-- more -- it is NOT the source of truth for whether the player has actually
-- responded (that's raid_rsvps; a row there is what actually stops the
-- reminder sweep from firing again). Written only by the Edge Function via
-- the service-role key -- no grants for anyone else, no read use case for
-- an end user or officer (unlike audit_log, checkpoints here are meaningless
-- without cross-referencing raid_rsvps/raid_schedule anyway, and a service
-- role query in the SQL editor is enough for debugging).

create table "public"."raid_rsvp_reminders_sent" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "raid_date" date not null,
    "checkpoint" text not null,
    "sent_at" timestamp with time zone not null default now(),
    constraint "raid_rsvp_reminders_sent_checkpoint_check" check (("checkpoint" = any (array['24h'::text, '2h'::text]))),
    unique ("team_id", "player_id", "raid_date", "checkpoint")
);

comment on table public.raid_rsvp_reminders_sent is
  'Dedup log for the optional-night DM reminder sweep (#895, part of #640) -- records that a 24h/2h reminder was already sent for a player/raid_date/checkpoint so the cron sweep does not re-DM on every tick. Insert-only, written solely by the optional-rsvp-reminders Edge Function via the service role. Not the source of truth for whether a player has responded -- that is raid_rsvps.';

alter table "public"."raid_rsvp_reminders_sent" owner to "postgres";

alter table "public"."raid_rsvp_reminders_sent" enable row level security;

create policy "Claude readers read raid_rsvp_reminders_sent" on "public"."raid_rsvp_reminders_sent" for select to "claude_readers" using (true);

-- No other grants: locked to the service role (and claude_readers, per the
-- uniform read-only AI-access policy every table carries) only.
