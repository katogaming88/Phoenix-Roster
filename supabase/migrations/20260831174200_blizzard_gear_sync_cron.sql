-- Schedules the blizzard-gear-sync Edge Function via pg_cron + pg_net,
-- exactly matching 20260713234553_pg_cron_edge_function_scheduling.sql's
-- pattern for twitch-live-check/wcl-progression-sync (both extensions are
-- already enabled by that migration, no need to re-create them here).
--
-- Once daily rather than every 5 minutes like twitch-live-check: equipped
-- gear doesn't change intra-day for most raiders, and this loops every
-- active player on every team against the Blizzard API one at a time --
-- there's no reason to hit that on a tight interval. Runs at 10am UTC
-- (6am/5am Eastern depending on DST), well clear of raid nights
-- (wcl-progression-sync's window is 9:30pm-midnight Eastern) and any
-- officer actively using the Priority tab.
--
-- Requires the BLIZZARD_GEAR_SYNC_SECRET vault secret to exist before this
-- runs (same as twitch_live_check_secret/wcl_progress_sync_secret) -- run
-- once, by hand, in the SQL Editor, reusing the same value already set as
-- the blizzard-gear-sync Edge Function's BLIZZARD_GEAR_SYNC_SECRET secret
-- (Project Settings > Edge Functions > Secrets):
--
--   select vault.create_secret('<the BLIZZARD_GEAR_SYNC_SECRET value>', 'blizzard_gear_sync_secret', 'Shared secret for blizzard-gear-sync pg_cron caller');

do $$
begin
  perform cron.unschedule('blizzard-gear-sync');
exception when others then
  null;
end $$;

select cron.schedule(
  'blizzard-gear-sync',
  '0 10 * * *',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/blizzard-gear-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'blizzard_gear_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
