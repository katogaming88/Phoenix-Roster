# WGA Raid Hub: Migration from Google Sheets to Supabase + PostgreSQL

**Status:** Phase 2 complete, Phase 3 not started
**Audience:** Kat (and anyone helping run or build the Raid Hub)
**Last updated:** 2026-07-08

## How to read this document

If you only have a few minutes, read the **Summary**, **What changes for users**,
and **What we need from Kat** sections. The rest is detail for when you want it.
The **Appendix** at the end is for whoever writes the code and can be skipped on a
first pass.

---

## Summary

The Raid Hub currently stores all its data in a Google Sheet and runs its backend
on Google Apps Script. This proposal moves the data into a real database
(PostgreSQL, hosted on Supabase) while keeping the website itself almost exactly as
it is today. The public site and the officer dashboard keep their current look,
their current URLs, and their Discord login.

The move happens one feature at a time, not all at once, so the live site keeps
working throughout. We start on the Supabase free tier, which costs nothing for a
guild of our size. Nothing about the player or officer experience is meant to change
on day one, beyond data loading faster and never showing stale numbers.

The one behavior change worth deciding up front: after the migration there is no
Google Sheet to open and hand-edit. Everything goes through the dashboard. See
**The one real workflow change** below.

---

## Why move off Google Sheets

The Sheet has served us well, but it is being used as a database and it is not one.
The practical problems:

- **No real data integrity.** Nothing stops a typo in a player name from quietly
  breaking attendance or loot links, because columns are matched by position, not by
  a defined relationship.
- **Stale data.** The site caches Sheet reads for 5 to 15 minutes for speed, so
  officers sometimes see old numbers right after a change and have to clear the cache.
- **A hard row cap.** The scoring logic reads a fixed block of rows (player rows 4 to
  33), so the roster has a built-in size limit that a database does not.
- **Two backends to maintain.** Phoenix and Hellfire each run their own separate
  Apps Script deployment. Every change has to be pushed twice.
- **Fragile transport.** The site talks to the backend over JSONP, a workaround for
  browser security rules that a normal database connection does not need.

PostgreSQL on Supabase fixes all of these: defined tables with real relationships,
always-current reads, no artificial row limit, one backend for both teams, and a
proper query connection.

## What Supabase gives us

Supabase is a hosting service built around PostgreSQL. We use four parts of it:

- **The database** (PostgreSQL) holds all roster, loot, attendance, BiS, and signup data.
  Picture each table like a Sheet tab, except the columns and the links between tabs are
  defined once and enforced, instead of being held together by hand.
- **The auto-generated API** lets the website read and write data directly, with no
  custom server code in the middle for ordinary reads.
- **Row Level Security (RLS)** is the database's own permission system. It decides who
  can read or change each row. This is where all access control lives (more below).
- **Edge Functions** are small pieces of server code for the few jobs that need a
  secret key, such as pulling scores from WarcraftLogs or notifying the Discord bot.
- **Auth** handles Discord login natively, replacing the hand-rolled login we run today.

---

## Guiding decisions (already made)

These were worked through and settled. They are listed here so the reasoning is on
the record, not to reopen them.

1. **Keep the current website, swap the data layer now. Consider a fuller rebuild
   (Next.js) only later.** The database design, the security rules, and the secret-
   holding functions are identical either way, so doing the simpler version first
   wastes almost no work if we upgrade the front end down the road. This is the
   "don't build it until you need it" choice.
2. **Migrate one feature at a time.** Supabase runs alongside the current system, and
   each feature flips over only after it is verified. At any moment, exactly one system
   is in charge of a given feature, so data never lives in two places at once.
3. **One database for both teams, separated by security rules.** Phoenix and Hellfire
   share a single Supabase project. Every row is tagged with its team, and the security
   rules keep teams from seeing or changing each other's data. Adding a future team
   becomes a single new row instead of a whole new deployment.
4. **Discord login moves to Supabase's built-in Discord support.** Officer and admin
   access is driven by a members table in the database.
5. **Start on the free tier.** It covers a guild our size. The only caveat: a free
   project goes to sleep after about a week of no activity, so the first page load
   after a long quiet stretch is slow for a few seconds. Weekly raids keep it awake.
6. **The historical loot sheet is imported once, then retired.** See **The loot feed**.

---

## What changes for users

**For raiders (public site):**
- Same URL, same look. The character selector, profiles, loot feed, raid progression,
  and signup form all stay.
- Discord login still works the same way (click, sign in with Discord, claim your
  character). One difference: the first time, Discord may show its permission screen
  again because the login is now handled by Supabase.
- Pages load faster and never show out-of-date numbers.

**For officers (dashboard):**
- Same dashboard, same tabs, same workflows (Roster, Loot, Priority, BiS, Attendance,
  Signups, M+ Exclusions, Received Items, Season Settings, Audit Log, Admin).
- Officer access still comes from your Discord account. Current officers stay officers.
- The audit log, approvals, fairness charts, and priority generator all keep working.

**What does not change:**
- The hosting for the website itself (still GitHub Pages, same address).
- Both teams stay supported.
- All existing data (roster, loot history, attendance, BiS lists, season history)
  comes across.

## The one real workflow change

Today an officer can open the Google Sheet directly and edit data by hand, add a
formula, or fix something in bulk. After the migration there is no Sheet to open. The
dashboard becomes the single place data is changed.

This is the most important thing for Kat to weigh in on. Before we flip each feature,
we need to know: **does any officer routinely do something by editing the Sheet
directly that the dashboard cannot already do?** Examples might be bulk-fixing names,
manual scoring tweaks, or custom columns. Anything like that needs a dashboard button
before that feature moves, or it becomes a step backward.

(Supabase does have a built-in table editor, but it is a developer tool, not an
officer-friendly screen, so the plan does not rely on it for day-to-day work.)

---

## The security model (please read)

This is the biggest real shift under the hood, and the one thing that has to be right.

Today, the Google Apps Script backend sits between the website and the Sheet and hides
everything. With Supabase, the website talks to the database more directly, using a
public key that ships inside the site's code. That means the database is reachable by
anyone who views the page source. That is normal and expected for this kind of setup,
**but it means the database's own security rules are the only thing protecting the
data.** There is no longer a backend to hide behind.

In practice this means:

- **All "who can do what" rules live in the database** (Row Level Security), not in the
  website code. The website cannot be trusted to enforce anything, so it does not try.
- **The team a request claims to be for is not trusted.** A write only succeeds if the
  logged-in user is actually a member of that team with the right role.
- **Secrets never go in the database.** The WarcraftLogs key, the Discord secret, and
  the bot key live only inside the Edge Functions, never anywhere the public key can reach.
- **Public submission forms get spam protection.** Because signup and request forms are
  now reachable directly, they get a bot check (Cloudflare Turnstile) so they cannot be
  spammed, something the old setup got for free through its awkward transport.

The plan includes a dedicated round of tests whose only job is to confirm these rules
hold: that an outsider cannot read or change another team's data even by faking the
team tag, and that no secret is reachable through the public key.

---

## Migration roadmap

Each phase ends with that feature live on Supabase and verified against the old system
before moving on. Order is driven by dependencies (later features need earlier ones in
place).

**Phase 1: Foundation.** *(Done.)* Set up the Supabase project, the database structure for
reference data (item lookup, armor types, bosses) and teams, and the testing setup.
Wire the website to read one simple thing from Supabase to prove the connection works.
Lowest risk, nothing user-facing changes.

**Phase 2: Public roster (read only).** *(Done, verified in #210.)* The public roster
(#208) and loot feed (#209) read from Supabase for both teams. Attendance and the two
M+ rejection fields still merge in from the Apps Script core payload -- they move at
Phase 5, not here. No writing yet, so no login needed.

**Phase 3: Login.** Move Discord login to Supabase. This affects the public site and the
officer dashboard at the same time, so it is done as one careful switch with the ability
to roll back. Current officers keep their access.

**Phase 4: Audit log.** Stand up the audit log in the database first, so that every
officer action migrated after this point is recorded properly from the start.

**Phase 5: Officer write features.** Move the features where officers change data, in
this order: roster edits, then BiS, then attendance, then loot, then the priority
generator (most complex, so last). Each one carries its audit logging and its Discord
bot notification across at the same time, so nothing goes silent.

**Phase 6: Settings and season data.** Move season settings, flags, and season history
into the database. Move secrets into Supabase's secret storage.

**Phase 7: Integrations.** Move the WarcraftLogs sync and the Discord bot notifications
into Edge Functions.

A rough sense of size: Phases 1 through 3 are the foundation and the trickiest to get
right (security and login). Phase 5 is the largest by volume because it is many features.
Phases 6 and 7 are smaller and self-contained.

## How the data moves over

For each team, a one-time import:

- Export each Sheet tab and load it into the matching database table.
- Reshape the data where the Sheet stored it awkwardly (the BiS grid and the priority
  ranking grid become normal rows).
- Convert dates from the Sheet's text format into real dates.
- Resolve players consistently by full name and realm, and catch any cases where two
  players share a first name (the Sheet tolerated this loosely; the database will flag it).
- Move officer and admin lists, player notes, and season history into their new homes.

Before each feature flips over, we check row counts and spot-check known records
against the live Sheet, so nothing is silently lost.

The tooling for this lives in `scripts/import/` (#320): CSV exports go into the
gitignored `data/<team>/` directory, `node scripts/import/generate.js --team <slug>`
writes one transactional SQL file per team, and the file is applied with psql. The
inserts key on natural unique columns, so re-applying after a fresh export picks up
only the rows added since the last run.

The BoE sheets are guild-wide rather than per-team, so they have their own entry
point (#749): the Form response export and the per-season sold exports go into the
gitignored `data/boe/` directory, `node scripts/import/boe.js` writes
`data/sql/import-boe.sql` covering every team in one run, and re-applying inserts
only finds that are new since the last run.

## The loot feed

Loot currently comes from two places: officers pasting RCLootCouncil exports into the
dashboard (the live path), and an automatic link to an older external loot sheet that
is no longer actively updated.

The decision: import that older sheet's history one time, then retire the link entirely.
Going forward, all loot comes through the dashboard paste, which writes straight to the
database. The dashboard's existing duplicate-protection is preserved, so re-pasting the
same export never doubles anything. After this, the app no longer depends on Google
Sheets at all.

---

## What we need from Kat

These are the decisions and setup steps that need Kat, listed so they can be handled in
one go.

1. **Approve the direction** in this document, or flag anything to change.
2. **The workflow question above:** confirm whether officers do anything by editing the
   Sheet directly that the dashboard cannot do, so we build those buttons before flipping
   the affected feature.
3. **Create the Supabase account and project** (free tier). This is a quick signup; we
   will walk through it together and note down the project keys.
4. **Discord app:** add Supabase's login address to the existing Discord application as an
   allowed redirect, alongside the current one. The old login keeps working until we
   remove it, so this is safe to do early.
5. **Discord bot over HTTPS:** the bot that posts signup and loot notifications currently
   runs on a plain web address. It needs a secure (HTTPS) address before the new backend
   can call it. We will sort out how.
6. **Access to the current Sheets** so we can export the data for the import.

## Risks and how we handle them

- **A security rule gap could expose data across teams.** Handled by a dedicated test
  suite that tries to break the rules, run before each feature goes live.
- **Losing direct Sheet editing.** Handled by the workflow question above, feature by
  feature, before each flip.
- **Login is shared by raiders and officers, so it switches for everyone at once.**
  Handled by doing it as one tested switch with the old method still registered for
  rollback.
- **Bot notifications could go quiet if a feature moves but its notification does not.**
  Handled by moving each feature's notification at the same time as the feature.
- **Free project sleeps after a week idle.** Acceptable for weekly raids; we revisit the
  paid tier only if it becomes a nuisance.
- **The blended priority scoring is the most complex logic.** Migrated last, and checked
  carefully against the current results before going live.

## How we verify and roll back

- Each phase is checked against the live system for the same team and season before it
  goes live.
- The old system stays in charge of each feature until its replacement passes its checks,
  so rolling a single feature back is just pointing it at the old backend again.
- Login keeps the old method registered until the new one is proven, so it can be
  reverted without locking anyone out.

---

## Appendix: technical detail (for implementers)

This section is for whoever builds it. Non-technical readers can stop here.

### Current architecture (confirmed in the code)

- Front end: static HTML and vanilla JS on GitHub Pages, talking to the backend over
  JSONP. Shared request helper at `js/common.js:62`; privileged writes append a session
  token via `_getDiscordTokenParam()` (`js/common.js:580+`).
- Backend: Google Apps Script, a single `doGet` action router in `gs/wgaWebApp.gs`.
- Data: about 15 Sheet tabs plus Script Properties for config and sessions.
- Secrets in Script Properties (confirmed): `WCL_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET`,
  `BOT_WEBHOOK_SECRET`; bot target hardcoded at `gs/wgaWebApp.gs:83-84`.
- Scoring layout (`gs/Config.gs`): recent score (last 2 reports), trend score (last 8),
  best (20), performance, attendance score (0-10), attendance percent; player rows 4-33.
  WCL guild tag 801219, mythic difficulty 5, heroic 4.
- Loot merge and dedupe at `gs/wgaWebApp.gs:2074-2104`.

### Target stack

- `supabase-js` loaded via CDN from the existing static pages (keeps the GitHub Pages
  deploy build-free).
- PostgreSQL with RLS as the security boundary.
- Edge Functions (Deno/TypeScript) for secret-bearing work only.
- Supabase Auth with the Discord provider; roles from a `team_members` table.

### Schema sketch

Each table below is roughly one Sheet tab. The main shape change: two of today's grids
become tall and narrow instead of wide. The BiS List (today a column per player) and the
Priority Order ranks (today a column per place) each become one row per entry. That "one
row per entry" layout is what makes filtering, counting, and linking reliable, and it is
the usual way databases store this kind of data. It is called *long form*.

Shared reference tables (no team tag): `items` (name, slot, armor_type, sort_id),
`item_bosses`, optional `classes_specs`.

Per-team tables (each tagged with `team_id`):
`teams`, `team_members` (discord_id, nullable auth_user_id, role, name_realm),
`players`, `scoring` (recent/trend/best/performance/attendance_score/attendance_pct),
`bis_items` (replaces the BiS grid), `priority_order` (long form, replaces the rank grid),
`attendance` (keyed by name_realm, not first name), `loot` (with rclc_id and a dedupe key),
the request queues (`signups`, `bis_requests`, `self_received_requests`,
`mplus_exclusion_requests`, `pending_roster`), `audit_log`, `settings` (public config in
JSON), and `season_snapshots` (replaces the season history blob).

RLS shape: reference tables readable by all; roster readable by anyone, writable only by
that team's officers and admins; request queues insertable by the matching raider or a
bot-checked anonymous submitter for their own character, readable and approvable only by
officers; audit log readable only by officers; every write rule binds the team to the
caller's membership rather than trusting the request.

### Auth bootstrap detail

Officers are pre-listed by Discord ID today, but Supabase issues a user ID only after the
first login. So `team_members` is keyed on `discord_id` with a nullable `auth_user_id`
filled in on first login (via a trigger, a small rule the database runs by itself, that
matches the Discord identity). A pre-listed
officer who has not logged in yet simply has a null `auth_user_id`, which is expected.
The character-claim mapping and the raider self-link flow are preserved.

### Edge Functions

- `wcl-sync`: holds the WCL key; ports `gs/WCL.gs` and `gs/Attendance.gs`; writes scoring
  and attendance using the service role (an admin-level key that lives only inside the
  server function, never in the page).
- `discord-bot-webhook`: posts notifications; bot moves behind HTTPS first.
- No custom OAuth function (Supabase Auth handles it). No loot-feed sync (the external
  sheet is legacy and imported once).

### Files that change on the front end

`js/common.js` (add a Supabase client and data functions alongside the existing JSONP
helper so features migrate one at a time), `js/discord.js` (swap login), `js/officer.js`,
`js/roster.js`, `js/signup.js`, `js/tabs/tab-*.js` (per-tab data calls), and the three
HTML files (load `supabase-js`, handle the Supabase login redirect).

### Behavior to preserve (reference while porting)

`gs/wgaWebApp.gs` (the action contract and all readers and writers), `gs/Config.gs`
(column mapping), `gs/PriorityGenerator.gs` (blended scoring; compare its output against
the current generator row by row before trusting it), `gs/WCL.gs` and `gs/Attendance.gs`.

### Tooling notes

- Node and the Supabase CLI are available on the dev machine. Docker is not installed
  yet, and local Supabase development needs it. Options: install Docker Desktop for local
  work, or develop against the cloud project directly.
- Tests: `vitest` plus the Supabase CLI for a local database. The RLS policy matrix is the
  highest-priority test (anon vs raider vs officer vs admin, plus cross-team and secret
  checks). Add Edge Function tests (mock WCL/Discord/bot HTTP, confirm loot dedupe is
  idempotent, meaning pasting the same export twice changes nothing the second time) and
  data-migration tests (counts and known records after import).
