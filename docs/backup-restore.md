# Backups & Recovery

Nightly logical dumps of the Supabase database, shipped off-provider to Cloudflare R2 -- the Supabase free tier has no PITR or automated backups, so this is the only recovery path for in-app data today.

This doc covers what exists and why, then the runbook: step-by-step recovery for the two failure shapes (a bad delete, a lost project), and the drill log recording every rehearsal.

## Setup

- **R2 bucket** (`wga-raid-hub-backups`): see #541 for how it and its scoped API token were created.
- **Repo secrets**: `SUPABASE_DB_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` -- see #542.
- **The workflow**: `.github/workflows/db-backup.yml`, runs nightly (~10:00 UTC) plus manual `workflow_dispatch`. See the workflow's own header comment for the full mechanics (dump, restore-verification, upload).

## What gets backed up

Two objects per run, at `pg/wga-<YYYY-MM-DD>.dump` and `pg/wga-auth-<YYYY-MM-DD>.dump` in the bucket:

- **`pg/wga-<date>.dump`** -- `pg_dump -Fc` of the entire `public` schema (schema + data). Standalone restorable; this is the artifact that matters for actual recovery.
- **`pg/wga-auth-<date>.dump`** -- `pg_dump -Fc --data-only` of the `auth` schema (`auth.users` + identities only). Kept as a relink reference for `team_members.auth_user_id` -- `auth`'s own table structure is Supabase-managed, not ours to back up structurally.

**Retention**: an R2 lifecycle rule on the bucket (`pg-backup-retention`, prefix `pg/`) deletes objects after 365 days. Set manually in the Cloudflare dashboard (R2 -> bucket -> Settings -> Object lifecycle rules), not by the workflow -- see #546. No `monthly/`-prefix long-term keepers exist past that window; revisit if that's ever needed.

## What the nightly verification proves, and what it does not

Worth being precise about, because "restore verification runs every night" reads stronger than what the check actually asserts.

**It proves**: last night's dump artifact restores into a clean `postgres:17` container, the public schema comes back with at least 20 base tables, and each table in the verify step's `EMPTY_CHECK` list comes back with at least one row. That catches a corrupt or truncated archive, a table that disappeared from the dump, and a table that restored completely empty.

**It does not prove the data is complete.** A floor of one row is cleared by a table that restored 5 of 2402 rows, and nothing compares restored counts against the source database. The `pg_restore` exit code is also discarded (see the comment in the verify step for why it has to be tolerated in this container), so a dump producing many more errors than the nine the 2026-07-23 drill established is indistinguishable from a clean one. Since `pg_restore` creates constraints after loading data, that discarded signal is where a partially restored parent table would otherwise show up.

Both gaps are tracked in [#700](https://github.com/katogaming88/WGA-Raid-Hub/issues/700). Until then, treat a green nightly run as "the archive is intact and nothing is missing wholesale", not as "the data is verified".

## Coverage map: what's regenerable vs. backup-only

Every `public` base table appears below. That is the point of the list: a table missing from it during an incident reads as "no answer" and gets guessed at, which is how the wrong call gets made under time pressure.

**Regenerable without a backup** -- these can be rebuilt from other sources if lost:

- The schema itself, from `supabase/migrations/`.
- `items`/`item_bosses` (the loot catalog), from `scripts/fetch-items.js` + the manual SQL import workflow (`docs/updating-fetch-items-for-new-tier.md`).
- `tier_token_map`, alongside the same catalog import.
- `raid_zones`/`raid_encounters`, re-derivable from Warcraft Logs.
- `player_wcl_season_perf` and `team_raid_progress`, re-fetched by the `wcl-sync` and `wcl-progression-sync` Edge Functions.
- `player_equipped_gear`, re-fetched by the `blizzard-gear-sync` Edge Function (daily cron sweep, plus an officer on-demand call).
- `priority_order`, rebuilt by `generate_priority_order()`.
- `scoring`, recomputed from performance and attendance inputs.
- Static reference data (`classes_specs` and similar).

Note the dependency, because it decides restore order: `priority_order` and `scoring` derive from `attendance` and `item_preferences`, both of which are on the backup-only list. Regenerating them before those inputs are whole produces confident, wrong numbers rather than an error.

**In-app-only -- a lost/corrupted row here has no other source, and is only recoverable from a backup:**

- `players` (the whole row: `nickname`, `join_date`, `is_trial`, `is_bench`, `bis_allowed`, `wishlist_allowed`, `is_backup_tank`, `is_backup_healer`, `m_plus_note` and the rest are all hand-entered)
- `player_officer_notes` (the officer note and the removal reason behind each archived player, hand-entered; they lived on `players` until [#925](https://github.com/katogaming88/WGA-Raid-Hub/issues/925)). Deliberately **not** an `EMPTY_CHECK` floor: a team with nothing written down has no rows here, so an empty table is a legitimate state rather than the silent loss that check exists to catch.
- `teams` (also the FK root of nearly every other table)
- `site_admins` and `guild_officers` (empty means nobody can administer the site)
- `item_preferences` (raider wishlists)
- `bis_items` (BiS lists and their obtained flags)
- `season_signups`
- `bis_requests`
- `self_received_requests`
- `mplus_exclusion_requests`
- `team_settings` (including officer bios stored in `config`)
- `site_settings`
- `audit_log` (post-cutover entries -- pre-cutover history was already lost, see the #377 backfill decision)
- `notifications`
- `streamers`
- `team_members` (Discord claims and auth links)
- `no_character_dismissals` (UI dismissal state; losing it only makes a dismissed prompt reappear)
- `priority_conflict_dismissals` (officer-acknowledged Priority List same-boss conflicts; losing it only makes a dismissed warning reappear, same low-stakes shape as `no_character_dismissals`)
- `priority_stale_dismissals` (officer-acknowledged Priority List stale-after-Heroic conflicts; same low-stakes shape as `priority_conflict_dismissals`)
- `priority_order_confirmed_empty` (marks an item/track's priority list as one an officer deliberately saved with nobody ranked; losing it just makes that item look unmanaged again)
- `boe_items` and `boe_listings` (the BoE lifecycle and money receipt: sale prices, payouts, the split -- hand-entered by managers, no other source, [#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745))
- `boe_managers` (the guild-wide BoE money-manager grants; empty means only site admins can run the BoE workflow)

This second list is exactly why the milestone exists: none of it can be re-fetched or re-derived, and the Danger Zone's clear RPCs make a bad delete a one-click possibility.

**Two tables sit in neither list, and treating them as either one is the mistake:**

- **`attendance`** is mixed by row, not by column. As of 2026-08-15: 895 rows `source = Officer`, 537 `WCL`, 47 `Auto (Bench)`. A Warcraft Logs re-sync rebuilds only the WCL third and silently drops the rest, which is worse than an obvious gap because the table comes back populated and looks restored. Restore it from the dump.
- **`rclc_loot`** is regenerable through `import_rclc_loot()` only for as long as the RCLootCouncil addon exports still exist, and those live on officers' machines, outside anything this repo backs up. Treat it as backup-only unless someone has confirmed the source exports are still in hand.

## Runbook: getting a dump out of R2

Who can reach the bucket:

- kat's Cloudflare login (bucket owner) and the bucket's read-write API token.
- The repo's Actions secrets (what the nightly workflow uses).
- Russell's read-only API token (#544), held in a local AWS CLI profile (`wga-backup-ro`).

Any S3 client works; the AWS CLI is what CI uses:

```sh
aws s3 ls s3://wga-raid-hub-backups/pg/ \
  --endpoint-url "https://<account-id>.r2.cloudflarestorage.com" --profile wga-backup-ro
aws s3 cp s3://wga-raid-hub-backups/pg/wga-<date>.dump . \
  --endpoint-url "https://<account-id>.r2.cloudflarestorage.com" --profile wga-backup-ro
```

The account id is not written here (public repo); it's visible in the Cloudflare dashboard and stored as the `R2_ACCOUNT_ID` repo secret.

## Runbook: selective restore (bad delete, Danger Zone accident)

> **Everything in this section runs against the live database. Incident use only.** For rehearsal, use the drill procedure below instead.

1. **Stop writes.** Enable maintenance mode from the admin dashboard so nothing changes underneath the restore.
2. **Establish the blast radius.** If `audit_log` survived, read it to see what was deleted and when. Pick the newest dump from before the damage.
3. **Whole-table replace** -- right when the table's post-dump changes are expendable (or the dump is from the same day):

   ```sh
   # incident only -- targets prod as postgres
   psql "service=wga-admin" -c 'truncate table public.<t>'
   pg_restore --data-only --table=<t> -d "service=wga-admin" wga-<date>.dump
   ```

   - **FK order**: restore parents before children. `truncate ... cascade` only when the child tables are also being restored from the dump.
   - **Triggers fire on data-only restores.** `pg_restore --disable-triggers` needs superuser, which Supabase's `postgres` role is not. For tables with side-effect triggers (anything that writes `notifications` or similar), wrap the restore: `alter table public.<t> disable trigger user;` before, `alter table public.<t> enable trigger user;` after.
   - **Sequences are not restored by per-table data restores** (the dump's `SEQUENCE SET` entries are separate objects that `--table` skips). Reset each serial afterwards: `select setval(pg_get_serial_sequence('public.<t>', 'id'), (select max(id) from public.<t>));` -- always resolve the sequence through `pg_get_serial_sequence()`, never by guessing `<table>_id_seq`: renamed tables keep their original sequence name (`season_signups`'s sequence is `signups_id_seq`, 2026-07-23 drill finding). When restoring in place into the live DB the sequence usually still holds the right value; the reset is cheap insurance, and required when restoring into a scratch database.
4. **Row-level surgery** -- right when the table gained rows since the dump that must be kept: restore the dump into a scratch local Postgres (the drill container works), then carry just the lost rows over with `\copy` out/in or hand-written inserts.
5. Verify counts and spot-check the restored rows, then turn maintenance mode off.

## Runbook: full rebuild (Supabase project lost or corrupted)

The order matters; each step exists because a later one depends on it.

1. **Create a new Supabase project.** `anon`, `authenticated`, and `service_role` already exist on a real project.
2. **Create the custom roles**: run `supabase/roles.sql`, then the read-only roles per `docs/claude-readonly-db-access.md`.
3. **Restore the newest public dump**: `pg_restore --no-owner -d "<new project's connection string>" wga-<date>.dump`. The "expected errors" list in `db-backup.yml`'s verify step is specific to its bare container -- a real project has an `auth` schema, so most auth-referencing DDL applies cleanly. What WILL fail here: the nine FK constraints pointing at `auth.users` (`audit_log.actor_id`, `site_admins.auth_user_id`, `team_members.auth_user_id`, `season_signups.auth_user_id`, `guild_officers.auth_user_id`, `no_character_dismissals.auth_user_id`, `boe_managers.auth_user_id`, `priority_conflict_dismissals.dismissed_by`, `priority_stale_dismissals.dismissed_by`), because the restored rows hold ids from the old project's now-gone `auth.users`. `pg_restore` skips the failed constraints and keeps the data; see step 9 for putting them back.
4. **Repair migration history.** The dump does not carry `supabase_migrations.schema_migrations`, so the new project believes no migration ever ran and the next `supabase db push` would replay all of them onto the restored schema. Link the project (`supabase link`) and mark every file in `supabase/migrations/` applied: `supabase migration list` shows the discrepancy, `supabase migration repair --status applied <version>` clears it.
5. **Re-create the pg_cron jobs** from `supabase/migrations/20260713234553_pg_cron_edge_function_scheduling.sql` -- cron jobs live in the `cron` schema, outside the dump. Step 4 already marked that migration applied, so run its statements directly in the SQL editor.
6. **Redeploy Edge Functions** (`supabase functions deploy`) and re-enter their secrets (Project Settings > Edge Functions).
7. **Repoint the frontend**: new project ref and anon key in the js config; re-register the Discord OAuth redirect for the new auth callback URL.
8. **Update the `SUPABASE_DB_URL` repo secret** to the new project's session pooler string so the nightly backup resumes against the new project.
9. **Auth relink.** The new project's `auth.users` starts empty, so every login is a first login; `link_auth_user_to_member()` re-links by `discord_id` on first login across all four grant tables (`team_members`, `site_admins`, `boe_managers` and, since #910, `guild_officers`). **It does not overwrite a stale id**: every branch ends `and auth_user_id is null`, so a restored row that still carries an id from the dead project is never relinked and the person silently keeps no access. Null those ids before the relinks land (`update <table> set auth_user_id = null`), or nothing in this step does anything. Recreate the nine FKs from step 3 as `not valid` (their definitions are in the migrations) so historical `audit_log.actor_id` values survive, then `validate constraint` once relinks settle or stale ids are nulled. `wga-auth-<date>.dump` is the reference copy of the old ids and Discord identities if anything needs untangling by hand.

## Restore drill

Backups only count once a restore has been walked end to end. The drill restores a real dump from the bucket into a disposable local `postgres:17` container -- never into prod -- and rehearses the selective-restore moves where they apply.

```sh
docker run -d --name wga-restore-drill -e POSTGRES_PASSWORD=postgres postgres:17
docker cp wga-<date>.dump wga-restore-drill:/tmp/
docker cp supabase/roles.sql wga-restore-drill:/tmp/
docker exec wga-restore-drill psql -U postgres \
  -c 'create role anon nologin' -c 'create role authenticated nologin' -c 'create role service_role nologin'
docker exec wga-restore-drill psql -U postgres -f /tmp/roles.sql
docker exec wga-restore-drill pg_restore --no-owner -U postgres -d postgres /tmp/wga-<date>.dump
```

Expected errors in this bare container (the same list `db-backup.yml`'s verify step tolerates): the image's pre-existing `public` schema, everything referencing the absent `auth` schema, and `supabase_admin` default-privilege statements.

The drill then covers:

- Count spot-checks against prod (`psql "service=wga"`, the read-only role) for `players`, `season_signups`, `audit_log` -- small drift is expected if prod moved since the dump.
- A selective-restore rehearsal inside the container: delete one table's rows, restore just that table from the dump, reset its sequence, and note whether side-effect triggers fired.
- `pg_restore --list` on the auth dump.

### Drill log

| Date | Dump | Result |
| ---- | ---- | ------ |
| 2026-07-23 | `wga-2026-07-22.dump` + auth | **Pass.** Pulled both objects from R2 with the read-only token. Full restore into `postgres:17`: 9 ignored errors, all matching the expected list above verbatim, nothing unexpected. Counts matched prod exactly (players 75, season_signups 46, audit_log 610; 26 base tables). Selective-restore rehearsal on `season_signups`: 46 rows deleted and restored per-table, no side-effect triggers fired (its only trigger is the `updated_at` stamper), `setval` fix-up exercised. Found: the table's sequence is `signups_id_seq` (legacy name from a rename), which is why the runbook resolves sequences via `pg_get_serial_sequence()`. Auth dump listed cleanly: 2 table-data entries (`auth.users`, `auth.identities`). |

## When the schema changes

Several parts of this doc and `db-backup.yml`'s verify step encode assumptions about the schema as it stood on the date the drill below was run. Nothing re-checks them automatically -- this section is the trigger for deciding whether a re-check or a fresh drill is warranted, not a schedule (re-drilling on every migration would be too heavy).

What's schema-tied:

- **Expected-error list** in `db-backup.yml`'s verify step and the drill section above -- 9 ignored errors as of the 2026-07-23 drill (#544): the container's pre-existing `public` schema, everything referencing the absent `auth` schema, and `supabase_admin` default-privilege statements.
- **Table-count floor of 20** in the same verify step -- real count was 26 when written, 27 as of [#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607)'s `guild_officers` table, then 29 (`tier_token_map` from #650, `no_character_dismissals` from [#512](https://github.com/katogaming88/WGA-Raid-Hub/issues/512)), then 32 (`boe_items`, `boe_listings`, `boe_managers` from [#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745)), then 33 (`priority_conflict_dismissals`), now 36 (`player_equipped_gear` and `priority_order_confirmed_empty` landed the same day as `priority_conflict_dismissals` without updating this count, caught now; plus `priority_stale_dismissals`) -- still well clear of the floor, no re-check needed.
- **The `EMPTY_CHECK` list** in the same verify step -- `players`, `item_preferences`, `season_signups`, `team_settings`, `team_members`, `teams`, `site_admins`, `attendance`. Every name is a claim that the table cannot legitimately be empty. Renaming or dropping one of them makes the check fail as `(unreadable)` until the list is updated, which is deliberate: a silently skipped assertion is the failure this whole step exists to prevent.
- **The coverage map above** -- it classifies all 36 base tables, so a new table leaves it incomplete without anything failing.
- **The nine `auth.users` FKs** in the full-rebuild runbook (steps 3 and 9) -- `audit_log.actor_id`, `site_admins.auth_user_id`, `team_members.auth_user_id`, `season_signups.auth_user_id`, `guild_officers.auth_user_id`, `no_character_dismissals.auth_user_id` ([#512](https://github.com/katogaming88/WGA-Raid-Hub/issues/512)), `boe_managers.auth_user_id` ([#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766)), `priority_conflict_dismissals.dismissed_by`, `priority_stale_dismissals.dismissed_by`. This list is the one to trust: steps 3 and 9 disagreed with it between #512 and #766, because #512 updated here and not there.
- **Sequence-name guidance** in the selective-restore runbook -- only as good as the tables it was checked against (`season_signups` resolving to `signups_id_seq` was the drill's find).
- **Drill-log row counts** -- meaningful only while the tables they name still exist under that name.

Re-check when a migration:

- **Adds a new table** -- classify it in the coverage map above as regenerable or in-app-only (or neither, with the reason), and decide whether it belongs in `EMPTY_CHECK`. This is the case that has gone wrong most often: `item_preferences` (#518), `bis_items`, `guild_officers` ([#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607)), `no_character_dismissals` ([#512](https://github.com/katogaming88/WGA-Raid-Hub/issues/512)) and `tier_token_map` (#650) all landed unclassified, and three of them were added to the table-count and FK lines above in the same edit that skipped the coverage map.
- Adds an FK to `auth.users` on a table not in the six listed above -- add it to the full-rebuild runbook's FK list.
- Renames a table or column named in this doc or the drill log -- update the reference; always resolve sequences through `pg_get_serial_sequence()` rather than trusting old guidance.
- Adds DDL or an RLS policy referencing `auth` -- check whether it lands inside or outside the verify step's tolerated error categories.
- Pushes the public table count close to the floor of 20, or meaningfully past 32 -- raise the floor so it still catches a truncated dump.

**CI nudge**: `schema-docs.yml` fails a PR that adds an `auth.users` FK or renames something in `supabase/migrations/` without also touching this file, mirroring the existing `docs/RLS.md` check in the same workflow.

**What the nudge does not catch**: a migration that adds a table matches neither trigger, so it lands with nothing asking about the coverage map. That is the mechanical reason the five tables named above went unclassified, and it means the new-table item at the top of this list is advisory at review time, exactly like the table-count and RLS-policy cases. Making it enforceable needs a check that asserts the map is complete rather than one that asks for the file to be touched, tracked in [#699](https://github.com/katogaming88/WGA-Raid-Hub/issues/699).

As of 2026-07-28 the table count (26 base tables) and the FK list still matched the 2026-07-23 drill baseline exactly. [#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607) (2026-07-30) added `guild_officers` (27 tables, 5th `auth.users` FK) -- updated above per this section's own checklist rather than a full re-drill, since neither the table-count floor nor the expected-error list needed touching. [#512](https://github.com/katogaming88/WGA-Raid-Hub/issues/512) (2026-08-05) added `no_character_dismissals` (29 tables -- `tier_token_map` from #650 had also landed in between without this doc being updated, caught now -- 6th `auth.users` FK). No re-drill due yet.

As of 2026-08-15 the coverage map was reconciled against all 29 base tables for the first time since it was written: 12 were unlisted, including `item_preferences`, `teams` and `site_admins`. The verify step gained the `EMPTY_CHECK` row floors in the same pass, after #691 showed that a wishlist can go missing without anything erroring. Table count and FK list both still match the 2026-07-23 drill baseline, so no re-drill.

As of 2026-08-25, [#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745) added `boe_items`, `boe_listings` and `boe_managers` (32 base tables), all classified in-app-only above. No `EMPTY_CHECK` floors while the tables ship empty; revisit `boe_items` once the #749 backfill lands. No new `auth.users` FK at that point, so the schema-docs CI nudge did not fire on them (that check only triggers on `references auth.users` / `rename to`); classified per this section's own checklist. No re-drill due.

As of 2026-08-26, [#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766) recreated `boe_managers` with an `auth_user_id` column, which does add a seventh `auth.users` FK and did fire the CI nudge. Table count is unchanged at 32 (a drop and recreate of an empty table, done while the grant was still unused on prod). The FK list above and both runbook steps are updated, and the five-versus-six drift between them from #512 is reconciled in the same pass. Still no `EMPTY_CHECK` floor: `boe_managers` can legitimately be empty, which just means only site admins can run the BoE workflow. No re-drill due.

As of 2026-08-31, the `priority_conflict_dismissals` table added an eighth `auth.users` FK (`dismissed_by`) and fired the CI nudge. Table count now 33; classified in-app-only above, same low-stakes shape as `no_character_dismissals` (losing it just makes a dismissed Priority List warning reappear). No `EMPTY_CHECK` floor: the table can legitimately be empty on any team that hasn't dismissed anything. No re-drill due.

As of 2026-09-01, `priority_stale_dismissals` added a ninth `auth.users` FK (`dismissed_by`) and fired the CI nudge -- same shape as `priority_conflict_dismissals`, classified in-app-only above, no `EMPTY_CHECK` floor. Reconciling this table also caught that the table-count floor had gone stale: `player_equipped_gear` (regenerable, re-fetched by `blizzard-gear-sync`) and `priority_order_confirmed_empty` (in-app-only) both landed on 2026-08-31 alongside `priority_conflict_dismissals` without updating the count here, since neither fired the CI nudge (no `auth.users` FK, no rename) -- the exact "new table matches neither trigger" gap this section's own header already calls out ([#699](https://github.com/katogaming88/WGA-Raid-Hub/issues/699)). Both are now classified above too. Table count is 36. No `EMPTY_CHECK` floors for any of the three (all legitimately empty on a team that hasn't used the feature yet). No re-drill due.

## Ops notes

- GitHub disables `schedule` workflows after 60 days without repo activity; any push re-enables them. Not a realistic risk while the project is active, but worth knowing if it ever goes dormant.
- **Capacity alerting** (#547): after each upload the workflow sums the bucket and warns in Discord (plus a run annotation) once usage reaches `ALERT_PCT` of `USAGE_LIMIT_BYTES`, both plain env at the top of the `Check bucket capacity` step. They start at 80% of R2's 10 GB free allotment. Crossing the line warns without failing the run, since R2 bills overage rather than cutting off; a check that cannot read the bucket fails the run instead, so it can't quietly stop watching. The allotment is account-wide while the check measures one bucket, which holds while backups are the only thing in the account.
