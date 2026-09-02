# Officer Dashboard Walkthrough

Reference notes for walking an officer through the dashboard -- not published to officers.

## Logging in

- Go to the officer page URL (not the public page)
- They log in with Discord -- session lasts 2 hours, then it re-prompts (the shared officer password was removed since access is fully Discord/RLS-gated now)
- Point out the season selector dropdown in the toolbar -- it filters most views to a specific season
- Top nav also has **Roster**, **Streams**, **Sign Up**, and **Help** links back to the public site (index.html) -- useful for checking how something looks from a raider's point of view without logging out

---

## First-Time Team Setup

A handful of settings live outside the weekly cadence below -- configure these once when a
team is first stood up (or whenever the season's progression/rosters need redefining):

- **Season Settings -> Raid Progression** -- add one block per raid in the season; boss kill
  dates show publicly on the landing page. Mini-raids (single/small standalone bosses) get no
  AOTC date field.
- **Season Settings -> Settings -> Trial Promotion Thresholds** -- set the weeks-on-roster and
  attendance % a trial needs to hit both of before the Roster tab's promotion banner appears
  for them.
- **Season Settings -> Settings -> Target Roster Sizes** -- optional Tank/Healer count inputs.
  Once the confirmed roster plus already-approved incoming roster meets or exceeds a target,
  raiders signing up for that role see a nudge to consider DPS/backup instead or talk to an
  officer. Leave a field blank to skip the nudge for that role -- raiders still see the plain
  count either way.
- **Officer Bios tab** -- add a card per officer (name/character/class/spec can prefill from an
  existing roster player, a one-time copy, not a live link), pronouns, title, an optional photo
  path under `assets/officers/`, and a short bio. Save Bios writes the whole list back.

Also worth setting early, even though they're covered in their own sections below: **Season
Name** and **Season Start Date** (Season Settings -> Settings) before the first loot import or
attendance refresh.

---

## Weekly / Recurring Workflow

The day-to-day job as an officer comes down to three cadences. These are the app's own
canonical steps (also built into the dashboard's Officer Guide tab) -- point people there
directly once they've seen it walked through once.

### After each raid night
1. **Loot tab -> Import** -- confirm Season Name is set in Season Settings, paste the
   RCLootCouncil JSON export, click Import. Duplicates are skipped automatically -- safe to
   paste multiple nights at once or re-paste an old export.
2. **Attendance tab -> Manage** -- Refresh from WCL (pulls the latest raid nights), review/edit
   any player statuses in the grid, then Commit Attendance Scores (recalculates attendance % for
   everyone -- safe to run multiple times, always recalculates from scratch).
3. **Scoring tab** -- Refresh from WCL (calculates ilvl-bracket scores for DPS), enter manual
   scores for tanks/healers, then Commit Performance Scores (saves the Recent score into the
   official Performance value Priority Generator uses).
4. **Priority tab** -- re-run Suggest Order for any item that just became contested.

### Ongoing -- review these as submissions come in
- **Signups** -- new applications
- **BiS Manager -> Submissions** -- link approvals/rejections
- **M+ Exclusions** -- exclusion requests
- **Received Item Requests** -- self-reported items from outside raid

### Once per season (the app's own "Rollover workflow")
1. Set an **End Date** on the current season if it closes before the next one starts.
2. **Season Settings -> History -> Start New Season** (formerly "Archive Current Season") --
   pushes the current Season Name/Start/End into history so it shows up in the season selector
   dropdown going forward, and does a lot more in the same click: wipes every player's
   real-item BiS list (placeholder M+/Crafted/Catalyst rows survive) and their submitted BiS
   link (a link is effectively per-tier; cleared unconditionally rather than left for a raider
   to notice it's stale), resets M+ exclusion for the whole active roster, resets Bench status
   for the whole active roster (Trial status is left alone), and auto-fills the new Season Name
   from the current tier constant. See the Season Settings section below for the full behavior.
3. Still in Season History, run the just-archived season's **WCL Performance Baseline**
   fetch (#264) -- the "Fetch WCL Performance" row only appears next to the *newest* history
   entry, so this is the only chance to run it; once another season is archived, the entry
   drops off the list with no way back. Seeds the Heroic priority baseline
   (`player_wcl_season_perf`) before the new season has raid reports of its own, and seeds
   `scoring.performance_score` for the new season too (without ever overwriting a real
   Commit Performance Scores). A live status label on the row shows whether it's already
   been done for that season.
4. Set the new **Start Date** for the upcoming season (Season Name is now auto-filled by step 2).
5. Re-import the new season's loot via **Loot -> Import** (entries auto-tag with the new season
   name). Old loot history doesn't need clearing -- entries stay tagged by season and the
   season selector already filters by it; there is no "Clear All Loot History" action (see the
   Loot tab section below).
6. Nothing special needed for Attendance -- there's no rollover-specific action here. Once the
   new season's first raid night happens, the normal after-raid-night **Attendance -> Refresh
   from WCL** (see the Weekly Workflow above) picks it up like any other night, since it's
   already scoped to raids on/after the new Season Start Date. Until then, players will show
   the roster's default "no data yet" 100% for the new season, which is expected, not a bug.
7. M+ exclusions are already reset team-wide by step 2's Start New Season. **M+ Exclusions ->
   Clear All Exclusions** is still useful mid-season if you need to reset exclusions without a
   full season rollover -- it only flips the live exclusion flag, it does not touch or relabel
   request history. **Do not** use Admin -> Danger Zone -> "Clear M+ Exclusion Requests" for
   this -- that permanently deletes the request history instead and leaves everyone's active
   exclusion untouched, the opposite of what a reset needs. See the M+ Exclusions section below
   for the full distinction.

---

## Roster tab

Two sub-tabs: **Roster**, **Discord Claims**.

- Search box, plus filter chips: Low Attendance (<95%), No BiS Source, Trials Only, Bench Only
- Role filter chips (Tank/Heal/Melee/Ranged) and sort (Name/Attendance/Items)
- **Buff Coverage** panel -- read-only, checks Raid Buffs/Boss Debuffs/Utility across the
  active (non-bench) roster and flags anything under-covered
- **Trial promotion banner** -- appears automatically once a trial meets both thresholds set
  in Season Settings (weeks on roster + attendance %)
- **+ Add Player** button in the table header
- Click any player to expand their profile card inline. From the card they can:
  - Change class, spec, role, trial/bench status, join date
  - Rename a player via the Name/Realm field (character or realm change) -- this also updates
    their name on the Attendance and Loot sheets
  - Add a private officer note (only visible on the dashboard)
  - Update a player's BiS source directly without waiting for a submission
  - Allow a player to submit a BiS update even when submissions are closed
  - Toggle their M+ exclusion directly, without a request
  - Mark an item as received directly (skips the approval queue)
  - Mark them as a designated Backup Tank / Backup Healer (roster flags shown as tags in the
    table, separate from their main role)

**Discord Claims sub-tab** -- shows characters claimed by raiders via Discord login. Remove a
claim if a raider linked the wrong character. Officer *promotion* (making someone an officer)
happens in the Admin tab's Officers sub-tab, not here.

---

## Loot tab

Three sub-tabs:

- **Import** -- paste RCLootCouncil JSON from in-game; entries are tagged with the current
  Season Name automatically. Set Season Name in Season Settings first.
- **Import History** -- a table of the most recent RCLootCouncil imports (up to the last 100
  rows: Time/Player/Item), sourced from the audit log so it only ever shows genuine paste-imports.
  There is no "Clear All" here -- it was deliberately left out because `rclc_loot` mixes
  paste-imports with older merged-in legacy-tracker rows with no column to tell them apart, so
  there's no safe way to delete "just this season's" entries. Loot history is never manually
  cleared; it stays in place and is filtered by its season tag.
- **Loot Fairness** -- bar chart of items received per player; filter by Heroic or Mythic

---

## Priority tab

At the top: **RCLootCouncil Export String** -- Generate/Regenerate pulls an already-encoded
string built from the current priority order and roster. Copy it into RCLootCouncil in-game
to sync priorities to the council.

Four sub-tabs:

- **Priority List** (default) -- read-only full ranked order per item; filter by boss, search by
  name, or hide empty entries. Its badge counts stale-after-Heroic Mythic #1s, same-boss #1
  conflicts, and players holding 2+ #1s team-wide; a banner also flags incomplete raider
  Wishlists (see BiS Manager -> BiS Lists for who's missing what). Each ranked player also flags
  if they already received a *different* item in the same slot this season (e.g. already has one
  ring, ranked for another) -- read live off this season's loot, not just whatever the list
  looked like when it was last generated
- **Contested Items** -- items wanted by multiple players; flags any player holding 1st priority
  on more than one item so over-allocation gets caught before loot decisions
- **Unmanaged Items** -- BiS items with no priority order set yet; badge shows the count
- **Notes** -- every item with a raider-written Wishlist note, and who wrote it. This is where a
  raider's "BiS for Destro"-style notes actually surface (see the raider walkthrough's
  "Fill out their Wishlist" section) -- gold badge on the tab flags when notes exist. Read-only
  context for judgment calls, e.g. deciding whether to award a second item in a slot to someone
  who's already tagged a note explaining why a different item is their real BiS for another spec;
  doesn't feed the Suggest Order scoring itself. Worth checking that the note is actually about a
  spec swapped between regularly mid-raid (same role, same primary stat) -- not someone's M+-only
  or different-role off-spec, which isn't what this is meant to cover

All four sub-tabs (and the BiS item-search pool) are scoped to the Season Settings -> Settings
-> **Season View** picker -- items outside the season you're currently viewing won't appear.

Clicking Edit (or Set Heroic/Set Mythic on an unmanaged item) opens the priority editor:
- Heroic/Mythic toggle at the top
- **Suggest Order** auto-ranks eligible players by blended score (role x attendance x WCL
  performance)
- Drag to reorder manually; add players from the pool on the right (defaults to BiS/wishlist
  players for that item, toggle "Show all roster" to widen it); no limit on players per item
- A warning appears if someone ranked below a player who already has the Heroic version is
  themselves marked "No Version" -- worth a manual review before saving
- Save

**How Priority Order works with Loot Import**

The priority list for an item (who's next in line for it) is not automatically updated when loot
is imported. Think of it as two separate steps:

1. Generating the list -- When an officer clicks "generate" for an item, the system looks at
   everyone who wants it (BiS list), checks who's already received it this season, and ranks the
   rest by performance/attendance score (with adjustments for tanks/healers, bench, trials, etc.).
   Anyone who already has the Mythic version -- or the Heroic version, if you're generating a
   Heroic list -- gets automatically filtered out of that fresh list. So at the moment you
   generate it, it's accurate.
2. Saving it -- Once generated, the officer saves it, and it sits in the system as a fixed, saved
   list until someone regenerates it again.

The gap: After a raid night, when loot is imported (from RCLootCouncil logs), the system records
who got what -- but it does not go back and edit any already-saved priority lists. So if someone
was #1 on a saved list and then received the item that night, the saved list still shows them as
#1 until an officer manually regenerates it.

The safety net: The system has built-in reports that flag this kind of staleness -- e.g., "this
person is still ranked #1 for Mythic but already has the Heroic version" -- so officers can spot
outdated lists. But nothing fixes it automatically; someone has to notice the flag and re-run the
generator.

Bottom line: Priority lists are a snapshot, not a live feed. They're only as current as the last
time someone hit "generate." Loot import updates the history the generator reads from -- it just
doesn't rewrite lists that were already saved.

---

## BiS Manager tab

Two sub-tabs:

- **Submissions** -- open/close toggle controls whether raiders see the BiS submit form.
  Approving updates the player's BiS source on the Roster automatically; Rejecting discards the
  submission with no change. A single player can be allowed to submit even while the window is
  closed, via the "Allow BiS Submit" toggle on their Roster profile card. **My BiS Changed (Same
  Source)** lands in this same queue -- a raider flagging that their source's *contents* changed, not
  the URL. Approving one of those doesn't update anything by itself (the source is already on file);
  it's just an acknowledgment that you've seen it and are about to act -- either edit their pick(s)
  in the BiS Lists grid below to match, or let them do it themselves via the separate **Wishlist
  Editing** open/close toggle in this same panel. Same per-raider exception shape as BiS Submit:
  "Allow Wishlist Edit" on their profile (officer view) reopens editing for just that one raider
  without reopening it team-wide.
- **BiS Lists** -- every player grouped by role with their item count. A player with an
  incomplete raider Wishlist shows a "Wishlist incomplete (N)" badge next to their name, hover
  for which slots are missing. Click Edit to open an inline item editor -- search is filtered to
  their armor type automatically, their BiS source link is shown at the top. There's no Save
  step -- every add, remove, and obtained-toggle writes to Supabase immediately.
  A raider's profile "BiS List" is a live merge on top of what's set here: any item they've
  tagged **BiS** in their own Wishlist overrides this grid's pick for that slot on their profile
  display (and in Loot Priority) without touching what's actually stored here -- so their profile
  can show something different from this grid without either side being wrong. When a raider
  flags "My BiS Changed" or a Wishlist note points at a real BiS change, editing their pick here
  works regardless of Wishlist Editing's open/closed state (it's the thing Loot Priority actually
  reads for slots the raider hasn't tagged themselves) -- or flip their "Allow Wishlist Edit"
  toggle (Submissions sub-tab above) if you'd rather they make the change themselves.

---

## Attendance tab

Three sub-tabs:

- **Manage** -- the main grid.
  - **Refresh from WCL** -- pulls the latest raid nights; run this after each raid night.
  - Click any player's status cell to set it manually: Present, Bench, Medical Leave, Excused,
    Extended Leave, No Show, or Not on Roster. Saves immediately (checkmark confirms).
  - **Exclude Report** toggle per raid night -- for alt runs or the wrong zone getting pulled
    in; excludes that whole night from scoring.
  - **Commit Attendance Scores** -- recalculates every player's attendance % and saves it to
    Scoring. Safe to run repeatedly; always recalculates from scratch.
- **Attendance Scores** -- threshold slider (default 95%); lists players at or below it with
  their specific penalty dates.
- **Bench Fairness** -- attendance view scoped to bench players specifically.

---

## Scoring tab

- **Refresh from WCL** -- calculates an ilvl-bracket percentile score for DPS from recent
  Warcraft Logs reports, holding draft Recent/Trend/Best values in a session cache. Tanks and
  healers don't get an automatic score, and there's currently no click-to-edit cell for them
  either -- manual tank/healer scoring has no UI path right now.
- "use" next to the **Best** score copies it into the Recent cell, if the widest-lookback number
  reads more fairly than a rough recent run.
- **Commit Performance Scores** -- saves the Recent score into the official Performance value
  that Priority Generator actually reads. Safe to run repeatedly.
- Color legend: green >=7.0 (Strong), gold >=5.0 (Average), dim <5.0 (Below average), purple
  (Trend fallback -- no recent data), red (No data), grey (Excluded -- Tank/Healer).

---

## Signups tab

Three sub-tabs: **Signups**, **Pending Roster**, **History**.

- **Signups** -- open/close toggle shows/hides the Sign Up button on the landing page.
  Approving marks the application approved and moves it to Pending Roster; Denying marks it
  rejected. If someone re-submits, it overwrites their existing pending entry rather than
  creating a duplicate. There's no delete action on this sub-tab -- Approve/Deny are the only
  options (don't confuse with Pending Roster's **Remove**, which just marks an entry rejected).
- **Pending Roster** -- applications approved but not yet on the roster. Each card has its own
  **Add to Roster** button (with a trial toggle, Backup Tank / Backup Healer checkboxes, and for
  main-swap signups, a swap picker); a selection checkbox per card plus **Select All** and **Add
  Selected to Roster** push a chosen subset at once. A **Buff Coverage** panel checks the
  pending group the same way the Roster tab's does. A collapsible **Missing Signups** panel
  lists roster members who haven't submitted a signup this cycle -- read-only, no bulk-remove
  action from here. **Remove** dismisses a single pending entry instead.
- **History** -- read-only, grouped by Approved/Pending/Denied, filterable by season.

---

## M+ Exclusions tab

- Open/close toggle controls the raider-facing request form -- raiders submit their Raider.io
  profile and a reason.
- The form gates Submit on two self-attested checks (6/6 Myth in every M+ obtainable slot; gem
  sockets filled 2 of 3 or better on Helm/Bracer/Belt) before a raider can even reach the
  Raider.io/reason fields. These are self-reported, not verified by the app -- still check the
  Raider.io link and read the reason field yourself, especially for known exceptions like a
  raid-only trinket stuck below Myth track with no M+ equivalent (raiders are prompted to
  mention this in their notes).
- Approving flags the player as M+ excluded on the roster view.
- Exclusion can also be toggled per player directly from their Roster profile card, without a
  request.
- **Clear All Exclusions** (on this tab, #405) -- flips every currently-excluded player's live
  `m_plus_excluded` flag back off (nobody stays excluded going into the new season). It only
  touches that flag -- it does **not** relabel or otherwise touch the request rows, the full
  request history stays intact and unchanged. Note: Season Settings -> **Start New Season**
  now also resets this flag for the whole active roster as part of archiving, so this button is
  mainly useful for a mid-season reset without a full season rollover.
  This is completely different from Admin -> Danger Zone -> "Clear M+ Exclusion Requests,"
  which does the opposite: it permanently deletes the request history and does **not** touch
  who's currently excluded -- anyone excluded stays excluded. Running the Danger Zone version
  at a season reset would leave stale exclusions in place while destroying the record of why
  they were granted. Always use this tab's button (or Start New Season) for a reset, never the
  Danger Zone one.

---

## Received Item Requests tab

- Raiders submit when they get an item outside of raid (M+, Great Vault, Crafted, Catalyst,
  Bonus Roll).
- Approve marks it received in their loot history, affecting fairness scores and priority
  standing. Reject dismisses it with no change.
- Items can also be marked directly from a player's Roster profile card -- that bypasses this
  queue entirely and takes effect immediately.

---

## Season Settings tab

Three sub-tabs: **Settings**, **Raid Progression**, **History**.

- **Season** -- the season number, entered as a plain number and combined with the (hardcoded)
  display prefix into the label applied to every loot entry imported through RCLootCouncil while
  it's set; also what the toolbar's Season dropdown filters by. Set before importing each
  season's loot.
- **Signup Season** -- a *separate* label stamped on signup submissions, distinct from Season
  Name. If left blank, signups get no season tag and won't show up in season-filtered views.
  Set before opening signups.
- **Season Start Date** -- raids before this date are excluded from attendance scoring;
  players who joined after it use their own join date as the window start instead. Leave blank
  to include all raids.
- **Season End Date** -- optional upper bound, for when a season closes before the next one
  starts.
- **Trial Promotion Thresholds** -- weeks-on-roster *and* attendance % a trial needs to hit
  both of before the Roster tab's promotion banner appears for them.
- **Target Roster Sizes** -- optional Tank/Healer count inputs. Once the confirmed roster plus
  already-approved incoming roster meets or exceeds a target, raiders signing up for that role
  see a nudge to consider DPS/backup instead or talk to an officer. Leave a field blank to skip
  the nudge for that role -- raiders still see the plain count either way.
- **Season View** -- a forward-looking season picker, separate from the live Season Name, that
  scopes the item catalog / BiS lists / Wishlist prep to a season you're preparing for before
  it actually goes live.
- **WarcraftLogs Guild URL** -- the guild's WCL page, used by the Attendance and Scoring tabs'
  Refresh from WCL actions.
- **Raid Progression** -- one block per raid in the season; boss kill dates show publicly on
  the landing page. Mini-raids (single/small standalone bosses) have no AOTC date. Archived
  along with the season.
- **Start New Season** (renamed from "Archive Current Season") -- pushes the current Season
  Name/Start/End into history so it appears in the season selector going forward, same as
  before, but now does considerably more in the same click: wipes every player's real-item BiS
  list (placeholder M+/Crafted/Catalyst rows survive) and clears their submitted BiS source
  unconditionally (it's effectively per-tier, regardless of which site it points to), resets M+
  exclusion for the whole active roster, resets Bench status for the whole active roster (Trial
  status is untouched), and
  auto-fills the new Season Name from the current tier constant instead of requiring it typed
  in manually. See the Rollover workflow above.
- **Season History** -- past archived seasons, with an **Unarchive** option to restore one as
  active if it was archived by mistake. The most recently archived season also has a
  **WCL Performance Baseline** fetch (#264) -- picks a raid tier from that season, pulls each
  DPS roster player's best character-page performance average (highest difficulty they logged,
  mythic if any, heroic otherwise) from WCL, and writes it to `player_wcl_season_perf`. Also
  seeds `scoring.performance_score` for the *new* season so heroic priority generation has a
  baseline number before any current-season raid reports exist -- never overwrites a real
  Commit Performance Scores result, only fills in players with no score yet. Run once, right
  after starting the new season.

---

## Officer Bios tab

Two cards: **Team Officer Bios** and **Guild Officer Bios**.

- **Team Officer Bios** -- editor for the officer cards shown on the public **About** tab's Team
  sub-tab (the public tab was renamed from "Bios" to "About," now with Team/Guild/About/Contact
  sub-tabs). **+ Add Officer** can prefill name/character/class/spec from an existing roster
  player (a one-time copy, not a live link; editing or removing that player later never touches
  the bio), or start blank.
- Per card: display name, character name, title, pronouns, class/spec, an image path (commit a
  photo to `assets/officers/` in the repo first, then paste its relative path -- blank shows
  initials instead), and a short bio text. Reorder with the up/down arrows, **Remove** deletes a
  card, **Save Bios** writes the whole list back.
- **Guild Officer Bios** -- a second, separate list shown on the public About tab's Guild
  sub-tab. Same list across every team (guild-wide, not per-team). Editable only by site admins;
  regular officers and team leaders see it read-only.

---

## Audit Log tab

- Every officer action is logged automatically -- approvals, edits, loot marks, status changes
- Shows timestamp, actor, action, target, and a single combined Detail column (a human-readable
  summary string, not separate old/new value columns)
- Search box to filter by officer, action, or player name

---

## Reports tab

Reads directly from Supabase report views -- no Apps Script fallback. Four sub-tabs:

- **Raid Nights Since Last Item** -- how many raid nights have passed since each active roster
  player's last loot award, grouped/filterable by role, sortable by player/last award/nights
  since.
- **BiS Demand vs Awards** -- ranks items by how many active players want them on their BiS list
  next to how many times each has actually been awarded in the selected season; high demand +
  low awards is what to prioritize.
- **Priority Order Health** -- three lists, filterable by season: **Stale Entries** (players
  ranked in a season's priority order who are no longer on the active roster), **Missing From
  Priority Order** (active non-bench players with no priority order entry at all that season),
  and **Mythic #1 Possibly Stale** (a saved Mythic #1 where the player already received the
  Heroic version of that same item -- not necessarily wrong, just worth a second look).
- **Season Loot Pace** -- items awarded per week of the season vs. the same week last season,
  filterable by track and slot. "Week 1" is measured from the season's first tracked loot award,
  not the raid-lockout calendar, since Supabase doesn't store a season start date yet.

---

## Officer Guide tab

- Renamed from "Help" (#354) to avoid confusion with the top nav's raider-facing Help link,
  which points back at the public site. The dashboard's own built-in "Officer Workflow
  Reference" -- numbered steps for importing loot, refreshing/editing/committing attendance,
  setting season dates, and the full season reset workflow. Point people here directly once
  they've seen the flow explained once, rather than re-explaining it from scratch every time.

---

## Admin tab (reference only -- not part of the normal weekly flow)

Restricted by role: site admins see the whole tab, team leaders see every sub-tab except Data
Export (plus only Clear Season History within the Danger Zone), and regular officers don't see
the tab at all. In practice this is usually one or two people per team. Five sub-tabs:

- **Properties** -- read-only live snapshot of this team's season settings: season name/dates,
  archived season count, raid progression count, whether Signups/BiS Submissions/M+ Exclusions
  are open. Has its own Refresh button. (Discord bot URLs/secrets are Supabase Edge Function
  secrets now, #224 -- edit them in the Supabase dashboard, not here.)
- **Data Export** -- downloads everything currently loaded in the dashboard (roster, loot
  history, priority order, BiS lists, season history, scoring) as JSON. No server call --
  exports straight from the in-memory cache, so it reflects whatever's currently loaded.
- **Officers** -- grant or revoke *officer* access for claimed characters (writes
  `team_members.role` in Supabase). Making someone a *team leader* or *site admin* is **not**
  done here -- team leader is a direct `team_members.role` change and site admin is a row in
  the `site_admins` table, both currently database-side only.
- **Feature Flags** -- per-team toggles to turn off features this team doesn't use (Loot Import
  & Tracking, Priority Order, BiS Lists, Scoring, M+ Exclusions, Fairness Charts, Bench
  Management, Attendance, Received Item Requests), effective immediately. Also has **Wishlist
  Tier Labels** here -- rename the 5 raider Wishlist status tiers for this team; blank keeps the
  default, colors don't change.
- **Danger Zone** -- permanent, irreversible wipes. Team leaders see only Clear Season
  History; the sheet wipes below it are site-admin only:
  - Clear Season History -- deletes all archived seasons
  - Clear Loot Data -- wipes imported RCLootCouncil loot entries
  - Clear BiS Submissions -- wipes pending BiS source submissions
  - Clear Signups -- wipes all signup applications
  - Clear M+ Exclusion Requests -- permanently deletes every row of the M+ exclusion request
    history. Does **not** clear who's currently excluded -- that stays untouched. Not the same
    as, and not a substitute for, the M+ Exclusions tab's own "Clear All Exclusions" (the
    correct season-reset button -- see the M+ Exclusions section above)
  - Clear Pending Roster -- wipes approved applicants awaiting the roster-add step
  - Clear Self-Received -- wipes self-reported item requests
  - There's no undo -- double-check the season selector and what's about to be cleared before
    confirming

---

## BoE Sales (its own page, `boe.html`)

Reached from the **BoE Sales** link in this dashboard's site nav, or from the same link in
the guild page's nav. Both appear only for someone who can open the page, so if the link
isn't there, the access rules below are the reason. It lived on this dashboard as a tab
until #774 moved it to the guild page: BoEs are guild property and the read spans every
team, so a per-team page was the wrong home, and a BoE manager who runs the guild bank
without staffing a raid team could not open this dashboard at all. #864 then gave it a page
of its own, because it was by far the longest thing on the guild page once history loaded,
it is officer-facing where everything around it there is raider-facing, and it had to hide
itself until three access checks answered. An old `?tab=boe` bookmark redirects to the
page. Signed out, the page offers Discord sign-in and comes back to itself afterwards.

Runs the auction lifecycle for BoEs the guild sells -- **found -> listed -> sold -> paid**, plus
**retire** for anything that never moves. Raiders report a find from the public **BoE** tab
(#746) or the guild page card; everything after the report happens here.

- **The page is guild-wide, not per-team** (#765). It shows every find you're allowed to see
  rather than only the team whose page you're on, because BoEs are guild property. A BoE manager
  or site admin sees all four teams, Wrathless included; a plain officer sees the teams they
  staff. Every row names the finding team, History included -- that's credit, not a
  disambiguator.
- **Actions need the BoE manager grant** (#766), assigned by a site admin on the site admin
  dashboard. Without it it is read-only: totals and rows, no buttons. Officers on any team
  see it read-only; everyone else is told whom the page is for. The grant is
  guild-wide, so a manager is authorized on every team's finds rather than one team's.

A summary strip and three sections:

- **Summary** -- **Guild income to date** (the guild's cut across sold and paid rows) and
  **Outstanding payouts** (what's still owed on sold-but-unpaid rows). Per-team find counts and
  gold raised sit underneath, shown only once more than one team has found something.
- **Open** -- found and listed items, oldest first. **Record Listing** logs a price and an
  optional note; an item can be listed more than once, so relists accumulate rather than replace
  each other. **Record Sale** takes the sale price and computes the split. **Retire** closes out
  anything that isn't going to sell.
- **Awaiting Payout** -- sold items, oldest first, with the split already computed.
  **Mark Paid** once the finder has their gold; the row moves to History.
- **History** -- paid and retired items, newest first, twenty to a page. Previous and Next
  sit under the table and a line beneath them says which rows are showing; the page you are
  on survives a Mark Paid or an undo.

**The split** is guild policy and guild-wide rather than per-team, set on the site admin
dashboard: the finder gets a percentage of the gross sale, or a flat floor below a pivot sale
price, whichever is larger, and never more than the sale itself. The guild keeps the rest and
absorbs the AH cut. Both constants are snapshotted onto each sold row, so editing the policy
later never rewrites what an earlier sale paid out.

Price fields take the formats people actually paste -- `250,000`, `250000g`, `1 000 000`.
Anything else is refused with a message on the row rather than read as zero.
