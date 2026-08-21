-- Widen wcl-progression-sync's pg_cron window from 9:30pm-midnight Eastern
-- (padded 1:00-5:30 UTC, see 20260713234553_pg_cron_edge_function_scheduling.sql)
-- to 8pm-2am Eastern, per Kat's request (2026-08-21) -- the old window was
-- too tight around the raid's actual start/end times.
--
-- Same DST-safe padding approach as the original: pg_cron is UTC-only and
-- doesn't adjust for US DST, so the window covers both offsets year-round
-- rather than needing a manual twice-a-year edit:
--   EDT (Mar-Nov, UTC-4): 8pm-2am ET = 00:00-06:00 UTC next day
--   EST (Nov-Mar, UTC-5): 8pm-2am ET = 01:00-07:00 UTC next day
--   -> polls 00:00-07:30 UTC (the trailing :30 tick is the normal half-hour
--      grid overshoot, not extra padding) to cover both.
-- Days unchanged: a UTC weekday is one calendar day ahead of the Eastern
-- evening it follows, so Mon/Tue/Thu ET nights still land on Tue/Wed/Fri UTC
-- (cron dow 2,3,5) -- see the original migration/wcl-progression-sync.yml's
-- header comment for the full explanation.

-- Idempotent re-run: cron.schedule() with a name already in use creates a
-- second duplicate job on some pg_cron versions rather than replacing it
-- (see the original migration's own note), so unschedule first.
do $$
begin
  perform cron.unschedule('wcl-progression-sync');
exception when others then
  null;
end $$;

select cron.schedule(
  'wcl-progression-sync',
  '0,30 0-7 * * 2,3,5',
  $cron$
  select net.http_post(
    url := 'https://kxgjqnpwfklbgrxdgmmv.supabase.co/functions/v1/wcl-progression-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wcl_progress_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
