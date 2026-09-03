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
| **MAJOR** | A previously-valid URL now 404s, points at different data, or requires re-authenticating; a schema change that isn't additive (a column/table/RPC removed or repurposed, not just added) | Retiring a page entirely, splitting one page into several, replacing the auth/session model |
| **MINOR** | New capability, tab, or workflow reachable from existing URLs; a page's *default* content or landing target changes but old links and bookmarks still resolve to a working page | New dashboard tab, new approval queue, changing what a bare root URL shows, adding a new page nothing depended on yet |
| **PATCH** | Bug fixes, visual polish, copy changes, layout tweaks, performance improvements | Layout fix, subtitle change, footer tweak |

The MAJOR bar is about **breaking an existing contract**, not about how much surface area changed. A large, multi-PR feature (a new page, a new admin tab, a new tracker) is still MINOR as long as everything that worked before the change still works the same way after it. Ask "does an old bookmark, saved link, or existing session still do what it used to?" -- if yes, it's MINOR regardless of how big the diff is.

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
(#431), 49 of them across the five pages. `npm run stamp -- 3.67.0`
rewrites the `VERSION` constant and every one of those tags in a single
pass, and
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
- Structural checks over the HTML and the CI tooling live in `tests/ci/`
  (`npm run test:ci`): landmarks, heading order, resolvable anchors, the
  `?v=` asset tags, and the changelog classifier. These read the pages as
  text, so they judge markup and never behaviour
- Accessibility runs in a real browser under `tests/browser/`
  (`npm run test:a11y`), which needs a one-time
  `npx playwright install chromium`. It serves the site locally and answers
  every third-party and Supabase request from `tests/browser/fixtures/`, so
  it is offline and does not touch production. Eleven public page states are
  loaded, checked against axe at WCAG 2.1 AA, and measured for reflow at
  480px. Each state waits on a sentinel selector that only exists once its
  async reads have rendered, so a page that silently truncated fails rather
  than passing empty
- Two files in that suite measure what axe has no automated rule for, and both
  assert a pair rather than a single reading. `reduced-motion.test.js` reads
  animation and transition durations under `prefers-reduced-motion` and under
  the default, because "the spinner does not animate" is equally true of a
  working media query and of a stylesheet with no animation at all.
  `keyboard.test.js` focuses every focusable element on every state in
  `states.js` and reads its outline back, then checks the modality contract:
  Tab shows a ring, a click on a button or a link does not, and a click into
  a text box or a select does
- `tests/browser/a11y-baseline.json` records every violation the site has
  today, compared for exact equality. A PR that fixes one has to delete its
  entries, and a PR that adds one fails. Refresh it with
  `UPDATE_A11Y_BASELINE=1 npm run test:a11y` and read the diff before
  committing it: the file is the accessibility milestone's scoreboard, so a
  refresh that grows a count needs a reason. An axe-core or playwright bump
  can shift the numbers on its own; that is the harness working, and the fix
  is to refresh the baseline on the bump's own branch

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Public page -- landing, raider profiles, season signup |
| `officer.html` | Officer dashboard -- all management tabs |
| `admin.html` | Site admin dashboard -- team management, site admin grant/revoke, feature flags, cross-team audit log, maintenance mode |
| `guild.html` | Guild-wide page -- team selection, streams, news, BoE entry point, About the Guild. Not scoped to a team |
| `boe.html` | BoE Sales -- the found-BoE auction lifecycle for officers, BoE managers and site admins. Guild-wide like `guild.html`, reached only through an access-gated link on the guild page or the officer dashboard |
| `js/common.js` | Shared globals, `TEAMS`, `TEAM_SLUG`/`IS_COLD_LANDING` resolution, `VERSION`, data helpers, `renderProfile` |
| `js/discord.js` | Discord OAuth login/session mapping, character claim flow |
| `js/roster.js` | Public page boot, cold-landing team picker/auto-redirect, dropdown, stats row, recent loot |
| `js/signup.js` | Multi-step signup form logic |
| `js/officer.js` | Officer boot, session expiry, tab dispatch |
| `js/officer-quick-actions.js` | Officer quick-actions bar (priority export, attendance refresh, loot paste) shown on the public page |
| `js/streamers.js` | Live Twitch streamer widget |
| `js/tabs/tab-*.js` | One file per officer tab (19 files) |
| `js/admin.js` | Standalone boot/logic for `admin.html` -- not team-scoped, so it doesn't reuse common.js/discord.js |
| `js/guild.js` | Boot/logic for `guild.html`. Also not team-scoped, but it does load common.js for `TEAMS` and the guild-wide helpers, then nulls the team globals so a team-dependent call throws rather than rendering Phoenix's data. Skips discord.js, whose session read is hard-scoped to one team |
| `js/boe-page.js` | Boot for `boe.html`: session, the three-RPC access answer (`fetchBoeAccess()` in common.js), then `js/boe-manage.js` renders. Same team-free shape as `js/guild.js` |
| `js/boe-manage.js` | The BoE lifecycle renderer and its RPC calls; takes `canManage` as a parameter and resolves no identity itself |
| `css/styles.css` | Shared styles across all pages |
| `css/officer.css` | Officer-specific styles (partial split out of `styles.css`, still in progress) |
| `css/admin.css` | Admin-page-specific styles |
| `css/guild.css` | Guild-page-specific styles, plus the keyboard/motion baselines scoped to that page until #435 generalises them |
| `gs/*.gs` | Retired Google Apps Script source, kept only as historical record -- no code reads `gasUrl` or writes through GAS anymore; everything is Supabase-only |
| `supabase/` | Supabase CLI project: local dev stack config and schema migrations |
| `supabase/functions/` | Edge Functions (Deno). Webhook relays (`boe-webhook`, `discord-bot-webhook`, `contact-webhook`), scheduled sync jobs (`wcl-sync`, `wcl-progression-sync`, `twitch-live-check`), and `upload-bio-photo`, which authenticates the caller and is the only writer to Storage -- see "Storage" below |
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

## Storage

`bio-photos` (added for #625) is the first Supabase Storage bucket in this
project, and the convention it set is meant to hold for the next one too:

- **No client ever writes to a bucket directly.** An Edge Function does the
  auth check and the write, using the service-role key. Storage RLS on
  `storage.objects` is left with no per-client rule at all -- the default
  deny already blocks a direct client write, so there is nothing to grant.
  A bucket created `public = true` still serves reads through its public URL
  without needing a read rule.
- **Path convention**: `{auth_user_id}/{filename}`, so a bucket that scopes
  content per-uploader gets that enforced for free -- an Edge Function using
  the caller's own `auth.uid()` to build the path can never be asked to
  write under someone else's.
- File-size/mime-type limits set on the bucket row itself
  (`file_size_limit`, `allowed_mime_types`) are defense-in-depth only; the
  real enforcement (resize, compression, a hard cap on the stored size)
  belongs in the Edge Function, not the client.
- See `supabase/functions/upload-bio-photo/index.ts` for the reference
  shape: authenticate by forwarding the caller's JWT to a second client and
  calling `auth.getUser()`, authorize with the same RPCs an equivalent save
  path already uses, then do the actual bucket read/write with a
  service-role client kept separate from the caller-scoped one.

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
