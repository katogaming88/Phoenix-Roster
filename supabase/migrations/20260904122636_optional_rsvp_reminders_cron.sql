-- Schedules the optional-rsvp-reminders Edge Function via pg_cron + pg_net
-- (#895, part of #640), exactly matching 20260831174200_blizzard_gear_sync_cron.sql's
-- pattern (both extensions already enabled by 20260713234553_pg_cron_edge_function_scheduling.sql).
--
-- Every 15 minutes: the function itself only acts within a ~15-minute
-- tolerance window around each optional night's 24h/2h checkpoints, so a
-- tighter interval would just be wasted invocations, and a looser one risks
-- missing a checkpoint window entirely.
--
-- Requires the OPTIONAL_RSVP_REMINDERS_SECRET vault secret to exist before
-- this runs (same pattern as blizzard_gear_sync_secret/twitch_live_check_secret)
-- -- run once, by hand, in the SQL Editor, reusing the same value already
-- set as the optional-rsvp-reminders Edge Function's OPTIONAL_RSVP_REMINDERS_SECRET
-- secret (Project Settings > Edge Functions > Secrets):
--
--   select vault.create_secret('<the OPTIONAL_RSVP_REMINDERS_SECRET value>', 'optional_rsvp_reminders_secret', 'Shared secret for optional-rsvp-reminders pg_cron caller');

do $$
begin
  perform cron.unschedule('optional-rsvp-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'optional-rsvp-reminders',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/optional-rsvp-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'optional_rsvp_reminders_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
