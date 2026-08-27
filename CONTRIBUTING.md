# Contributing to WGA Raid Hub

## Workflow

1. Pick an issue from the [issue tracker](https://github.com/katogaming88/WGA-Raid-Hub/issues) or create one first
2. Branch off `main`: `git checkout -b <type>/<short-description>`
   - Types: `feat`, `fix`, `refactor`, `style`, `chore`, `docs`
   - Example: `feat/filter-by-role`
3. Make your changes, then open a pull request against `main`
4. Reference the issue in your PR description (e.g. `Closes #12`)

## Branch naming

| Type | When to use |
|------|-------------|
| `feat/` | New feature or roadmap item |
| `fix/` | Bug fix |
| `refactor/` | Code restructure with no behaviour change |
| `style/` | Visual or layout changes only |
| `chore/` | Config, tooling, project setup |
| `docs/` | Documentation only |

## Versioning

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Bump | When to use | Examples |
|------|-------------|---------|
| **MAJOR** | Architectural overhaul, breaking change to URLs or database schema | Page split, new auth system |
| **MINOR** | New officer capability, new tab, new raider-facing workflow | New dashboard tab, new approval queue |
| **PATCH** | Bug fixes, visual polish, copy changes, layout tweaks, performance improvements | Layout fix, subtitle change, footer tweak |

When merging a PR:
- Frontend changes (under `js/` or the root HTML pages): bump the
  version in `js/common.js` (`var VERSION`) and add an entry under a
  `### Frontend` heading in the new version's `CHANGELOG.md` block
- Backend changes (under `supabase/migrations/` or `scripts/import/`): add
  an entry under a `### Backend` heading, with no version bump. Backend
  entries join the version block of the release they land next to
- A PR touching both sides updates both sections; a PR touching neither
  needs neither

Bumping the version means more than one file: every local `css/`/`js/`
tag on every page carries a `?v=<VERSION>` cache-bust query string
(#431), around 40 of them. `npm run stamp -- 3.67.0` rewrites the
`VERSION` constant and every one of those tags in a single pass, and
prints a per-page count so a page that matched nothing is visible rather
than reported as a silent success. It refuses a version that is not
`x.y.z`, and it writes nothing at all if any page would fail.

CI enforces this in both directions (#353): frontend paths require a
Frontend entry and a bump, backend paths require a Backend entry, and a
bump without a frontend change fails. The `js/common.js` VERSION line
itself does not count as a frontend change, so a bump alone never
satisfies the frontend checks. Mechanical PRs (formatting, lint,
comment-only changes) are exempt from every check: use a `chore/*` branch
or add the `chore` label.

## Pull requests

- Keep PRs focused on one issue or theme
- Update `CHANGELOG.md` under `### Frontend` / `### Backend` per the
  versioning section above
- `js/common.js` is type-checked (`// @ts-check` plus JSDoc annotations, no
  build step). If you touch a checked file, run `npm run typecheck`; CI runs
  the same check on every `js/` change. Add `// @ts-check` to more `js/`
  files as they get touched
- Frontend logic has unit tests under `tests/frontend/` (they load the plain
  `js/` scripts into a vm sandbox, no browser needed). Run
  `npm run test:frontend`; CI runs the suite on every `js/` change. That job
  pins `TZ=America/New_York`, the project's canonical zone: date logic reads
  the viewer's local calendar date, so a UTC runner cannot catch a
  local-vs-UTC regression (#703)

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `admin.html` | Site admin dashboard -- team management, site admin grant/revoke, feature flags, cross-team audit log, maintenance mode |
| `js/common.js` | Shared globals, `TEAMS`, `TEAM_SLUG`/`IS_COLD_LANDING` resolution, `VERSION`, data helpers, `renderProfile` |
| `js/discord.js` | Discord OAuth login/session mapping, character claim flow |
| `js/roster.js` | Public page boot, cold-landing team picker/auto-redirect, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, session expiry, tab dispatch |
| `js/officer-quick-actions.js` | Officer quick-actions bar (priority export, attendance refresh, loot paste) shown on the public page |
| `js/streamers.js` | Live Twitch streamer widget |
| `js/tabs/tab-*.js` | One file per officer tab (19 files) |
| `js/admin.js` | Standalone boot/logic for `admin.html` -- not team-scoped, so it doesn't reuse common.js/discord.js |
| `css/styles.css` | Shared styles across all pages |
| `css/officer.css` | Officer-specific styles (partial split out of `styles.css`, still in progress) |
| `css/admin.css` | Admin-page-specific styles |
| `gs/*.gs` | Retired Google Apps Script source, kept only as historical record -- no code reads `gasUrl` or writes through GAS anymore; everything is Supabase-only |
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations |
| `scripts/import/` | One-off/recurring data import tooling (loot, attendance, etc.) |
| `scripts/ci/` | CI checks that need more than a workflow step (changelog classification, the team-wide read guard), plus the version stamper (`npm run stamp`), which owns the page registry the asset-version check reads |
| `dbdoc/` | Generated schema docs (tbls). Never edit by hand; regenerate with `npm run db:docs` |
| `docs/RLS.md` | Hand-maintained RLS policy reference (tbls cannot generate this) |

## Reading team-wide data

PostgREST caps any response at 1000 rows and returns the truncated page as an
ordinary `200` with `error: null`. Nothing in supabase-js surfaces the
partial-content signal, so a short read is indistinguishable from a complete
one at the call site: the app renders confidently wrong data rather than an
error. This has produced real defects more than once, including attendance
scores computed from part of a season and written to the database as fact.

**Any read filtered by `team_id` goes through `fetchAllPaged()`** (`js/common.js`).
It pages on `id`, takes an exact count on the first page, gives each page its
own timeout rather than sharing one budget across the read, and returns `null`
rather than partial rows if anything fails. Callers must treat `null` as "the
read failed" and `[]` as "there is nothing there", and must never render the
two the same way.

```js
fetchAllPaged(
  function (afterId, limit) {
    var q = supabaseClient
      .from('attendance')
      .select('id, player_id, status', afterId === null ? { count: 'exact' } : undefined)
      .eq('team_id', _teamCfg.supabaseTeamId)
      .order('id', { ascending: true })
      .limit(limit);
    return afterId === null ? q : q.gt('id', afterId);
  },
  { label: 'attendance grid' }
);
```

`scripts/ci/team-wide-read-check.js` enforces this on every PR touching `js/`.
It parses each file rather than grepping it, so the same call shape inside a
comment or a string does not trip it. A read is exempt when it cannot reach the
cap and the code says so: `.single()`/`.maybeSingle()`, a `head: true` count, a
narrowing `.eq('player_id', ...)`, or a literal `.limit(50)`.

Anything else that genuinely cannot grow past 1000 rows declares why, on or
just above the read:

```js
// team-read-guard: one row per roster member, 80 on the largest team.
```

Write the actual bound, not "this is fine". The annotation is also the escape
hatch for a `makeQuery` callback declared as a named function somewhere else,
which the check cannot follow. Run it locally with
`node scripts/ci/team-wide-read-check.js`.

## Local development database (Supabase)

The Supabase migration develops all schema changes against a local stack running in
Docker before anything touches the cloud project. Setup from scratch (Docker,
Supabase CLI, starting the stack, linking to the cloud project) is documented
step by step in [docs/supabase-local-dev-setup.md](docs/supabase-local-dev-setup.md).

PRs that change `supabase/migrations/` must also:

- Name the migration file with the **real current local timestamp** (`YYYYMMDDHHMMSS`),
  not UTC and not hand-picked. Supabase orders and applies migrations by this
  prefix, so a wrong one can silently apply out of order relative to
  concurrent work from other contributors. Check the actual system clock
  rather than guessing or copying an adjacent file's timestamp.
- Regenerate the schema docs: `supabase db reset`, then `npm run db:docs`, and
  commit the `dbdoc/` changes (CI fails stale docs)
- Update [docs/RLS.md](docs/RLS.md) if the migration adds, alters, or drops an
  RLS policy (CI checks this too)
- Regenerate the policy export if policies changed: `npm run db:rls`, and
  commit `docs/rls_policies.csv` (CI fails a stale CSV)
- Pass the RLS policy tests: `supabase db reset` (applies migrations and the
  test seed), then `npm run test:rls`. CI runs the same suite on every
  supabase/ or tests/ change. If a policy legitimately changed, update the
  matching assertions in `tests/rls/` and the matrix in docs/RLS.md together
