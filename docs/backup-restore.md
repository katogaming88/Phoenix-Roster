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

## Coverage map: what's regenerable vs. backup-only

**Regenerable without a backup** -- these can be rebuilt from other sources if lost:

- The schema itself, from `supabase/migrations/`.
- `items`/`item_bosses` (the loot catalog), from `scripts/fetch-items.js` + the manual SQL import workflow (`docs/updating-fetch-items-for-new-tier.md`).
- `raid_zones`/`raid_encounters`, re-derivable from Warcraft Logs.
- Static reference data (`classes_specs` and similar).

**In-app-only -- a lost/corrupted row here has no other source, and is only recoverable from a backup:**

- `season_signups`
- `bis_requests`
- `self_received_requests`
- `mplus_exclusion_requests`
- `players.officer_notes`
- `team_settings` (including officer bios stored in `config`)
- `site_settings`
- `audit_log` (post-cutover entries -- pre-cutover history was already lost, see the #377 backfill decision)
- `notifications`
- `streamers`
- `team_members` (Discord claims and auth links)

This second list is exactly why the milestone exists: none of it can be re-fetched or re-derived, and the Danger Zone's clear RPCs make a bad delete a one-click possibility.

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
3. **Restore the newest public dump**: `pg_restore --no-owner -d "<new project's connection string>" wga-<date>.dump`. The "expected errors" list in `db-backup.yml`'s verify step is specific to its bare container -- a real project has an `auth` schema, so most auth-referencing DDL applies cleanly. What WILL fail here: the four FK constraints pointing at `auth.users` (`audit_log.actor_id`, `site_admins.auth_user_id`, `team_members.auth_user_id`, `season_signups.auth_user_id`), because the restored rows hold ids from the old project's now-gone `auth.users`. `pg_restore` skips the failed constraints and keeps the data; see step 9 for putting them back.
4. **Repair migration history.** The dump does not carry `supabase_migrations.schema_migrations`, so the new project believes no migration ever ran and the next `supabase db push` would replay all of them onto the restored schema. Link the project (`supabase link`) and mark every file in `supabase/migrations/` applied: `supabase migration list` shows the discrepancy, `supabase migration repair --status applied <version>` clears it.
5. **Re-create the pg_cron jobs** from `supabase/migrations/20260713234553_pg_cron_edge_function_scheduling.sql` -- cron jobs live in the `cron` schema, outside the dump. Step 4 already marked that migration applied, so run its statements directly in the SQL editor.
6. **Redeploy Edge Functions** (`supabase functions deploy`) and re-enter their secrets (Project Settings > Edge Functions).
7. **Repoint the frontend**: new project ref and anon key in the js config; re-register the Discord OAuth redirect for the new auth callback URL.
8. **Update the `SUPABASE_DB_URL` repo secret** to the new project's session pooler string so the nightly backup resumes against the new project.
9. **Auth relink.** The new project's `auth.users` starts empty, so every login is a first login; `link_auth_user_to_member()` re-links members by `discord_id` and overwrites the stale `auth_user_id`. Recreate the four FKs from step 3 as `not valid` (their definitions are in the migrations) so historical `audit_log.actor_id` values survive, then `validate constraint` once relinks settle or stale ids are nulled. `wga-auth-<date>.dump` is the reference copy of the old ids and Discord identities if anything needs untangling by hand.

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
- **Table-count floor of 20** in the same verify step -- real count was 26 when written.
- **The four `auth.users` FKs** in the full-rebuild runbook (steps 3 and 9) -- `audit_log.actor_id`, `site_admins.auth_user_id`, `team_members.auth_user_id`, `season_signups.auth_user_id`.
- **Sequence-name guidance** in the selective-restore runbook -- only as good as the tables it was checked against (`season_signups` resolving to `signups_id_seq` was the drill's find).
- **Drill-log row counts** -- meaningful only while the tables they name still exist under that name.

Re-check when a migration:

- Adds an FK to `auth.users` on a table not in the four listed above -- add it to the full-rebuild runbook's FK list.
- Renames a table or column named in this doc or the drill log -- update the reference; always resolve sequences through `pg_get_serial_sequence()` rather than trusting old guidance.
- Adds DDL or an RLS policy referencing `auth` -- check whether it lands inside or outside the verify step's tolerated error categories.
- Pushes the public table count close to the floor of 20, or meaningfully past 26 -- raise the floor so it still catches a truncated dump.

**CI nudge**: `schema-docs.yml` fails a PR that adds an `auth.users` FK or renames something in `supabase/migrations/` without also touching this file, mirroring the existing `docs/RLS.md` check in the same workflow. It can't catch the table-count or RLS-policy cases above -- those still rely on this checklist at review time.

As of 2026-07-28 the table count (26 base tables) and the FK list still match the 2026-07-23 drill baseline exactly, so no re-drill is due yet.

## Ops notes

- GitHub disables `schedule` workflows after 60 days without repo activity; any push re-enables them. Not a realistic risk while the project is active, but worth knowing if it ever goes dormant.
- **Capacity alerting** (#547): after each upload the workflow sums the bucket and warns in Discord (plus a run annotation) once usage reaches `ALERT_PCT` of `USAGE_LIMIT_BYTES`, both plain env at the top of the `Check bucket capacity` step. They start at 80% of R2's 10 GB free allotment. Crossing the line warns without failing the run, since R2 bills overage rather than cutting off; a check that cannot read the bucket fails the run instead, so it can't quietly stop watching. The allotment is account-wide while the check measures one bucket, which holds while backups are the only thing in the account.
