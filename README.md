# WGA Raid Hub

A live web app for We Go Again raid teams -- a full raid hub giving raiders a personal profile and officers a complete management dashboard. Supabase (Postgres + Auth + RLS) is the backend; there is no build step and no server of its own -- both pages are static HTML/JS hosted on GitHub Pages, talking to Supabase directly from the browser.

Supports multiple teams (Phoenix, Hellfire Rollers, Immolation) from a single codebase. Append `?team=hellfire` (or `?team=immolation`) to any URL to switch teams; a raider or officer who's claimed a character on a given team is redirected there automatically on a cold visit.

---

## What it does

### Guild page (public, `guild.html`)

The one page that is not scoped to a raid team: the guild above the three teams, rather than any one of them. It is where a visitor who does not know which team they want starts.

Carries the team cards (badged with your own team, plus a signup link for any team whose signups are open), guild-wide Twitch streams (whoever is live gets an embed, everyone else a compact row), a three-headline news teaser, a **BoE** nav link to the BoE page, About the Guild, and the guild's external links. Built across [milestone #27](https://github.com/katogaming88/WGA-Raid-Hub/milestone/27).

It replaced the cold-landing team-picker modal on `index.html`, so a visitor with no `?team=` in the URL now lands here instead of on a three-button prompt. A signed-in raider with exactly one claimed team still goes straight to that team's roster, so nobody's daily path got longer. `index.html` keeps its URL and stays the team page; whether the guild page should become the site's front door is tracked in [#794](https://github.com/katogaming88/WGA-Raid-Hub/issues/794).

### BoE Sales (`boe.html`)

Report a find and follow what happens to it, on one page. The report form sits at the top ([#891](https://github.com/katogaming88/WGA-Raid-Hub/issues/891), moved off index.html's BoE tab; no login needed, and it picks its own reporting team), and under it the found-BoE auction lifecycle ([#864](https://github.com/katogaming88/WGA-Raid-Hub/issues/864)): record listings and sales (payout split computed from the guild-wide policy), mark payouts paid, retire dead items, undo any of those; a summary strip of guild income, outstanding payouts, and finds per team. Guild-wide, not per-team: BoEs are guild property, so a BoE manager or site admin sees every team's finds in one list with the finding team named per row. Open to anyone signed in ([#890](https://github.com/katogaming88/WGA-Raid-Hub/issues/890)) and scoped by the read policies: a team officer sees the teams they staff and settles those payouts ([#888](https://github.com/katogaming88/WGA-Raid-Hub/issues/888)), a raider sees the finds reported under their own character ([#889](https://github.com/katogaming88/WGA-Raid-Hub/issues/889)) with no buttons. Reached from the **BoE** link in every page's nav, none of them access-gated any more; `index.html?team=<slug>#boe` and `guild.html#boe` redirect here, the first carrying its team. Signed-out visitors get the form and a sign-in prompt in place of the records.

### Landing page (public, `index.html`)

- Character selector dropdown -- choose your character to open your profile (officers get the full roster; a claimed-but-unclaimed-dropdown raider gets a one-click "View My Profile" instead)
- Stats row showing current Raiders count and total items distributed this season
- Recent Loot feed, searchable, showing items distributed across the roster this season
- Raid Progression tracker -- every raid in the current season as cards with kill counts, boss lists, first-kill dates, and AOTC badge
- A floating live Twitch widget for raiders currently streaming
- Discord login -- sign in with Discord (via Supabase Auth) to claim your character and unlock personalised features

Other public nav tabs: **Roster** (current + next-season "tentative" roster), **Streams** (full streamer directory), **Sign Up** (multi-step season signup form), **History** (past seasons' progression and rosters), **About** (team bios, guild leadership bios, guild info, contact form), **News**, **Help**. The current view (and an open profile) is reflected into the URL, so a reload restores where you were instead of always dropping back to Home.

### Raider profile (public, no login required to view)

- **Attendance** -- season attendance percentage with a colour-coded progress bar and monthly sparkline, expandable to show Excused/No Show dates
- **Items Received** -- items received this season, expandable to the full list with slot and difficulty
- **BiS List** -- link to the player's submitted BiS list; submit or update directly from the profile when submissions are open
- **Wishlist** -- per-item tiered status (BiS / Good / OK / Catalyst Only / Pass) a raider sets themselves, feeding into priority generation
- **Loot Priority** -- every BiS item with the player's current priority rank, slot, and source
- **Self-mark received** -- submit items received outside of raid (M+, Great Vault, Crafted, Catalyst, Bonus Roll) for officer approval; a Discord-authenticated raider marking their own claimed character is auto-approved
- **M+ Exclusion** request, when the team has that window open
- Trial / Bench / Backup Tank / Backup Healer badges, when applicable

### Discord login (raiders and officers)

Everyone signs in with the same Discord button (Supabase Auth, full-page redirect). On first login a raider claims their character from the team's roster; a persistent "Claim your character" prompt on the landing page covers logging in without a claim yet, including pointing at the right team if they're already claimed elsewhere. Officer/admin status is derived from the database (`team_members.role`, `site_admins`), not a separate login -- an existing Discord session just unlocks more once it resolves.

- **My Profile** -- nav dropdown shortcut to your claimed character's profile
- **Officer Access** -- shown to officers/team leaders/site admins, links straight to `officer.html`
- **Site Admin** -- a separate Discord-authenticated page (`admin.html`), gated to `site_admins` only

### Officer dashboard (`officer.html`)

Discord-authenticated, session lasts 2 hours. A global season selector filters loot, fairness, and attendance to a specific past season. Every tab/sub-tab below can be individually hidden per team via Feature Flags (Admin tab), except Roster and Season Settings.

| Tab | Sub-tabs | What it shows |
|-----|----------|--------------|
| **Roster** | Roster / Discord Claims | Roster: full player table with attendance, items, BiS status, Trial/Bench/Backup Tank/Backup Healer tags; filter and sort; click a player to expand their profile inline with edit controls, add/remove/rename players. Discord Claims: every claimed Discord-to-character mapping; remove a claim or grant/revoke officer access. |
| **Loot** | Import / Import History / Loot Fairness | Import: paste RCLootCouncil JSON to write loot to the database. Import History: view previously imported batches. Loot Fairness: bar chart of items received per player, filterable by Heroic or Mythic. |
| **Priority** | Priority List / Contested Items / Unmanaged Items | RCLootCouncil export string generator. Priority List: full priority order per item, filterable/searchable, each item has a Priority Generator button (auto-rank by blended score) with an editable, saveable order. Contested Items: every item sorted by how many players have it on their BiS/Wishlist. Unmanaged Items: BiS items with no priority order yet, badge-counted. |
| **BiS Manager** | Submissions / BiS Lists | Submissions: open/close BiS submissions globally or per player; approve or reject submitted links. BiS Lists: role-grouped player table; Edit opens the 16-slot BiS item grid with armor-type-filtered item search/autocomplete. |
| **Attendance** | Manage / Attendance Scores / Bench Fairness | Manage: attendance grid editable per player per night, Refresh from WCL, Commit Attendance Scores. Attendance Scores: players below a threshold. Bench Fairness: bench player attendance comparison. |
| **Scoring** | -- | Fetches WarcraftLogs performance scores per player, editable/overridable manually, committed as one of the Priority Generator's blended-score inputs. |
| **Signups** | Signups / Pending Roster / History | Signups: open/close the public form; review/approve/deny submissions. Pending Roster: approved applicants awaiting a roster add, with Trial/Backup Tank/Backup Healer toggles at promotion time. History: past signup activity. |
| **M+ Exclusions** | -- | Review/approve/reject raider-submitted M+ exclusion requests; toggle exclusion per player manually; open/close the request window. |
| **Received Item Requests** | -- | Approve or reject raider self-mark requests; writes straight to loot history on approval. |
| **BoE Sales** | -- | Not a tab any more: the **BoE** link in this page's site nav opens `boe.html` (see above), which reports finds and tracks them, open to anyone signed in and scoped by the read policies. An old `?tab=boe` bookmark redirects there. |
| **Season Settings** | Settings / Raid Progression / History | Settings: season name/start/end, season code prefix, target tank/heal roster counts, trial thresholds, WCL guild link. Raid Progression: boss kill dates shown publicly. History: past seasons, Archive Season (snapshots the roster and pushes to history), Unarchive. |
| **Officer Bios** | -- | Team officer bio cards shown on the public About tab; also edits Guild Officer Bios (guild-wide, site-admin write access). |
| **Audit Log** | -- | Searchable, append-only log of every officer/admin action -- actor, action, target, detail, timestamp. |
| **Reports** | Raid Nights Since Last Item / BiS Demand vs Awards / Priority Order Health / Season Loot Pace | Read-only analytics views over the season's loot/priority/BiS data. |
| **Admin** | Properties / Data Export / Officers / Feature Flags / Danger Zone | Visible to team leaders and site admins. Team leaders see Properties, Officers, Feature Flags, and Danger Zone (but only its one team-leader-scoped op, Clear Season History); Data Export and every other Danger Zone clear (Loot Data, BiS Submissions, Signups, Pending Roster, M+ Exclusion Requests, Self-Received) are site-admin only. |
| **Help** | -- | Officer workflow reference guide. |

### Site Admin dashboard (`admin.html`)

A separate, site-wide (not per-team) page gated to `site_admins`:
- **Teams** -- create/archive teams
- **Site Admins** -- grant/revoke site-admin access by Discord ID
- **Guild Officers** -- grant/revoke guild-wide officer access by Discord ID (view + player/attendance/bio edits on every team, without site-admin write access)
- **BoE** -- grant/revoke the BoE manager role by Discord ID (guild-wide; it gates every BoE money mutation), plus the guild-wide payout floor and pivot
- **Feature Flags** -- the same per-team flags as officer.html's Admin tab, in one cross-team table
- **Audit Log** -- cross-team, searchable
- **Maintenance Mode** -- site-wide banner + data-load gate

---

## Auth, sessions, and access control

- **Discord OAuth via Supabase Auth** is the only login method, for raiders, officers, and admins alike -- one button, one flow.
- **Character claim** links a raider's Discord identity to a `players` row (`team_members` + `claim_character()`); a person can claim characters on multiple teams.
- **Officer access** is a `team_members.role` value (`officer`/`team_leader`), not a separate credential -- granted/revoked from the Roster tab's Discord Claims sub-tab or the Admin tab.
- **Site-admin access** is the `site_admins` table (by Discord ID), managed from `admin.html`.
- Every write path is enforced by Postgres Row Level Security, not client-side checks -- see [`docs/RLS.md`](docs/RLS.md) for the full policy/function matrix.

---

## Architecture

1. **Supabase Postgres** is the single source of truth -- schema and RLS policies live in `supabase/migrations/`, applied in order.
2. `index.html`, `officer.html`, `admin.html`, `guild.html`, and `boe.html` are plain static pages (no build step, no bundler) that call Supabase directly from the browser via `supabase-js`, using a public anon key restricted by RLS.
3. **Feature flags** (`team_settings.config.features`) let a team hide tabs/sub-tabs it doesn't use, editable per-team from the Admin tab or site-wide from `admin.html`.
4. Every page is hosted on **GitHub Pages** at the repo root; the `TEAMS` object in `js/common.js` maps each team slug to its Supabase team ID, switched via `?team=`. `guild.html` and `boe.html` are the exceptions: both are guild-wide and carry no team; the guild page links down into the team pages, and the BoE page shows every team's finds and asks which team a new find is for. `boe.html` reads a `?team=` when one is given, purely to preselect that dropdown.
5. Google Sheets/Apps Script was the original backend but has been **fully retired** (the migration's last phase closed 2026-07-21) -- the `gs/*.gs` files remain in the repo only as historical record; nothing reads or writes through them anymore.

For the full file-by-file breakdown, local dev setup (Docker + Supabase CLI), migration workflow, and PR requirements, see [`CONTRIBUTING.md`](CONTRIBUTING.md) -- that's the maintained source of truth for project structure so it doesn't drift out of sync with this file the way it previously did.

---

## Database

- [`dbdoc/`](dbdoc/) -- generated schema docs (tables, columns, triggers, functions, ER diagrams), regenerated with `npm run db:docs`. Never hand-edit.
- [`docs/database-schema-reference.md`](docs/database-schema-reference.md) -- a narrative companion to `dbdoc/`.
- [`docs/RLS.md`](docs/RLS.md) -- hand-maintained policy/function reference (tbls can't generate this).
- [`docs/database-decisions.md`](docs/database-decisions.md) -- a running log of settled schema decisions and the reasoning behind them.
- [`docs/backup-restore.md`](docs/backup-restore.md) -- what's backed up, what's regenerable without a backup, and the restore runbook.

---

## Local development

See [`docs/supabase-local-dev-setup.md`](docs/supabase-local-dev-setup.md) for setting up the local Supabase stack (Docker + CLI) from scratch.

```
npm run lint           # eslint over js/, scripts/, tests/
npm run format:check   # prettier check
npm run typecheck      # tsc --noEmit (js/common.js is @ts-check'd)
npm run test:frontend  # vitest -- frontend logic, no browser needed
npm run test:rls       # vitest -- RLS policy behavior against a local reset
npm run db:docs        # regenerate dbdoc/ after a migration change
npm run db:rls         # regenerate docs/rls_policies.csv
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full PR checklist (what a migration change additionally requires) and versioning/changelog rules.

---

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) and the [issue tracker](https://github.com/katogaming88/WGA-Raid-Hub/issues) for planned work.
