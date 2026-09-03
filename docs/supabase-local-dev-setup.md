# Local Supabase Dev Stack: Setup Walkthrough

How to run the full Supabase stack (Postgres, Auth, REST API, Studio) on your own
machine with Docker. This is the standard dev setup for the Supabase migration
(decision 8 in [supabase-migration-plan.md](supabase-migration-plan.md)): schema
changes are developed and tested locally first, then pushed to the cloud project.

This guide was written while setting up the first dev machine (Windows 10, AMD CPU)
and covers every step from bare metal. Most steps are one-time.

## 1. Prerequisites

### 1a. CPU virtualization (one-time, BIOS)

Docker on Windows needs hardware virtualization. Check first: open Task Manager >
Performance > CPU and look for `Virtualization: Enabled`, or run in PowerShell:

```powershell
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
```

If it reports `False`, reboot into BIOS/UEFI setup and enable:

- **AMD boards:** `SVM Mode` (usually under Advanced CPU settings or "OC" > CPU features)
- **Intel boards:** `Intel VT-x` (sometimes "Intel Virtualization Technology")

Save, boot back into Windows, and re-run the check. It should now report `True`.

### 1b. Docker Desktop

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the
WSL 2 backend (the default on Windows 10/11; it works on Home editions). If WSL 2
itself is missing, Docker Desktop's installer sets it up.

Verify Docker is alive:

```powershell
docker version --format '{{.Server.Version}}'
```

Any version number back means the engine is running. If it errors, start Docker
Desktop from the Start menu and wait for the whale icon to settle.

### 1c. Supabase CLI

On Windows, install via [scoop](https://scoop.sh/):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase/supabase
supabase --version
```

On macOS/Linux: `brew install supabase/tap/supabase`.

If a freshly installed command is not found in an already-open terminal, open a new
terminal (the PATH change only applies to new sessions).

### 1d. psql client (optional but useful)

For command-line checks against the local database. On Windows:

```powershell
scoop install postgresql
```

Note: scoop's postgresql package adds its `bin` directory to PATH instead of
creating shims, so `psql` only resolves in terminals opened after the install.
The binary lives at `~\scoop\apps\postgresql\current\bin\psql.exe`.

## 2. Start the stack

The repo already contains the CLI project scaffolding (`supabase/config.toml`,
created once with `supabase init`), so you do NOT run `supabase init` yourself.
From the repo root:

```powershell
supabase start
```

The first run downloads several GB of Docker images and takes a few minutes.
Later runs take seconds. When it finishes it prints the local endpoints and keys.

To see them again at any time: `supabase status`.

| Service | URL |
|---------|-----|
| API (REST/Auth/GraphQL) | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio dashboard | http://127.0.0.1:54323 |
| Mailpit (captures outgoing mail) | http://127.0.0.1:54324 |

The keys printed by `supabase status` (anon key, service role key, JWT secret) are
the same well-known defaults on every machine that runs Supabase locally. They are
not secrets and they do not touch the cloud project.

## 3. Verify it works

1. Open http://127.0.0.1:54323 in a browser. Studio should load and show a running
   database.
2. Query Postgres directly:

   ```powershell
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select version();"
   ```

3. `docker ps` should list ~11 healthy `supabase_*_WGA-Raid-Hub` containers.

The local stack builds only from `supabase/roles.sql` plus the migration files in
`supabase/migrations/`; it knows nothing about the cloud schema beyond what those
files capture. Run `supabase db reset` and the 20 public tables should appear
(check in Studio or with `\dt public.*` in psql).

`roles.sql` exists because the cloud cluster has a custom `claude_readers` role
that the RLS policies in the baseline migration reference. Local and shadow
databases need that role created before the migrations run or the policy
statements fail with `role "claude_readers" does not exist`.

## 4. Link to the cloud project (one-time)

Linking tells the CLI which cloud project this repo belongs to, which later enables
`supabase db pull` / `db push`. Run these yourself in a terminal; both involve
credentials that should never pass through anything else:

```powershell
supabase login
supabase link --project-ref kxgjqnpwfklbgrxdgmmv
```

- `supabase login` opens a browser window; approve it and the CLI stores an access
  token for your Supabase account.
- `supabase link` prompts for the cloud database password. Get it from the project
  owner. It is not stored in the repo and must never be committed.

Link state is written to `supabase/.temp/`, which is gitignored. Verify with
`supabase projects list`: the linked project shows a `●` marker.

## 5. Day-to-day commands

| Command | What it does |
|---------|--------------|
| `supabase start` | Start the local stack |
| `supabase stop` | Stop it (data volumes are kept) |
| `supabase status` | Show endpoints and keys |
| `supabase db reset` | Rebuild the local database from `supabase/migrations/` + seed |
| `npm run db:docs` | Regenerate the schema docs in `dbdoc/` and sort their trigger listings (see section 6) |

Docker Desktop must be running before `supabase start`.

## 6. Regenerating schema docs (after any migration change)

The generated docs in `dbdoc/` (markdown + Mermaid ER diagrams, built by
[tbls](https://github.com/k1LoW/tbls)) must match the schema the migrations
produce; the schema-docs CI workflow fails a PR when they drift.

One-time install: tbls is not in the main scoop bucket. Download the
`tbls_vX.Y.Z_windows_amd64.zip` asset from the
[tbls releases page](https://github.com/k1LoW/tbls/releases), and put
`tbls.exe` somewhere on PATH (this setup used `~\bin`, added to the user PATH).
On macOS/Linux: `brew install k1LoW/tap/tbls`.

Then, whenever migrations change:

```powershell
supabase db reset   # make the local DB match the migration files
npm run db:docs     # regenerate dbdoc/, then sort the trigger listings
node scripts/ci/dbdoc-sort.js   # the sort step alone, after a by-hand tbls doc
```

Commit the `dbdoc/` changes together with the migration. `npm run db:docs:check`
runs `tbls diff` locally, the same check CI runs. If your PR adds, alters, or
drops an RLS policy, also update [RLS.md](RLS.md) and regenerate the raw policy
export with `npm run db:rls` (commit `docs/rls_policies.csv`) in the same PR;
CI checks both.

## 7. Applying migrations to production

The rule: a migration reaches prod through `supabase db push`, run from the
repo root with the CLI linked (section 4). Running the SQL in the dashboard
SQL Editor does not count as applying it, even though the schema change lands.

The why: the SQL Editor never writes `supabase_migrations.schema_migrations`,
the ledger that `db push` and `migration list` read. Every editor-applied
migration leaves the ledger one row behind reality, `migration list` misreports
prod, and once an unrecorded version sits behind a recorded one, `db push`
refuses to run at all (`LegacyDbPushMissingRemoteError`). On 2026-08-31 the
ledger was 22 migrations behind the live schema for exactly this reason and
had to be reconciled by hand (`supabase migration repair --status applied`,
after verifying each migration's effect was live on prod first; marking an
unapplied migration applied would tell push to never run it).

CI enforces the rule: the Migration ledger check workflow compares
`supabase/migrations/` filenames against the ledger on every PR touching
migrations, on pushes to main, and in a weekly sweep. A PR adding a migration
stays red until someone runs `supabase db push`. One wrinkle: a push writes
only to the database, so GitHub does not notice it happened. After pushing,
re-run the check from the PR's Checks tab (or push any commit) to turn it
green.

Known limits:

- SQL run in the editor with no committed migration file is invisible to this
  check. Catching that needs `supabase db diff` against a shadow database,
  which is not wired up.
- Two open PRs can carry migrations whose timestamps interleave; the CLI
  refuses out-of-order pushes. Renaming the not-yet-pushed file to a later
  timestamp is the usual fix.

## Known quirk: vector container restart loop (Windows)

On Docker Desktop for Windows the `supabase_vector` container (log shipping for the
local Logs page) can restart-loop forever. Everything else works fine. Local
analytics is therefore disabled in `supabase/config.toml` (`[analytics]
enabled = false`), which removes the vector and analytics containers from the
stack. The only loss is the Logs page inside local Studio.

## What comes next

With the stack running, linked, and the baseline migration captured
(`supabase/migrations/20260704204411_initial_schema.sql`, pulled with
`supabase db pull --diff-engine migra`; the default pg-delta engine reported
"no schema changes found" against the live schema, so use the migra engine),
the next migration-plan steps are:

- **Schema fixes as migrations:** issues #271 and #272 ride the new workflow.
- **Test harness:** vitest RLS policy matrix against the local stack.

See the roadmap in [supabase-migration-plan.md](supabase-migration-plan.md).
