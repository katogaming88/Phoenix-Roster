-- #629: wcl-progression-sync only ever queried Mythic difficulty, so
-- team_raid_progress had a heroic_date column (added alongside mythic_date
-- in the original #285 migration) that nothing ever wrote to -- Heroic kill
-- dates only existed via the officer-triggered manual "Fetch from WCL"
-- button (wcl-sync's fetchProgression), not the automatic cron sync.
--
-- Extending the sync to also aggregate Heroic (see the wcl-progression-sync
-- function body change alongside this migration) needs the same four
-- per-difficulty columns Mythic already has -- heroic_date alone can't carry
-- pull count / best-%-remaining / report link the way mythic_pulls/
-- mythic_best_pct/mythic_report_code/mythic_fight_id do for Mythic.
alter table "public"."team_raid_progress"
  add column "heroic_pulls" integer,
  add column "heroic_best_pct" numeric(5,2),
  add column "heroic_report_code" text,
  add column "heroic_fight_id" integer;
