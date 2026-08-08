# Changelog

All notable changes to WGA Raid Hub will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
with each release split into `### Frontend` (drives the version number) and
`### Backend` (migrations and import tooling, no version bump) sections.

---

## [3.55.0] - 2026-08-08

### Frontend

- **The public progression card now tracks Heroic the same way it already tracks Mythic** -- each boss shows a live Heroic kill date (once cleared) or current pull count and best % remaining, with a report link when available. AOTC now updates itself automatically from the last boss's Heroic kill date instead of requiring an officer to click "Fetch from WCL" + Save in Season Settings (#629).

### Backend

- `wcl-progression-sync` now aggregates both Mythic and Heroic from a single unfiltered `fights` query per report (bucketed by `fight.difficulty`) instead of a Mythic-only filtered one, avoiding a second WCL API round trip per zone. `team_raid_progress` gained `heroic_pulls`/`heroic_best_pct`/`heroic_report_code`/`heroic_fight_id` alongside its existing (previously unused) `heroic_date` column.

## [3.54.0] - 2026-08-07

### Frontend

- **A raider already added to the roster can now edit their signup while the team's signup window for that season is still open**, instead of seeing it hard-locked as soon as an officer promoted them. Editing sends the signup back through officer review (reverting to Pending) rather than writing the roster directly -- an officer still has to approve the change before it takes effect.

### Backend

- `update_own_signup()`: allows editing an `added` signup while its `season` still matches the team's active signup season (the same condition `get_own_signup()` already requires to show the raider that row at all). The edit reverts the signup to `pending` for re-review instead of touching the `players` roster row directly.

## [3.53.3] - 2026-08-07

### Frontend

- **Fixed the Player Settings panel logging a spurious "Spec Changed" audit entry on every save, even when only the nickname (or another field) actually changed.** Class/Spec always wrote to the database and audit log because the dropdowns always hold a valid selection (they're required fields) -- that was mistaken for "always changed". Now compares the selected class/spec against the player's current values and only writes/logs when they actually differ, same as Name/Realm, Joined Date, and Nickname already did.

## [3.53.2] - 2026-08-07

### Frontend

- **Fixed the officer dashboard's "Items Distributed" stat card (and the public landing page's "Items This Tier" stat) counting every season instead of just the current one.** `DATA.lootCounts` aggregates loot across the team's entire history with no season filter, so both cards were summing the pre-computed all-time `count`/`heroicCount`/`mythicCount` fields on each entry. Both now filter each player's individual loot entries by the active season, same approach the public roster page's recent-loot feed already used.

## [3.53.1] - 2026-08-06

### Frontend

- **Fixed the public roster's character profile card showing career-long Items Received and attendance instead of the current season's.** Only officer.html sets the season filter used to scope those sections (`ACTIVE_SEASON`, set via the officer dashboard's Season dropdown); index.html's profile card shares the same rendering code but never set it, so it silently stayed on "all seasons" forever, mislabeled "this tier" -- new-season loot/attendance never appeared cleared because it was actually still showing everything ever received/recorded. index.html now defaults it to the live season on load, same as officer.html does.
- The attendance trend graph (the dots under the % bar) also ignored the season filter even on officer.html -- it always showed full raid history regardless of which season was selected, unlike the % number above it. Now scoped to the selected season's date range, same as the percentage.
- Same fix for the public profile card's "click to expand" attendance detail list (No Show/Excused/Late nights) -- was also full history, so a new season's card still surfaced the previous season's flagged nights.
- An officer explicitly viewing "All Seasons" on the officer dashboard now sees an honest "N items — all-time" label instead of the misleading "N items this tier".

## [3.53.0] - 2026-08-06

### Frontend

- **The officer dashboard's Player Settings panel can now edit a roster member's nickname**, not just set one when first adding a player. Previously the only way to change an existing player's nickname was to overwrite it via the Name/Realm field, which actually renames the character record. Saves together with the rest of the panel's fields.

## [3.52.2] - 2026-08-06

### Frontend

- **"Start New Season" now also wipes M+/Crafted/Catalyst BiS placeholder entries**, not just real item picks -- every BiS list/wishlist is per-season, and what a raider wants from a Mythic+ vault or has crafted can target a completely different slot next tier, so there's no reason to carry a stale placeholder forward any more than a stale real-item pick. The archive confirmation dialog's copy was updated to match (previously said these entries were kept).

### Backend

- `archive_current_season()`'s `bis_items` wipe dropped its `is_placeholder` exclusion -- see Frontend note above. The season-history snapshot was already unfiltered by `is_placeholder`, so nothing changes about what's preserved in history. See `docs/database-decisions.md` for details.
- Fixed `add_signup_to_roster()` setting a new character's `join_date` one calendar day ahead in the evening -- it used the DB session's `current_date` (UTC), not the raid's local date. Past ~8pm EDT / 9pm EST, UTC had already rolled to the next day. Now computed explicitly in America/New_York. See `docs/database-decisions.md` for details, including which live rows needed a manual date correction.
- Fixed `import_rclc_loot()` leaving `track` null (shown as "Other" in the Loot feed) on Mythic Flex raids like Sporefall, whose RCLC instance string has an extra hyphen after the difficulty word ("Sporefall-Mythic - Flexible Raiding") that broke the old "everything after the last hyphen" parser. Now searches the whole instance string for the difficulty word instead. See `docs/database-decisions.md` for details.

## [3.52.1] - 2026-08-05

### Frontend

- The Roster tab's Discord Claims sub-tab now shows "N of M roster members have claimed a character" plus a list of who hasn't yet, so officers can see claim progress -- and who to nudge -- at a glance instead of cross-referencing the roster by hand.

### Backend

- Fixed `add_signup_to_roster()` silently resetting a raider's tenure to today on a main-swap: the new character was always a plain insert with `join_date = current_date`, since a genuine main-swap has no `(team_id, name_realm)` conflict to preserve an existing date through. Now carries the archived character's `join_date` forward, same fix pattern as the earlier `team_member_id` carry-over. See `docs/database-decisions.md` for details.

## [3.52.0] - 2026-08-05

### Frontend

- **The "claim your character" prompt stopped nagging raiders who don't need it.** Two fixes: (1) an account already claimed on a different team no longer gets the auto-popping claim modal when just visiting a team it's not on -- the inline "switch teams" card already handled this correctly, the modal just never checked; (2) the claim modal now has an "I don't have a character yet" option ([#512](https://github.com/katogaming88/WGA-Raid-Hub/issues/512)) that permanently dismisses both the modal and the inline card for that account, instead of reappearing on every visit forever.

### Backend

- Added `no_character_dismissals` (global, keyed on `auth_user_id`, no team scoping) -- a raider manages their own row directly via RLS (`auth_user_id = auth.uid()`), no RPC needed. See `supabase/migrations/20260805130058_no_character_dismissals.sql`.

## [3.51.2] - 2026-08-04

### Frontend

- **Fixed resolved class tier items showing up as duplicate, unmanageable entries on the Priority tab** -- the 65 class-specific resolved tier items added in #650 (e.g. "Damned Necrolyte's Charred Grasps") were appearing in Unmanaged Items alongside their own drop token (e.g. "Venomwoven Idol"), even though priority is only ever generated and matched against the token. Officers could accidentally set priority on the resolved item itself, which loot tracking would never actually use. Now excluded, matching the same filter Wishlist/BiS already applied.

## [3.51.1] - 2026-08-04

### Frontend

- **History tab now shows what the team was working on when a season ended** -- if a boss wasn't killed before archiving, its Mythic pull count and best % (as of the last WCL progression sync before archiving) now shows alongside the season's kill count, instead of that progress being silently lost.

### Backend

- `archive_current_season()` now folds each boss's `team_raid_progress` row (pulls/best %) into its `seasonHistory` snapshot at archive time -- the raw data was already durably stored, just never joined in. See `supabase/migrations/20260804140752_archive_season_boss_progress.sql`. Snapshot only, not a running history -- reflects progress as of the last sync before archiving.

## [3.51.0] - 2026-08-04

### Frontend

- **Priority order for tier-token drops now accounts for a raider's overall tier-set progress** -- a raider closer to finishing their 5-piece class set (especially anyone one piece from a 2pc/4pc bonus) now outranks a raider further along, on top of the existing score/wishlist/status math. A new "Sync Roster Tier Counts" action on the Priority tab refreshes every roster player's tier-piece count from Raider.IO in one pass (meant to be run right before generating priority); every individual "Sync from Raider.IO" click (raider's own profile or officer's BiS editor) keeps it fresh too, at no extra cost. A raider's own profile now also shows a raw "Tier: N/5" progress badge, separate from BiS-tagged completion %.

### Backend

- Added `players.tier_pieces_equipped`/`tier_pieces_synced_at` and rewrote `generate_priority_order()` to weight tier-token candidates by that count -- no new RLS needed, officers already had full write access to `players`. See `supabase/migrations/20260804140751_tier_pieces_priority_weighting.sql` for the exact ranking rule.

## [3.50.0] - 2026-08-04

### Frontend

- **Raiders and officers can now sync tagged tier picks against Raider.IO's equipped gear** -- a "Sync from Raider.IO" action, on both the raider's own profile (BiS List) and the officer's BiS editor, fetches equipped gear from Raider.IO's public character-profile API and auto-checks `obtained` for any of the 5 tier slots (Head/Shoulder/Chest/Hands/Legs) where the equipped item matches the tagged BiS pick. Matching is purely item-id based against the already-seeded resolved tier items (#650) -- no token or bonus-ID resolution needed, since Raider.IO reports the final resolved piece. The Omni-Curio stays out of scope, same as #650.
- The raider's own **BiS List** now starts expanded on their profile instead of behind a click -- it has its own top-level sub-tab there already, so the extra collapse was a click behind a click. The officer's inline embedded view is unchanged (still collapsed by default).

### Backend

- `bis_items` writes were officer-only; raiders can now UPDATE `obtained` on their own rows too (`is_own_player(player_id)`), needed for the self-service Raider.IO sync above. A trigger locks every UPDATE -- officer or raider -- to that one column, since `item_id`/`player_id`/`slot`/`season` are only ever set at insert.

## [3.49.50] - 2026-08-04

### Frontend

- **Wishlist and BiS grid now show the actual class tier piece instead of the generic drop token** -- Midnight Season 2's tier gear doesn't drop as the wearable item itself; bosses drop a generic per-armor-type token (e.g. "Venomwoven Idol"), which a raider manually converts into their class's named piece (e.g. "Damned Necrolyte's Charred Grasps") via an NPC. Both views now resolve and display the viewing raider's own class piece via a new token-to-class mapping, while the underlying wishlist tag/BiS pick still records the token itself -- matching what RCLootCouncil actually logs, so priority generation needed no changes.

### Backend

- Added `tier_token_map` (token_item_id, class, resolved_item_id) and seeded it for all 13 classes' 5 tier slots this season -- see `scripts/fetch-tier-resolved-items.js` and `scripts/generate-tier-token-map-sql.js`.
- Imported the 65 class-specific resolved tier items into `items` (flagged `is_ptr = true`, matching the rest of this pre-release tier's catalog rows until 12.1 ships live) and backfilled their `secondary_stats`/`main_stats`/`weapon_subtype` via `scripts/fetch-item-stats.js`.

## [3.49.49] - 2026-08-03

### Frontend

- **Wishlist/BiS grid now hide gear a class can't actually use** -- the Weapon and Off Hand rows previously showed every class's weapons/shields mixed together (a Mage could see Maces and Polearms, any class could see Shields), since neither armor type nor main stat rules out the wrong weapon type. Now filtered by a class-eligible weapon-type/shield table, on top of the existing armor/main-stat filters.
- **Filtered out healer-only and tank-only trinkets from wrong-role wishlist/BiS views** -- a trinket whose only value is healing/protecting allies (e.g. a healing-triggered proc, or an ally-shield on-use ability) now only shows to a Heal-role viewer, and one whose only value is reducing/absorbing damage the wearer takes now only shows to a Tank-role viewer, instead of every spec that happened to match its stats (or, for one healer trinket, every spec at all -- it carried no stat restriction whatsoever).

### Backend

- Added `items.weapon_subtype` (nullable text, e.g. `'Sword'`/`'Staff'`/`'Shield'`), backfilled by `scripts/fetch-item-stats.js` in the same pass as `secondary_stats`/`main_stats` -- no extra API calls needed. See `docs/database-decisions.md` (#609) for the class-weapon-type table and its sourcing.
- Fixed `add_signup_to_roster()` silently orphaning a raider's account link on a main-swap: archiving the old character never carried its `team_member_id` to the newly added character, leaving the account linked to an inactive, archived row. Now transfers the link forward. See `docs/database-decisions.md` for details.

### Frontend

- **Fixed wishlist item names wrapping mid-word on the Profile/Priority/BiS cards** -- the wider custom wishlist status labels (BIS/2ND CHOICE/SIDEGRADE/CATALYST ONLY/PASS, #515) pushed the shared item-name column below its intended minimum width, since its `flex:1` gave it an effective 0% flex-basis that the wrap calculation ignored. Now uses a matching flex-basis so the status-button row properly wraps onto its own line instead of squeezing the name. Also moved the priority-rank pill up next to the item icon/name (top-right) instead of sitting to the left of the status buttons, using the space freed up by that wrap fix.
- **Wishlist now flags a raid-drop slot already covered by an Other Sources BiS pick** -- tagging M+/Crafted/Catalyst as BiS for a slot lives on a completely separate card from that slot's own raid-drop card, so there was no indication when opening the raid-drop card that the slot was already spoken for. It now shows a heads-up note naming the source (e.g. "You already have Crafted tagged as your Other Sources BiS for this slot").
- **Linked the WGA Priority Loot addon from the Wishlist and officer Loot pages** -- officers running the Priority Order system need the addon in-game to see it; raiders can optionally install it too, to see their own Priority rank on items as they drop.

## [3.49.47] - 2026-08-03

### Frontend

- **Removed the Season Code Prefix setting and simplified Season Name/Signup Season to number inputs** -- the code/display prefix (e.g. `MID` / "Midnight Season") is now a hardcoded constant updated alongside the existing per-tier `CURRENT_SEASON` constant at an expansion boundary, instead of an officer-editable per-team setting that risked different teams drifting to different prefixes for the same real-world expansion. Both the Season Name and Signup Season boxes in Season Settings now take just the season number (e.g. `3`) and compose the full label automatically, removing the chance of a typo in the prefix wording. No effect on existing data -- every team's stored season name already matched the default pattern.

## [3.49.46] - 2026-08-03

### Frontend

- **Fixed the public site's browser tab title staying stuck on "-- Roster"** -- index.html has several client-side views (Roster, Profile, Signup, History, ...) switched via `showView()` with no per-view title update, so the tab title went stale the moment a visitor navigated anywhere else. Now reads `WGA Raid Hub -- <Team>` regardless of view; officer.html's `-- Officer` title is unaffected since that page genuinely is always the officer dashboard.

## [3.49.45] - 2026-08-03

### Frontend

- **Fixed the BiS list's "Mark received" button disappearing after a Heroic-only receive** -- a Heroic receive (in-raid or self-reported) hid the button entirely, blocking a later Mythic mark-received for the same item. Only a Mythic receive now retires the row.
- **The mark-received form's difficulty dropdown no longer defaults to Mythic** -- it opens blank and now requires an explicit choice, matching the existing validation on the source field.

## [3.49.44] - 2026-08-03

### Frontend

- **Officer attendance grid now surfaces the WCL sync's "probable late arrival" flag** -- rows with the new `source = 'WCL (Late?)'` (unclassified, status left blank) render the source in gold so an officer notices it needs a manual Late (with notice) / Late (no notice) call. A pending flag no longer scores as a 0% miss in the meantime (`computeSeasonAttendancePct` now excludes unset-status rows the same as a night with no row at all).

### Backend

- `attendance.status` is now nullable (was `NOT NULL DEFAULT 'Present'`) and `attendance.source` gained a new allowed value, `'WCL (Late?)'`, to support the flag above.
- `wcl-sync`'s `refreshAttendance()` now also detects whether a present player missed the raid's first logged pull (a new `fights`/`playerDetails` query per new report, separate from the existing kill-only `rankings` fetch so wipe-heavy progression nights don't skew the "first pull" baseline) and writes the flag instead of guessing which Late status applies. See [#633](https://github.com/katogaming88/WGA-Raid-Hub/issues/633) for the full decision writeup.

## [3.49.43] - 2026-08-02

### Frontend

- **Added "Late (with notice)" and "Late (no notice)" attendance statuses** -- 90% and 50% attendance weight respectively, alongside the existing 7 statuses. Available in the officer attendance grid, the player profile card's history and "Add raid night" dropdowns, and reflected in the attendance trend chart, roster attendance %, and the below-threshold officer detail view. See [#633](https://github.com/katogaming88/WGA-Raid-Hub/issues/633) for the full decision writeup.
- **Widened the attendance grid's source column** so "Auto (Bench)" no longer truncates to "Auto (Be..." ([#626](https://github.com/katogaming88/WGA-Raid-Hub/issues/626)).

### Backend

- New migration widens `attendance.status`'s CHECK constraint to allow the two new Late statuses.

## [3.49.42] - 2026-08-02

### Frontend

- **Fixed a syntax error opening the Priority Edit modal's player pool for names/realms containing an apostrophe** -- the pool list's `onclick` handler encoded names with `encodeURIComponent`, which doesn't escape `'`, so an apostrophe broke out of the inline handler's string and threw "missing ) after argument list", breaking the entire page script. Now matches the existing item-name encoding fix and escapes apostrophes explicitly.
- **Fixed the Priority tab getting stuck on "No priority data found" on page load** -- the boot sequence's core-data pass builds whichever tab is named in a `?tab=` deep link (including `?tab=priority`) before the heavy-data fetch that actually populates `DATA.priorityOrder` has landed, so the panel rendered against an empty `{}` and nothing ever rebuilt it once the real data arrived a moment later (switching Priority sub-tabs happened to mask this, since each sub-tab's build call picks up whatever's in `DATA` at that point). The heavy-data callback now re-renders whichever Priority sub-tab is visible once its data is actually in.
- **Fixed the Priority tab also going stale after changing Season View** -- `DATA.priorityOrder` (and its fairness-warning companions) were filtered to a season code once at load and never re-derived, so saving a new Season View on the Season Settings tab left an already-open Priority tab locked to the old season until a full page reload. Season View changes now re-derive the priority data from cached raw rows and refresh the visible Priority sub-tab immediately.
- **Fixed the Priority List's "Already has this slot" warning false-flagging Trinket and Finger (ring) drops** -- the warning treated any existing same-slot item this season as spoken for, but Trinket and Finger are dual-equip slots a player can legitimately hold two of at once. It now only flags once both slots are already filled.

## [3.49.41] - 2026-08-01

### Frontend

- **Fixed the claim modal's "wrong team" hint leading with the wrong likely cause** -- the hint told a raider who doesn't see their character to check whether they're on the wrong team, but the far more common reason is that an officer hasn't added them to the roster yet (the dropdown only lists unclaimed active players on the current team). Now leads with "ask an officer to add you" and mentions the wrong-team possibility second.

## [3.49.40] - 2026-08-01

### Frontend

- **Renamed "BiS Link" to "BiS Source"** (#627) -- "BiS Link" and "BiS List" were one word apart and easy to conflate in conversation, and "BiS Link" didn't read as what it actually does: a reference URL an officer reads and manually reflects into the BiS Manager grid, not a live-updating list. Updated the profile section label, the raider's "Submit/Update BiS List" button (now "Submit/Update BiS Source" -- it was itself a case of this exact confusion), the officer's update button, the save confirmation and audit log entry, the roster table column, the officer "No BiS Source" filter chip, and the "My BiS Changed (Same Link)" flag button (now "Same Source"). "BiS List" and "Wishlist" are unchanged. `players.bis_link` and `bis_link_requests` are left as-is -- whether the DB-level naming should follow is an open follow-up decision, not made here.

## [3.49.39] - 2026-08-01

### Frontend

- **Fixed setting a BiS ring/trinket removing the BiS tag from the other ring/trinket slot** -- the raider Wishlist tagged every ring/trinket item with `slot: null`, so tagging a BiS pick for Trinket 2 looked like a conflict with whatever was already BiS in Trinket 1 and silently demoted it. Finger 1/Finger 2 and Trinket 1/Trinket 2 now save with an explicit row so the two slots track independently. Since the same item now lists under both cards, a row already BiS on its sibling slot is now fully locked there (every status button disabled, not just BiS) with a note explaining why -- the only way to free it up is replacing it as the sibling slot's BiS pick. Tagging any other status (Good/OK/etc.) on a ring/trinket now mirrors into its sibling slot too, since a backup item doesn't care which numbered slot it ends up filling.

## [3.49.38] - 2026-07-31

### Frontend

- **Fixed Wrist showing every armor type's bracers instead of just yours** -- both the raider Wishlist tab and the officer's BiS search picker had `Wrist` wrongly listed alongside genuinely armor-agnostic slots (Neck/Back/Finger/Trinket/Weapon), so it skipped armor-type filtering entirely. Bracers are real armor (Cloth/Leather/Mail/Plate) like Chest/Legs/etc., confirmed every Wrist item in the catalog carries a real armor type -- it's now filtered the same as every other gear slot.

### Backend

- **`generate_priority_order()` now sorts bench/trial raiders by tier instead of discounting their score** -- previously a trial or bench raider's `weighted_total` was shrunk by a second status multiplier stacked on top of their role weight, and a flat 0.85 for trial Ranged/Melee turned out to be higher than a full-status healer's own role weight (0.75), letting a trial DPS outrank a permanent healer for the same item. Status now only decides which tier (full/trial/bench) a raider sorts into -- no bench/trial raider of any role can outrank a full-status raider regardless of score -- and `weighted_total` is `raw_score * role_mult` for everyone, so officers see a bench/trial raider's real score instead of an artificially discounted one. See `docs/database-decisions.md`'s 2026-07-31 entry.

## [3.49.37] - 2026-07-31

### Frontend

- **Added a "Clear My Wishlist" button** to a raider's own Wishlist tab -- previously the only way to reset a wishlist was removing every gear-slot tag and Other Sources pick one at a time. Clears everything in one action (with a confirmation prompt first), gated by the same wishlist-editing-open rule as every other edit on that tab.

## [3.49.36] - 2026-07-31

### Frontend

- **Starting a new season now also clears every player's submitted BiS link**, alongside the existing real-item BiS list wipe. A BiS link points at a specific tier's loot table, and there's no way to tell whether the site behind it happens to update in place for a new tier -- so it's cleared unconditionally rather than left for a raider to notice it's stale. Updated the archive confirmation dialog and the Officer Guide's "Season reset workflow" card to say so.

### Backend

- `archive_current_season()` now also nulls `players.bis_link` for the whole active roster, alongside its existing real-item `bis_items` wipe and `m_plus_excluded`/`is_bench` resets. Not added to the historical `bis_items` snapshot -- this is "clear it going forward," not "start preserving a historical record of it" -- and `bis_requests` (the submission/approval queue) stays untouched, same as its existing precedent of staying intact independent of season resets.

## [3.49.35] - 2026-07-31

### Frontend

- **Fixed the Roster tab's Recent Score column throwing repeatedly in production** (`column scoring.team_id does not exist`) -- #616 added a `.eq('team_id', ...)` filter against the `scoring` table, but that table has no `team_id` column at all (it's scoped by `player_id`/`season` only, and "Public read scoring" has no team restriction at the RLS level either). Fixed to scope by `.in('player_id', ...)` against the roster already loaded in `DATA`, which is what should have been there from the start.

## [3.49.34] - 2026-07-31

### Frontend

- **The attendance trend chart's monthly tooltip now shows "attended/total" raids for that month** -- previously it showed only this player's own recorded-night count (e.g. "88% (8 raids)"), which silently excludes any night they have no row for at all (a mid-month roster join, or a genuinely unrecorded night), with no way to tell that apart from "the team only raided 8 times." The total now comes from the distinct raid dates across every player that month, not just this one; the attended count is Present/Bench nights specifically (Excused/Medical Leave/Extended Leave/No Show don't count as attended, even though they still factor into the displayed percentage).

## [3.49.33] - 2026-07-31

### Frontend

- **Added a "Recent Score" column to the officer Roster tab** -- the exact committed `scoring.performance_score` value `generate_priority_order()` reads for DPS priority, previously only visible on the Scoring tab. Color-coded with the same thresholds the Scoring tab already uses. Tank/Heal roles show `--` (Priority uses Attendance only for them, regardless of whatever's stored in that column) instead of a number that isn't actually what their priority is based on.

## [3.49.32] - 2026-07-31

### Frontend

- **Season History now shows whether the WCL Performance Baseline fetch has already been run** for the newest archived season -- a live "Already fetched (N players)" / "Not fetched yet -- do this before generating Heroic priority" label next to the existing "Fetch WCL Performance" row, since nothing previously indicated this one-time step was outstanding, or reminded an officer it only stays available for the _newest_ history entry. Also added the missing step to both the in-app "Season reset workflow" reference card (Officer Guide tab) and `docs/officer-walkthrough.md`'s rollover checklist, neither of which mentioned this step before.

## [3.49.31] - 2026-07-31

### Frontend

- **Priority List now flags when a saved item's top 3 has drifted from a scoring update** -- previously a saved priority order was a frozen snapshot with nothing checking it against current performance/attendance, so a player tailing off or spiking could sit stale in a saved order indefinitely. Folds into the existing Priority List conflicts banner/badge; runs automatically right after committing Scoring tab performance updates, plus a new "Check for Drift" button for on-demand checks. Non-blocking -- nothing is auto-reordered, resolving a flag is still a deliberate re-save through the Priority Edit modal.

### Backend

- New `check_priority_order_drift(team_id, season)` function -- compares each saved `priority_order` item/track's top 3 against a live `generate_priority_order()` call (reusing that function rather than re-implementing its weighting) and returns only the ones that changed. Same non-blocking, security-invoker pattern as the existing fairness warning views (`20260713150512_priority_order_fairness_warnings.sql`).

## [3.49.30] - 2026-07-30

### Frontend

- **Added a "Guild Officer" access tier for cross-team officer dashboard access** -- a standalone, site-admin-granted role (new "Guild Officers" tab on the site admin dashboard, granted/revoked by Discord ID) for people with guild-wide authority who aren't necessarily an officer/team_leader on any one team's own roster. On a team a guild officer isn't natively an officer of, they get full view+edit access to that team's Roster (players, attendance) and can add/edit Guild Officer Bios; read-only access to Reports, Audit Log, and Priority Order (no edit/regenerate); and no access at all to Approvals (M+ Exclusions, Signups, BiS link requests), Season Settings, Priority generation/editing, Loot Import, or the Admin tab.

### Backend

- New `guild_officers` table (mirrors `site_admins`) and `is_guild_officer()`, OR'd into the `players`/`attendance` write policies, the `audit_log`/`team_members` read policies, and the `write_audit_log()`/`set_guild_officer_bios()` function gates. Deliberately not OR'd into `bis_requests`, `mplus_exclusion_requests`, `season_signups`, `self_received_requests`, `team_settings`, or the `priority_order`/`rclc_loot` write policies, so those stay RLS-blocked for a guild-officer-only caller regardless of what the frontend renders.

## [3.49.29] - 2026-07-30

### Frontend

- **Officers can now see a raider's full Wishlist on any profile view they open, not just their own** -- previously `ownWishlistSectionHTML()` only ever rendered on a raider's self-view; an officer viewing someone else's profile (officer.html's Roster tab, or index.html's officer-only character lookup) saw nothing beyond whatever wishlist-tagged BiS items were already folded into the "BiS List" merge. Shows every tagged item (Good/OK/Catalyst Only/Pass included, with notes), sorted head-to-toe. Read-only; branches on whether the viewer actually owns the profile rather than which page it's viewed from, reusing the Priority tab's already-loaded wishlist data on officer.html or a scoped single-player fetch on index.html.
- **"My List Changed (Same Link)" renamed to "My BiS Changed (Same Link)"**, and now also shown on the Wishlist tab (not just BiS) so a raider doesn't have to switch tabs to flag it.

- **Added a per-raider "Allow Wishlist Edit" exception** -- mirrors the existing "Allow BiS Submit" toggle. Wishlist Editing was previously an all-or-nothing team-wide toggle; there was no way to reopen just one raider's Wishlist while it's closed for everyone else. New toggle on a raider's officer-view profile card, checked alongside the team-wide toggle in every Wishlist editing gate (`js/wishlist.js`).
- Also synced the raider and officer walkthrough docs with several changes since their last full pass (v3.48.0): the "Bios" nav rename to "About" (Team/Guild/About/Contact sub-tabs, including the previously-undocumented Contact form), Backup Tank/Backup Healer profile badges, per-character WarcraftLogs/Raider.IO/Armory quick-links, the signup capacity nudge, the Recent Loot search box, and a clearer explanation of how the profile's "BiS List" is a live merge of the officer's BiS Manager grid and a raider's own Wishlist BiS tags.

### Backend

- Added `players.wishlist_allowed` (boolean, default false) -- same officer-write RLS rule already covering `players` gates the toggle, no new RPC needed since (unlike BiS Submission, which runs unauthenticated on the public roster page) Wishlist editing only ever happens for an already-authenticated, already-claimed raider.

## [3.49.28] - 2026-07-29

### Frontend

- **Wishlist help tip now covers multi-spec raiders** -- explains that only one item per slot can be BiS, so a raider playing multiple specs with different stat priorities (e.g. a warlock swapping Aff/Demo/Destro) should tag their main spec's item BiS and any other spec's different pick Good/OK with a note saying which spec it's for. Pairs with #610's officer-side Notes tab, which is where those notes actually surface.

## [3.49.27] - 2026-07-29

### Frontend

- **Added a Notes sub-tab to the officer Priority tab** -- surfaces every item that has a raider-written wishlist note (`item_preferences.note`) and who wrote it, e.g. a pure-DPS raider explaining why an off-spec item is tagged "Good" instead of "BiS". Previously the note only ever rendered back on the raider's own wishlist editor; officers had no way to see it. Styled to match the raider wishlist card itself (icon/name/stat-pill header via the shared `itemNameBlockHtml()`, status-tier-colored row, class/spec badge, note in the same box style as the wishlist's own note field). A gold count badge on the sub-tab button flags that notes exist, deliberately kept off the main Priority nav badge since a note is context, not something needing action. Read-only: doesn't feed `generate_priority_order()`'s weighting, meant purely to inform officer discretion on sequencing calls.
- **Priority List now flags a ranked player who already received a different item in the same slot this season** -- e.g. a raider ranked for the Destro belt who already has the Aff/Demo belt. Read live from `DATA.lootCounts` at render time (not baked into `generate_priority_order()`, which only reflects reality whenever that item's list is next regenerated -- this stays current regardless of generation cadence).

## [3.49.26] - 2026-07-29

### Frontend

- **Filtered Trinket/Weapon/Off Hand wishlist and BiS-grid rows by main stat** -- those rows had no `armor_type` to scope on, so every class saw every item regardless of Strength/Agility/Intellect. Added `items.main_stats` (jsonb array, mirrors `secondary_stats`) and a `specMainStat(class, spec)` lookup in `js/common.js` (spec-keyed, not class-keyed, since e.g. Death Knight Frost and Mage Frost share a spec name but not a stat), applied in `wishlistBucketRealItems()` and `bisSlotOnInput()` the same way the existing armor-type filter works. Neck/Back/Wrist/Finger are left unfiltered -- they never roll a main stat in this expansion's itemization.

### Backend

- **`scripts/fetch-item-stats.js` now backfills `main_stats`** alongside `secondary_stats` in the same pass, from Blizzard's Game Data API and a Wowhead PTR fallback (including a new effect-text fallback for trinkets whose stat restriction only shows up in their Equip:/Use: description, not a raw stat entry).

## [3.49.25] - 2026-07-28

### Frontend

- **Added a Wishlists Completed officer stat card and an All/Hero/Myth difficulty selector** -- the officer stats bar now has a fifth card tracking how many roster members have every wishlist slot tagged (or covered by the officer BiS list), sourced from `getIncompleteWishlists()` (now roster-overridable so the card can pass the full roster). It shows `-` until `_teamItemPreferences` finishes loading rather than flashing a misleading "all complete". The Items Distributed card's single cycling difficulty badge is replaced with an All/Hero/Myth button group, color-matched to the existing rank-pill colors. "Raiders" and "BiS List" (renamed from "BiS Submitted") now count the full roster including bench, since gear prep isn't limited to active raiders.

## [3.49.24] - 2026-07-28

### Frontend

- **Fixed the trial promotion alert still not showing on a fresh officer login** -- #604 fixed 3 of the 4 places the officer dashboard reloads, but missed `_grantOfficerAccessViaDiscord()` (officer.html's inline script), the path taken whenever there's no existing `sessionStorage` session -- a first Discord login, or reopening officer.html in a new tab (`sessionStorage` doesn't survive a tab close, unlike a same-tab refresh). That path had the same `loadData()` shape as the other three, missing `buildTrialPromoAlert()` from its heavy-data callback. Same fix applied.

## [3.49.23] - 2026-07-28

### Frontend

- **Fixed the trial promotion alert never showing a player past both thresholds** -- `buildTrialPromoAlert()` only ran from the officer dashboard's core-data callback, before `DATA.rawAttendanceData` was loaded; at that point every player's computed attendance falls back to `0%`, which always failed the attendance threshold check regardless of their real attendance. Now also re-runs once heavy data (attendance included) arrives, at all three call sites that reload the dashboard (initial officer.html load, after a player rename, after archiving a season).

## [3.49.22] - 2026-07-27

### Frontend

- **Fixed the Priority nav badge going stale after changing Season View** -- the Priority tab's item list itself already rebuilt correctly on every tab switch, but its nav badge (unmanaged + conflict counts) is computed by a separate `updatePriorityBadges()` that only ran on initial page load or after a priority-list save/generate, not when Season View changed what counts as in-scope. `saveSeasonView()` now calls it directly after a successful save.

## [3.49.21] - 2026-07-27

### Frontend

- **Fixed stale content in the officer Officer Guide tab** -- the attendance status list was missing _Extended Leave_, and the "Season reset workflow" reference card still described a "Clear All Loot History" step that doesn't exist (deliberately removed in #219, since there's no safe way to isolate paste-imported rows from legacy-merged ones). The card now points at Season Settings' "Start New Season" (renamed from "Archive Current Season") and reflects that it auto-fills the season name and resets BiS/M+ exclusion/bench status, and drops the loot-clearing step entirely since loot history stays in place, filtered by its season tag.

## [3.49.20] - 2026-07-26

### Frontend

- **Fixed the officer Audit Log tab showing two rows for a single settings change** -- every toggle/save routed through `saveTeamSetting()` (M+ Exclusions, BiS Submissions, Wishlist Editing, Signups open/closed, Season Name/Start/End/Code Prefix, WarcraftLogs Guild URL, Raid Progression, Roster Targets, Trial Thresholds, Wishlist Tier Labels, Team Officer Bios, Season History Cleared) was logging twice: once from the DB's own generic `team_setting_updated` entry (added by a prior migration to audit every `team_settings` write) and again from an older, friendlier-named client-side `writeAuditLog()` call that predates it. `saveTeamSetting()` now takes an optional `skipAudit` flag, passed as `true` from every call site above so only the friendly entry lands -- feature flags, `seasonView`, and `activeSignupSeason` (which have no friendly entry of their own) keep the automatic generic logging as their only audit trail. "Season Archived" also gets its incidental follow-up save's generic entry suppressed, since it only describes an auto-filled season name, not the archive itself -- the meaningful "Season Archived" entry already covers that.

### Backend

- `set_team_setting()` gets a new trailing parameter (`p_skip_audit boolean default false`). Adding it produced a second, distinct function overload rather than replacing the original in place (same pitfall as `add_signup_to_roster()` in #593/#594) -- the migration drops the stale 2-arg overload and re-grants the new 3-arg one explicitly (`authenticated` only).

## [3.49.19] - 2026-07-26

### Frontend

- **Added designated Backup Tank / Backup Healer roster flags** -- two new independent toggles in the officer Player Settings panel, alongside Trial/Bench. Multiple raiders can hold either designation at once (no exclusivity), and it's not restricted to a player's own current role (a DPS with a tank offspec can be flagged Backup Tank). Shows as a badge on the profile page (public, same visibility as the Trial/Bench badges) and as a status tag in the officer roster table. Also added to the Pending Roster promotion flow -- two new checkboxes alongside the existing Trial checkbox, threaded into `add_signup_to_roster()` at promotion time the same way Trial already is (there's no column on `season_signups` itself).

### Backend

- Added `players.is_backup_tank` / `players.is_backup_healer` (boolean, default false) and two new trailing parameters on `add_signup_to_roster()`. Adding parameters this way produced a second, distinct function overload rather than replacing the original in place (confirmed against a local `db reset`) -- the old 3-arg overload is dropped and the new 5-arg one gets fresh, explicit `authenticated`-only grants, since a genuinely new function doesn't inherit the original's and Postgres grants EXECUTE to `PUBLIC` (`anon` included) by default.

## [3.49.18] - 2026-07-26

### Frontend

- **Added URL-based view routing to index.html (#517)** -- Home, Roster, Streamers, and Profile now reflect into the URL hash (`#roster`, `#streams`, `#profile/<name>`) as you navigate, and a reload restores the same view instead of always dropping back to Home. Extends the one-way hash deep-link officer.html's nav already used (#354) into a two-way one. Loading `#profile/<name>` directly is gated to the profile's own owner or an officer viewer -- anyone else's link falls back to Home, since a hand-edited URL is reachable without the existing "View My Profile" button's implicit self-only reach. Sign Up/History/About/News/Help stay out of scope for now.
- **Same treatment for officer.html's tabs (#517)** -- switching tabs now keeps the existing `?tab=` param (already used for one-way deep links from index.html's Officer Access nav, #354) in sync, so a reload restores whatever tab you were on instead of dropping back to Roster. No ownership gate needed here -- the whole page is already officer-only.

## [3.49.17] - 2026-07-26

### Frontend

- Fixed the officer Audit Log tab showing "[object Object]" for any save whose diff includes an array value (bios lists, `seasonHistory`, `raidProgression`, etc.) -- `humanizeAuditValue()` only knew how to flatten nested objects, so an array fell through to `String()`, which stringifies an array of objects as `"[object Object]"` per element. Now shows a plain item count instead (e.g. "Team Officer Bios: 2 items").

## [3.49.16] - 2026-07-26

### Frontend

- **Fixed Guild Officer Bios not appearing on every team's site** -- they were stored per-team (`team_settings.config.guildOfficerBios`), so a bio saved on Phoenix's site never showed up on Hellfire's or Immolation's. Now sourced from a genuinely guild-wide store, the same list everywhere. Editing is now restricted to site admins (a team's own officer/leader isn't automatically authorized to edit guild-wide content) -- a non-admin officer still sees the current list on officer.html's Bios tab, read-only, with a note explaining why the controls are disabled.

### Backend

- Added `site_settings.guild_officer_bios` (the existing guild-wide singleton settings table, alongside `maintenance_mode`) and a new `set_guild_officer_bios()` RPC, `SECURITY DEFINER` and gated by `is_site_admin()` -- mirrors `admin_set_maintenance_mode()`'s shape exactly. Existing data backfilled from whichever team had it set, then the dead `guildOfficerBios` key removed from every team's `team_settings.config`.

## [3.49.15] - 2026-07-26

### Frontend

- Updated the Officer Bios editor's photo instructions (Team and Guild) -- officers now send Kat the image they want to use rather than committing it into the repo themselves.

## [3.49.14] - 2026-07-25

### Frontend

- **Fixed the officer dashboard's top nav being out of sync with the public site** -- `officer.html` had its own hardcoded copy of the nav item list, which still said "Bios" and was missing "News" entirely (drifted since #582/#509 only updated `index.html`'s copy). The nav item list (labels/order/tooltips/deep-link targets) is now defined once in `js/common.js` (`SITE_NAV_ITEMS`) and rendered per-page by a shared `renderSiteNav(mode)` -- future nav changes only need to happen in one place.
- Fixed a related latent bug found while consolidating this: officer.html's non-Home nav links (Roster, Streams, History, About, News, Help) never carried the `?team=` query param when switching away from Phoenix, silently dropping a non-default team's officer back onto Phoenix's public site when clicked. Also fixed the `#bios` deep-link hash in `js/roster.js` still mapping to a `showView('bios')` call that no longer does anything post-#582 -- it's `#about` now.

## [3.49.13] - 2026-07-25

### Frontend

- Added a total count and a per-role count to the public Roster tab's pending ("Next Season Roster (Tentative)") view -- a "N Pending Raiders" line above the table, and each role's group header now shows its own count (e.g. "Tanks (2)").
- Signup Step 3 (Spec/Role) now shows who else already plays the selected class, and, for hybrid classes picking Tank or Healer, a capacity advisory against a new officer-set "Target Roster Sizes" setting -- once the count meets or exceeds the target, raiders see a nudge to consider DPS/backup instead, or talk to an officer. Always counts already-approved incoming-roster signups; the confirmed active roster is counted too only when a team's live raiding season already equals the season being signed up for (i.e. officers push approved signups straight onto the roster instead of leaving them pending) -- otherwise the roster reflects a prior season and would wrongly count someone who simply hasn't signed up yet for the season in question. Pending (not-yet-officer-approved) signups aren't counted -- `season_signups` RLS keeps those officer-only, and there's no privacy-safe way to name other still-under-review applicants here. A returning roster member who resubmits for continuity, or genuinely swaps to a different main, no longer shows up twice in that comparison.

### Backend

- `incoming_roster` view now also exposes `swap_from_name_realm`, so a true main-swap signup can exclude the old character it replaces from the signup-time class comparison above instead of double-counting one real person under two names. Not a security change -- character names are already public elsewhere in this app.

## [3.49.12] - 2026-07-25

### Frontend

- Added a Contact sub-tab to the public About tab (#577) -- a form for reporting site issues, posted through a new `contact-webhook` Edge Function to a single fixed admin Discord channel regardless of which team's site it was submitted from. Unlike the existing `discord-bot-webhook` (a per-team relay to each team's own self-hosted bot server), this posts directly to a Discord native incoming webhook with no per-team routing. No email field -- a logged-in submitter's Discord snowflake ID rides along instead, rendered as a clickable `<@id>` mention in the Discord embed so a reply is a right-click away. Needs the `CONTACT_WEBHOOK_URL` Edge Function secret set and the function deployed before it actually delivers anywhere -- missing the secret is a silent no-op, same as `discord-bot-webhook`'s missing-per-team-secret case.
- Fixed the About tab's Team/Guild/About/Contact sub-tab sections rendering too narrow and left-aligned instead of centered -- their wrapper divs now use `display:contents` so each section's content becomes a direct centered flex child of the page body again, matching every other tab.

## [3.49.11] - 2026-07-25

### Frontend

- **Hotfix:** the footer version-number id list still referenced the old `versionNumBios` id from before the Bios -> About rename (#582), which no longer exists in the DOM. `document.getElementById(id).textContent=...` threw on the missing element inside a `forEach`, which silently killed the rest of that inline boot script -- including the team switcher population and every nav-visibility update that ran after it. Every visitor since #582 merged saw a broken nav bar and an empty team switcher. Now points at `versionNumAbout`.

## [3.49.10] - 2026-07-25

### Frontend

- Added an "About" sub-tab to the public About tab (#577) -- static copy on what WGA Raid Hub is and who built it. Since this content always exists, the About nav item is no longer hidden for teams without Team/Guild officer bios yet, and its pill sub-tab bar now shows whenever 2+ of Team/Guild/About are populated.

## [3.49.9] - 2026-07-25

### Frontend

- Renamed the public "Bios" nav tab to "About", split into Team and Guild sub-tabs (#577). Team shows the existing officer bios unchanged; Guild is a new, separate officer-authored bio list (`team_settings.config.guildOfficerBios`) for the guild's own officers, since not every team officer holds a guild officer rank and vice versa. The pill sub-tab bar only appears once both sections have entries -- a team with only one populated section just sees that content directly. The "About" nav item itself still stays hidden until at least one of the two has an entry.

## [3.49.8] - 2026-07-25

### Frontend

- Renamed the internal `blazeCommanderBios` key/variable to `teamOfficerBios` throughout the Officer Bios editor and public Bios tab (#577). "Blaze Commander" was We Go Again's own guild-specific officer rank name, baked into a field every team uses regardless of what they call their own leadership rank; no visible UI or behavior change.

### Backend

- Renamed the `team_settings.config.blazeCommanderBios` jsonb key to `teamOfficerBios` for all teams (#577).

## [3.49.7] - 2026-07-25

### Frontend

- Fixed the officer BiS Lists tab (grid editor, BiS count, completion %) and a raider's own Priority List section showing every season's officer picks forever instead of respecting the selected season view -- `bis_items` has no `season` column, so unlike Wishlist and the Priority tab, nothing was checking `isItemInSeasonScope()` against it. All BiS displays now scope to the season view the same way Wishlist already does.
- Tagging a raid item as BiS for a slot that already had a Wishlist Other Sources placeholder (M+/Crafted/Catalyst) in it now deletes that placeholder outright instead of demoting it to Good. Those rows lock permanently once set (#515 follow-up), so demoting one left a stale, un-editable "Good" row behind rather than actually freeing the slot.
- Fixed the Wishlist's own "officer BiS set" row label crediting an officer's `bis_items` pick from a different season view -- `wishlistCompleteness()`'s officer-bucket lookup had the same missing season filter as the BiS Lists tab above, so a slot only actually covered by a prior season's officer pick wrongly showed as settled.
- Fixed Other Sources placeholder rows (M+/Crafted/Catalyst, in both the officer BiS Lists editor and a raider's own Wishlist) never disappearing once the season view moved on -- unlike real items, these aren't tied to a raid zone, so the season filter above didn't do anything for them at all. They now carry their own `season` (#580), stamped when tagged, and are hidden once that season no longer matches the one being viewed. Existing rows were backfilled to each team's currently-configured season name.

### Backend

- Added a nullable `season` text column to `bis_items` and `item_preferences`, backfilled to each team's `team_settings.config->>'seasonName'` (#580).

## [3.49.6] - 2026-07-25

### Frontend

- Fixed the Priority List conflicts banner (stale-after-heroic #1s, same-boss #1 conflicts, duplicate #1s) showing entries from other seasons regardless of which season a team was actually on -- the underlying queries had no season filter at all. Both are now scoped to the team's current season, matching the ranked Priority List itself.
- Priority Edit's save/generate/fairness-warning calls, and the ranked Priority List's own read, were tagging/filtering by the live raid season only, ignoring a team's `seasonView` (a forward-looking season pointer used to prep a future season's catalog/BiS/Wishlist ahead of time). A team pointed at a future season while still raiding the current one had no way to actually save priorities under that future season -- they'd silently land tagged as the live season instead. All of these now respect `seasonView` when it's set.

## [3.49.5] - 2026-07-24

### Frontend

- Added a "Remove" button to Wishlist Other Sources rows (M+/Crafted/Catalyst). Those rows lock permanently once a status is set (#515 follow-up) so a raider can't casually retag them, but that also meant a mis-clicked slot had no way back short of an officer fixing it directly in the DB. Remove deletes the `item_preferences` row outright, freeing the slot back up in the "+ Add" dropdown.

## [3.49.4] - 2026-07-24

### Frontend

- Restored "Catalyst" as a Wishlist Other Sources option, scoped to Back/Wrist/Waist/Feet only. Corrected understanding of the catalyst mechanic: those 4 non-tier slots come out of the catalyst with fixed stats regardless of the item fed in, so tagging "how did you get it" is meaningful for them the same way it is for M+/Crafted. The 5 actual tier slots (Head/Shoulder/Chest/Hands/Legs) still keep the input item's own stats when catalyzed, so a source tag there remains meaningless -- unchanged from before.

## [3.49.3] - 2026-07-23

### Frontend

- Fixed item hover-tooltips (Priority tab, Wishlist) always rendering at the same horizontal position regardless of cursor location. Root cause, found by reading the Wowhead widget's own source directly: `itemNameBlockHtml()`'s `<a class="wowhead">` (the actual hover target) had `flex:1` applied to itself, stretching it to span the entire row width instead of just the visible icon+name. The widget anchors its tooltip off the hovered element's own bounding box, not raw cursor pixels -- since every row's anchor shared the same right edge (each `flex:1`-stretched to fill its row identically), every tooltip landed at the same X. `flex:1`/`min-width` now live on a non-interactive wrapper for layout; the `<a>` itself sizes to just its visible content so the widget anchors correctly. Confirmed cross-browser (Edge, Brave with Shields fully disabled), ruling out extensions/fingerprinting-protection as the cause.
- `officer.html` now also sets `window.whTooltips` (`{colorLinks: true, iconizeLinks: true, iconSize: 'small'}`) before loading the Wowhead widget script, matching `index.html` -- this page was running the widget entirely unconfigured, missed when item-hover tooltips were added to the Priority tab (#567), which only wired the config into `index.html`. Not the root cause of the above, but a real gap worth closing regardless.

## [3.49.2] - 2026-07-23

### Frontend

- Fixed Priority tab / Unmanaged Items nav and tab-pill counts not applying season scoping (`isItemInSeasonScope()`, #549) -- `getUnmanagedItems()` now filters by season directly, so `updatePriorityBadges()`'s counts (which read its `.length`) agree with the actual filtered list instead of counting every season's unmanaged items. Surfaced live: Hellfire's Unmanaged Items list correctly showed 99 Season-2-scoped items, but its badge and the Priority nav badge still showed 212 (every season).

## [3.49.1] - 2026-07-23

### Frontend

- Fixed `input[type="date"]` calendar-picker icons rendering black (invisible) against the dark background. Their `filter:invert(1)` predates `:root`'s `color-scheme: dark` (#568); the browser now renders the icon white natively on its own, so the leftover invert filter was flipping it back to black -- removed.
- Raid Progression's "List" button (Season Settings, queries WCL's static zone data -- works before any fights are logged) now renders each encounter as a checkbox instead of inert text, with "Select All"/"Select None" and an "Add Selected as Bosses" button that appends them straight into the raid's boss list using WCL's exact names. Lets an officer set up a season's full boss list ahead of the raid going live without retyping (and risking misspelling) every boss name by hand; re-clicking skips encounters already added by `wclEncounterId`.

## [3.49.0] - 2026-07-23

### Frontend

- New "Season View" setting (Season Settings tab, #549) replaces `raidProgression`-based item scoping and all four "Show all seasons" checkboxes (Priority tab, Unmanaged Items, BiS grid, Wishlist) with one nullable `team_settings.config.seasonView` picker sourced from `raid_zones.season`. Left unset, everything keeps reading the live raiding season exactly as before (fail-open when a team has no `raid_zones` rows configured yet). Set explicitly, an officer can prep a future season's item catalog/wishlist/BiS -- or audit a past one -- without touching the live `raidProgression`, and filtering becomes strict (no `raid_zones` row for that season means an empty view, not a silent fallback). Fixes a real gap surfaced by Hellfire's Season 1 -> 2 rollover: `raidProgression` gets wiped to `[]` by every "Start New Season" archive (#537), which used to make every item show up unfiltered (fail-open with nothing configured) until an officer manually repopulated Raid Progression. Deliberately does **not** touch signups -- see decision note below.
- Priority tab and raider Wishlist item rows now show each armor piece's armor type (Cloth/Leather/Mail/Plate) as a colored label next to the slot, via the shared `itemNameBlockHtml()` -- a quick visual guide for whether an item fits a given class, no filtering behavior attached.

## [3.48.1] - 2026-07-23

### Frontend

- "Start New Season" now archives and auto-fills the next season's name in one click (#537), instead of leaving Season Name blank for an officer to retype after archiving. The new name comes from a single code-level `CURRENT_SEASON` constant (`js/common.js`, Kat-updated once per tier, same manual-per-tier-edit pattern as `scripts/fetch-items.js`'s `ZONE_ID`), so every team's "Start New Season" click applies the same name instead of officers typing it independently and risking drift.

## [3.48.0] - 2026-07-23

### Frontend

- M+ exclusion request form now gates submission on two qualifying checks instead of accepting any Raider.io link + notes (#564): a checkbox confirming 6/6 Myth in every M+ obtainable slot, and a "gem sockets filled (Helm/Bracer/Belt)" select that must be 2 of 3 or better -- `submitMPlusExclusionForm()` blocks with an inline error until both are satisfied. Still self-attestation only (no schema change); officers review the Raider.io link and notes same as before. Also declared `color-scheme:dark` on `:root` so the new select's native dropdown popup renders dark instead of the browser's light default, and trimmed some stale/inaccurate copy on the form (it referenced "loot priority" instead of the actual weekly M+ requirement, and a leftover caveat about playing a different M+ character that didn't apply to this raid-roster form).

## [3.47.3] - 2026-07-23

### Frontend

- Restyled Priority tab item rows (Priority List and Unmanaged Items) and the raider Wishlist: a large item icon beside the name/detail-line stack, Epic-purple item name, then slot/stat-pills ("Crit"/"Haste"/"Mastery"/"Vers", whichever the item actually rolls, per `items.secondary_stats`) on one line and the boss on its own line below (#561). New shared `itemNameBlockHtml()`/`statPillListHtml()` helpers in `js/common.js` -- both tabs previously had separate near-identical implementations (`wishlistItemNameHtml()` in `js/wishlist.js` had no stat pills and only a boss line), now consolidated into one so they can't drift apart. Item level and quality/rarity color stay out of scope: the team evaluates items by max-upgrade track regardless of displayed ilvl, and raid drops are effectively always Epic, so both would be clutter or a hardcoded value not worth fetching. The Wowhead hover-tooltip widget link now points at `/ptr/item=<id>` instead of the live URL for items still on PTR (`items.is_ptr`), so the tooltip shows real stats instead of coming back empty against live-only data -- same root PTR-data-lag issue as #560's backend fetch, just on the client-side widget this time.

### Backend

- Added `items.is_ptr` (#561 follow-up) so `itemNameBlockHtml()` knows which items still need a `/ptr/`-prefixed Wowhead link. Backfilled true for the current tier (`wcl_zone_id = 53`); flip back to `false` once it ships live, same time as the existing `WCL_ZONE_ID`-into-`raid_zones` go-live step (`docs/updating-fetch-items-for-new-tier.md`).

## [3.47.2] - 2026-07-23

### Frontend

- Fixed the Priority tab's boss filter dropdown not picking up newer-season bosses when "Show all seasons" was checked -- `populateBossFilters()` hardcoded the current-season-only scope and only ran once at data load, so toggling the checkbox never refreshed it. Now each dropdown (Priority List, Unmanaged Items) rebuilds independently against its own tab's checkbox state, re-running on toggle instead of just once.

### Backend

- Added `items.secondary_stats` (which of Crit/Haste/Mastery/Vers an item rolls) and `scripts/fetch-item-stats.js`, which backfills it from Blizzard's Game Data API, falling back to Wowhead's `dataEnv=2` tooltip endpoint for anything still-PTR that Blizzard's static item database 404s on (#560). All 201 real items now have real data -- no waiting on a tier to ship live.
- The nightly backup now checks how full the R2 bucket is after each upload and warns in Discord once it reaches 80% of the 10 GB free allotment (#547). R2 has no native percent-full alert, and nothing prunes old dumps yet, so without this the first sign of trouble would be an overage charge. Crossing the threshold warns without failing the run; a check that cannot read the bucket fails it, so the alert cannot quietly stop watching.
- Executed the first restore drill (#544) against a real R2 dump and recorded it in the runbook's drill log: full restore clean (every ignored error matched the documented expected list), row counts matched prod exactly, per-table selective restore rehearsed. One finding folded back into the runbook: `season_signups`'s sequence is `signups_id_seq` (legacy name), so sequence resets must go through `pg_get_serial_sequence()` rather than guessed names.

## [3.47.1] - 2026-07-22

### Frontend

- Fixed the Discord field on the New Raid Signup notification always showing "(not provided)" -- it was reading a free-text `discord` field that's been defunct since signups moved to Discord-authenticated sessions. It now sends the raider's actual logged-in Discord username. Also added a Main Swap field showing whether the signup is a swap and, if so, which character it's swapping from.

### Backend

- Added the restore runbook to `docs/backup-restore.md` (#544): getting a dump out of R2, selective restore after a bad delete (trigger, FK-order, and sequence caveats), and full project rebuild -- including `supabase migration repair` (a restored project has no migration history, so an unrepaired one would replay every migration on the next `db push`) and recreating the four `auth.users` FKs that cannot restore against an empty auth store. Plus a drill procedure and drill log; restores get rehearsed, not just documented.
- `.github/workflows/db-backup.yml` now posts a Discord embed (reusing the existing `DISCORD_WEBHOOK_URL` deploy-notification channel/secret) when a nightly backup run fails, naming which step failed and linking straight to the run (#545). Scheduled-workflow failure emails only reach whoever last touched the file; this puts it where the team already watches deploy status. Fires on any failure, including the missing-secret guard -- intentionally noisy, since an unprotected database should nag nightly until it's fixed.

## [3.47.0] - 2026-07-22

### Frontend

- Scoped the item catalog to the current raid tier (#535): the Priority tab (item list, boss filter, Unmanaged Items), the BiS 16-slot grid editor, and the Raider Wishlist now default to showing only items whose `wcl_zone_id` matches a zone in the team's current `raidProgression`, with a "Show all seasons" checkbox to see everything. Previously every item ever imported showed up in all three places forever, regardless of tier. Placeholder items (M+/Crafted/Catalyst) are always shown, and items with no zone tag or teams with no `raidProgression` configured fail open rather than disappearing.
- Fixed Unmanaged Items listing M+/Crafted/Catalyst placeholders as items needing a rank -- they aren't raid drops and were never meant to be ranked, but nothing in `getUnmanagedItems()` excluded them.
- Fixed most armor items landing in the Priority tab's "Other" bucket instead of their real slot section -- `ARMOR_SLOT_ORDER`/`getItemGroup()` still used the pre-normalization slot vocabulary (`SHOULDERS`, `GLOVES`, `CLOAK`, `BRACERS`, `BELT`, `BOOTS`) after the item-catalog slot normalization migration moved `items.slot`/`getSlotColor()`/the BiS grid to the canonical singular names (`SHOULDER`, `HANDS`, `BACK`, `WRIST`, `WAIST`, `FEET`).

### Backend

- Added `items.wcl_zone_id` and backfilled every existing (Season 1) item to Voidspire's zone id (46), the zone all current `item_bosses` rows resolve to.
- `scripts/fetch-items.js` now emits `wcl_zone_id` (from the existing `ZONE_ID` constant) into `items.csv` for each new tier's import.
- Fixed `scripts/fetch-items.js` writing Wowhead's own zone id (`ZONE_ID`) into `items.wcl_zone_id` instead of the actual Warcraft Logs zone id -- the two are unrelated numbering schemes (e.g. Voidspire is Wowhead zone id in the 16000s but WCL zone 46), so every item imported through it would've been tagged with an id no `raid_zones` row could ever match, silently breaking the season filter (#535) for any tier seeded this way. Added a separate `WCL_ZONE_ID` constant for the correct value.
- Added `scripts/items-csv-to-sql.js`, converting a finalized `items.csv` into a ready-to-paste `insert into items` statement (correct `null` handling and quote-escaping for ~90 hand-typed rows was too easy to get wrong manually).
- Documented (`docs/updating-fetch-items-for-new-tier.md`) how to reconcile `item-bosses-sql.js`'s output against `items.csv` before importing -- Wowhead's Items-tab paste includes housing decor/companion items that aren't real catalog entries, and separately can miss real non-equippable items (e.g. a `Curio`-slot class-set token) that need adding by hand rather than dropping.
- Added `.github/workflows/db-backup.yml` (#543): a nightly `pg_dump` of the Supabase database to Cloudflare R2, with same-run restore verification (a bare `postgres:17` service container proves last night's actual dump artifact restores cleanly, not just that migrations apply) so a broken or incomplete dump fails the run loudly instead of sitting undetected in the bucket. First backup of any kind for this project -- see `docs/backup-restore.md` for what's covered and what isn't.

## [3.46.6] - 2026-07-22

### Frontend

- Fixed a signup being permanently recorded as a main swap "from" the exact same character being signed up for, when the raider's Discord claim hadn't finished resolving yet by the time they reached step 1 of the signup form (a DB round trip, see `getDiscordSession()`). Whether the typed character matched their claim was only ever computed once, at step 1 -- if the claim resolved moments later while they were still on steps 2-4, the stale "differs" result was still used at Submit, so a raider whose claim just loaded late got flagged as swapping off their own character. Now rechecked against the current claim on every step-4 render and again right before Submit, matching the fix #500 already applied to the edit-signup path.

## [3.46.5] - 2026-07-21

### Frontend

- Renamed the public Roster tab's "Incoming" sub-tab to "{signup season} Roster (Tentative)" (e.g. "MN Season 2 Roster (Tentative)"), pulled from the officer-set `DATA.signupSeason` so it names next season directly and stays correct without a code change once a new season's signups open, rather than the vague "Incoming" label.
- Fixed the progression panel silently dropping a boss's pull/kill data after its display name was edited in Season Settings (e.g. shortening "Belo'ren, Child of Al'ar" to "Belo'ren"). The join from `team_raid_progress` to a season's boss list matched purely on normalised boss name, and Season Settings' "Fetch from WCL" button was discarding the WCL encounter ID it fetched instead of saving it -- so a renamed boss no longer matched WarcraftLogs' own (unrenamed) encounter name and its progress just vanished with no error. Boss entries fetched from WCL now carry their `wclEncounterId`, and the progress join tries that first before falling back to the name match, so renaming a boss's display name can no longer break this. Existing boss lists need one more "Fetch from WCL" click in Season Settings to pick up the id and reconnect.

## [3.46.4] - 2026-07-21

### Frontend

- Wishlist rows now show a priority-rank pill (same one used on the BiS List) for every item, not just BiS picks -- `getRank()` was already keyed by item name and worked for any item, but only the BiS List ever called it, so raiders had no way to check their priority on a non-BiS wishlist item. Other Sources rows (M+/Crafted) skip the pill since they aren't real raid drops with a priority order. Also: a wishlist slot card now notes when the officer's BiS grid already has a pick for that slot ("N tagged -- officer BiS set"), so a slot the raider never tagged themselves doesn't misleadingly read as unaddressed -- the tag count and its green/grey styling still reflect only the raider's own tags.

## [3.46.3] - 2026-07-21

### Frontend

- Fixed the priority-rank pill next to each BiS item on a raider's own profile always showing "-", even when the item had a real priority order. `getRank()` treated `DATA.priorityOrder[itemName]` as a flat array, but it's actually `{heroic?: [...], mythic?: [...]}` -- so the lookup loop never ran and always returned no rank. The identical bug was fixed independently in the officer Contested Items view a while back, but this copy was never touched. Now searches both tracks and looks the player up by full character identity instead of first name, so two roster characters sharing a first name can't collide here either.
- Reworked the BiS list's rank/received display for readability: a separate small pill per track ranked on (Heroic green, Mythic purple, e.g. "2 H"/"1 M" side by side) instead of one combined pill; the "received" indicator is now a colored letter pill (same Heroic/Mythic coloring) plus the date, and the whole row now highlights green when the Mythic version was received, gold when only Heroic was. Also fixed the BiS List's column header ("Prio / Slot / Item / Source") not lining up with its own rows -- every column but Item now has a fixed width instead of "auto" (each row is its own CSS grid, so an auto-sized column computed a different width per row depending on content, e.g. two rank pills or a received badge vs. a bare "Mark received" button, throwing off the shared Item column's centering) -- and widened the profile view (`680px` -> `820px`) to give the wider rows room.

## [3.46.2] - 2026-07-21

### Frontend

- Fixed the BiS List editor, BiS list display, and Priority tab's ranked-list/pool (#529, companion to #359) merging two rostered characters that share a first name into one entry -- both editors could show/edit the union of each other's BiS items, and the Priority tab's "Suggest Order"/manual-rank Save flow could silently resolve a ranked character to the wrong twin's `player_id` when saving. `DATA.bisList` and `DATA.priorityOrder`'s ranked arrays are now keyed by full character identity (name + realm) instead of first name alone.

## [3.46.1] - 2026-07-21

### Frontend

- Fixed the loot display (player profile card, Recent Loot feed on the landing page, Roster tab's Items column, and the Fairness chart) merging two rostered characters that share a first name into a single entry -- both showed the union of each other's loot, and Recent Loot mislabeled drops with whichever nickname happened to write the shared key last (#359). `DATA.lootCounts` is now keyed by full character identity (name + realm) instead of first name alone. The BiS list and Priority tab's pool lookup still key by first name and can still collide for now -- re-keying those is a larger, separately-scoped follow-up.

## [3.46.0] - 2026-07-20

### Frontend

- Added a "News" tab (#509): a lightweight reverse-chronological feed of what's shipped -- date, category tag (Feature/Fix/Change), version, and a one-line title, expanding on click to a short write-up. Deliberately not a full blog -- no screenshots, no multi-section posts, closer to a single CHANGELOG.md entry. Source of truth is a new hand-maintained `news.json` at the repo root (same authoring workflow as CHANGELOG.md), not generated from the changelog itself -- changelog bullets aren't categorized and mix raider-facing and officer-only changes in the same line, so a naive filter could leak officer-only tooling into this raider-facing feed. A red dot on the News nav item flags an unread entry, tracked via a `localStorage` "last seen" version cleared on visiting the tab -- keyed on version rather than date, since entries shipped the same day would otherwise never register as new after the first visit -- no new table needed. An entry can also be marked `"pinned": true` in `news.json` to always sort to the top regardless of date (for an announcement an officer wants every raider to see); the pinned entry and the single chronologically latest entry both auto-expand by default, everything else stays collapsed until clicked.

## [3.45.1] - 2026-07-20

### Frontend

- The Priority tab's boss filter dropdown (and the matching Unmanaged Items filter) now sorts by actual raid kill order instead of alphabetically, using the boss order already tracked in Season Settings' raid progression list. A boss with no match there (progression not set up yet, or a name mismatch) falls back to sorting alphabetically after every known boss.

## [3.45.0] - 2026-07-20

### Frontend

- Wishlist completeness indicator (#515): a raider's own Wishlist tab now shows "N/16 slots tagged" (green once every required slot is covered, red with a list of what's missing otherwise) -- Off Hand only counts as required once a One-Hand item is tagged BiS for Weapon. A slot the officer's `bis_items` grid already has a pick for counts toward completeness too, even if the raider never touched their wishlist -- otherwise every raider who's fully handled by their officer would show as permanently incomplete. Officers get a compact "Incomplete Wishlists" name list above the Priority List (visible before generating priority order for the night), plus a per-raider "Wishlist incomplete (N)" badge on the BiS Manager > BiS Lists row, hover for exactly which slots -- kept off the Priority tab itself since a full per-raider breakdown there was a wall of near-identical text while adoption is still low.
- Fixed the BiS List display (profile card, both the raider's own view and the officer's read view from the Roster tab) rendering rows in whatever order they happened to come back from the database instead of canonical gear-slot order -- rows now always sort Head > Neck > Shoulder > Back > Chest > Wrist > Hands > Waist > Legs > Feet > Finger 1 > Finger 2 > Trinket 1 > Trinket 2 > Weapon > Off Hand.
- Fixed the officer's read view of a raider's profile (Roster tab) never showing that raider's own wishlist-tagged BiS items -- the read-time wishlist/`bis_items` merge only ever ran on the raider's own profile view. Both views now share the same merge logic.

### Backend

- Wishlist ranking integration (#515, final piece): `generate_priority_order()` now factors in a raider's own `item_preferences` tag for the item being ranked, alongside the officer's `bis_items` pick it already used. A raider who tagged the item themselves (and isn't in `bis_items` at all) is now a candidate too -- BiS keeps today's 1.0 multiplier, Good is 0.90, OK is 0.60, Catalyst Only is 0.75, and Pass excludes the raider from the suggested order entirely, even overriding an existing `bis_items` pick. An untagged raider who's only in `bis_items` is unaffected -- identical math to before this change. The Suggest Order modal's status text picks up a new "Wishlist: Good/OK/Catalyst Only" segment automatically (silent for BiS/untagged) since it already reads the RPC's `status_label` column.

## [3.44.0] - 2026-07-20

### Frontend

- Officers can now open/close raider wishlist editing independently of the `bis` feature flag, same "pause editing without hiding it" shape as BiS Submissions and M+ Exclusions -- new "Wishlist Editing" toggle next to BiS Submissions on the officer BiS Manager tab. When closed, raiders still see their existing tags (colored, read-only) instead of the tab disappearing; status buttons and the note field are disabled, with a red "Wishlist editing is currently closed" notice. Useful for locking the list right before generating priority order for the night so it can't shift mid-decision. Stored as a new `team_settings.config.wishlistOpen` key, same `SEASON_CONFIG_KEYS` pattern as the other two toggles -- no migration.
- Reworked the Wishlist tab's layout, which had become an endless undifferentiated scroll: each gear slot is now a collapsible card (collapsed by default, with a colored-dot count of tags already set, turning green once every item in that slot has a status) instead of a plain heading. The M+/Crafted placeholder rows -- previously repeated in _every one_ of the 16 slot sections (32+ rows before counting any real items) -- move into a single "Other Sources -- Not From Raid" card instead: each source lists only the slots it's actually been tagged for, plus a "+ Add" control (which saves straight to BiS -- tagging a source for a slot at all already means it's the intended plan) to tag a new one; once a slot is tagged under one source it locks in permanently and drops out of the other source's dropdown, since only one can cover a given slot.
- Catalyst is intentionally **not** one of the Other Sources options -- catalyzing keeps an item's own stats/cantrip rather than replacing them, so it was never a distinct "source" the way M+/Crafted are. Tag the real item you want directly and use the existing "Catalyst Only" status button on it instead. Added a reminder of this on the 5 tier-set slot cards (Head/Shoulder/Chest/Hands/Legs) specifically, where it's most likely to matter.
- The Wishlist help text now leads with "this is your BiS list, expanded" (next to the header, not buried in the collapsed tip) and calls out that BiS choices tagged here also show up on the BiS List tab.
- Real raid-drop items now show the boss they drop from underneath the item name (from the existing `DATA.itemBosses` lookup), so a raider doesn't need to already know the loot table to tag a slot.
- Opening a slot card now auto-collapses any other open card, so the page doesn't grow into another long scroll as more slots get tagged -- except Finger 1/Finger 2, Trinket 1/Trinket 2, and Weapon/Off Hand, which can stay open together since raiders often want to compare both rows at once, and Other Sources, which stays independent of the 16 gear cards.
- Only one item can be BiS per slot at a time now. Tagging a new item BiS auto-demotes whatever was previously BiS for that slot to Good instead of leaving two items both claiming it.

## [3.43.1] - 2026-07-20

### Frontend

- Fixed the raider wishlist failing to save any new tag (`400 Bad Request` on `item_preferences`) -- `wishlistUpsert()`'s insert path never set `team_id` (a NOT NULL column), so every first-time tag on an item failed silently in the console rather than actually saving. Caught live right after Phase 2 shipped; added a frontend test asserting the insert payload's shape so this can't regress unnoticed again.
- Each wishlist status button now has its own color (matching the officer admin panel's tier-label dots: BiS gold, Good green, OK blue, Catalyst Only purple, Pass red), and selecting one tints the whole item row that color instead of just highlighting the button.

## [3.43.0] - 2026-07-20

### Frontend

- Officers can now rename the raider wishlist's 5 status tiers (default BiS/Good/OK/Catalyst Only/Pass) per team -- new "Wishlist Tier Labels" panel under Admin > Feature Flags, 5 text inputs with a shared Save button. Leaving a field blank keeps that tier's default text; colors stay fixed per tier regardless. Phase 2 of #515 -- no schema change, stored as a new `team_settings.config.wishlistStatusLabels` key via the existing `set_team_setting` RPC, same no-migration pattern the Officer Bios feature already uses.
- The wishlist (both the profile's Wishlist tab and the BiS tab's wishlist-merged rows) now shares the existing `bis` feature flag rather than always being on -- a team with BiS Lists turned off no longer sees either. Previously the wishlist had no feature-flag gate at all.

## [3.42.0] - 2026-07-20

### Frontend

- Added a raider-facing "My Wishlist" section on the raider's own profile page (same self-service pattern as the "Your Stream" section -- only renders, and is only writable, when the logged-in session's claimed character matches the profile being viewed; no separate nav tab, since a wishlist isn't something a visitor browsing the roster should stumble into on someone else's profile): tag any catalog item -- not just one BiS pick per slot -- as BiS/Good/OK/Catalyst Only/Pass, with an optional note per item. Scoped to the raider's own armor type (a Warlock never sees Plate/Mail/Leather rows). Each item shows its real Wowhead icon (from a new `items.icon` column, not dependent on the Wowhead tooltip widget's external script actually loading -- ad-blockers commonly block it) and links out to a Wowhead hover tooltip with rarity-accurate coloring when that script does load (`whTooltips = {colorLinks:true, iconizeLinks:true}` + `power.js`, now loaded on the public site too). Purely additive: doesn't touch the existing officer BiS grid, and has no effect yet on priority-order generation. First slice of #515; ranking integration, a completeness indicator, and officer-configurable tier labels are later phases of the same issue.
- Split the raider's own profile view into 4 sub-tabs (Overview, BiS, Wishlist, Settings) instead of one long stacked scroll -- Attendance/Items Received under Overview, BiS Link/BiS List under BiS, the new Wishlist section gets its own tab instead of being buried at the bottom, M+ Exclusion/Your Stream under Settings. Reuses the Roster page's existing sub-tab CSS/pattern. Officer inline profile view is unaffected. Added clarifying copy on both the BiS and Wishlist tabs explaining the difference between the two (officer-curated single pick vs. raider-tagged multiple options), since having both was a likely source of confusion.
- The BiS tab's BiS List now merges in the raider's own wishlist "BiS" tags -- read-time only, nothing written back to `bis_items`. Where a raider has tagged an item "BiS" in their Wishlist, it supersedes the officer's pick for that slot in this display (marked "(Wishlist)"); slots the raider hasn't tagged still show the officer's `bis_items` pick as before. Reduces duplicate officer data entry without creating duplicate storage -- `bis_items`, `getBisItems()`, and every other consumer of it (conflict detection, priority generation, the officer's own 16-slot grid) are untouched.

### Backend

- New `item_preferences` table backing the above: one row per player+item(+slot override for the shared M+/Crafted/Catalyst placeholder rows), RLS-gated to the owning raider for writes and to officer/team_leader for read (not public, unlike `bis_items` -- these tags are more personal/opinionated). `slot` override and its unique index mirror `bis_items`' own `20260710120000_bis_items_slot_override.sql` fix for the same reason.
- New nullable `items.icon` column (Wowhead icon slug), captured by `scripts/fetch-items.js`; re-run it and import the refreshed `items.csv` through the SQL Editor as usual to backfill existing rows -- new tiers get it automatically going forward.
- `scripts/fetch-items.js` no longer needs a hand-pasted item-ID list each tier -- it now reads the raid's full loot table (item id, name, equip slot, boss source) directly off the Wowhead zone page in one fetch, and only queries Wowhead per item for the icon, via its lightweight tooltip JSON endpoint rather than the full item page/XML. Cuts per-run Wowhead requests roughly in half and removes the two fetches that were most prone to getting rate-limited/blocked; per-tier setup is now just `ZONE_ID`/`ZONE_IS_PTR` plus `TOKEN_SLOT_KEYWORDS` (see `docs/updating-fetch-items-for-new-tier.md`).

## [3.41.0] - 2026-07-16

### Frontend

- Season signups now require a Discord login -- no more anonymous entries. Visiting Sign Up while logged out shows "You must sign in with Discord to do this" with a login button in place of the form; the "Sign Up" nav item stays visible either way. The main-swap option (checkbox + free-typed "switching from" character) is also removed entirely for accounts with no claimed character -- it's now only ever offered/auto-filled from a verified claim, never free-typed. (#513)

### Backend

- `submit_season_signup` now rejects anonymous callers (`Not signed in`) instead of opportunistically recording `auth_user_id` when present; `anon` loses execute on the function entirely. Reverses the #403 decision that required it to stay anon-callable for un-logged-in prospective recruits.

## [3.40.0] - 2026-07-16

### Frontend

- Added a "Bios" tab (public site nav) showing officer bio cards: photo (or initials fallback), name/pronouns/character name, title, class/spec badge, and a short bio, in officer-controlled display order. Hidden until a team adds at least one. New "Officer Bios" tab in officer.html to author them -- add/remove/reorder/save, same round-trip pattern as Raid Progression; adding one can start from an existing roster player (prefills name/character/class/spec, a one-time copy not a live link) or be filled in from scratch for someone not on the roster. No new table or migration -- saved as a new `team_settings.config.blazeCommanderBios` key through the existing settings RPC. Second slice of #477; a second, guild-wide bio tier is a separate follow-up (needs its own `site_settings` column/RPC). (#477)

## [3.39.0] - 2026-07-16

### Frontend

- Added a new "History" tab (public site nav) with a plain-text "Progression History" list: one line per archived season (newest first) with the season's aggregate Mythic kill count and the date of its last boss kill. Needs no new data -- everything is already stored on `DATA.seasonHistory` from the existing season archive flow. First slice of #477; officer/guild-wide bio cards are a separate follow-up. (#477)

## [3.38.0] - 2026-07-16

### Frontend

- Added a small outbound-link icon box to the header (index.html and officer.html), separate from the internal site-nav row: Raider.IO and Armory link to the guild-wide pages (static, since neither site splits by team), and a WarcraftLogs icon links to this team's own WCL guild page (Phoenix and Hellfire log separately despite being one guild) once an officer sets it in Season Settings > Settings. Hidden until set, no live data pulled from any of the three. (#288)
- Every raider's profile card now shows the same Raider.IO/Armory/WarcraftLogs icon links, built client-side from their name and realm -- no submission or API call needed. The M+ exclusion request form's Raider.io URL field is now pre-filled with this same link instead of asking a raider to paste it every time they submit or re-submit a request. (#289)

## [3.37.0] - 2026-07-16

### Frontend

- The public landing page's Recent Loot feed now has an item-name search box. Searching shows every matching item for the current season (no 10-item cap); with the box empty it's still just the last 10, same as before. No player-name filter by design -- a raider's full item history stays un-browsable, matching the #99 login gate. (#279)

## [3.36.0] - 2026-07-15

### Frontend

- Signing up now checks for an existing signup first: a raider who already submitted this season sees a summary of it (status, class/spec, their own note) with an Edit button, instead of a blank fresh form. A pending or approved-but-not-yet-rostered signup can be corrected (typo, realm transfer, mislabeled main swap) without officer involvement; an approved edit reverts to pending for re-review. A signup already added to the roster, or denied, is shown as locked. (#500)

### Backend

- Added `season_signups.auth_user_id`, captured by `submit_season_signup()` from `auth.uid()` when the submitter is signed in at submission time.
- Added `get_own_signup()` and `update_own_signup()` (both SECURITY DEFINER), the read/edit path backing the above -- the only way a raider can see or change their own signup; `season_signups` itself still has no read or write rule for a raider role. (#500)
- One-time backfill: links `auth_user_id` on signups submitted before this shipped (never captured until now) to their submitter's claimed account, where an unambiguous claim already exists -- so the currently pending/approved signups already in the system get self-edit access too, not just new ones going forward. Covers main-swap signups too (matched via `swap_from_name_realm`, the claimed old character, since the new character usually isn't a roster row yet to match against directly). (#500)

## [3.35.1] - 2026-07-15

### Frontend

- Fixed Missing Signups incorrectly flagging a raider's current main as missing when they'd already submitted a mainswap signup under their new character's name (Discord-claim-verified swaps only). The old character name is now recorded at signup time so the check can match on it.

### Backend

- Added `season_signups.swap_from_name_realm` and a matching `submit_season_signup` parameter to persist the verified-claim mainswap's old character name, previously computed client-side and discarded.

## [3.35.0] - 2026-07-15

### Frontend

- The public Roster tab now has an "Incoming" sub-tab (next to "Current Roster") listing approved signups awaiting their roster add for the current season, grouped by role the same way as the main roster (name + class/spec badge only -- no attendance, items, BiS, or notes, unlike the officer-only Pending Roster worklist). Only appears when there's actually someone incoming. (#499)

### Backend

- Added `public.incoming_roster`, a narrow-columned public view over approved-unpromoted `season_signups` rows, scoped to each team's active signup season, powering the above.

## [3.34.0] - 2026-07-15

### Frontend

- Visiting the site with no `?team=` and no team chosen yet this session no longer silently defaults to Phoenix's roster. A logged-in raider with a claimed character on another team is now redirected there automatically; everyone else sees a "Which team are you viewing?" picker instead.

## [3.33.39] - 2026-07-14

### Frontend

- Season History now has a "View BiS" button per archived season, showing each player's BiS list (item, slot, obtained) as it stood at archive time -- same read-only snapshot pattern as the existing "View Roster" button.
- The Archive Season confirmation message now says what's actually about to happen to BiS items, M+ exclusion, and Bench status, not just the season name/dates.
- The public site's "Officer Access" nav link is now hidden for plain raiders -- previously visible to everyone regardless of role, which no longer makes sense now that officer access is Discord-only (#495). Stays visible for officers, team leaders, and site admins.

### Backend

- `archive_current_season()` now also resets state that had no season concept in the schema at all, and so persisted forever across every archive: real-item `bis_items` rows are snapshotted into the season-history entry (placeholders included, for a complete record) and then wiped -- a new tier's loot table is almost always a different set of items, so last tier's real-item BiS rows were dead weight. Placeholder entries (M+/Crafted/Catalyst) survive the wipe untouched, since they aren't tied to specific gear. `players.m_plus_excluded` (and its `m_plus_note` reason) resets to false for the active roster, since that flag means "doesn't need gear right now" and a new tier means everyone needs gear again. `players.is_bench` also resets to false for the active roster -- `is_trial` is deliberately left alone, since trial status is still a specific Trial Promotions decision, not something a new tier changes on its own. `rclc_loot` (actual loot-award history) is unaffected either way -- it's an independent child of the shared item catalog, not of `bis_items`.

## [3.33.38] - 2026-07-14

### Frontend

- Added `attendance` and `requests` feature flags (Admin > Feature Flags, both the per-team self-serve version and the site-admin dashboard). Attendance previously had no flag at all; Received Item Requests previously shared the `loot` flag even though it's a distinct raider self-mark-received workflow, so toggling Loot off also hid Requests as a side effect. The raider-facing "Submit request" button (on their own profile) is now gated on `requests` too, so disabling the flag stops the workflow end-to-end instead of just hiding the officer's approval queue tab while raiders could still submit into it unseen. The officer's own direct "Mark received" shortcut is unaffected either way, since it doesn't go through the approval queue.

## [3.33.37] - 2026-07-14

### Frontend

- Fixed WCL performance scores leaking between teams -- the Scoring tab's cache key (`_WCL_SCORES_KEY`) wasn't scoped per team, unlike every other session/local storage key in this app, so refreshing scores on one team and then switching to another team in the same browser session would render the first team's cached scores on the second team's Scoring tab.
- Removed the shared per-team officer password. Officer access is now Discord OAuth only -- RLS already gates every officer read/write on a genuine `auth.uid()`, so the password never granted real backend access, and it sat in plaintext in a public JS file besides. A brand-new team's first officer can still be bootstrapped before their first login by inserting a `team_members` row with their Discord ID and `role='officer'` directly (no dedicated Admin UI for this yet) -- `claim_character()` already looks up an existing row by `discord_id` on first login and links it, so the role carries over.

## [3.33.36] - 2026-07-14

### Frontend

- Fixed the officer Roster tab's Player Settings panel collapsing itself the moment a Spec was picked -- the post-save `buildRosterTable()` rebuild reset every panel to its default collapsed state, making it look like the picker closed itself out from under the officer. Class, Spec, Name/Realm, and Joined Date now commit together via one "Save Player Settings" button instead of each field auto-saving or having its own Save button, and the panel's expanded/collapsed state now survives the rebuild (#489).
- Fixed the `<input type="date">` calendar-picker icon rendering black and nearly invisible against this app's dark theme (Player Settings' Joined date, Raid AotC / boss-kill dates, season start/end, add-player Join Date) (#490).
- Increased the border contrast on `.filter-chip` (Roster/Discord Claims sub-tabs, filter/role/sort chips) and `.btn-muted` (the default secondary-button style used site-wide: Cancel, Refresh, Log out, Paste Loot, and similar non-primary actions) -- both used a barely-visible white border (7-12% opacity) against the dark background, making unstyled-looking buttons hard to tell apart from a real CSS bug when actually just low contrast.
- Admin > Officers now shows a read-only "Team Leader: <character>" line above the officers table -- previously a team leader (a distinct top tier that already grants full admin access without the `officer` role) was invisible on this panel, so a team with only a team leader claimed and no other officers showed a bare "No officers yet." that read as a bug (#491).
- Buff Coverage (Roster tab and Pending Roster's pre-push preview) names now link to their Wowhead spell page with a hover tooltip -- officers previously had to recognize each ability by name alone. Also moved Hunter's Mark from Raid Buffs to Boss Debuffs: it's applied to the boss, not the raid, so it was miscategorized.

### Backend

- `build_rclc_export()` now excludes already-awarded recipients from the ranked `priority` object at export time, the same way `generate_priority_order()` already does at generation time -- a Mythic `rclc_loot` row drops a player from both tracks, a Heroic row drops them from the Heroic track only. Previously the export just re-shipped whatever `priority_order` last had saved, so the RCLootCouncil addon could show a stale rank instead of "Awarded" for an item an officer forgot to regenerate since it last dropped (#480).

## [3.33.35] - 2026-07-13

### Frontend

- Fixed the "Look Up a Raider" dropdown on the public/index page (shown to officers) excluding bench players -- the adjacent Roster tab already listed them, so a bench player was invisible in the one place officers use to pull up any raider's profile.

### Backend

- Replaced GitHub Actions' scheduled trigger for `twitch-live-check` and `wcl-progression-sync` with `pg_cron` + `pg_net` calling both Edge Functions directly from Postgres -- GitHub Actions' scheduled-workflow trigger never actually honored either cron expression in practice (real gaps of 1-3 hours), stale enough that a live raider could show as offline on the landing page for up to an hour. See `docs/database-decisions.md` (2026-07-13 entry) for the full writeup.

## [3.33.34] - 2026-07-13

### Frontend

- **Priority List conflict badge.** The Priority tab's nav badge total previously included a silent "stale-after-Heroic #1" count with no visible home of its own, so the total could be higher than the Unmanaged Items badge with no way to tell where the difference came from. Added a badge on the Priority List sub-tab covering all three fairness/health checks: stale-after-Heroic #1s, same-boss #1 conflicts, and players holding 2+ #1 priorities team-wide -- plus a banner naming the actual item(s)/player(s) behind each one, so a conflict is no longer just a bare number.

## [3.33.33] - 2026-07-13

### Frontend

- Fixed the Pending Roster tab resetting a row's Trial checkbox and archive-player dropdown back to their defaults whenever any row's selection checkbox was toggled (the whole list re-renders on selection change, and those two controls weren't remembering their manually-set values).

## [3.33.32] - 2026-07-13

### Frontend

- **Priority order fairness warnings.** The Priority Edit modal now shows a non-blocking ⚠ next to whoever's in the #1 slot if they already hold a #1 priority on another item, or on another item from the same boss -- officers can still save either way. Importing loot now immediately refreshes a "saved Mythic #1 but the player already got the Heroic version" check and updates the Priority nav badge, without needing to reload the page or revisit the Priority tab. Also added a "Mythic #1 Possibly Stale" section to the existing Priority Order Health report.

### Backend

- Added `priority_order_live_first_prios`, `priority_order_first_prio_counts`, `priority_order_same_boss_conflicts`, and `priority_order_stale_after_heroic` views backing the above.
- Folded approved `self_received_requests` into `priority_order_live_first_prios` and `priority_order_stale_after_heroic` alongside `rclc_loot` -- an officer-approved self-received item is just as real a receipt as an RCLootCouncil import, and previously only the latter cleared a player's live #1 / triggered the stale-after-heroic flag.

## [3.33.31] - 2026-07-12

### Frontend

- **officer.html's nav now matches index.html.** The officer dashboard's top nav was missing Roster, Streams, Sign Up, and Help -- officers had no way to reach those pages without manually editing the URL. Added them as links back to index.html (which now honors a `#roster`/`#streams`/`#signup`/`#help` deep-link on load to open the right view) (#354). Renamed the officer dashboard's own sidebar "Help" tab to "Officer Guide" to avoid confusion with the new raider-facing "Help" link that now sits right next to it in the top nav.

## [3.33.30] - 2026-07-12

### Frontend

- **Added a raider-facing Help tab.** index.html now has a Help tab covering the core raider workflows (claiming a character, submitting BiS, signing up, requesting a received item, checking priority/attendance), plus contextual `?` tooltips next to the relevant sections -- parity with officer.html's existing Help tab, reusing the same `toggleHelp()`/`.help-tip` pattern (#409).

## [3.33.29] - 2026-07-12

### Frontend

- **Denied signups no longer linger on the Signups subtab.** Denying a signup now removes its card immediately, matching the approve flow, and the subtab only ever shows pending submissions on reload -- denied signups still show up under History.

## [3.33.28] - 2026-07-12

### Frontend

- **Added a Patreon link to the public site's footer.** A small icon-only link (Kat's Patreon) next to the existing Changelog link, on every public-facing view.

## [3.33.27] - 2026-07-12

### Frontend

- **Killed bosses on the progression card now show in green (#285).** The boss name, kill date, and pull-count badge all pick up `--heal` once a boss is killed, matching the green used for other "done" indicators (BiS checkmarks, etc.) instead of the same muted color as an in-progress boss.

## [3.33.26] - 2026-07-12

### Frontend

- **Landing page now shows mythic pull count / best % on the progression card (#285).** The current work-in-progress boss shows its pull count and best % remaining so far; already-killed bosses show their total pulls next to the existing kill date, matching WCL's own reports view. Clicking either links straight to the relevant WCL report/fight. Sourced from new `raid_zones`/`raid_encounters`/`team_raid_progress` tables, synced by a new `wcl-progression-sync` Edge Function on a GitHub Actions cron (every 30 min, Tue/Thu/Mon 9:30pm-midnight Eastern raid hours only) -- see `docs/database-decisions.md` for why this isn't a JSON blob or manual-only refresh.

### Backend

- Added `raid_zones`/`raid_encounters` (shared WCL reference data) and `team_raid_progress` (per-team sync target) tables, plus the `wcl-progression-sync` Edge Function and its GitHub Actions cron workflow (#285).
- **Fixed `wcl-progression-sync` undercounting mythic pulls (#285).** Its `reports(guildID, zoneID, limit)` call only fetched one page (100 reports); an active progression guild's report count for a single zone across a season can exceed that, silently dropping the oldest reports and undercounting `mythic_pulls` relative to what WCL's own boss page shows (confirmed live: 145 pulls shown here vs. 174 on WCL). Now paginates via `has_more_pages` until exhausted (capped at 20 pages as a runaway guard).

## [3.33.25] - 2026-07-12

### Frontend

- **Fixed the officer player-settings panel closing when the browser tab regained focus.** Supabase's auth client re-validates the session (and re-fires a `SIGNED_IN` event, not just `TOKEN_REFRESHED`) whenever `officer.html` regains visibility, even though the session itself hadn't changed. That handler always ran the full login-complete pipeline, which shows the loading overlay and rebuilds the officer dashboard from scratch -- wiping an open player-settings panel and only reopening it once the reload finished. `js/discord.js`'s `onAuthStateChange` handler now tracks the last user ID it actually processed a `SIGNED_IN` for and skips the pipeline on a repeat fire for the same user, resetting on `SIGNED_OUT` so a genuine re-login still runs it.

## [3.33.24] - 2026-07-12

### Frontend

- **Officers can now leave a note when approving a BiS submission (#278).** Approving a Pending BiS entry (a fresh link or a "same link" flag) swaps the Approve/Reject buttons for an inline optional note field, mirroring both the existing BiS rejection flow and M+ exclusion's approve flow. Stored in `bis_requests.officer_notes`, same column the rejection note already uses.

## [3.33.23] - 2026-07-12

### Frontend

- **"Clear read" in the notification bell dropdown.** A header row with a "Clear read" link appears whenever the dropdown has at least one already-read notification, hiding it from view -- and staying hidden across refreshes and future logins. Doesn't touch the `notifications` table at all (no new raider-writable delete path): a per-character "cleared through" id is kept in `localStorage`, so this resets if the raider ever clears site data, which also logs them out of Discord at the same time anyway.

## [3.33.22] - 2026-07-12

### Frontend

- **"My List Changed (Same Link)" flag on a raider's own BiS section (#278).** Until now, `submitBiS` only fired when the link itself changed, and even then only during an open submission window or with an officer's individual allow-list -- so a raider whose Raidbots/sheet contents changed in place (link unchanged) had no way to signal officers to go recheck their tracked items. This new action is always available (no submission-window or allow-list gate) whenever the raider already has a link on file, and lands in the same Pending BiS review queue with a "Same link -- items changed" badge so officers know to go recheck the BiS Lists tab rather than treat it as a new link. Also fires the same Discord bot notification as a regular BiS submission (reusing the `bis` webhook action, distinguished by a `sameLink` flag), so officers are pinged in Discord the same way a fresh link submission already was.
- **Officers can now leave a reason when rejecting a BiS submission (#278).** Rejecting a Pending BiS entry (a fresh link or a "same link" flag) swaps the Approve/Reject buttons for an inline optional note field, mirroring the M+ exclusion rejection flow -- the raider's in-app notification includes the reason when one's given.

### Backend

- **`flag_bis_list_changed()` (#278).** SECURITY DEFINER, granted to anon like `submit_bis_link()` (#404) -- re-queues the player's existing `players.bis_link` into `bis_requests` without the submission-window/allow-list gate, since it isn't granting a new link. Collapses into the existing pending row if one's already queued for the same link, so repeat clicks don't pile up duplicates.
- **`bis_requests.officer_notes` (#278).** Same shape as `mplus_exclusion_requests.officer_notes` -- an optional reason an officer can attach when rejecting a request, surfaced to the raider via `notify_player()`.

## [3.33.21] - 2026-07-12

### Frontend

- **In-app notification bell (#151).** A raider now sees a bell in the nav (index.html and officer.html) when they've claimed a character, with a red badge for unread notifications. Opening it shows their last 20 notifications and marks the unread ones read. Fires when an officer approves or rejects their BiS list link, self-received item, or Mythic+ exclusion request -- rejection notifications for M+ exclusions include the officer's rejection reason, which the UI already collected "to be shown to the raider" but had no way to actually deliver until now. Season signup approve/reject deliberately isn't wired to this: an applicant has no `players` row (and so nothing to notify) until their signup is promoted to the roster, well past that step.

### Backend

- **`notifications` table + `notify_player()` (#151).** No direct INSERT policy for anyone, including officers -- `notify_player()` (SECURITY DEFINER, same shape as `write_audit_log()`) is the only way a row gets written, so a notification can't be forged or misattributed. A raider reads and marks-read their own rows via `is_own_player(player_id)`, the same self-service predicate `streamers` introduced.

## [3.33.20] - 2026-07-12

### Frontend

- **Site admins no longer need a team's password to open its officer dashboard.** The Discord-login gate only checked `session.isOfficer` (a `team_members` role on that specific team), so a site admin with no roster row on a given team fell back to the password prompt even though they have global access. Now accepts `session.isOfficer || session.isAdmin`.
- **The Priority tab's unmanaged-items nav badge could silently stay wrong (usually hidden) after a fresh Discord login.** It reads `DATA.priorityOrder`/`DATA.itemSlots`, both populated by `loadData()`'s heavy batch, but the Discord-login grant path only recomputed the badge from the core batch (before that data exists) and never again once the heavy batch actually resolved. Now recomputed after the heavy batch too, matching the session-restore reload path that already did this correctly.
- **Switching teams (or, less often, plain navigation) could load with the wrong CSS/fonts until a hard refresh.** `switchTeam()` reloaded via `location.href = location.pathname`, which is the exact same URL the page is already on whenever there's no `?team=` query string -- some browsers treat that as a soft reload that can reuse stale cached/in-memory resources instead of a genuine fresh fetch. Now always includes the destination team in the query string so the URL actually changes.
- **Raid Progression's boss list can be reordered by drag-and-drop** instead of only add/remove -- boss WCL encounter IDs don't always come back in kill order, so getting boss #4 assigned before boss #3 was common and previously meant deleting and re-adding rows to fix the order.
- **Small text raised noticeably across the whole site** (every card/box, tab, and inline-styled label in the CSS and JS) -- Rajdhani is a fairly thin font that was blurring at the smallest sizes previously in use (mostly 0.65rem-0.97rem), so this went beyond a light nudge to a consistent, larger bump everywhere that pattern showed up.

## [3.33.19] - 2026-07-12

### Frontend

- **Guild-wide Twitch streams (#286) are wired to real Supabase data.** The landing-page live banner, floating widget, Streams tab, and the self-service editor on a raider's own profile now read/write the real `streamers` table instead of a hardcoded mock array. Two real bugs caught in the process: the self-service editor called an HTML-escaping helper (`_esc()`) that was never actually defined anywhere, which would have thrown the moment a raider's own profile rendered; and every raider-controlled field the stream cards render site-wide (display name, channel, schedule note) went out unescaped, harmless with hardcoded mock data but a real gap now that it's genuine user input -- both fixed, with a test that reverts the fix and confirms a `<script>`/`<img onerror>` payload is caught.
- **The live-streamers banner now sits below the officer quick-actions bar**, not above it -- was pushing the officer-only controls down a row for no reason.

### Backend

- **`streamers`' officer-write RLS policy fixed before ever reaching production.** It checked `my_team_role(team_id) = any('officer','admin')`, but `team_members.role` never holds `'admin'` (that's the separate, global `site_admins` concept) -- team leaders could never have written via the officer-override path. Fixed to `'team_leader'`, matching every other officer-write policy in the schema.
- **`twitch-live-check` Edge Function + a GitHub Actions cron** (every 5 minutes) keep `streamers.is_live`/`last_checked_at` current by polling Twitch's Helix API for every linked channel. No cron/pg_net infrastructure exists in this project yet, so GitHub Actions is the trigger rather than new Postgres extensions. Needs manual setup before it does anything: a Twitch Developer app (`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`), a shared `TWITCH_LIVE_CHECK_SECRET` (Supabase Edge Function secret + matching GitHub Actions repo secret), and deploying with `--no-verify-jwt` since the cron calls it with no Supabase session at all -- see the function's own header comment for the exact steps.

## [3.33.18] - 2026-07-11

### Frontend

- **Apps Script is retired (#225).** Every remaining live GAS call site is gone: `loadData()`'s core/heavy JSONP chunk fetch (the primary roster/loot/BiS/priority/attendance load for Phoenix and Hellfire -- Immolation already used the GAS-independent path from #426, now made universal), the Danger Zone's seven "Clear ___ Sheet" ops, the Quick Actions "Refresh Attendance" button (which was still calling GAS directly while the real Attendance tab already used the `wcl-sync` Edge Function -- the same two-different-paths bug #335 fixed for priority export), the profile card's attendance-history GAS fallback, and the "Clear Cache" button (meaningless once there's no GAS script cache to clear). `jsonpRequest()` and its audit-attribution helper are deleted; `WEB_APP_URL` is gone. `TEAMS[team].gasUrl` stays as a historical record of which deployment served which team -- nothing reads it anymore, and (per Kat's call) the `gs/` Apps Script source itself is kept for now rather than deleted outright.
- **A Supabase failure now shows an empty state, not a stale GAS fallback.** This is a real behavior change, not just a refactor: previously, if a Supabase query genuinely errored, several read paths (roster, BiS, priority order, self-received, attendance history) fell back to whatever GAS last had. With GAS gone there is nothing to fall back to, so those paths now show empty/error states directly -- correct given the circumstances, but worth knowing if something looks emptier than expected right after this ships.
- **The Danger Zone's "Clear \___" ops are Supabase-native**, matching the fix #423 already made for Clear Season History. Five new SECURITY DEFINER RPCs (site-admin only) handle the four request tables plus the narrower "Pending Roster" subset (approved-but-not-yet-added signups, distinct from clearing every signup outright); Loot Data clears via a direct client delete, since officers already hold a grant on `rclc_loot` for their own team. Status messages now show the actual row count cleared. **"Clear Pasted Loot Sheet" is retired outright, not migrated** -- #219 replaced the old paste-to-sheet-then-import flow with a direct paste-to-RPC import with no staging table, so there was nothing left for it to clear.

### Backend

- **Five new `danger_clear_*` RPCs** for the Danger Zone's request-table clears (`danger_clear_bis_requests`, `danger_clear_season_signups`, `danger_clear_pending_roster`, `danger_clear_mplus_exclusion_requests`, `danger_clear_self_received_requests`), all SECURITY DEFINER, `is_site_admin()`-gated, returning the deleted row count.

## [3.33.17] - 2026-07-11

### Frontend

- **Fixed Danger Zone's "Clear Season History" clearing the wrong store (#423).** Since #221 moved season config onto Supabase, archived seasons live in `team_settings.config.seasonHistory` -- but this op still called the GAS `dangerClearSeasonHistory` action, which cleared Script Properties (a store nothing has read since #221) and left the real archived seasons untouched. Officers who ran it saw "Done." while their Season History list stayed exactly as it was. Now clears `config.seasonHistory` directly through the same `saveTeamSetting()`/`set_team_setting` RPC the Season Settings tab already writes through -- team-leader-gated, same as before -- and updates `DATA.seasonHistory` and the Season tab's rendered list immediately, no reload needed. `season_snapshots` (the table the op's old description named) was never the actual store; nothing has ever written it, so it's left untouched.

## [3.33.16] - 2026-07-11

### Frontend

- **Dropped the item-slot synonym tables (#453).** `getSlotColor()` had to list every pair (`BOOTS` and `FEET`, `GLOVES` and `HANDS`, `CLOAK` and `BACK`...) and `BIS_CATALOG_SLOT_TO_ROWS` existed largely to translate, because `items.slot` spoke a different dialect from `bis_items.slot`. Both now use the canonical in-game/Wowhead names, so what's left is only the mapping that can't be reduced: an item's slot is a _type_ (a ring fits either finger), while a BiS row is a _position_, so `Finger`/`Trinket` still fan out to both numbered rows and every weapon type collapses to the single `Weapon` row.
- **Fixed `scripts/fetch-items.js`, which was broken.** It fetched Wowhead's `/tooltip/item/{id}` endpoint, which Wowhead has removed -- it now 404s for _every_ item, so the next tier fetch would have failed outright. Now reads the `&xml` endpoint, whose `<inventorySlot>` gives the canonical slot straight from the game data (no per-tier `SLOT_FROM_TYPE` guesswork for real items) and reports no slot at all for tier tokens, which is exactly the case the existing name-parsing fallback covers.

### Backend

- **Normalized the item catalog's slot vocabulary and de-duplicated it (#453).** `items.slot` held a vocabulary hand-typed into the retired GAS "Item Lookup" spreadsheet (`Boots`, `Gloves`, `Belt`, `Bracers`, `Cloak`, `Shoulders`, `Ring`, `1H/2H`, `OH`, `Unknown`) that matched neither the game, Wowhead, nor `bis_items.slot`. Every slot was re-derived from Wowhead by `wow_item_id` rather than translated from the old words -- a string mapping can't split `1H/2H` into One-Hand (12 items) / Two-Hand (5) / Ranged (2), and can't recover `Unknown` at all.
- **Deleted 19 duplicate catalog rows and added a unique index on `wow_item_id`.** The catalog held 132 rows for 113 distinct items: every tier token existed twice, once hand-filed with a slot and once seeded bare as `Unknown`. They slipped past the `unique(lower(name))` index because the hand-filed rows carried an armor-type suffix and the seeded ones didn't, and there was no unique constraint on `wow_item_id` to catch it. Nothing referenced the duplicates (verified across `bis_items`, `rclc_loot`, `priority_order`, `self_received_requests` and `item_bosses`), so they're deleted rather than merged, behind a guard that refuses to run if that's ever untrue.
- **Tier-token names no longer repeat their armor type.** `Alnforged Riftbloom (Plate)` becomes `Alnforged Riftbloom`, since `items.armor_type` already stores `Plate` -- the suffix was how the spreadsheet told four identically-named tokens apart, and the column does that job now. Only a suffix that literally repeats `armor_type` is stripped, so `Chiming Void Curio (Tier)` (a class-set trade token, no armor type) is left alone.
- **`build_rclc_export` learned `Held In Off-hand`.** It keys off `coalesce(bis_items.slot, items.slot)`, and its CASE already covered the canonical names but had no arm for the legacy ones -- a BiS row with no slot of its own and a legacy catalog slot fell through to `null` and was dropped from the RCLootCouncil export. Nothing hit that in practice, and the normalization removes the possibility; the one genuinely new value (Wowhead's name for off-hand-only tomes and orbs) now maps to the addon's `oh` key alongside shields.

## [3.33.15] - 2026-07-11

### Frontend

- **"Mark received" now ticks the matching BiS item as obtained (#386).** #217 gave officers an "Obtained" checkbox on `bis_items` and #406 moved the self-received flow onto Supabase, but nothing linked them -- a raider marking an item received (or an officer direct-marking it) left the BiS row unticked, so an officer had to repeat the action in BiS Manager. Approving a self-received item now flips the matching `bis_items` row automatically, keeping BiS Manager as the one place officers actively _edit_ a list while "Mark received" is just the received-state signal. The "Mark received" button now sends the raw `bis_items.slot` of the row it was rendered for, rather than the displayed slot name -- the two diverge routinely (the item catalog says `Boots`/`Gloves`/`Trinket` where `bis_items` says `Feet`/`Hands`/`Trinket 1`), and only the raw value identifies which row an approval fills.

### Backend

- **`self_received_requests.slot` + a trigger that syncs `bis_items.obtained` (#386).** New nullable `slot` column records which BiS row a request was raised against. It's needed because `bis_items` is unique on `(player_id, item_id, coalesce(slot, ''))`: the placeholder items (`M+`, `Crafted`, `Catalyst` -- `items.is_placeholder`) name a loot _source_ rather than a piece of gear, so one player legitimately lists `M+` against six different slots, and an approved `M+` previously could not say which of them it filled. `submit_self_received()` and `direct_mark_received()` gain a `p_slot` argument (dropped and recreated rather than replaced, since adding a parameter would otherwise leave the old 6-argument overload resolvable). The flip itself lives in a trigger rather than in those two functions, because there is a third path to `approved` -- the officer Requests tab updates `status` directly -- so a trigger catches all three and can't be bypassed by a fourth. It is deliberately one-way: approving sets `obtained = true`, but rejecting or reverting never clears it, since an officer may have ticked the box by hand and silently undoing that would be worse. A request with no slot (rows predating this) only infers a target when the item occupies exactly one slot for that player.

## [3.33.14] - 2026-07-11

### Frontend

- **Fixed accented roster names silently escaping the priority pool's loot-exclusion rule (#360).** `DATA.lootCounts` is keyed by diacritic-stripped names (`normalise()`), but `prioEditLootFlags()` looked its entry up with `lootCounts[firstName.toLowerCase()]`, which preserves accents -- so an accented name could never match its own key and always came back with no loot. The visible symptom was a missing "has the Heroic version" badge, but the same function backs `prioEditIsBlocked()`, which enforces the exclusion rule shared with `generate_priority_order()`: a mythic recipient is done with an item and a heroic recipient is blocked from the heroic track. Because the lookup silently missed, **an accented player who had already received an item could be ranked for it again**, in both the pool render and the "Show all roster" add path. Now goes through the existing `getLootEntry()` helper, which normalises both sides -- the same thing every other loot consumer already did. Consolidating on that helper also leaves exactly one place that knows how `lootCounts` is keyed, which is what #359 will want to change.

### Frontend

- **Cache-bust CSS/JS with a `?v=<VERSION>` query on every asset tag (#431).** GitHub Pages serves every static asset with `Cache-Control: max-age=600`, so for up to 10 minutes after a deploy a browser with the site already open could run fresh HTML/JS against a stale cached CSS (or vice versa) -- the reported symptom of pages rendering with visibly wrong styling until a hard refresh. Every local `<link rel="stylesheet">`/`<script src="js/...">` in `index.html`/`officer.html`/`admin.html` now carries `?v=<VERSION>`, so every version bump forces a fresh fetch of every asset. The query string is hardcoded per tag (not injected) because `VERSION` is a runtime JS constant only known after `common.js` itself loads -- the one tag most likely to be served stale otherwise. External CDN/font URLs (jsDelivr, Google Fonts) are pinned upstream and left untagged. A new `asset-version-check` CI job (`tests/ci/asset-version-check.test.js`) keeps the ~30 tags in sync with `js/common.js`'s `VERSION`, failing the PR if a bump leaves any tag stale or a new asset tag ships without one.

### Frontend

- **Immolation home/officer pages no longer time out (#426).** A team with no GAS deployment (`gasUrl:''`, as Immolation was created directly in Supabase) previously hit a 15s "Request timed out." on every load: `loadData()` unconditionally injected the core/heavy JSONP `<script>`s from the team's `gasUrl`, and an empty base URL made them resolve to the current page -- which loads as a script, never 404s (so `onerror` never fires), and never calls the roster callbacks, so `DATA` stayed null. `loadData()` now detects the empty `gasUrl` and builds `DATA` entirely from the existing `fetchSupabase*` reads instead, stubbing the GAS chunks with empty payloads. The page renders from whatever Supabase has for the team (empty roster/attendance until it's seeded) rather than hanging. The core/heavy overlay logic was extracted into shared `applyCoreData()`/`applyHeavyData()` helpers so the GAS and GAS-independent paths run identical merges, and the heavy fallbacks now default to empty objects so the write paths in `tab-bis.js`/`tab-priority.js` can't index `undefined`.

## [3.33.11] - 2026-07-11

### Frontend

- **Renamed the Scoring tab's "Commit to Scoring Sheet" button to "Commit Performance Scores" (#242).** It's been writing directly to `scoring.performance_score` in Supabase since #432 (#223 stage 2) -- the label and its help text (including the confirm-banner prompt) still described the old GAS behavior of copying a "Recent Score" spreadsheet column into a "Performance" column, which was actively wrong, not just stale phrasing. The Attendance tab's matching button was already renamed to "Commit Attendance Scores" in an earlier pass; this finishes the other half. Also fixed a handful of leftover "Scoring sheet"/"Commit Scores to Sheet" references in the Season Rollover Guide help card, `docs/officer-walkthrough.md`, and `README.md` that no longer matched the current button labels, and corrected stale wording claiming healers get an automatic WCL performance score (they're manual, same as tanks).

### Frontend

- **Officer-triggered WCL season performance fetch (#264).** Season History's most recently archived season now offers a "WCL Performance Baseline" fetch: pick a raid tier from that season, pull each DPS roster player's best character-page performance average from WarcraftLogs (whichever difficulty they actually logged highest -- mythic if any, heroic otherwise, matching the character page's own "Highest Difficulty" filter), and write it to `player_wcl_season_perf` (new `fetchSeasonPerf` action on the `wcl-sync` Edge Function). Tanks/healers are excluded, same as every other WCL-derived performance path in this app -- their score is always officer-set. Queries each character directly by name/realm/region rather than through WCL guild membership -- live testing against the real Phoenix roster found guild membership silently misses real players currently tagged to a different guild on WCL's side (a large parent/community guild rather than the specific raid-team guild `teams.wcl_guild_id` points at), so a per-character lookup is what actually reaches everyone.
- **Seeds `scoring.performance_score` for the new season from that fetch (#394-lite).** Before this, heroic priority generation had nothing to read until an officer ran a real "Commit Performance Scores" pass against current-season raid reports -- now the fetch above also seeds a starting number per player, but only for players with no `scoring` row yet this season (`ignoreDuplicates: true` upsert), so it can never clobber a real commit. No blended/weighted formula between previous-season baseline and current-season data -- that's deliberately deferred; this is a one-time fallback that real commits simply overwrite once they happen.
- The raid-tier picker dedupes by WCL zone rather than listing every raid-progression entry -- a season with multiple separate raid releases can still have WCL scope its rankings to one season-wide zone spanning all of them (confirmed live on a real season with 3 raids sharing one zone), so listing each entry separately offered 3 options that silently returned identical data under different labels.

## [3.33.9] - 2026-07-11

### Frontend

- **Removed the dead "Sync % to Roster Sheet" button (#419 follow-up).** Left over from before #434 (#223 stage 3) moved the roster table's Attendance % column onto Supabase -- the button pushed computed percentages into the old GAS Roster sheet, which the roster view stopped reading once that migration shipped, but nobody removed the button itself. Already flagged as legacy in its own help text; now the button, its `syncAttendancePct()` handler (`js/tabs/tab-season.js`), and the matching GAS action (`gs/wgaWebApp.gs`) are gone.

## [3.33.8] - 2026-07-11

### Frontend

- **Discord bot notifications off Apps Script (#224).** Signup, self-received-loot, BiS-link, and M+ exclusion notifications now post through the new `discord-bot-webhook` Edge Function instead of GAS's `sendToBot()`. Fixes a silent regression from Phase 5: self-received/BiS/M+ exclusion stopped notifying the bot entirely once their write paths moved to Supabase RPCs with no GAS relay (only signup's stopgap relay in `js/signup.js` still worked) -- all four now notify again, and signup's relay is replaced with a direct Edge Function call rather than generalized. `js/common.js`'s `submitSelfReceivedRequest`/`submitBiSForm`/`submitMPlusExclusionForm` each fire a best-effort `discord-bot-webhook` call after their RPC succeeds (self-received only when not auto-approved, matching GAS's prior behavior).
- **Removed the Admin tab's Bot Config sub-tab.** Bot URL/secret now live in Supabase Edge Function secrets (`BOT_WEBHOOK_URL_<TEAM>`/`BOT_WEBHOOK_SECRET_<TEAM>`), which aren't writable from a running web app -- unlike GAS Script Properties, there's no API for the app to change them, so the in-app "type a value, click Save" form could no longer do anything real. Changing them now happens in the Supabase dashboard. The Properties sub-tab's Bot URL/Secret rows are also gone, and `getAdminProperties`/`setBotUrl`/`setBotSecret` are dropped from `gs/wgaWebApp.gs`.

### Backend

- **Grants base DML privileges to `service_role`** (#332): the baseline schema pull granted `service_role` only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN on every table, never SELECT/INSERT/UPDATE/DELETE, mirroring the gap #312 fixed for `anon`/`authenticated`. `service_role` bypasses RLS but not base grants, so a service-role write would have failed with permission denied before RLS was ever consulted -- nothing hit this yet since no Edge Function currently uses the service-role key, but it would have broken the first one that did. Also grants sequence USAGE, the second half of the same gap #383/#384 found for `anon`/`authenticated`.

## [3.33.7] - 2026-07-11

### Frontend

- **WCL sync off Apps Script, stage 3 of 3 -- final stage (#223).** The Attendance tab's "Refresh from WCL" now calls the `wcl-sync` Edge Function's new `refreshAttendance` action, writing directly into `attendance` (source='WCL'/'Auto (Bench)') instead of GAS's Attendance sheet. This also unblocks the Manage grid's read side, which was explicitly waiting on this stage (`js/tabs/tab-attendance.js`'s old #218 comment) -- `getAttendanceGrid` now queries `attendance` directly, grouping rows by raid night and filling in blank/no-status entries for any roster player without a row yet so officers can still fill gaps in from the grid. "Commit Attendance Scores" is a direct client read+aggregate+write into `scoring.attendance_score`/`attendance_pct` (no WCL secret needed, same reasoning as stage 2's commit), with a session-only manual-edit flow -- no more round trip to a GAS cell nothing ever read back.
- **Roster attendance %, the Scores sub-tab's "below threshold" list, and the bench-fairness trend now also read from Supabase** (`DATA.rawAttendanceData`/`attendanceDetails`/`recentAttendanceTrend`, `js/common.js`) instead of GAS's heavy payload -- those were built by reading the same Attendance sheet the refresh above stops writing to, so leaving them GAS-sourced would have made every attendance display in the app freeze the moment this shipped. Falls back to the GAS heavy payload only if the Supabase query itself fails, not merely because it's empty (Supabase is authoritative for attendance from here on).
- Extended Leave (a status already present in `attendance`'s schema but never given a GAS weight) counts as full credit (1.0), same as Present/Bench/Medical Leave.
- Both "Refresh from WCL" buttons (Attendance and Scoring) now show an indeterminate progress bar (`.wcl-progress-bar`, `css/styles.css`) while the request is in flight -- these are single request/response Edge Function calls with no real progress to report, so this is "still working" feedback, not a completion percentage.

### Backend

- **Adds `attendance.source`/`attendance.report_title`** (#223): `source` (WCL/Officer/Auto (Bench)) is what lets a refresh tell which existing rows are safe to overwrite vs. an officer's manual edit, mirroring the column GAS's Attendance sheet used for the same purpose. `report_title` is a nullable per-row echo of the WCL report title, purely so the night-selector shows something more useful than a bare date. `report_id` (added in stage 1, never actually written until now) is also now populated, and used as the incremental-refresh cache key.

## [3.33.6] - 2026-07-11

### Frontend

- **Fixed audit log layout drift between `admin.html` and `officer.html`.** `.admin-page`'s max-width (1100px) had fallen out of sync with `#officerView`'s (1600px), so the site-admin Audit Log rendered noticeably narrower than the officer dashboard's despite sharing the same table markup/CSS -- now matched exactly (max-width and padding). Also centered the Detail column (`.audit-table td:last-child`, `css/styles.css`) on both pages, which had been left-aligned while every other column in `.roster-table`-based tables centers by default.

## [3.33.5] - 2026-07-11

### Frontend

- **WCL sync off Apps Script, stage 2 of 3 (#223).** The Scoring tab's "Refresh from WCL" now calls the `wcl-sync` Edge Function's new `refreshPerformance` action instead of GAS's `refreshWclPerformance`, using the same per-team `wcl_guild_id` and forwarded-JWT auth pattern stage 1 established. The "Commit" and manual-score-edit steps, however, move to **direct Supabase writes from the client** rather than more Edge Function actions -- GAS's `setManualScore`/`commitPerformanceScores` only ever wrote to sheet cells the app never read back (the frontend has always sourced its state from a `sessionStorage` cache of whatever `refreshWclPerformance` returned), so there was no server-side "draft" to actually replace. Manual edits (including "use best score") now update the cached score array synchronously with no network round trip; "Commit" upserts straight into `scoring` (`recent_score`/`trend_score`/`best_score`/`performance_score`) via the same officer-RLS + `writeAuditLog()` pattern every other officer write in this app already uses (e.g. `js/tabs/tab-attendance.js`'s attendance status writes). Also fetches each report's WCL rankings once instead of GAS's up-to-3x redundant refetch across the overlapping recent/trend/best windows, to stay well inside the Edge Function's execution limit.

## [3.33.4] - 2026-07-11

### Frontend

- **First piece of WCL sync off Apps Script (#223, stage 1 of 3).** Season Settings' raid progression picker ("List Encounters"/"Fetch from WCL" on each raid card) now calls a new `wcl-sync` Supabase Edge Function instead of GAS's `getWclZoneEncounters`/`fetchWclProgression` actions. Read-only, no Supabase writes -- chosen as the first stage specifically to validate the new Edge Function scaffolding, auth pattern, and secrets access with minimal risk before the larger write-heavy stages (WCL performance scoring, attendance sync) build on top of it. No service-role key: the function forwards the caller's own session JWT (auto-attached by `supabase.functions.invoke()`), so RLS/`my_team_role` gate everything exactly like every other direct-write call site in this app already does -- the only real secret is `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET` (kept off the client, already configured per #205). Response shapes are unchanged (`{zoneName, encounters}` / `{success, bosses, aotcDate}`), so the rest of the raid-progression UI needed no changes.

### Backend

- **Adds `supabase/functions/wcl-sync/index.ts`** (first Edge Function in this repo) and **`teams.wcl_guild_id`** (#223): a nullable per-team column, since GAS hardcoded this per-deployment (`gs/Config.gs`, Phoenix's guild only) but the new Edge Function is one shared multi-tenant function. Set directly via the SQL Editor for now, same as every other one-off admin value in this schema -- Hellfire's guild ID still needs to be backfilled before its raid progression picker will work end-to-end.

### Frontend

- **Per-team feature flags now actually do something (#231).** #232 already built the storage (`team_settings.config.features`) and a site-admin cross-team toggle grid, but nothing in the app read the flags -- toggling one had zero visible effect. Two things land together: a team-leader self-serve toggle panel (new "Feature Flags" sub-tab on the officer dashboard's Admin tab, `js/tabs/tab-admin.js`, same `saveTeamSetting()`/`set_team_setting` write path #232's grid uses -- no new backend), and the actual gating logic. `js/common.js`'s `applyTeamSettingsToData()` now stashes `config.features` onto `DATA.features`; a new `featureEnabled(key)` helper (missing key/object reads as enabled, same fallback `js/admin.js` already used) is the single source of truth both officer.html and index.html check. **loot** hides the Loot tab's Import/History sub-tabs, the Received Item Requests nav-item, and the public self-received request form -- the Loot nav-item itself only fully disappears if `fairness` is also off, since Loot Fairness lives inside that same tab. **priority** hides the Priority nav-item. **bis** hides the BiS Manager nav-item and the profile card's BiS Link/BiS List sections (form and read-only display alike). **scoring** hides the Scoring nav-item (there's no separate WCL score display elsewhere to gate). **mplus** hides the M+ Exclusions nav-item and the profile card's M+ Exclusion section. **fairness** hides the Loot tab's Fairness sub-tab and the Attendance tab's Bench Fairness sub-tab. **bench** hides the per-player bench toggle button on the roster profile card (the read-only Bench status tag/roster grouping stay, since a team simply never sets `isBench` if unused). `resetLootSubTab()` now picks a visible default sub-tab instead of hardcoding Import, so a team with only Fairness enabled doesn't land on a blank hidden panel; `applyFeatureFlagVisibility()` also bounces off a tab the user is currently on if it just got hidden by a live toggle.

## [3.33.2] - 2026-07-11

### Frontend

- **Site-wide maintenance mode (#245).** A new Maintenance tab on `admin.html` lets a site admin flip a toggle (with an optional custom message) that immediately blanks both `index.html` and the officer dashboard (`officer.html`) with a "Down for Maintenance" banner, checked before any data loads or login prompt shows -- `js/roster.js` and `js/officer.js`'s boot sequences now gate everything behind a `checkMaintenanceMode()` call in `common.js`. `admin.html` itself is never blocked (it doesn't include `common.js` at all, by the same standalone design from #232), so the toggle can always be turned back off. Every toggle writes to the cross-team Audit Log (`maintenance_mode_enabled`/`maintenance_mode_disabled`, with the message in Detail).

### Backend

- **Adds `site_settings` (singleton) and `admin_set_maintenance_mode()` (#245)**: a fixed id=1 row (`maintenance_mode boolean`, `maintenance_message text`) with public SELECT (every page, including anonymous visitors, needs to read this before anything else loads) and no write policy at all -- `admin_set_maintenance_mode()` (`SECURITY DEFINER`, gated on `is_site_admin()`) is the only write path, same shape as `bis_requests`/`self_received_requests`. Updates `docs/RLS.md` and `tests/rls/` (a new `maintenance-mode.test.js`, plus `site_settings` added to the public-read matrix) since this is the first genuinely new RLS policy since #232 started (public SELECT + a `claude_readers` policy).

## [3.33.1] - 2026-07-11

### Frontend

- **New standalone site admin dashboard: team management, site admin grant/revoke, cross-team feature flags, and a cross-team audit log (#232).** `admin.html` + `js/admin.js` -- not tied to any team, gated on the existing `is_site_admin()` RPC (Discord login required; non-admins see a denied screen). Organized as four tabs using the exact same `.nav-item`/`.tab-panel`/`switchTab()` setup as the officer dashboard (`officer.html`/`js/officer.js`), so it reads as the same app rather than a bolted-on page. Teams tab lets a site admin create a team, edit its name/slug, and archive/unarchive it, without switching into a specific team's officer dashboard. Deliberately standalone rather than reusing `common.js`/`discord.js`: both are built around a single active team (`_teamCfg`, `TEAM_SLUG`-keyed session storage), which doesn't fit a page with no team context. Site Admins tab lists current site admins (Discord display name once they've logged in at least once, otherwise their raw Discord user ID) and lets a site admin grant access by Discord user ID or revoke it. Grant resolves `auth_user_id` immediately when the account has already signed in before (matched by Discord snowflake, same lookup `link_auth_user_to_member()` uses); a brand-new grant with no matching login yet is backfilled automatically the first time that account signs in, same as officer links. Revoke is blocked server-side if it would leave zero site admins, so the dashboard can't be locked out from itself. Feature Flags tab is a per-team flag grid (Loot/Priority/BiS/Scoring/M+/Fairness/Bench) covering every team at a glance, matching #231's `team_settings.config.features` schema; toggling a checkbox writes immediately via the existing `set_team_setting` RPC (no new write path needed -- its RLS access rule already allows `is_site_admin()` cross-team, not just a team's own `team_leader`). A missing `features` key, or a missing flag within it, reads as enabled, since no team's webapp checks these yet and every existing team has no `features` key at all -- unset has to mean "on" or this tab would dark every feature for every team the first time it saves. Audit Log tab is a cross-team audit log (adapted from the officer dashboard's `js/tabs/tab-audit.js`), with a team filter (All Teams / Site-level / a specific team) and the same search-by-officer/action/target/detail box; no new read path needed either -- `audit_log`'s existing "Officers read audit_log" access rule already lets `is_site_admin()` through with no `team_id` restriction, the per-team officer tab just never exercises that branch. Detail rendering (both here and, now, the officer dashboard's own audit tab) handles the plain-string convention older write paths use as well as jsonb objects, humanized rather than dumped raw -- `{"features":{"bench":false}}` reads as "Bench: Off": nested objects flatten to their leaf key/value pairs (dropping the uninformative parent key), keys title-case (`bis`/`mplus` overridden to "BiS"/"M+"), and booleans render as On/Off. Matches `officer.js`'s `switchTab()` in one more way: each tab's data refetches on every switch (not just once at login), so a change made on one tab (a flag toggle, say) shows up immediately on Audit Log rather than only after a full page reload. **Known limitation**: `TEAMS` (`js/common.js`) is still a hardcoded per-team config (`gasUrl`/`officerPass`/`supabaseTeamId`) that the rest of the site reads from -- a team created here won't get a working officer/public dashboard until a `TEAMS` entry is added by hand. Closing that gap is follow-up work, not in scope for this stage.

### Backend

- **Adds `teams.archived_at`, `site_admins` grant/revoke/list RPCs, and team CRUD RPCs (#232)**: `admin_create_team`/`admin_update_team`/`admin_set_team_archived` and `admin_grant_site_admin`/`admin_revoke_site_admin`/`admin_list_site_admins`, all `SECURITY DEFINER` and gated on `is_site_admin()`, following the same definer pattern as `write_audit_log()`/`claim_character()`. Neither `teams` nor `site_admins` has a direct client write grant -- these are that write path, and every call writes an `audit_log` row via `write_audit_log()`. `admin_create_team` also inserts a default `team_settings` row for the new team, since every other write path (`set_team_setting`, `fetchSupabaseSettings`) assumes one already exists. `audit_log.team_id` is now nullable -- site admin grants aren't scoped to a team, and `write_audit_log(null, ...)` already reads as site-admin-only under the existing "Officers read audit_log" access rule (`my_team_role(null)` resolves to no row) with no rule changes needed. No new write path for feature flags -- reuses `set_team_setting`, whose access rule already covers `is_site_admin()` cross-team. `set_team_setting` itself now calls `write_audit_log()` on every save (`team_setting_updated`) -- previously no `team_settings` write left any audit trail at all, site admin or team leader alike, so a site admin toggling a team's feature flags (or a team leader editing season settings) was invisible. Detail is a diff of old config against the merged result, one level deep, not the raw `p_updates` -- the jsonb `||` merge is shallow, so a single-flag toggle has to resend the whole 7-key `features` object every time to avoid wiping out the other flags, and logging that verbatim would show all 7 on every save instead of just the one that changed. A no-op save (re-sending values that already match) skips logging entirely rather than writing an empty row.

## [3.33.0] - 2026-07-11

### Frontend

- **The Admin tab now honors the officer/team-leader split the RLS policies already enforce (#317).** Team leaders (Discord login, `team_members.role = 'team_leader'`) now see the Properties, Bot Config, and Officers sub-tabs plus Clear Season History in the Danger Zone -- previously they got only the Officers sub-tab, even though the `team_settings` and `season_snapshots` policies already accept them. Data Export and the seven sheet-wipe danger ops stay site-admin only ("no change intended there" per the #294 decision), and plain officers still see no Admin tab. The sub-tab map lives in a new `adminSubTabVisibility()` (`js/tabs/tab-admin.js`) that both `showAdminTab()` (`officer.html`) and the landing-sub-tab pick share, and `renderDangerZone()`/`executeDangerOp()` filter ops through `visibleDangerOps()`. The internal access level string `'officers'` was renamed to `'team_leader'` since it now grants more than the Officers sub-tab. UI-only change: the visibility filter is not a security boundary (RLS is, where Supabase backs the write).

## [3.32.14] - 2026-07-10

### Frontend

- **Season codes translate automatically for every future season, not just `MID1` (#341).** `seasonDisplayName()`/`seasonCodeForDisplay()` (`js/common.js`) now derive `MID2`, `MID3`, etc. <-> `Midnight Season 2`, `Midnight Season 3`, etc. from a pattern instead of requiring a hardcoded `SEASON_LABELS` entry per season -- the previous single-entry map would have silently mistranslated (or failed to translate) every season after the first until someone remembered to add it. `SEASON_LABELS` survives as an explicit override for anything that doesn't fit the pattern. Even the `MID`/`Midnight Season` prefixes themselves are no longer hardcoded: a new "Season Code Prefix" field in Season Settings (`team_settings.config.seasonCodePrefix`/`seasonDisplayPrefix`) lets officers repoint the pattern at a new expansion's naming without a code change, defaulting to today's values when unset.

## [3.32.13] - 2026-07-10

### Frontend

- **Unified the two "Copy Priority Export" entry points onto one data source (#408).** The Priority tab's Generate/Regenerate button (`js/tabs/tab-priority.js`, #335) already called the `build_rclc_export` Supabase RPC (live `bis_items`/`priority_order` data); Quick Actions' "Copy Priority Export" button (`js/officer-quick-actions.js`, on the public page) still called the GAS `getExportString` action, which recomputed from the Google Sheets "BiS List"/"Priority Order" tabs -- both of which stopped being the live data source once the BiS List Editor (#391/#393) and priority generator (#220) migrated to Supabase. Whichever button an officer reached for first determined whether the export reflected current reality or a stale spreadsheet snapshot. Quick Actions now calls the same RPC; the shared UTF-8-safe base64 encoding step (`_utf8ToBase64`, #360) moved from `tab-priority.js` to `common.js` so both pages can use it.

## [3.32.12] - 2026-07-10

### Frontend

- **Wired player rename and officer notes to Supabase (#407).** `renamePlayer` and `savePlayerNote` (`js/tabs/tab-roster.js`) were the last two officer roster writes still GAS-only -- renaming updated only the GAS Roster sheet, and officer notes lived in a GAS Script Property keyed by name-realm. Both now write straight to `players` (rename updates `name_realm` in place by `id`, so historical `rclc_loot`/`bis_items`/`attendance` rows stay linked; notes use the new `players.officer_notes` column, see Backend). `officer_notes` is now part of the roster's normal Supabase read (`fetchSupabaseRoster`), replacing the separate `DATA.playerNotes` GAS map. Renaming now triggers a full data reload (rather than patching the roster row in place) so the profile card's Items Received/BiS List -- both keyed client-side by name -- resolve correctly under the new name instead of staying blank until a manual page reload. **Known gap, tracked as #419**: the roster table's summary Attendance % is still a name-matched merge from the GAS Roster/Attendance sheet (not yet migrated, #218), so it goes stale for a renamed player until that sheet's own name is corrected too -- the player detail card's real per-night attendance (Supabase, linked by id) is unaffected.

### Backend

- **Adds `players.officer_notes` (#407)**: #407's premise -- that this column already existed in the schema but was simply unused -- was wrong. The column that actually exists is `mplus_exclusion_requests.officer_notes`, a different table; `dbdoc/public.players.md`'s relations diagram embeds that table's full column list next to `players`' own for the FK diagram, which is what got misread as a `players` column, both when the issue was filed and when this fix's PR first shipped without the column. Confirmed against the live database only after roster loads started failing with `column players.officer_notes does not exist`.

## [3.32.11] - 2026-07-10

### Frontend

- **Fixed BiS list editor rejecting real items for Hands/Waist/Feet/Weapon/Off Hand (and, less visibly, Shoulder/Back/Wrist/Finger).** `BIS_CATALOG_SLOT_TO_ROWS` (`js/tabs/tab-bis.js`) mapped a slot vocabulary (`Hands`/`Waist`/`Feet`/`Two-Hand`/`One-Hand`/`Ranged`/`Off Hand`) that never matched what `items.slot` actually stores -- confirmed against the live table, which uses `Gloves`/`Belt`/`Boots`/`Bracers`/`Cloak`/`Shoulders`/`1H/2H`/`OH` (the literal values the Item Lookup sheet's "slot" column uses). Only `Head`/`Neck`/`Chest`/`Legs`/`Trinket` happened to match by coincidence, which is why those slots worked while the rest only ever offered the M+/Crafted/Catalyst placeholders in the item search. `getSlotColor` (`js/common.js`) had the same wrong vocabulary baked in, silently graying out slot-color coding on the Priority and Conflicts tabs and player profiles for the same items; extended it to recognize both vocabularies.
- **Zebra-striped the BiS list editor's slot rows** -- with every row the same bordered box and background, a dense 16-slot list was hard to scan row-to-row; alternating rows now get a faint background tint.

## [3.32.10] - 2026-07-10

### Frontend

- **Wired self-received loot requests to Supabase (#406).** `self_received_requests` already had "Officers read/update" RLS in place and fit the live feature's fields exactly (`track`/`source`/`note`) -- it just never had an INSERT path or any frontend reference, so raider submission, officer approve/reject, and officer direct-mark were all still GAS-only. Adds `submit_self_received()` and `direct_mark_received()` (both SECURITY DEFINER, since request tables have no INSERT policy for anyone, officers included), moves the officer Requests tab onto direct Supabase reads/updates, and switches a player's approved self-received items to a Supabase-sourced read with the Apps Script heavy chunk as fallback. The GAS auto-approve-on-matching-Discord-session check is replaced with a real `auth.uid()` lookup through `players.team_member_id -> team_members.auth_user_id`, now that #222 has login itself on Supabase Auth -- no more trusting a client-supplied legacy session token.

### Backend

- **New `submit_self_received()`/`direct_mark_received()` RPCs (#406)**: both SECURITY DEFINER, since `self_received_requests` allows no direct INSERT for anyone, officers included. `submit_self_received()` is granted to `anon`+`authenticated` (raider submission) and auto-approves when the caller's linked character matches the one submitted for; `direct_mark_received()` is granted to `authenticated` only and checks the officer/team_leader/site_admin role in the function body.
- **Site admins can now read/update the four request tables cross-team (#413)**: `season_signups`, `bis_requests`, `mplus_exclusion_requests`, and `self_received_requests` were the only officer-scoped tables missing the `OR is_site_admin()` clause every other one already has (`audit_log`, `team_members`, `team_settings`, `season_snapshots`). A site admin who isn't personally an officer/team_leader on a given team saw zero rows in these four for that team -- found while verifying #403's historical Hellfire signup backfill actually landed (it had; the officer viewing it just wasn't a `team_members` row on that team).

## [3.32.9] - 2026-07-10

### Frontend

- **Fixed Pending Roster card layout and Trial defaulting.** The card header's `justify-content:space-between` (shared with the Signups tab, which has no selection checkbox) spread the checkbox/name/badges across the row once a checkbox was added for the selection-based push feature, leaving the name visually adrift from the class/spec line below it -- grouped checkbox+name+New/Update badge into one flex item so they stay clustered at the left edge. The `Trial` checkbox also no longer defaults on for every card: roster signups are normally returning raiders re-upping for next season, not new recruits, so it now defaults on only for genuinely new characters (and off for main-swap signups, which are always a returning raider under a new name even when the name itself is new to the roster).

## [3.32.8] - 2026-07-10

### Frontend

- **Wired the M+ exclusion request/approval flow to Supabase (#405)** -- `submitMPlusExclusion`/`getMPlusExclusions`/`approveMPlusExclusion`/`rejectMPlusExclusion`/`setMPlusExcluded`/`clearAllMPlusExclusions` were still 100% GAS despite `mplus_exclusion_requests` existing since day one; the roster's `mPlusExcluded`/`mPlusNote`/`mPlusRejected`/`mPlusRejectionNote` fields all still came from the GAS core payload. Raider submission now calls the new `submit_mplus_exclusion` RPC; the manual roster toggle and bulk-clear write `players.m_plus_excluded` directly; the pending-request nav badge switched to Supabase.
- **Approve now sets the roster's exclusion flag directly**, instead of only marking the request approved and leaving a separate manual toggle for the officer to remember (GAS's actual behavior -- an approved request could sit approved without the player ever actually being excluded). Reject leaves the request rejected; the raider's "Rejected" badge is derived live from the most recent rejected request per player rather than a persisted column, since `players` has no rejection-state columns of its own.

### Backend

- **New `submit_mplus_exclusion` RPC**: SECURITY DEFINER, granted to `anon` (same trust model as the GAS action it replaces -- submission runs unauthenticated on the public roster page). Re-validates `mPlusExclusionsOpen` server-side. No schema changes needed otherwise -- `mplus_exclusion_requests` already fit the feature exactly, unlike `bis_requests` (#404).

---

## [3.32.7] - 2026-07-10

### Frontend

- **Wired the BiS link submission/approval flow to Supabase (#404)** -- `submitBiS`/`getPendingBiS`/`approveBiS`/`rejectBiS`/`updateBisLink`/`allowBisForPlayer`/`revokeBisForPlayer` were still 100% GAS despite `bis_requests` existing in Supabase since day one; a freshly-approved link never reached the roster's Supabase-sourced `players.bis_link` read. Raider submission now calls the new `submit_bis_link` RPC; officer approve/reject and manual link edits write `bis_requests`/`players` directly (existing officer-write RLS already covered both). The pending-BiS nav badge also switched to Supabase.
- **Per-player BiS submission gating moved to `players.bis_allowed`** (a boolean column) instead of a GAS Script Property array, so `allowBisForPlayer`/`revokeBisForPlayer` stay usable by any officer -- routing it through `team_settings`/`set_team_setting()` instead would have restricted the toggle to team leaders only.
- Moved `findRosterPlayerByNameRealm()` from `js/signup.js` (index.html-only) to `js/common.js` (loaded on both pages), since the BiS toggle on officer.html now needs it too.

### Backend

- **Repurposed `bis_requests` (#404)**: dropped `bis_req_item_id` (a mandatory FK to `items` that never fit this feature -- the live flow submits a whole BiS list URL, not a per-item request) and added `bis_link text not null`/`player_note text`. Table had zero rows and zero references anywhere, confirmed before altering.
- **New `submit_bis_link` RPC**: SECURITY DEFINER, granted to `anon` (submission runs unauthenticated on the public roster page, same trust model as the GAS action it replaces). Re-validates the submission gate server-side (`bisSubmissionsOpen` team-wide or the player's own `bis_allowed`) rather than trusting the client's decision to show the form.
- Added `players.bis_allowed boolean not null default false`.

---

## [3.32.6] - 2026-07-10

### Frontend

- **Fixed the public signup form writing to a Sheet no officer screen reads (#403)** -- since the officer Signups/Pending Roster tabs switched to Supabase-only reads in #328, `submitSignup` kept writing exclusively to the GAS "Roster Responses" Sheet, so every real signup submitted since then was invisible to officers. `js/signup.js` now calls the new `submit_season_signup` RPC as the write of record; the existing GAS `submitSignup` call is still fired afterward, unchanged, purely for its Discord bot notification side effect (#224 will move that to an Edge Function). The free-text "Discord Name" field is dropped from the form per the #340 decision -- the verified Discord link now lives on `team_members` via the Claims flow. `getMissingSignups`/the signups+pendingRoster nav badge counts also switched from the orphaned GAS sheet to Supabase (`season_signups`/`pending_roster`/`DATA.roster`).

### Backend

- **`submit_season_signup` RPC (#403)**: SECURITY DEFINER, granted to `anon`, gated on `team_settings.config.signupsOpen` -- season_signups had no INSERT path of any kind before this (officer read/update only).
- **One-time historical backfill (#403)**: ~21 real MID2 signup rows recovered from Hellfire's GAS "Roster Responses" sheet into `season_signups`, so the officer Signups tab isn't blank post-cutover. Two approved-but-never-rostered rows (`Dhbruh-Dalaran`, `Poplockndots-Thrall`) land as `status = 'approved'` so they surface in Pending Roster for an officer to act on.

---

## [3.32.5] - 2026-07-10

### Frontend

- **Retired the dead GAS Discord OAuth code path (#222, Phase 6)** -- `discordTokenExchange`/`discordApiGet`/`discordOAuthCallback`/`generateSessionToken` (and the `discordCallback` action that called them) read `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` from Script Properties to mint a `discordSession_*` token, but nothing has called that route since `discord-callback.html` was deleted when login moved to Supabase Auth's Discord provider (#363) -- confirmed via a full grep of `js/` and every `.html` page for any reference to `discordCallback`/`discord-callback.html`, found none. `validateDiscordSession`/`claimCharacterForSession` and their routes are left in place (they don't read either secret, and `resolveChangedBy()`/`requestSelfReceived`'s `sessionToken` param still call `validateDiscordSession` for any pre-#363 session that might still be live) -- only the code that actually read the two Script Properties is removed. `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` still need to be deleted from the Apps Script project's Script Properties by hand (a separate store from Supabase, no CLI/SQL path to it). `WCL_CLIENT_SECRET` and `BOT_WEBHOOK_SECRET` stay in Script Properties -- they're still the live path for WCL sync and bot notifications; their Edge Function replacement is Phase 7 ("Integrations"), not yet built, despite the values already sitting dormant in Supabase's Edge Function secrets vault since Phase 1.

---

## [3.32.4] - 2026-07-10

### Frontend

- **Season config migrated off Apps Script Script Properties, onto Supabase (#221, Phase 6)** -- the Season tab (name/start/end dates, trial promotion thresholds, raid progression, archive/unarchive) and the Signups/BiS/M+ Exclusions open-closed toggles now read from and write to `team_settings.config` instead of Script Properties. Archiving a season now embeds the roster snapshot (nameRealm/role/isTrial/isBench/joinDate/attendance, computed client-side same as always) directly on the `seasonHistory` entry instead of a separate `rosterSnapshot_<timestamp>` Script Property, so "View Roster" on an archived season renders instantly with no round trip. The Admin tab's Properties Inspector now shows these same fields from `DATA`; Bot URL/Secret stay on the Apps Script `getAdminProperties` action (#222 scope). Both live teams' current Script Properties values need a one-time backfill into `team_settings.config` via the Supabase SQL Editor before this ships live -- see the PR description.
- **Fixed: `write_audit_log` 400 on every season/toggle save (#221 follow-up)** -- caught during manual verification. These new call sites passed `''` for `p_target_id` (there's no specific record ID for a team-level setting), but that column is an `integer`, and Postgres rejects casting an empty string -- every save silently failed to log while still succeeding at the actual write. Now passes `null` for both `targetType`/`targetId` on all seven call sites, matching how other id-less audit entries are logged elsewhere.

### Backend

- **`set_team_setting`/`archive_current_season`/`unarchive_season` (#221)** -- three new `SECURITY INVOKER` RPCs on `team_settings`. All three rely entirely on the existing "Team leaders write settings" RLS rule (unchanged) for authorization -- a caller without team_leader/site_admin gets a clear "Not authorized" exception rather than a silently-discarded write, since a plain `update ... returning x into v` with 0 rows affected otherwise leaves `v` NULL with no error raised.

---

## [3.32.3] - 2026-07-10

### Frontend

- **Manual attendance entry from the player detail panel (#241)** -- the officer roster tab's player-profile Attendance history card previously could only edit a raid night the player already had a row for; if a player was added mid-season and had zero attendance rows at all, it just showed "No attendance records found" with no way to create one. The card now always shows an **Add raid night** control (date + status dropdowns, reusing the same `attendance` upsert + `write_audit_log` shape `saveAttendanceFromCard` already established) offering every team raid date the player has no row for yet, on or after their join date. Adding a player with a join date also now bulk-writes `Not on Roster` for every earlier raid night the team has any attendance row for, so a mid-season add doesn't leave the whole pre-join history blank/editable -- those nights display read-only, matching how an existing `Not on Roster` row already rendered. Existing rosters added before this ships aren't backfilled retroactively; only new adds going forward get it.
- **Attendance history card now reads from Supabase, not Apps Script (#241 follow-up)** -- caught during manual verification: `getPlayerAttendanceFull` (the card's read source since before #218) reads the Attendance Google Sheet, which has no visibility into writes this card -- or the pre-existing per-row edit dropdown, live since #218 -- make straight to Supabase. A saved change reverted on the next page load because the Sheet-sourced read never saw it, for both the new "add" feature and the older edit path. `loadAttendanceHistory` now queries `attendance` directly (the full historical CSV import in #320 already backfilled it, so an empty result means the player genuinely has none), falling back to the old GAS action only on a query error, the same convention as the roster/BiS/priority_order reads migrated earlier in Phase 5.

---

## [3.32.2] - 2026-07-10

### Frontend

- **RCLootCouncil priority export string migrated to Supabase (#335, Phase 5)** -- the Priority tab's Generate/Regenerate button now calls the new `build_rclc_export()` RPC and base64-encodes the JSON client-side, instead of reading a value cached from a Google Sheets custom menu action (`exportPriorityData()`) that no longer has a home once Sheets is retired. The `players` object is unchanged in shape; `priority` is a new shape, `{ [wow_item_id]: { H: [...], M: [...] } }`, split by `priority_order.track` instead of GAS's single flat per-item list -- the old sheet never distinguished Heroic/Mythic priority, but merging both into one list risked surfacing a Mythic-only-ranked player during a Heroic award (or vice versa). The companion addon, `RCLootCouncil_PriorityLoot` (separate repo), reads the raid's live difficulty via `GetInstanceInfo()` at vote/award time to pick the right track -- see that repo's own changelog for the corresponding update. The "no export string found, run the spreadsheet menu action" empty state is gone; generation is now always live.

### Backend

- **`build_rclc_export(p_team_id, p_season)` (#335)** -- new `SECURITY INVOKER` RPC building the export payload from `bis_items`/`priority_order`/`items`/`players` directly. Slot key for the `players` object prefers `bis_items.slot` (the BiS Manager's 16-slot grid override, #320) and falls back to `items.slot` for legacy rows, defaulting to the first numbered row (ring1/trinket1) for the Finger/Trinket ambiguity that column can't resolve either. Rows on a placeholder item (M+/Crafted/Catalyst, no `wow_item_id`) are excluded -- RCLootCouncil needs a real item id to award against.

---

## [3.32.1] - 2026-07-10

### Frontend

- **Selection-based push to roster for the Pending Roster tab (#273)** -- replaces the implicit "push everything" model with an explicit checkbox per pending card (unchecked by default) and a filter-aware **Select All** control, so an officer can push a chosen subset without deleting entries they don't want first. The **Add Selected to Roster** button loops `add_signup_to_roster()` once per checked signup, reusing each card's own trial-toggle/archive-picker values, and reports a per-batch summary (e.g. "8 of 10 added, 2 failed: ..."). A main-swap row with no archive target picked, or a server-rejected row, fails only that row without blocking the rest of the batch. Does not port the old GAS `pushPendingToRoster(removeAbsent)` roster-purge behavior -- no Supabase equivalent exists and it's out of the scope agreed on the issue.

---

## [3.32.0] - 2026-07-10

### Frontend

- **Officer signup review and Add to Roster UI migrated to Supabase (#328, Phase 5)** -- the Signups and Pending Roster tabs now read/write `season_signups` and the `pending_roster` view directly instead of the Apps Script payload. Approve/Deny update `status`/`reviewed_at`/`reviewed_by`/optional `signup_officer_note` under the existing "Officers update signups" RLS policy (Discord-logged-in officers now carry a `teamMemberId` in their session for this; password-only officers leave `reviewed_by` null, which the column allows). Pending Roster gets a new per-row **Add to Roster** control -- trial toggle (default checked) and, for main-swap signups, an old-character picker -- that calls `add_signup_to_roster()`. **Remove from Pending** now sets `status = 'rejected'` instead of deleting. The old bulk "Push to Roster" area is removed: it operated on Apps Script Sheets row indices, which don't exist in the signup_id-keyed Supabase data; #273 will build its per-row-selection replacement. GAS handlers (`getSignups`, `approveSignup`, `denySignup`, `getPendingRoster`, `removePendingRoster`, `pushPendingToRoster`) are left in place, unused, per the established Phase 5 retirement convention. The raider-facing signup submission form still writes to the Apps Script Sheet -- no Supabase INSERT path exists yet, so `season_signups` stays empty until that's built separately.

---

## [3.31.0] - 2026-07-10

### Frontend

- **New officer "Reports" tab, reading directly from Supabase (#227, Phase 5)** -- four sub-tabs, each backed by one of the new views below: **Raid Nights Since Last Item** (role and sort filter chips, plus severity coloring on the nights-since count scaled to the highest value currently shown, so the color bands stay meaningful as a season's raid-night count grows); **BiS Demand vs Awards** (season filter, ranks items by active-roster BiS demand next to how many times each was actually awarded); **Priority Order Health** (season filter, two panels -- "Stale Entries" for priority-order rows pointing at now-archived players, and "Missing From Priority Order" for active non-bench players absent from priority order entirely for a season); **Season Loot Pace** (season/track/slot filters, items awarded per week of season next to the same week in the prior season alphabetically). None of these have an Apps Script equivalent or fallback -- they only exist in Supabase.

### Backend

- **Four new officer report views (#227)**: `rnlsi`, `bis_demand_vs_awards`, `priority_order_stale_entries`, `priority_order_gaps`, `season_loot_pace` -- all `SECURITY INVOKER`, all built on the now-fully-migrated loot/attendance/BiS/priority tables (#216-#220). None take a season/team parameter (views can't be parameterized); each returns `team_id`/`season` as output columns for the caller to filter on. `season_loot_pace`'s "week of season" is proxied from the earliest tracked loot award per season, since there's no season-start-date column yet (that's #221's scope, Phase 6, not landed).

---

## [3.30.0] - 2026-07-10

### Frontend

- **Priority generator migrated to Supabase (#220, Phase 5)** -- the "Suggest Order" and "Save Priority" actions in the priority edit modal now call the new `generate_priority_order()`/`save_priority_order()` RPCs instead of the Apps Script `?action=generatePriorityOrder`/`?action=savePriorityOrder` endpoints. The blend the issue flagged as needing to be resolved first turned out not to be a live formula at all: it's the Scoring sheet's Weighted Total column, `=IFERROR(Performance*0.5 + Attendance*0.5, "")`, confirmed from the live cell formula -- the new RPC reads `scoring.performance_score`/`attendance_score` directly, exactly like the sheet does today. Role/status/item-ownership multipliers (bench/trial stacking, mythic/heroic "already has item" penalties and bonuses) are ported verbatim from `generatePriorityForItem()` (`gs/wgaWebApp.gs`) -- the web-app implementation, not the sheet-menu version in `gs/PriorityGenerator.gs`, which lacks the item-ownership penalties. The priority-order _read_ path (`DATA.priorityOrder`, used by the Priority List and Unmanaged Items tabs) now also reads directly from Supabase's `priority_order` table, with the Apps Script heavy chunk kept as a fallback if that query fails -- same pattern already used for `bis_items`/roster. GAS's `generatePriorityForItem`/`savePriorityOrderForItem` are left in place, unused, per the established Phase 5 convention of retiring GAS write handlers all at once once the whole migration finishes rather than per-issue.

### Backend

- **`generate_priority_order()`/`save_priority_order()` (#220)** -- new `SECURITY INVOKER` RPCs (RLS already grants officers direct read/write on every table touched, the same reasoning that moved `import_rclc_loot()` (#219) off `SECURITY DEFINER`). `save_priority_order()` fully replaces (delete+reinsert) any existing ranks for the given `(team_id, season, item_id, track)` in one transaction and writes exactly one `audit_log` entry per save. Note: `priority_order.track` uses `'Hero'`/`'Myth'` (#343's difficulty->track rename), not the `'Heroic'`/`'Mythic'` values the original issue text predated.

---

## [3.29.0] - 2026-07-10

### Frontend

- **BiS Manager editor redesigned around a fixed 16-slot grid instead of a search-then-add flat list (#393)** -- a BiS list only ever has one item per slot, so the editor now shows every slot (Head/Neck/Shoulder/.../Finger 1/Finger 2/Trinket 1/Trinket 2/Weapon/Off Hand) up front; an empty row gets a "+ Add" that opens a search scoped to items that actually fit that slot (plus M+/Crafted/Catalyst placeholders, always offered everywhere), a filled row shows its item with Obtained/remove inline. This replaces the 3.28.0 placeholder-only slot picker -- `bis_items.slot` is now set for every row added through the editor, real items included, not just placeholders, since "Finger"/"Trinket" alone can't say which of the two numbered rows a real ring or trinket is for either. Legacy rows added before this feature (no `bis_items.slot` recorded) fall back to a best-effort placement by their catalog slot; anything that still doesn't land in a row (unrecognised slot, or both numbered rows already taken) surfaces in an "Other" section below the grid so nothing silently disappears.
- **BiS editor rows are now bordered and zebra-striped** so each row's Obtained checkbox and remove button stay visually paired with its slot/item text across the empty space a wide panel leaves between them -- previously plain flex rows with no visual grouping, which got confusing once multiple rows could share the same item text (e.g. "M+" on both Finger slots).
- **`getSlotColor()`'s slot-name vocabulary corrected to match `items.slot`** (`js/common.js`) -- it was still checking the old GAS sheet's plural naming (`SHOULDERS`/`GLOVES`/`BOOTS`/`CLOAK`/`BRACERS`/`BELT`, `RING`), which never matched Supabase's singular `items.slot` values (`Shoulder`/`Hands`/`Feet`/`Back`/`Wrist`/`Waist`, `Finger`) seeded by `fetch-items.js` -- real armor pieces were silently rendering in the default text color instead of their role color. Found while building the slot grid, where the mismatch was immediately visible.

---

## [3.28.0] - 2026-07-10

### Frontend

- **Item catalog now reads exclusively from Supabase's `items`/`item_bosses` tables (#391)** -- the GAS "Item Lookup" sheet (`getItemSlots()`/`getItemArmorTypes()`/`getItemBosses()` in `gs/wgaWebApp.gs`) is retired as a data source for the web app. `scripts/fetch-items.js` already seeds `items`/`item_bosses` from Wowhead every tier, so there's no reason to maintain two parallel catalogs; the PR #390 stopgap (merging Supabase on top of GAS) is replaced with a Supabase-only read. A failed/empty Supabase query now resolves to an empty catalog rather than silently falling back to stale GAS data, matching how loot reads behaved after #209/#358. The GAS functions themselves are left in place, unused, for now -- officer-side spreadsheet tooling (dropdown validation, Export.gs) still depends on the "Item Lookup" sheet existing.
- **Placeholder BiS entries (M+, Crafted, Catalyst) can now be given a real slot, and shown up to twice for dual-slot gear (#393)** -- these entries previously showed the literal word "Placeholder" as their slot, since `items.slot` is `NOT NULL` and those stand-ins store that sentinel (they name a loot source, not a gear slot). The BiS Manager's item search now prompts for a slot (Head/Neck/Shoulder/.../Finger 1/Finger 2/Trinket 1/Trinket 2/Weapon/Off Hand) when adding a placeholder item, written to a new `bis_items.slot` override column; a real item still adds in one click and keeps deriving its slot from `items.slot` as always. This also lets the same placeholder be aimed at two different slots for one player (e.g. both Finger slots at "M+"), previously blocked outright since two placeholder rows for a player always shared `item_id`. The original per-row slot data from the old GAS BiS List sheet was already lost at the #217/#320 migration and can't be restored -- this only fixes the slot going forward.

### Backend

- **`bis_items.slot` (#393)** -- nullable officer-chosen slot override, used only for placeholder BiS rows (`items.is_placeholder`). `bis_items_no_dupe_item_key` moved from a plain `(player_id, item_id)` unique constraint to a `(player_id, item_id, coalesce(slot, ''))` expression index so two placeholder rows can coexist for the same player when their slots differ, while real items (slot always null) still dedupe exactly as before.

---

## [3.26.0] - 2026-07-09

### Frontend

- **Priority tab now opens on Priority List by default** -- it was defaulting to Contested Items, despite Priority List being the plain read-only view most officers want first.
- **The Discord claim modal's "wrong team" hint is now a real team-switcher dropdown inside the modal itself**, not a link that closed the modal to open the nav bar's separate switcher. A guess-based "auto-switch to the one other team we know about" approach was tried first, but doesn't hold up with more than two teams (a raider could have claims on several other teams, or the target team's slug might not even resolve) -- a real dropdown scales to any number of teams without guessing. The nav bar's switcher is unchanged; this is a second, independent instance of the same picker, reusing `initTeamUI()`'s existing per-element population loop.
- **Discord Claims list now shows the actual Discord display name alongside the raw Discord ID** (Roster tab), resolved via a new `resolve_discord_display_name()` function, so officers can visually confirm the right account claimed the right character instead of only seeing an opaque snowflake id.
- **Fixed a stale-session bug**: the cached mapped Discord session (`localStorage`, keyed per team) wasn't invalidated when a _different_ Discord account signed in on the same browser, so a browser that previously had an officer's cached session could briefly show officer status for a newly-signed-in, non-officer account until the fresh check completed. The cache now checks the signed-in user's id before rendering anything from it.
- **Added Immolation as a third team** (`TEAMS.immolation`, `js/common.js`) -- it already existed in Supabase (`teams.id = 3`) but had no client-side config, so nothing team-related (switcher, claims) could resolve it. Known limitation: it has no Apps Script deployment (created directly in Supabase, unlike Phoenix/Hellfire's pre-migration Sheets), and `loadData()`'s core/heavy chunk loading is still GAS-dependent regardless of migration progress elsewhere -- so the site won't actually load data for this team until enough of that pipeline no longer needs a GAS backend. Not addressed here; this just gives team-switching/claims code something correct to point at.
- **Fixed the BiS Manager's item search silently missing an item that's actually in the GAS "Item Lookup" sheet.** The immediate cause was a stale `CFG.itemDataStart` row offset in `gs/wgaWebApp.gs` (a sheet cleanup shifted every row up by one; the hardcoded start-row didn't move with it, so row 2 was silently skipped) -- but the deeper issue is that item search has depended solely on that GAS sheet the whole time, with no fallback to Supabase's own `items` table, which has carried the real item catalog since #217/#219. Item search now merges Supabase's `items` on top of the GAS-sourced list as a safety net regardless of sheet alignment; full retirement of the GAS sheet as the item-catalog source is tracked separately (#391).
- **Renamed "Team Phoenix" to "Phoenix"** for naming consistency with Hellfire Rollers and Immolation, neither of which carries a generic "Team" prefix.

### Backend

- **`resolve_discord_display_name()` RPC** -- small `SECURITY DEFINER` function reading `auth.users`' Discord display name for the Discord Claims list, gated the same officer/team_leader-or-site-admin way as `resolve_actor_name()` (#376). Deliberately not a reuse of `resolve_actor_name()`: that function's resolution order prefers a linked character's nickname first, which is the wrong priority for verifying which real Discord account performed a claim.

---

## [3.25.0] - 2026-07-09

### Frontend

- **RCLootCouncil paste import moved to Supabase (#219, Phase 5)** -- both the officer dashboard's Loot Import tab and the public-page officer quick-actions bar's paste widget (two separate call sites, both migrated) now import through `import_rclc_loot()` instead of the Apps Script `appendLootRows` action. Each import resolves the player (creating an archived stub for an unrecognized name-realm, never a null link), resolves the item by its numeric item ID first and name as a fallback, derives the track (Champion/Hero/Myth) from the instance string's difficulty suffix, and reads the boss straight off the export -- all server-side in one RPC call instead of the old chunked JSONP round-trips. Duplicate protection is a real unique constraint (`dedupe_key`, team + RCLC id) rather than app-level checking, so re-importing the same export is a safe no-op. Every newly-imported row logs itself via `write_audit_log()` (#214); the confirmation banner now also reports items that couldn't be resolved against the season's Item Lookup. The "Import History" sub-tab now shows the last 100 imports sourced from the audit log instead of the (permanently empty, going forward) Apps Script sheet -- no "Clear All" button in this version, since there's still no safe way to select only paste-imported rows out of `rclc_loot` for deletion (see `docs/database-decisions.md`).

### Backend

- **`import_rclc_loot()` RPC** (#219) -- `SECURITY INVOKER` function that resolves player/item, derives track, computes the dedupe key, and inserts into `rclc_loot` with `on conflict (dedupe_key) do nothing`, logging one `audit_log` entry per newly-inserted row. Uses `INVOKER` rather than `DEFINER` since officers already have full RLS write access to both `players` and `rclc_loot` directly (same reasoning as `add_signup_to_roster()`); an unresolved item is left `item_id = null` rather than auto-created, since that would require `DEFINER` (`items` grants no authenticated role a direct write).

---

## [3.24.0] - 2026-07-09

### Frontend

- **Attendance status/exclusion writes moved to Supabase (#218, Phase 5)** -- setting a player's per-night attendance status (both from the Attendance tab's per-night grid and the player profile's "Attendance" history card -- two separate write paths, both migrated) and toggling a raid night's report-exclusion flag now write straight to `attendance` instead of the Apps Script `setAttendanceStatus`/`setReportExcluded` actions, each logging itself via `write_audit_log()` (#214). Added the missing `Extended Leave` status to both status dropdowns to match what the database has always allowed. Unlike roster and BiS, the attendance grid's _reads_ deliberately stay on Apps Script for now -- the weekly WCL sync that actually populates new raid nights hasn't moved to Supabase yet (a separate issue, #223), so migrating reads today would show an empty grid for any team without a historical import. Known interim quirk: since writes go to Supabase but reads still come from the untouched Sheet, an officer's edit persists only for the rest of that browser session until reads migrate alongside #223 (see `docs/database-decisions.md`).

### Backend

- **`attendance.player_id`'s FK reconciled to `ON DELETE SET NULL`** (#218) -- matches `rclc_loot` and the decision #250 already called for but never actually migrated (the baseline schema dump still showed `ON DELETE CASCADE`). Safety net only, in case a `players` row is ever hard-deleted outside the app's soft-delete path.

---

## [3.23.0] - 2026-07-09

### Frontend

- **BiS list edits moved to Supabase (#217, Phase 5)** -- adding an item, removing an item, and a new "mark obtained" toggle on the officer BiS Lists editor now write straight to `bis_items` instead of the Apps Script `setBisItems` action, each logging itself via `write_audit_log()` (#214). The editor no longer stages changes behind a Save button -- each action fires its own instant write, since `bis_items` supports true per-row inserts/updates/deletes (the old GAS handler only supported rewriting a player's whole BiS column at once). "Obtained" is a brand-new concept with no Sheet equivalent; it's separate from the existing loot-based BiS completion badge on the profile page, which still derives from actual RCLootCouncil/self-received history. BiS list _reads_ also moved to Supabase in this same release (ahead of the issue's literal writes-only scope) so a page reload always reflects the true current state instead of a stale Apps Script snapshot the moment any write landed. Apps Script keeps its `setBisItems` handler in place, unused, until the whole Phase 5 write migration is verified.

---

## [3.22.0] - 2026-07-09

### Frontend

- **Roster edits moved to Supabase (#216, Phase 5)** -- add player, remove player, and the trial/bench/join-date/class/spec field edits on the officer Roster tab now write straight to `players` instead of going through the Apps Script `addPlayer`/`removePlayer`/`updatePlayerField` actions; every write logs itself via `write_audit_log()` (#214). "Remove player" is a soft-delete (`archived_at` set, not a hard delete) so historical loot/BiS/attendance rows referencing the player stay intact; re-adding a previously archived name-realm un-archives the same row instead of erroring or duplicating. Apps Script keeps its roster-write handlers in place, unused, until this path is verified side by side. The Player Settings panel's standalone Role dropdown is gone -- role is now a read-only derived display, since the migrated schema resolves it from a single class+spec pairing (`class_spec_id`) rather than storing it independently; picking a new Class only repopulates the Spec dropdown, and the write fires once Spec is chosen (see `docs/database-decisions.md`, 2026-07-09).

---

## [3.21.0] - 2026-07-09

### Frontend

- **Audit Log tab rewired to Supabase (#378)** -- the officer dashboard's Audit Log tab read from the legacy GAS `?action=getAuditLog` JSONP endpoint; it now reads `audit_log` directly. Columns collapse the old From/To pair into a single DETAIL column, holding the human-readable summary string `write_audit_log()` (#214) and the #377 backfill both write. CHANGED BY resolves `actor_id` through `resolve_actor_name()` (#376) instead of showing a raw uuid; TARGET resolves `target_type = 'players'` rows to a character name (no other `target_type` is written by any flow yet, so nothing else resolves). Historical rows (before #214) have no `actor_id`/`target_type` and permanently lost their original TARGET value in the #377 backfill, so CHANGED BY and TARGET show blank for anything from before this shipped -- accepted, not a bug.

### Backend

- **anon/authenticated granted USAGE on public sequences (#383)** -- #312 granted base table DML to anon/authenticated so RLS could be reached on a write, but never granted USAGE on the identity sequences behind serial columns; found when #216's Add Player flow hit `permission denied for sequence players_id_seq` despite the row-level policy permitting the insert. Same class of gap #332 flagged for service_role. One additive migration, same shape as #312.

---

## [3.20.0] - 2026-07-09

### Frontend

- **Officer claim management and promotion on Supabase (#365)** -- The roster tab's Discord Claims table and the admin tab's officer promotion picker read live `DATA.discordClaims`/`DATA.officerDiscordIds` from the GAS core payload, which went stale the moment #212 moved claim writes to Supabase; the admin tab's promote action was already dead code since #211 moved officer access to `team_members.role`. Both panels now read through a shared `fetchTeamClaims()` (`js/discord.js`): claimed, unarchived players on the team joined to their linked `team_members` row for `discord_id` and `role`. Removing a claim clears `players.team_member_id`; granting/revoking officer access updates `team_members.role` directly between `raider` and `officer` through PostgREST, covered by the existing "Officers write players" and "Team leaders write team_members" policies -- no new SQL needed. The claims table now shows Discord ID instead of a display name and drops the claimed-date column, since neither is stored anywhere in Supabase. Team leaders are intentionally excluded from the officer picker -- it only replaces the old flat officer on/off toggle, not the separate team-leader tier.
- **Team leaders can now reach the Officers sub-tab without site-admin access (#365 follow-up)** -- The Admin tab was a single site-admin-gated nav item, so a team leader had to go through a site admin to promote a raider to officer even though the "Team leaders write team_members" policy already let them make that write. `showAdminTab()` now takes a tri-state access level (`adminAccessLevel()` in `js/discord.js`: full for site admins, `'officers'`-only for team leaders, none otherwise) instead of a plain boolean; a team-leader-only session gets the Admin nav item but only the Officers sub-tab -- Properties, Bot Config, Data Export, and Danger Zone stay hidden and reachable only by site admins.

### Backend

- **Audit log write path (#214)** -- `audit_log` had no client write path (anon/authenticated hold no INSERT grant on the table), so no Phase 5 officer write feature would have anywhere to record its action. `write_audit_log(p_team_id, p_action, p_target_type, p_target_id, p_detail)` is now the one SECURITY DEFINER function meant to ever insert into it: same definer pattern as `is_site_admin()`/`claim_character()`, gated to officer/team_leader-or-site-admin callers, `actor_id` always set from `auth.uid()` rather than a caller-supplied value.
- **Actor-name resolution for the audit log (#376)** -- `resolve_actor_name(p_actor_id, p_team_id)` resolves an `audit_log.actor_id` uuid to a display name for the upcoming Audit Log tab rewire: the linked player's nickname, else the character-name part of their `name_realm`, else (for a site admin acting on a team they don't belong to) their Discord display name read from `auth.users`. Since that last path surfaces another person's PII, the function re-checks the same officer/team_leader-or-site-admin gate `"Officers read audit_log"` already enforces, rather than relying on the `EXECUTE` grant alone.
- **Backfilled historical audit_log.detail to the summary-string convention (#377)** -- the Stage C import (#320) had written the raw `{target, from, to, changed_by}` shape into `detail`; existing rows now carry a single human-readable summary string matching what `write_audit_log()` (#214) and the Audit Log tab rewire (#378) expect. Legacy `changed_by` values are dropped, not preserved -- every historical row's `actor_id` is null and always will be, so CHANGED BY was never going to resolve for these rows regardless.

---

## [3.19.2] - 2026-07-09

### Frontend

- **Added a team switcher to the public page (#368)** -- `index.html`'s nav had no way to move between teams; only `officer.html` exposed the `teamSwitcherSelect` dropdown. A raider landing on the wrong team's link (bad bookmark, stale Discord link) had to manually edit the `?team=` query param. Reuses the existing shared `initTeamUI()`/`switchTeam()` plumbing, so it inherits Discord session carry-over across the switch for free.
- **Added a "wrong team" hint to the claim modal (#212)** -- A raider who doesn't see their character in the claim dropdown had no signal that they might be viewing the wrong team's roster. The hint now names the currently-viewed team and links straight into the new public team switcher (`goToTeamSwitcher()` in `js/discord.js`) rather than just stating the problem. This was the last remaining piece of #212, deliberately deferred behind #368 landing first.
- **The landing "Claim your character" prompt now recognizes a claim on the other team** -- `resolveDiscordSession()` scopes its `team_members` lookup to the current team, so a raider who already claimed a character on the other team looked identical to one who'd never claimed anything -- same generic prompt, no signal they were just on the wrong page. `findClaimElsewhere()` in `js/discord.js` uses the `Members read own team_members` policy (#212), which isn't team-scoped, to check the other team for an existing claim; if found, the landing card swaps to "You've already claimed {character} on {team}" with a button that calls `switchTeam()` directly instead of the generic claim flow.

---

## [3.19.1] - 2026-07-09

### Frontend

- **Fixed the claim prompt getting stuck on "Checking your account..." after login (#371)** -- `js/roster.js` and `js/officer-quick-actions.js` both declared a global `onDiscordSessionRestored` function. `roster.js` loads last on `index.html`, so its declaration silently won the naming collision -- `officer-quick-actions.js`'s version, the one that refreshes the officer bar, player selector, and claim prompt, has been dead code since #370 shipped. It only went unnoticed because most logins fire a `SIGNED_IN` event (a different, non-colliding hook); a `getSession()`-restored session firing `INITIAL_SESSION` instead hit the collision and never updated the UI. Fixed by having `roster.js`'s version call `_qaRefresh()` itself and removing the shadowed duplicate.
- **Added loading feedback while a Discord session resolves** -- The gap between a Discord login completing and the mapped session resolving (a `team_members` lookup, then a `players` lookup and an `is_site_admin` check) had no visual feedback. If the tab lost focus during that window, the browser would defer those requests until it regained focus, so login could look like it silently failed for several seconds. The nav button now shows a disabled "Signing in..." state during that gap, and the persistent "Claim your character" box (#370) shows a "Checking your account..." placeholder instead of staying invisible. Both are skipped when a cached session is already available, so returning users don't see a pointless flash. The lookup itself is now bounded by a 15-second timeout, so a stalled request (accepted but never answered, which the browser's own `fetch()` has no default timeout for) falls back to a retryable logged-out state instead of leaving the loading state on screen indefinitely.
- **Reworded the claim prompt** -- "Link your Discord to a character to see your priority standing and mark loot you receive" is now "Link a character to your account to unlock your raider profile," a general framing that doesn't call out specific features.

---

## [3.19.0] - 2026-07-08

### Frontend

- **Raider character claim flow (#212)** -- Claiming a character now writes through Supabase. The claim dropdown lists only unclaimed roster members, read live from the database instead of the old Apps Script claims list, and confirming a claim calls the `claim_character` function, which links the character to your Discord identity and rejects one that is missing, archived, or already taken. On login the site resolves your claimed character through the canonical `players.team_member_id` link, so your profile and priority standing show up. A persistent "Claim your character" box on the home page gives you a way back to claiming whenever you are logged in without a character, not only the one-shot modal right after login.

### Backend

- **Raider character claim flow, backend half (#212)** -- Added `claim_character(team_id, name_realm)`, a `SECURITY DEFINER` function that links a raider's chosen character to the person layer: it sets `players.team_member_id` to the caller's `team_members` row, creating that row with `role = 'raider'` on a first claim and reusing an unlinked row imported from the Discord Claims sheet (#338) rather than duplicating it. It refuses a character that is archived, missing, or already claimed. A new self-read RLS policy lets a member read their own `team_members` row, which the login session read (`resolveDiscordSession`) needs for a raider's `nameRealm` to resolve. A one-time backfill links the pre-migrated claims to their `players` rows on the canonical `team_member_id` model. The frontend that calls this ships separately (v3.19.0). Also captures the `on_auth_user_created` trigger in a migration: it was created by hand in the dashboard and existed only on production, so local and CI stacks could not exercise the claim path against it until now.

---

## [3.18.1] - 2026-07-08

### Frontend

- **Audit log records the acting officer again (#364)** -- The Supabase login swap (#211) dropped the Discord session token from the client session, and that token was the only thing that told Apps Script who made a change. Officer writes still served by Apps Script (attendance, BiS, received items, and the rest until Phase 5) were logging a blank "changed by" as a result. The site now sends the signed-in officer's Discord username as `changedBy` instead, and Apps Script uses it when no token is present (old cached sessions that still send a token keep working). Both team deployments need a redeploy for the Apps Script half to take effect; until then attribution stays blank, the same as before this change.

---

## [3.18.0] - 2026-07-08

### Frontend

- **Discord login now goes through Supabase Auth (#211)** -- Replaced the hand-rolled popup OAuth flow (`discord-callback.html`, `window.open`, `postMessage` relay, CSRF `state` param) with Supabase's `signInWithOAuth()` full-page redirect. `js/discord.js` maps the resulting Supabase auth session to the `{ username, nameRealm, isOfficer, isAdmin }` shape `officer.js` already consumes via `onDiscordLoginComplete` / `onDiscordSessionRestored` / `onDiscordInitNoSession` / `onDiscordLogout`, so no changes were needed there. Role and admin tier come from `team_members` and `is_site_admin()` respectively. Login mechanism only -- the character-claim write (#212) and removing the now-redundant GAS OAuth redirect (#213) are separate follow-ups; `discord-callback.html` is deleted since the new flow no longer needs a relay page.

---

## [3.17.2] - 2026-07-08

### Frontend

- **Removed the Apps Script loot fallback (#210 cutover cleanup)** -- Both team GAS deployments were redeployed to drop `lootCounts` (retired in #358), confirmed live via the `heavy` chunk. The frontend no longer falls back to `heavy.lootCounts` when the Supabase loot query fails; it now resolves to an empty loot feed instead, since there is no longer an alternate source to fall back to.

---

## [3.17.1] - 2026-07-08

### Frontend

- **Fixed unreadable Discord reauth button on the officer password prompt** -- `.site-nav-discord` is styled for the transparent top-nav bar, but the reauth "Continue with Discord" button in the officer prompt pairs it with `.btn` instead of `.site-nav-item`, so it had no background set and fell back to the browser's default white button with `--text-muted` text on top -- washed out and hard to read. Added a `.btn.site-nav-discord` variant with a blurple-tinted background matching the surrounding reauth box.

---

## [3.17.0] - 2026-07-08

### Frontend

- **Public loot reads from Supabase (#209)** -- The loot feed (player cards, Recent Loot, landing totals, fairness and priority views) now builds from the `rclc_loot` table instead of the Apps Script heavy payload. Rows are remapped client-side to the exact shape the Apps Script emitted -- same first-name keys, award dates formatted in the sheet's Eastern timezone, Hero/Myth/Champion tracks shown under the Heroic/Mythic/Other labels the UI expects, and the stored season code shown under its sheet display name -- so nothing changes visually. The query fetches every season for the team and pages past PostgREST's 1000-row cap; on any failure it falls back to the Apps Script loot feed while that still exists. The Apps Script stops serving `lootCounts` (both team deployments need a redeploy after this merge). One sheet-era artifact is deliberately not reproduced: the old feed collapsed a genuine same-minute double drop into one entry, so phoenix's item total now reads 156 where the sheet showed 155.

---

## [3.16.0] - 2026-07-07

### Frontend

- **Public roster reads from Supabase (#208)** -- Both pages now load the roster from the `players` table (with class/spec/role joined from `classes_specs`) instead of the Apps Script payload. The rows are mapped to the exact shape the Apps Script emitted, so nothing changes visually. Attendance and the M+ exclusion fields still merge in from the Apps Script payload: attendance is computed live from the Attendance sheet, and the M+ request flow stays officer-gated until Phase 5. If the Supabase query fails, times out, or returns nothing, the page falls back to the Apps Script roster and keeps working. New frontend unit tests (`npm run test:frontend`) cover the mapping and the fallback, with their own CI job.

### Backend

- **Departed characters keep their loot history (#209)** -- The loot importer now creates archived stub players rows for names no longer on the Roster (the same treatment attendance and scoring always had) instead of leaving `player_id` null, so every imported loot row carries character attribution. A one-time relink script backfills the 67 phoenix rows imported before the change (24 departed characters); the upcoming Supabase loot read depends on it, since a player-keyed read would otherwise drop those items from the public loot totals and Recent Loot feed.
- **Roster re-imports reconcile instead of insert-only (#208)** -- Re-applying a team's generated import now updates changed player fields from the Roster export (spec swaps, nicknames, trial/bench flags, BiS links, join dates), revives a returning player's archived row in place (keeping their history), and archives active players who left the sheet roster. Unchanged rows are not touched, so `updated_at` still means a real edit, and a second apply reports zero affected rows. All other sections stay insert-only. This is the roster refresh path while the site reads players from Supabase but roster edits still happen on the sheet (until Phase 5): regenerate from a directory holding just a fresh Roster.csv (see the header of scripts/import/generate.js) and re-apply. The M+ exclusion fields are never overwritten on update.

---

## [3.15.2] - 2026-07-07

### Added

- **Type checking for the frontend JS (#331)** -- `js/common.js` now opts into TypeScript's checker with `// @ts-check` and JSDoc annotations, and a new "Type check" step in the lint CI runs `tsc --noEmit` (also available locally as `npm run typecheck`). There is still no build step: the `.js` files ship exactly as they are, and a new `js/globals.d.ts` declares the window globals (the supabase CDN client and the JSONP callbacks) for the checker only. The remaining `js/` files opt in as they get touched; generated Supabase types come after the Phase 2 schema settles, per the issue.

---

## [3.15.1] - 2026-07-07

### Fixed

- **`scripts/fetch-items.js` runs again (#301)** -- The script still used a CommonJS `require` after `scripts/` became an ES module package, so `node scripts/fetch-items.js` threw before doing anything. The require is now an import, and the script only starts its Wowhead fetches when executed directly, so the test suite can load it without hitting the network.

---

## [3.15.0] - 2026-07-07

### Changed

- **Loot columns store item track, named and valued as track (#343)** -- The `difficulty` columns on `rclc_loot`, `self_received_requests`, and `priority_order` are renamed to `track` and store the real upgrade-track names: Champion, Hero, Myth (previously the hybrid Champion/Heroic/Mythic). The columns always meant track: the app translated Normal drops to "champion", and self-received uses the values for vault/crafted/catalyst items that never dropped at a raid difficulty. The migration updates existing rows in place; the importers translate the sheet's difficulty words on the way in; priority_order stays Hero/Myth only, since Champion loot is handled by loot council outside the priority system. The sheet and current UI keep their vocabulary until the Phase 2/5 switches.

---

## [3.14.0] - 2026-07-07

### Added

- **Discord Claims import into team_members (#338)** -- The importer now reads a team's Discord Claims tab and backfills each claim as a `team_members` row (`role = 'raider'`), so the auth trigger can match a raider's Discord ID on their first Supabase login and existing claims carry over instead of everyone re-claiming. A claim for an already-seeded officer or team leader keeps the existing role and only fills in a missing `name_realm`. Claim IDs mangled by sheet number formatting (scientific notation loses digits) are skipped with a printed warning, since a truncated ID would silently never match at login. Verified on the local stack: 6 of hellfire's 7 claims import (one skipped for a mangled ID), seeded officer rows keep their roles and gain their character links, and a second apply changes nothing.

---

## [3.13.3] - 2026-07-07

### Fixed

- **Roster import accepts the full-sheet export layout (#320)** -- The hellfire Roster export ships the sheet's two banner rows (title and description) above the header, which the roster parser rejected because it expected the header in row 1. The parser now locates the header row by content within the first few rows, so both the cleaned phoenix layout and the full-sheet hellfire layout import. Verified against the hellfire export on the local stack: 15 players and 59 audit rows import, and a second apply inserts zero rows. The hellfire signup-flow tabs (Pending Roster, Discord Claims, Roster Responses) are out of scope for the historical import and stay in the sheet until the signup flow itself moves.

---

## [3.13.2] - 2026-07-07

### Added

- **`.env.example` template is now tracked** -- the root `.gitignore` was ignoring the example env file along with the real one, so the template never traveled with the repo. The ignore rule now covers only `.env`/`.env.local`; `.env.example` documents the expected variables (Supabase URL and keys, pooler `DATABASE_URL`) with empty values.

---

## [3.13.1] - 2026-07-07

### Changed

- **Clarified the Admin Danger Zone's "Clear M+ Exclusions" label** -- renamed to "Clear M+ Exclusion Requests" to distinguish it from the M+ Exclusions tab's own "Clear All Exclusions," which clears a different thing (the active exclusion flag on players, not the request history).

---

## [3.13.0] - 2026-07-07

### Added

- **supabase-js client on both pages (#207)** -- index.html and officer.html now load the supabase-js v2 library and initialize a shared client in `js/common.js`, and each team's config carries its Supabase team id (verified against the live `teams` table). Nothing reads from Supabase yet: the JSONP backend stays in charge of every feature, and if the CDN script fails to load the site works exactly as before. This is the foundation for the Phase 2 public read switches (#208, #209).

---

## [3.12.2] - 2026-07-07

### Fixed

- **Loot Data import accepts the export's two-digit-year dates (#320)** -- The real Loot Data export writes its date column as `3/19/26`, which the import date parser rejected (it only knew 4-digit years). The parser now accepts `M/d/yy` with or without a time, expanding to `20yy`. Verified against the phoenix export on the local stack: all 156 loot rows import (102 Heroic, 54 Mythic, season MID1, Eastern timestamps), 19 old-tier items auto-created, and a second apply inserts zero rows.
- **Schema reference doc matches the live difficulty vocabulary** -- `docs/database-schema-reference.md` still described the `rclc_loot.difficulty` CHECK as Normal/Heroic/Mythic; the live constraint is Champion/Heroic/Mythic with Normal translated to Champion on import (decided on #320).

---

## [3.12.1] - 2026-07-07

### Fixed

- **Import generators match the real CSV exports (#320)** -- The parsers were written against the raw sheet tab layouts, but the actual exports are flattened: headers sit in row 1, the Roster and Scoring tabs carry different column sets, and player names arrive as "First-Realm - Nickname". The Roster, Scoring, and Item Lookup parsers now read the exported layouts, dash-separated nicknames are stripped everywhere names are matched, and M/d/yyyy join dates are accepted. The Item Lookup's "Crafting" placeholder row is renamed to "Crafted" on import to match the app vocabulary the BiS cells already use, and the Attendance parser skips the export's excluded-reports trailer and blank-status rows with a printed warning instead of aborting. Verified end to end against the phoenix exports on the local stack: full generate, apply, and a second apply inserting zero rows.

---

## [3.12.0] - 2026-07-06

### Added

- **Signup-to-roster promotion in the database** -- The old sheet's Pending Roster tab is now a signup state instead of a table: approved signups waiting for the roster add are exactly `season_signups` rows at `status = 'approved'`, readable by officers through the new `pending_roster` view. A new `add_signup_to_roster()` function performs the add as one transaction: it creates the player (or unarchives a returning character, or links an already-active member without resetting their trial flag and join date), archives the old character on a main swap, and marks the signup `added`. A CHECK constraint guarantees a signup can only link to a player once it is `added`. Authorization rides on the existing officer policies; applicant names stay invisible to the public until the add happens.

---

## [3.11.0] - 2026-07-06

### Added

- **Self Received Requests import (#320, decided in #322)** -- Migration adds `difficulty`, `source`, and `note` columns to `self_received_requests`, and a new generator imports the tab with the mixed Source values split the same way the app reads them: a "Mythic:"/"Heroic:" prefix wins, a bare value defaults to Mythic, and the base tier stores as Champion. The legacy loot export's response and note columns are dropped on import per the same decision.

---

## [3.10.0] - 2026-07-06

### Added

- **One-time data migration tooling, stage C (#320)** -- Import generators for loot, the M+ request history, and the officer audit log. Loot merges Pasted Loot and the legacy external tracker export, translates the base difficulty tier to Champion (per the decision on #320), derives legacy seasons from a date-ranges config, creates items rows for old-tier gear the Item Registry never knew, and dedupes on team-prefixed keys so a re-apply or a refresh export inserts only new rows. Audit rows keep their action text verbatim with the target/old/new/changed-by context folded into a jsonb detail blob. Timestamps convert from the spreadsheet's wall-clock timezone at apply time, so DST is Postgres's problem, not the generator's.

---

## [3.9.0] - 2026-07-06

### Added

- **One-time data migration tooling, stage B (#320)** -- Import generators for the three history tables. Attendance locates its columns by header text (the #228 cleanup changed the export layout), validates statuses against the schema's allowed list, and flags duplicate player/date rows; departed players referenced only by history import as archived stub rows. The BiS grid and priority ranking grid reshape from their wide sheet layouts into normal rows, with duplicate BiS cells collapsed and every item reference checked against the Item Lookup export before apply.

---

## [3.8.0] - 2026-07-06

### Added

- **One-time data migration tooling, stage A (#320)** -- New `scripts/import/` generators turn per-team CSV exports of the Google Sheet tabs into one reviewable, transactional SQL file per team (`node scripts/import/generate.js --team phoenix --season "..."`). This stage covers items + item_bosses (with a cross-team registry mismatch report), players (M+ exclusion state derived from approved requests, departed players kept as archived stubs so history FKs hold), and scoring. Re-applying a file inserts only new rows, so the pre-cutover refresh is a plain re-run. CSVs and generated SQL live in the new gitignored `data/` directory.
- **Natural unique keys on the reference tables** -- Migration adds `unique (class, spec)` on classes_specs and a unique index on `items (lower(name))`, giving the import SQL real ON CONFLICT targets. A double-applied import (SQL Editor or psql) now converges instead of duplicating reference rows; the classes-specs generator from #321 emits the matching conflict clause.
- **Import test suite** -- `npm run test:import` runs vitest unit tests for the CSV parsing, name normalization (diacritics, nicknames), SQL escaping, and per-table generators.

---

## [3.7.4] - 2026-07-05

### Added

- **Generated database schema docs** -- New `dbdoc/` directory with a markdown page and Mermaid ER diagram per table, generated from the migrations with [tbls](https://github.com/k1LoW/tbls) (`npm run db:docs`). A new schema-docs CI check fails any PR whose migrations no longer match the committed docs, so the diagrams cannot silently drift.
- **RLS policy reference** -- `docs/RLS.md` documents the row-level-security policy matrix for all 20 tables (tbls cannot introspect policies). CI requires it to be updated whenever a migration touches policy SQL. Writing it surfaced two policy defects on `player_wcl_season_perf`, filed as #293.
- **Raw RLS policy export** -- `docs/rls_policies.csv` holds every policy as one spreadsheet-friendly row, generated straight from `pg_policies` with `npm run db:rls`. CI regenerates it and fails the PR if the committed CSV is stale.

---

## [3.7.3] - 2026-07-05

### Changed

- **Split officer promotion out of the Discord Claims tab** -- The Roster tab's Discord Claims sub-tab showed Grant/Revoke Officer buttons alongside claim data, duplicating the Admin tab's Officers sub-tab. Discord Claims is now purely a read-only view of who claimed what character, with a consistent "Remove" action for every viewer (previously only non-admins had it). The Officers sub-tab now lists only current officers (with Revoke), plus a new "Promote a claimed character to officer" picker built from claimed users who aren't officers yet -- replacing the old free-text Discord ID field, which required knowing a raw ID that was never shown anywhere in the UI.

---

## [3.7.2] - 2026-07-05

### Fixed

- **Stale "Who are you?" label on the profile selector card** -- The public landing page's card only ever renders once someone's already logged in with Discord and claimed a character, so asking "who are you?" no longer made sense. Now reads "Your Profile" for raiders (just their own "View My Profile" button) and "Look Up a Raider" for officers (who get the full character dropdown).

---

## [3.7.1] - 2026-07-04

### Added

- **Public Roster tab** -- A new "Roster" nav item on the public landing page shows who's currently on the roster (name, class, spec) grouped by role, with no login required. Read-only -- no attendance, loot counts, or BiS data, and no edit controls (those stay behind the officer-only profile dropdown). Reuses the same class-badge styling as the officer BiS Lists tab.

---

## [3.7.0] - 2026-07-04

### Added

- **Signup mismatch confirmations for logged-in Discord users** -- If a signer is logged in with a claimed character, two new checks now catch likely mistakes before submission:
  - **Different Name-Realm than the claim** -- typed at Step 1, this is checked immediately, before any class/spec is picked. A typo can land on a genuinely different real character (e.g. typing `Katorri` when your claim is `Katorrí`, which happens to be someone else's actual character on the same realm), so this is no longer silently assumed to be an intentional main swap. Step 1 shows exactly what's claimed vs. what was typed, naming both characters, and requires an explicit confirmation before continuing. If confirmed, the claimed character is automatically recorded as the main-swap source later at submission -- no manual re-typing needed.
  - **Same Name-Realm, different class** -- the character's class can't actually change, so picking a class that doesn't match the claimed character's roster record is almost certainly a misclick. A confirmation checkbox naming both the recorded and selected class appears at the spec step and blocks progress until checked.
  - The original checkbox + manual Name-Realm entry (added in 3.6.8) is unchanged for signers with no claimed character on file.

---

## [3.6.9] - 2026-07-04

### Fixed

- **Main-swap checkbox not obvious as a checkbox** -- The "I'm switching mains this season" toggle used the hidden-input/pill-button style meant for grouped chip selections (like off-spec), so as a standalone full-width control it read as a static label rather than something clickable. It now renders as a visible native checkbox with a gold accent, matching the pattern used elsewhere on the site (e.g. the Pending Roster "remove absent" toggle).

---

## [3.6.8] - 2026-07-04

### Fixed

- **Main swap on the signup form was an auto-filled text box** -- The field silently pre-filled with the signer's own claimed character, making it look like everyone was swapping mains by default. It's now a checkbox ("I'm switching mains this season"). If the Discord user has a claimed character, it's shown read-only; otherwise a text box appears, validated with the same name-formatting rules as character names (catches malformed entries like `mmyumbeans - Illidan` before submission).

### Added

- **Pending Roster diff preview** -- The push banner now shows how many entries are new vs. updates vs. missing signups, computed against the live roster, before confirming a push.
- **Pending Roster conflict highlighting** -- Cards with a main swap get a highlighted border, a New/Update badge, and a note on whether the old character is still on the roster (so officers know if "remove absent" is needed to clean it up).
- **Pending Roster sort/filter controls** -- Role chips, a "Main Swap Only" toggle, and Name/Class sort for the pending entry list.

---

## [3.6.7] - 2026-06-29

### Added

- **Devotion Aura buff coverage tracking** -- Devotion Aura (provided by all Paladins) is now included in the raid buff coverage panel.
- **Signup history viewer** -- A new History sub-tab on the Signups tab shows all Roster Responses entries for the current signup season, grouped by status (Approved / Pending / Denied). Read-only reference view so officers can see the full signup picture alongside the active submission queue.

---

## [3.6.6] - 2026-06-29

### Fixed

- **Roster push overwrite bug** -- When multiple signups were pushed to the roster in one batch, any player whose role was stored as `DPS` or `Healer` (raw signup form values) was written to the sheet with an invalid role string. The next player's insertion point calculation skipped that row, causing them to be written to the same row and clobbering the previous player (root cause of Dayned being lost). The backend now resolves `DPS` and `Healer` to the correct `Melee`/`Ranged`/`Heal` value based on the player's main spec before writing to the roster.
- **Pure DPS class role defaulting to Melee** -- Warlock, Mage, and Rogue signups had no role radio buttons, but the resolved role defaulted to `Melee` for all of them. Each class now carries a fixed role in `CLASS_SPECS` (`Ranged` for Warlock/Mage, `Melee` for Rogue).
- **Hunter role not accounting for Survival (Melee)** -- Hunter previously defaulted to `Ranged`. Since Survival is a melee spec, Hunters now see a `Melee`/`Ranged` radio button on the signup form.
- **Hybrid DPS/Healer role not resolving at signup time** -- Players selecting `DPS` or `Healer` on the signup form now have their role resolved to the specific raid role (`Melee`, `Ranged`, or `Heal`) based on their selected main spec before the signup is submitted.

### Added

- **Character name validation** -- The public signup form and the officer Add Player modal now reject names that don't follow WoW naming rules: 2-12 characters, first letter capitalized, no additional capitals. Invalid names show an error with a corrected suggestion (e.g. "Did you mean Glizzygary?").

---

## [3.6.5] - 2026-06-29

### Added

- **Signup Season setting in Season Settings** -- Officers can now set the signup season label directly from the Season Settings tab. Previously the backend supported this but had no UI, meaning all signups were recorded with a blank season field. The field is now exposed, loaded on page open, and validates against empty saves.

---

## [3.6.4] - 2026-06-28

### Fixed

- **Attendance and WCL scores now pull from the Roster sheet** -- Player lists for attendance refresh, attendance score commit, WCL score refresh, and performance score commit were previously read from hardcoded rows 4-33 in the Scoring sheet (30-player cap). All four now source players directly from the Roster sheet, so anyone added to the Roster is automatically included. The Scoring sheet still stores scores per player but is no longer the source of truth for who is on the roster.

---

## [3.6.3] - 2026-06-28

### Fixed

- **Buff coverage styling** -- Buff names are now colored by their provider class (e.g. Druid orange for Mark of the Wild). Multi-class buffs (Heroism, Combat Res) remain white. Font size increased from ~0.77rem to 0.88rem on both the Roster and Pending Roster panels.

---

## [3.6.2] - 2026-06-28

### Fixed

- **Buff coverage not rendering on Roster tab** -- `buildRosterBuffCoverage` was only called in the heavy-data callback, so it never ran on initial load or after player saves. Moved the call into `buildOfficerDashboard` so it renders consistently.

---

## [3.6.1] - 2026-06-28

### Added

- **Buff/debuff coverage panel** -- Pending Roster tab now shows a collapsible Buff Coverage section (between Missing Signups and the Push area) with Raid Buffs, Boss Debuffs, and Utility grouped into three sections. Each buff shows a green checkmark (2+ players), yellow warning (1 player), or red X (not covered). Hovering a buff chip shows which players provide it.
- **Compact buff summary on Roster tab** -- A compact always-visible buff/debuff summary appears above the roster table, showing the same green/yellow/red indicators for the current active roster (bench excluded).

---

## [3.6.0] - 2026-06-28

### Added

- **3-stage roster signup flow** -- Signups are now a full season registration flow: players submit a signup (class/spec/role/discord/mainswap/notes), officers approve into a Pending Roster staging area, then push to the official roster in bulk when signups close.
- **Active signup season setting** -- A new Settings sheet stores a `signupSeason` key (e.g. `MN S1`) independent of the attendance season start date, so pre-season signups are attributed to the correct season. Officers set it via a new `setActiveSignupSeason` action.
- **Season stamping** -- Every signup submission and pending roster entry is now stamped with the active signup season.
- **Re-signup support** -- Approving a player who already has a Pending entry overwrites it rather than creating a duplicate, so players can update their class/spec before the push.
- **Missing signups** -- New `getMissingSignups` action (and `/missing-signups` bot command via bot issue #3) returns roster members who have not submitted a signup for the current season.
- **Push to Roster** -- New `pushPendingToRoster` action bulk-applies all Pending entries to the official roster (add new players, update existing class/spec/role). Optionally removes roster members not in the pending set.
- **Pending Roster tab redesign** -- Stats panel (total + role breakdown), collapsible missing signups section grouped by role, simplified cards with mainswap/season indicators, and a two-step Push to Roster confirm flow with optional remove-absent checkbox.

### Changed

- **Pending Roster sheet columns** -- Extended from 6 to 12 columns: Character-Realm, Class, Main Spec, Off Specs, Role, Discord, Mainswap, Notes, Season, Submitted At, Approved At, Status.
- **Approve signup** -- Removed the old duplicate-on-roster guard (players are expected to already be on the roster for season re-registrations). Now passes mainswap, notes, and season through to the Pending Roster sheet.
- **Officer.html help text** -- Updated Signups tab help to describe the push-based flow.

### Fixed

- **ESLint no-useless-escape** -- Removed unnecessary `\/` and `\-` escapes in two date-parsing regexes.
- **ESLint no-empty** -- Added `Logger.log()` bodies to previously-empty catch blocks.
- **ESLint no-redeclare** -- Converted `var` to `const`/`let` in `getItemRecipients` loops to eliminate cross-loop re-declarations.

---

## [3.5.5] - 2026-06-23

### Added

- **Supabase migration plan** -- Added `docs/supabase-migration-plan.md`, a proposal for moving the Raid Hub off Google Sheets to Supabase and PostgreSQL: phased roadmap, security model (Row Level Security as the access boundary), data migration approach, the loot-feed retirement, and the decisions and setup needed to begin. Planning only; no application changes.

---

## [3.5.4] - 2026-06-23

### Fixed

- **Grant/Revoke Officer and Remove buttons broken on Roster tab** -- Same double-quote collision as the Admin tab fix in 3.5.3; the Roster tab's Discord Claims section had identical unescaped `JSON.stringify` calls in its `onclick` attributes. Also fixes the Remove button (`removeDiscordClaim`) on the same row.

---

## [3.5.3] - 2026-06-23

### Fixed

- **Grant/Revoke Officer buttons broken in Admin tab** -- The onclick attributes used `JSON.stringify` to embed Discord ID and username, which wraps strings in double quotes. Because the attribute itself also uses double quotes, the browser truncated the attribute at the first inner `"`, leaving an incomplete JS expression that threw `SyntaxError: Unexpected end of input`. Replaced the inner quotes with `&quot;` HTML entities so the onclick is valid.

---

## [3.5.2] - 2026-06-23

### Fixed

- **"Invalid or expired session" when claiming a character on Hellfire Rollers** -- The Discord login popup could not read `sessionStorage` from the opener window, so it always called Phoenix's GAS backend to create the session. Claiming a character on Hellfire's page then failed because Hellfire's GAS had no record of the token. The team slug is now encoded directly in the OAuth `state` parameter so the callback knows which backend to call without any cross-window storage coordination.

---

## [3.5.1] - 2026-06-23

### Fixed

- **Discord session lost when switching teams** -- Switching to a different team via the nav dropdown now preserves your Discord login. Previously the per-team session key (`wga_discord_<slug>`) caused the new page to find no stored token, forcing a re-login. The session is now copied to the destination team's key before navigation.

---

## [3.5.0] - 2026-06-23

### Changed

- **"Who are you?" selector is now gated behind Discord login** -- The player selector card on the landing page is hidden unless the visitor is logged in via Discord with a claimed character. This prevents anonymous profile browsing now that Discord auth is live.
  - **Non-officers** see a "View My Profile" button that opens their own profile -- no dropdown.
  - **Officers** see the full player dropdown for browsing plus a "View My Profile" button.
  - **Unclaimed / not logged in** -- the card is hidden entirely.

---

## [3.4.2] - 2026-06-23

### Fixed

- **Officer quick-actions bar disappears on hard refresh** -- The bar now renders immediately from the cached Discord session in localStorage instead of waiting for the async token-validation JSONP call to complete. The validation callback still corrects the bar if the token has since been invalidated.

---

## [3.4.1] - 2026-06-23

### Changed

- **Officer quick-actions: attendance refresh links to dashboard** -- After a successful WCL attendance refresh from the index page quick-actions bar, the status message now includes a "Review in Dashboard" link that opens `officer.html` directly on the Attendance tab.
- **Officer dashboard: `?tab=` deep-link support** -- `officer.html?tab=attendance` (or any other tab name) now opens the dashboard with that tab active. Uses `openTab()`, a new programmatic helper that finds and clicks the correct sidebar nav button.

---

## [3.4.0] - 2026-06-23

### Added

- **Officer quick-actions bar on the index page** (#99) -- A compact bar appears below the site nav on the public roster page whenever a Discord-authenticated officer is logged in. Three actions are available without navigating to the full officer dashboard:
  - **Copy Priority Export** -- fetches the current priority export string from the backend and copies it to the clipboard in one click.
  - **Refresh Attendance** -- triggers a WCL attendance pull with inline progress and result feedback.
  - **Paste Loot** -- toggles an inline RCLootCouncil JSON paste form with the same chunked import logic as the officer dashboard loot import tab.
  - The bar shows/hides reactively on Discord login, logout, and session restore.

---

## [3.3.2] - 2026-06-23

### Changed

- **Attendance: auto-Bench players not in WCL log** -- Roster players who do not appear in the WCL log for a main raid night are now automatically marked `Bench` (source: `Auto`) instead of left blank. Officers can override individual rows to No Show / Excused as needed; manually set statuses are preserved on subsequent refreshes.

---

## [3.3.1] - 2026-06-23

### Changed

- **Attendance refresh: fewer WCL API calls** -- Three optimizations reduce the number of WCL queries on each pull:
  1. If `Season Start` is set, the initial report list query is filtered to that date (`startTime` param), so only current-season reports are fetched instead of the last 50 regardless of age.
  2. Reports whose date is already in the Attendance sheet skip zone + participant fetches entirely when either raid progression zone IDs are configured or a season start date is set (3 queries -> 0). When neither is set, only participant fetches are skipped (3 -> 1).
  3. Zone filtering now uses the zone IDs from the configured Raid Progression rather than heuristically detecting the "current" zone from the most recent report. This correctly handles mid-season tier additions (e.g. Sporefall in 12.0.7) -- any zone listed in the season's raid progression is treated as valid. Falls back to the previous heuristic if no progression is configured.
  - Typical re-run savings: a 10-night season with 8 nights already cached goes from ~30 WCL API calls to ~6.

---

## [3.3.0] - 2026-06-23

### Added

- **Attendance: exclude report from web app** -- Each raid night in the Attendance > Manage tab now has an "Exclude Report" / "Remove Exclusion" toggle button. Toggling updates column F of the Attendance sheet directly, immediately reflects in the night selector label (`[EXCLUDED]`), and writes an audit log entry.

---

## [3.2.0] - 2026-06-23

### Added

- **Audit log: officer identity** (#112) -- All officer-initiated actions now populate the "Changed By" column in the Audit Log with the officer's Discord username. The Discord token is auto-injected into every backend request when a Discord session is active. Discord Claims (user self-service) are marked "N/A" in that column since no officer performs the action.

---

## [3.1.0] - 2026-06-23

### Added

- **Signup: Main Swap field** (#181) -- Raiders switching mains can enter their current character (Name-Realm) on the signup form. If Discord-authenticated, the field pre-fills with their claimed character. Officers see the main swap on the signup card (highlighted in gold). On approval, the old character is automatically removed from the Roster sheet and their Discord claim is cleared.
- **Season archive: Roster snapshot** (#79) -- Archiving a season now captures a read-only snapshot of the roster (name, role, trial/bench status, join date, attendance %). Officers can expand a "View Roster" table for any archived season in the Season History tab.

### Fixed

- **Duplicate signup guard** (#180) -- Approving a signup for a character already on the Roster sheet now returns a descriptive error to the officer rather than silently creating a duplicate entry.

### Changed

- **Admin-only visibility** (#157) -- The team switcher dropdown in the nav bar is now hidden for non-admin officers (same gate as the Admin tab).

---

## [3.0.10] - 2026-06-23

### Fixed

- "My Profile" in the Discord nav dropdown now works on the officer dashboard. Clicking it navigates to the public roster page and automatically opens your character profile there.

---

## [3.0.9] - 2026-06-23

### Fixed

- Switching teams on the officer dashboard while Discord-authenticated no longer drops you to the password prompt on the new team. A "Continue with Discord" banner now appears at the top of the access prompt so you can re-authenticate with one click. The password form remains available below as a fallback.

---

## [3.0.8] - 2026-06-23

### Fixed

- Column headers in the Discord Claims and Officers tables now align with their data cells (headers were center-aligned by browser default while data was left-aligned).

### Added

- Discord Claims table now shows a Role column (Officer/Raider) for each claimed user.
- Admins see Grant Officer / Revoke buttons directly in the Discord Claims table; non-admin officers see only the Remove button.

---

## [3.0.7] - 2026-06-22

### Changed

- Discord login no longer auto-navigates to your character profile on login, session restore, or after claiming a character.
- A persistent **My Profile** entry now appears in the Discord nav dropdown (when a character is claimed) so you can navigate to your profile on demand.

---

## [3.0.6] - 2026-06-22

### Changed

- Discord Claims moved from Admin to a new subtab under Roster, accessible to all officers.
- Column widths in the Discord Claims table are now fixed to prevent content from spreading unevenly.

### Added

- Officer management UI in the Admin tab (Officers subtab). Admins can grant or revoke officer dashboard access per Discord user, or manually grant by Discord ID for users who have not yet claimed a character.
- Admin tab is now hidden from officers logged in via Discord; only users whose Discord ID is listed in the `adminDiscordIds` GAS Script Property can see it. Password login always shows Admin.
- `isOfficer` is now controlled by an explicit `officerDiscordIds` GAS Script Property rather than roster priority rank.

---

## [3.0.5] - 2026-06-22

### Changed

- Discord Claims moved from Admin to a new subtab under Roster, accessible to all officers.
- Column widths in the Discord Claims table are now fixed.

---

## [3.0.4] - 2026-06-22

### Added

- Discord Claims subtab under Admin on the officer dashboard. Shows all claimed characters with Discord username, character, and claimed date. Officers can remove a claim if a raider linked the wrong character -- the raider's active session is updated immediately and they will be prompted to re-claim on next login.

---

## [3.0.3] - 2026-06-22

### Fixed

- Claim character dropdown is now sorted alphabetically by Name-Realm.

---

## [3.0.2] - 2026-06-22

### Fixed

- Discord nav dropdown now anchors below the button instead of floating to the right edge of the screen.
- Nav dropdown shows a "Claim your character" option when logged in but no character has been claimed yet.

---

## [3.0.1] - 2026-06-22

### Fixed

- Claim character dropdown now shows `Name-Realm Class` instead of `Name-Realm (Class Spec)` -- drops spec and parentheses to reduce visual noise.
- Discord OAuth redirect URI corrected to match GitHub Pages URL casing (`WGA-Raid-Hub`). Fixes #166.

---

## [3.0.0] - 2026-06-22

### Added

- **Discord OAuth login.** Closes #25. Raiders and officers can now sign in with Discord -- the largest feature this app has shipped and the foundation for Phase 6 post-auth work.
  - **Login flow:** "Login with Discord" button in the site nav opens a popup. Discord redirects to a new `discord-callback.html` relay page on GitHub Pages, which forwards the authorization code to GAS server-side. The client secret never touches the browser.
  - **Session management:** GAS exchanges the code for a Discord access token, fetches the user profile, and creates a 30-day session token stored in `PropertiesService`. The frontend stores the token in `localStorage` (survives tab close and refresh).
  - **Character claiming:** On first login, a modal prompts the raider to select their character from the roster. One claim per Discord ID and one claim per character, enforced server-side. Claim is stored in a new "Discord Claims" sheet.
  - **Auto-redirect:** After login (or on page load with a valid session), the raider's own profile opens automatically -- no need to pick from the dropdown.
  - **Officer Discord login:** Officers whose claimed character has Raid Leader or Officer priority (1 or 2) bypass the password prompt entirely when logging in via Discord. The password prompt remains available as a fallback.
  - **Self-mark auto-approve:** When a Discord-authenticated raider submits a self-received item for their own character, GAS auto-approves it immediately instead of queuing it for officer review. Implements the long-standing TODO comment in the codebase. Partially closes #74.
  - **`discordClaims` in core payload:** The `chunk=core` response now includes a `discordClaims` array so the officer page can display and manage claims (officer claim management UI ships in #45).
- New GAS actions: `discordCallback`, `validateDiscordSession`, `claimCharacter`, `discordLogout`.
- New GAS helpers: `discordOAuthCallback`, `validateDiscordSession`, `claimCharacterForSession`, `isOfficerCharacter`, `ensureDiscordClaimsSheet`, `getDiscordClaims`, `generateSessionToken`, `discordTokenExchange`, `discordApiGet`.
- New files: `discord-callback.html`, `js/discord.js`.

### Setup required (before going live)

1. Create a Discord application at discord.com/developers. Enable `identify` scope. Register redirect URI: `https://katogaming88.github.io/WGA-Raid-Hub/discord-callback.html`.
2. Set `DISCORD_CLIENT_ID` (public) in `js/discord.js` (already set to the app client ID).
3. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` as Script Properties in both GAS deployments (Phoenix and Hellfire).

---

## [2.29.0] - 2026-06-22

### Added

- **Trial promotion improvements.** Closes #145.
  - Officers can now promote a trial player directly from the promotion alert with a "Promote" button on each row -- no longer need to navigate to the player profile.
  - Trial period duration and attendance threshold are now configurable in Season Settings and persisted to GAS script properties. Thresholds default to 4 weeks / 75% if not set.
- **Season Settings reorganised into subtabs.** Settings (name, dates, trial thresholds), Raid Progression, and History (archive + season history) are now separate subtabs instead of one long scroll. Card order also corrected: Season Name now appears before Start Date.

---

## [2.28.0] - 2026-06-22

### Added

- **Team switcher in officer dashboard.** A dropdown in the officer nav bar lets the admin switch between team deployments (Team Phoenix, Hellfire Rollers). Selecting a team saves to sessionStorage and reloads the page against that team's GAS backend. Auth is namespaced per team so switching prompts for the correct officer password automatically. Switcher is officer-page only -- not visible on the public roster.
- **Admin panel for super-admin.** A new Admin tab (officer page only) gives the admin full control over both team deployments:
  - **Properties Inspector** -- live read of all script properties (season name/dates, feature flags, bot URL, masked bot secret).
  - **Bot Config** -- set or clear the bot base URL and webhook secret via the officer UI without touching GAS directly.
  - **Data Export** -- one-click download of the full in-memory DATA object as a timestamped JSON file.
  - **Danger Zone** -- eight targeted destructive operations (clear season history, clear any data sheet) each requiring the admin to type the exact team name before executing.
- New backend GAS actions: `getAdminProperties`, `setBotUrl`, `setBotSecret`, `dangerClearSeasonHistory`, `dangerClearSheet`.

---

## [2.27.0] - 2026-06-22

### Added

- **Archived seasons view and unarchive capability.** Season History now shows rich cards (name, date range, raid count) in reverse-chronological order, each with an Unarchive button. Officers can restore any past season as the active season with a confirmation step -- the dialog warns if an active season would be overwritten. A new `unarchiveSeason` backend action handles the restore and logs it to the audit log. Closes #143.

---

## [2.26.0] - 2026-06-22

### Added

- **Priority over-allocation detection.** The Contested Items view now shows a warning banner listing any player who holds 1st priority on two or more item/difficulty combinations, helping officers spot over-allocation before loot decisions are made. Each affected player's chip in the item cards is also flagged with a red `!` badge. Closes #12.

### Fixed

- **Rank labels now display in Contested Items.** Player chips in the Contested Items view were never showing rank numbers (#1, #2, etc.) due to a bug where the per-difficulty priority object was treated as a flat array. Ranks now render correctly with a difficulty suffix (e.g. `#1H`, `#2M`).

### Changed

- **Contested Items moved from Loot tab to Priority tab.** It is a planning tool, not a loot history tool, so it now lives alongside Priority List and Unmanaged Items.
- **Priority subtabs reordered to match officer workflow.** New order: Contested Items -> Unmanaged Items -> Priority List (what's being fought over -> what still needs a decision -> what's been decided). Contested Items is now the default landing subtab when opening Priority.

---

## [2.25.0] - 2026-06-21

### Added

- **Active M+ exclusion list in officer tab.** The M+ Exclusions tab now shows a "Currently Excluded" section above the pending request queue, listing every player whose exclusion is active with their officer note. No extra network call -- populated from the already-loaded roster data on tab switch. Closes #149.
- **Rejection reason on raider card.** When an officer rejects an M+ exclusion request they are now prompted for an optional rejection reason (matching the existing approve note flow). The reason is saved to the sheet and shown on the raider's public card as a "Rejected" badge with the officer's note. If requests are open, the raider sees a Re-submit button. Closes #144.

---

## [2.24.0] - 2026-06-21

### Added

- **Champion (Normal) loot tier tracking in priority scoring.** The priority generator now recognises Normal-difficulty receipts from all three loot sources (Pasted Loot sheet, Loot Data IMPORTRANGE, and Self Received Requests). For Mythic priority, players with only a Normal receipt receive a 1.07x bonus (vs the 1.15x "No Version" bonus they incorrectly received before). For Heroic priority, Normal holders receive a 0.90x penalty and a "Has Champion" status label -- they are lower priority than players with no version, but still eligible. Self-received source prefixes "Champion:" and "Normal:" both route to the champion tier.

---

## [2.23.0] - 2026-06-21

### Changed

- **BiS List cleared on season archive.** When a season is archived via the officer dashboard, all player item columns (col B onwards from row 3) are now wiped so the sheet is ready for the next season's BiS lists. Slot labels and the player header row are preserved.

---

## [2.22.0] - 2026-06-21

### Changed

- **JSONP timeout handling across all data loading.** Added a `jsonpRequest(url, callback, timeoutMs)` helper to `common.js` (default 90s timeout, 120s for WCL refresh). All 50+ JSONP call sites across every officer tab now use this helper. If GAS hangs or is slow to respond, the request times out cleanly, re-enables the button, and shows "Request timed out. GAS may still be processing -- try again in a moment." instead of leaving the UI stuck indefinitely. Network errors show "Request failed. Check your connection."

---

## [2.21.0] - 2026-06-21

### Added

- **WCL Performance Scores tab** in the officer dashboard (`js/tabs/tab-scoring.js`). Officers can refresh WCL performance scores and commit them to the Scoring sheet without opening the spreadsheet.
- **Three scoring windows**: Recent (last 2 reports), Trend (last 8 reports), Best (last 20 reports). Scores are ilvl bracket percentile / 10, giving a 0-10 scale. Best Score uses the single highest percentile across all 20 reports rather than an average.
- **Inline score editing**: clicking any Recent Score cell opens a number input to manually override the value. The override is saved to the draft column (J) immediately via GAS and the cell updates in place.
- **"Use Best" button** on each Best Score cell copies the best score into the Recent Score column (both the spreadsheet draft and the in-page cache), so the next Commit will use the best score rather than the recent average.
- **Committed badge**: after committing, each eligible player's Recent Score cell shows a "committed" label so officers can see which scores have already been pushed to the Performance column.
- **sessionStorage caching**: scores are stored in `sessionStorage` after each refresh. Returning to the Scoring tab within the same browser session restores the table immediately with a "cached N mins ago" status, avoiding a redundant WCL fetch.
- **Color legend** always visible on the Scoring tab: green (>=7 Strong), gold (>=5 Average), dim (<5 Below average), purple (trend fallback), red (No data), muted (Excluded - Tank/Healer).
- **Healer exclusion from WCL scoring**: healers are now fully excluded from WCL data collection alongside tanks. Both roles are marked "Excluded" in the draft columns with a blue background.
- **Attendance-based scoring for tanks and healers** in the Priority Generator: instead of using the WCL performance score (col E), tanks receive `attendance * 0.50` and healers receive `attendance * 0.75` as their raw score, reflecting that these roles are not meaningfully ranked by DPS bracket percentile.

### Changed

- `refreshPerformanceScores()` and `commitDraftScores()` in `WCL.gs` now delegate to extracted core functions (`refreshWclPerformanceCore`, `commitPerformanceScoresCore`) so the same logic is callable from the web app without triggering `SpreadsheetApp.getUi()` alerts.
- `getRecentReports()` in `WCL.gs` now accepts a `limit` parameter instead of hardcoding 20, so all three scoring windows can share a single GQL fetch sliced in memory.
- `BEST_REPORTS = 20` added to `Config.gs` alongside existing `RECENT_REPORTS` and `TREND_REPORTS` constants.

---

## [2.20.0] - 2026-06-21

### Added

- **Multi-tenant support.** A single frontend now serves both Team Phoenix and Hellfire Rollers. The active team is selected via `?team=phoenix` or `?team=hellfire` URL param (defaults to `phoenix`) and persists in `sessionStorage` so dropping the param mid-session doesn't reset the team. Each team has its own GAS backend URL, team name, and officer password in the `TEAMS` config in `common.js`. Closes #136.
- **Team-scoped session storage keys** (`phoenix_officer` / `hellfire_officer`) prevent officer auth from bleeding between teams in the same browser.
- **Inter-page link passthrough.** Officer Access, Back to Roster, and Cancel links now carry the `?team=` param so navigation stays on the correct team.

### Fixed

- **Officer player card race condition.** Opening a player card then switching seasons triggered `buildRosterTable()` to wipe the inline card. Added `reopenSelectedPlayer()` which restores the card after every roster rebuild.
- **Loot not showing in officer view after copying spreadsheet.** Loot Data sheet entries were added to `lootCounts` without a season tag, so the season filter excluded everything. `getLootCounts()` now reads `seasonName` from Script Properties and tags Loot Data entries accordingly.

### Changed

- GAS web app file renamed from `PhoenixRosterWebApp.gs` to `wgaWebApp.gs`.
- Removed `REPORT_NAME_FILTER` constant — WCL report fetching now returns all guild reports without filtering by title, accommodating teams with inconsistent report naming.
- Changelog and footer links updated from `Phoenix-Roster` to `WGA-Raid-Hub` repo.

---

## [2.19.0] - 2026-06-20

### Added

- **BiS Manager tab** replaces the old BiS Submissions nav item. The tab now has two sub-tabs: Submissions (existing approve/reject workflow, unchanged) and BiS Lists. Closes #128.
- **BiS Lists sub-tab** shows all roster players grouped by role with their current item count. Clicking Edit on any player opens an inline editor below their row with: a list of their current BiS items (each removable), an item search/autocomplete field sourced from the Item Lookup sheet, and Save/Cancel actions. Saves write back to the BiS List sheet and invalidate the heavy cache.
- **Armor type filtering** in the BiS editor item search: results are automatically narrowed to items matching the player's armor type (Plate/Mail/Leather/Cloth derived from their class). Universal slots (Neck, Back, Ring, Trinket, Wrist, Cloak) and items with no armor type recorded are always shown regardless of class. Item Lookup col D = Armor Type; col E = Sort ID; col F = Boss.

---

## [2.18.0] - 2026-06-20

### Added

- **Raid Progression Tracker** on the public landing page. Displays all raids for the current season as side-by-side cards, each showing raid name, mythic kill count, progress bar, numbered boss list with first-kill dates, and an AOTC badge. Closes #80.
- **Raid Progression editor** in Season Settings. Officers can add multiple raids per season, each with a name, optional mini-raid flag (suppresses AOTC), AOTC date, and a list of bosses with individual mythic kill dates. Progression data is persisted in Script Properties and included in the core payload; archived seasons include their raid progression.
- **WCL auto-fill for boss kills.** Each raid card has a WCL Zone ID field and a "Fetch from WCL" button. Clicking it queries the WCL GraphQL API (using existing Script Property credentials) for all guild kills in that zone and populates boss names and first-kill dates automatically. Heroic kill of the last boss in range is used as the AOTC date.
- **Encounter ID range filter** per raid card (from/to fields). Allows multiple raids that share the same WCL zone ID (e.g. Midnight Season 1 zone 46) to be fetched independently by specifying which encounter IDs belong to each raid.
- **"List" button** per raid card that queries WCL for all encounters in a zone and displays their IDs and names inline, making it easy to look up the correct encounter range before fetching.

### Changed

- Landing page stat counters (Raiders, Items This Tier) moved above the character selector card.
- Landing page max-widths widened to accommodate the side-by-side progression layout (landing card 380px -> 500px, stats 380px -> 500px, loot 480px -> 760px, selector 360px -> 460px).

---

## [2.17.0] - 2026-06-20

### Added

- **Priority order management** from the officer dashboard. Dedicated Priority tab lists all items from the BiS sheet, split into Heroic and Mythic rows per item. Officers can drag-and-drop reorder, manually add players from the pool, or hit "Suggest Order" to auto-generate a ranked list. Closes #111.
- **Priority generator** scores eligible players by WCL performance × role multiplier (Tank ×0.50, Heal ×0.75, DPS ×1.00) with bench/trial penalties. Checks three loot sources (Pasted Loot, Loot Data, Self Received Requests) to exclude or penalize players who already have the item.
- **Heroic/Mythic prio split.** Each item has separate Heroic and Mythic priority rows in the Priority Order sheet (col A = difficulty). The generator handles them independently: heroic loot recipients are excluded from heroic prio and penalized ×0.85 on mythic; players with no version get a ×1.15 bonus on mythic prio; self-received/officer-marked items exclude the player from all prio.
- **"Mark Mythic received"** button on BiS list items. Players can submit a self-received request; officers can mark directly. Officers always see the button even when a receipt badge is already shown, so upgrading from heroic to mythic can be recorded. Any approved mark (officer or player) now counts as full exclusion from both prio tiers.
- Diacritic-insensitive name matching in the generator so players with accented names (e.g. Twañ) are correctly matched against loot records.

### Changed

- Priority generator no longer pads results to exactly 10 players -- the suggested list stops when there are no more eligible players.
- Priority tab count label no longer shows `/10`; shows the actual ranked count instead.
- **Unmanaged Items** badge and list now only clear an item once both Heroic and Mythic priorities have been saved. Previously, saving one difficulty removed the item from the unmanaged tab entirely. Partially-configured items now show individual "Set Heroic" / "Set Mythic" buttons for whichever difficulty is still missing.
- **Priority List** adds a "Hide empty" checkbox to the filter bar. When checked, individual Heroic/Mythic rows with no players assigned are hidden, reducing clutter without affecting rows that have rankings.
- **Suggest Order** results now display each player's weighted score and status label (e.g. `Score: 6.6 (Has Heroic)`) inline in the ranked list so officers can see the scoring rationale at a glance.
- A warning box now appears in the priority edit modal when a "Has Heroic" player is ranked above a "No Version" player in the suggested order. The warning updates live as players are reordered and disappears once the ordering is resolved.
- Fixed a crash (`SyntaxError: missing ) after argument list`) when clicking "Set Priority" or "Edit" on items whose names contain an apostrophe (e.g. "Vaelgor's Final Store"). `encodeURIComponent` does not encode `'`, so it is now explicitly percent-encoded to `%27` before being embedded in onclick handlers.

---

## [2.16.0] - 2026-06-19

### Added

- **Season selector** in the officer dashboard toolbar. A "Season:" dropdown filters loot counts, fairness, conflicts, and attendance to the selected season; "All Seasons" retains previous behavior. Defaults to the current season when one is configured. Hidden when no season data exists. Closes #115.
- **Season history store.** Officers can now archive the current season (Season Settings tab), pushing it to an immutable history list with start and end dates. Past seasons appear as options in the season selector. Season history is persisted in Script Properties and included in the core payload.
- **Season End Date** field in Season Settings. Officers can record when a season closes (independent of when the next one starts). Stored as `seasonEnd` in Script Properties.
- **Client-side attendance %** computed from raw per-raid records (`rawAttendanceData` in the heavy payload), replacing the server-computed value for any season other than "current". Replicates the join-date window logic from the backend. Bench fairness sub-tab also filters raid nights to the selected season's date window.

### Changed

- `getAttendanceDetails()` (heavy payload) now returns all-time penalty events without a season cutoff; the frontend filters them to the active season window when rendering the attendance scores list.
- Loot items in `getLootCounts()` now include a `season` field (from column A of the Pasted Loot sheet) to enable client-side season filtering.
- Season Settings tab redesigned into individual cards (Season Start Date, Season Name, Season End Date, Archive Season, Season History). Each card has its own `?` help button with a scoped inline tip, replacing the single cramped panel.

---

## [2.15.1] - 2026-06-19

### Added

- **Attendance trend sparkline on player profile.** The attendance section now shows a small SVG line chart, visible by default without clicking anything. When data spans more than one calendar month, each dot represents a month with the Y position reflecting average attendance that month (green >= 90%, blue >= 70%, yellow >= 50%, red below). When only one month of data exists, individual raid nights are shown instead. Hovering a dot shows an instant tooltip with the month, average percentage, and raid count (or exact date and status for per-night mode). Covers all season data with no cap. Closes #42.

---

## [2.15.0] - 2026-06-19

### Added

- **Bench Fairness sub-tab** on the Attendance tab. Shows how many times each raider has been benched, grouped by role (Tank / Heal / Melee / Ranged / Bench), sorted highest to lowest, with a bar chart and a raid-average reference line. Each row shows bench count and bench rate (benched / total raid nights appeared). Computed from the loaded attendance grid -- run "Refresh from WCL" first if no data appears. Closes #82.

### Changed

- Attendance tab: the Manage Raid Attendance panel (night grid, WCL refresh, Commit Scores) is now its own **Manage** sub-tab. The tab bar now reads **Manage | Attendance Scores | Bench Fairness**. Manage is the default. This prevents the night grid from consuming the full viewport when you just want to check scores or bench fairness.

---

## [2.14.2] - 2026-06-19

### Added

- Dedicated **Help tab** in the officer dashboard sidebar with a full workflow reference. Six step-by-step guides cover: importing RCLootCouncil loot history, refreshing attendance from WCL, manually editing attendance status, committing scores to the roster sheet, setting season start date and name, and the complete season reset workflow. Links within the guide jump directly to the relevant tab.

---

## [2.14.1] - 2026-06-19

### Added

- Contextual help tips on the officer dashboard: every major tab and sub-tab now has a `?` button that toggles an inline tip panel explaining the workflow. Covered sections: Roster, Priority, all four Loot sub-tabs (Import, Import History, Contested Items, Loot Fairness), Attendance, Signups, BiS Submissions, M+ Exclusions, Received Item Requests, and Season Settings (which also includes the full season reset checklist).
- Stat card hover tooltips: hovering any of the four summary cards at the top of the officer dashboard shows a short description of what the number counts.
- Items Distributed stat card now has a difficulty filter badge (All / Heroic / Mythic) in its top-right corner. Clicking it cycles through the three views without affecting card height or layout.

---

## [2.14.0] - 2026-06-19

### Added

- Officers can now edit a player's class, spec, and character name/realm directly from the player profile in the officer dashboard, without needing to delete and re-add the player. Class and spec save on dropdown change; name/realm changes require a Save button. Renaming a player migrates their officer notes to the new key automatically. All three changes are written to the audit log.

---

## [2.13.4] - 2026-06-19

### Added

- Loot Import is now its own dedicated sub-tab in the Loot tab, separate from Import History. Import History shows stored entry count, most recent date, and the Clear All action; Import shows only the paste form.

### Fixed

- "Clear All Loot History" button showed no feedback while the server request was in flight. It now disables and reads "Clearing..." until the response arrives.
- Unmanaged Items notification badge (sidebar and sub-tab) was always blank on page load because the badge was computed at core-payload-ready time, before the heavy payload (which contains priority and item slot data) had loaded. Badge is now also recomputed when the heavy payload arrives.

---

## [2.13.3] - 2026-06-19

### Fixed

- Loot dates still showed as raw strings after 2.13.2 because RCLC exports dates as `"2026/06/09"` and `String()` was passed through verbatim. The import frontend now parses `e.date` with `new Date()` and normalises it to `YYYY-MM-DD` before storing, so Google Sheets reliably converts it to a Date object and `Utilities.formatDate` formats both loot sources identically -- enabling cross-source deduplication to work. Existing imported data with bad dates should be cleared via Clear All and re-imported.

---

## [2.13.2] - 2026-06-19

### Fixed

- Attendance source column incorrectly labeled all players as "Officer" on any re-run of "Refresh from WCL". Root cause: the sheet-reader only preserved the status, not the source, so on rebuild every player with a prior entry was re-tagged Officer regardless of whether the entry originated from WCL or an officer edit. The reader now stores both status and source; sources are preserved faithfully across refreshes.
- "Refresh from WCL" success message auto-cleared after 6 seconds, leaving no indication the import completed if the officer wasn't watching. The message now stays visible until the next refresh.
- Loot import duplicated entries when the same RCLC JSON was re-imported (e.g. after clearing addon data and re-exporting, which resets local RCLC entry IDs). Deduplication now uses both the RCLC ID and a composite key (player + item + instance + date) so identical loot is skipped even if the ID changed between exports.
- Recent loot dates from the RCLC import displayed as raw JavaScript timestamp strings (e.g. "Tue Jun 09 2026 00:00:00 GMT-0400"). Google Sheets auto-converts date strings like `2026/06/09` to Date objects on write; the loot reader now formats them with `Utilities.formatDate` the same way the IMPORTRANGE loot path already did.
- Loot entries appeared doubled when both the `Loot Data` IMPORTRANGE sheet and the `Pasted Loot` sheet contained the same items. `getLootCounts` now deduplicates across both sources using a `player|item|date` key, reading Pasted Loot first so RCLC-imported entries take precedence.

---

## [2.13.1] - 2026-06-18

### Changed

- Self-mark received source options: replaced "World Drop" with "Bonus Roll"

---

## [2.13.0] - 2026-06-18

### Added

- Loot history import from the officer dashboard (#101). The Loot tab now has a third sub-tab, **Import History**, where officers can paste an RCLootCouncil JSON export directly into the web app.
  - Paste area accepts the standard RCLC JSON export (in-game: RCLootCouncil > Export > JSON). Works with any export size — one night, several nights, or the full season history.
  - Imports are **additive**: each paste appends new entries and automatically skips duplicates (deduped by the RCLC entry `id`). Re-pasting a night you already imported is safe.
  - Completion message reports how many entries were added and how many were skipped as duplicates.
  - The panel shows total entries stored and the date of the most recent entry.
  - **Clear All** button (with confirmation) wipes the imported history for use at a season reset.
  - Imported data is written to a new `Pasted Loot` sheet (created automatically) with columns: Season, RCLC ID, Player, Date, Item Name, Instance.
  - The season label applied to all imported entries is set once in the **Season Settings** tab (new Season Name field) rather than entered per import. The Import History tab shows the active season name and warns if none is configured.
  - `getLootCounts()` now reads from both the existing `Loot Data` sheet (IMPORTRANGE) and the new `Pasted Loot` sheet, merging results — no disruption to existing loot data.
  - Import and clear actions are logged to the Officer Audit Log and invalidate the heavy payload cache.

---

## [2.12.0] - 2026-06-18

### Added

- Attendance entry from the officer dashboard (#94). The Attendance tab now has a "Manage Raid Attendance" panel with three new capabilities:
  - **Refresh from WCL** button — triggers a full WCL fetch and rewrites the Attendance sheet without opening the spreadsheet. Shows a progress note ("This may take 30-60 seconds"), then displays a summary (X nights found, Y excluded) on completion.
  - **Night-by-night status grid** — after refresh (or on tab open if data exists), a dropdown lists every raid night. Selecting a night shows all roster players with their current status. Officers can change any status (Present / Bench / Medical Leave / Excused / No Show / Not on Roster) via a dropdown; each change auto-saves to the Attendance sheet and logs to the audit log.
  - **Commit Scores to Sheet** button — calculates attendance scores for all players and writes them to the Scoring sheet column D. Shows an inline confirmation banner before firing, then reports how many players were scored and over how many nights.
- `refreshAttendanceCore()` extracted from `refreshAttendance()` so the WCL fetch logic can be called from the web app without requiring spreadsheet UI.
- `commitAttendanceScoresCore()` extracted from `commitAttendanceScores()` for the same reason; the spreadsheet menu versions now delegate to these core functions.
- `getAttendanceSheetGrid()` backend function — reads the Attendance sheet and returns all raid nights with their full player/status list as JSON.
- `setAttendanceStatusInSheet()` backend function — finds a specific player/date row in the Attendance sheet and updates the status and source columns.
- Four new web app action handlers: `refreshAttendanceWCL`, `commitAttendanceScores`, `getAttendanceGrid`, `setAttendanceStatus`. All attendance mutations are logged to the Officer Audit Log.
- Attendance status editing from the player profile card. Expanding a player's attendance history now shows editable dropdowns on each row instead of static labels, allowing per-entry status changes without leaving the roster view. "Not on Roster" entries (pre-join-date raids) remain static labels. Changes save immediately with the same Saved/Error feedback as the grid.
- All attendance status dropdowns (night selector, grid rows, profile card rows) now show a gold `▾` chevron indicator so they are visually identifiable as interactive controls.
- Green `✓` checkmark on attendance grid rows where a status has been committed to the sheet (WCL-imported, auto-benched, or officer-entered). Rows with no status show no checkmark, making it easy to spot entries that still need to be filled in. The checkmark persists after saving a change in the current session.

---

## [2.11.1] - 2026-06-18

### Fixed

- Excused absences now carry a partial penalty (weight 0.8) in the webapp attendance percentage, matching the Scoring sheet formula. Previously Excused was treated as a full penalty (same as No Show), causing attendance % to be understated for players with excused absences.
- Players present in a WCL log but not in any ranked fight (e.g. joined mid-raid, sat out boss attempts) are now correctly detected as present. The combatants list (`masterData.actors`) is now always merged with rankings rather than used only as a last resort when rankings are completely empty.
- Players with "Not on Roster" entries no longer have those raids counted in their attendance denominator, fixing badly deflated percentages for mid-season additions (e.g. showing 26.9% instead of 100%).

### Changed

- Low-attendance threshold raised from 90% to 95% across the filter chip, attendance tab slider default, roster filter logic, and color bands.

---

## [2.11.0] - 2026-06-18

### Added

- Season start date setting in a new Season Settings tab on the officer dashboard. Officers can set (or clear) the date the current raid season began; the value persists in Script Properties and is included in the core payload for all clients.
- Mid-season join exclusion: raids between the season start date and a player's personal join date are excluded from their attendance penalty list and attendance percentage. The full attendance history view (expandable per-player) labels those excluded raids as "Not on Roster" in a greyed style so officers can still see the full timeline.
- Attendance percentage now computed directly from the Attendance sheet rather than the Scoring sheet formula, giving accurate per-player denominators that respect both the season start and each player's join date. Closes #107.
- Add Player modal now includes an editable Join Date field (defaults to today) so officers can backdate a player's join date at the time of adding them.
- Medical Leave attendance status with weight 1.0 (no penalty, same as Present). Appears in the Attendance sheet dropdown, displayed in light blue in both the sheet and the webapp attendance history view.
- "Sync % to Roster Sheet" button in the officer Attendance tab. Computes attendance % using the same logic as the player-facing display and writes the values directly to Roster sheet column C.
- WCL attendance import now fetches all reports for the Team Phoenix guild tag rather than filtering by report title. Fixes missing raid nights whose WCL log titles did not contain "Phoenix". Alt runs (title contains "Alt") are still excluded and appear in the Excluded section at the bottom of the Attendance sheet.
- WCL API credentials moved from Config.gs to Script Properties via a `setWCLCredentials()` helper, keeping them out of version control.

### Fixed

- Attendance % denominator now computed from player rows in the Attendance sheet rather than header rows. Header rows for some raids lacked a date in col A, causing those raids to be silently dropped from the denominator.

### Changed

- WCL queries scoped to Team Phoenix guild tag ID rather than the overall guild ID.
- Updated active tanks (added Adrestia, removed Hinda and Rothdar) and healers (added Kaya, removed Puddinpie) in Config.gs.

---

## [2.10.0] - 2026-06-18

### Performance

- Payload split into two separately cached JSONP chunks to eliminate load timeouts. A fast `?chunk=core` request (roster, toggle flags, bisAllowedPlayers, playerNotes) returns in under 1 second and lets both pages render immediately. A `?chunk=heavy` request (lootCounts, attendanceDetails, bisList, priorityOrder, itemSlots, selfReceived) fires right after and fills in loot counts, recent loot, BiS/priority content without blocking the visible render. Cache keys are invalidated precisely: roster mutations clear `rosterCore` only (300 s TTL); loot/BiS mutations clear `rosterHeavy` only (900 s TTL); the manual Clear Cache button clears both. Closes #104.

---

## [2.9.0] - 2026-06-18

### Added

- Join date per player tracked in Roster sheet column M. Automatically set to the current date when a player is added via the officer dashboard or approved from Pending Roster. Visible on the player profile (below the role/class badges) and in the officer roster table (below the class badge in the Player cell). Officers can manually set or correct a join date from the Player Settings panel on any profile. Changes are logged in the Officer Audit Log. Closes #77.
- Officer Audit Log now records an entry whenever an RCLootCouncil export string is generated from the Priority tab.

---

## [2.8.0] - 2026-06-18

### Added

- RCLootCouncil export string accessible directly from the Priority tab in the officer dashboard. A card at the top of the tab has a Generate button that rebuilds the export string on demand (same logic as the spreadsheet Export Priority Data function, minus the dialog) and displays it in a copyable text area. The freshly generated string is also written back to `Export!A11` to keep it in sync. No spreadsheet access needed. Closes #98.

---

## [2.7.3] - 2026-06-18

### Fixed

- Attendance history now sorts newest-to-oldest by date regardless of sheet row order.

---

## [2.7.2] - 2026-06-18

### Fixed

- Clicking anywhere inside the BiS List, Items Received, or Attendance sections no longer collapses them. The toggle is now scoped to the section header row only for all three sections.

---

## [2.7.0] - 2026-06-18

### Added

- Full attendance history per player in the officer profile panel. An "Attendance History" section appears below the attendance bar when viewing any player as an officer. On first click it fetches the complete date-by-date log (all statuses, not just penalties) via a new `getPlayerAttendanceFull` endpoint. Shows a summary line (e.g. "42 Present, 2 Late, 1 No Show") followed by a scrollable list newest-first, colour-coded by status. Result is cached for the session so subsequent toggles don't re-fetch. Closes #14.

---

## [2.6.1] - 2026-06-17

### Changed

- Class/spec badge on the player profile and officer roster now shows spec name only (e.g., "Demonology" instead of "Warlock - Demonology"); badge color remains the class color. Falls back to class name if no spec is set. Officer roster badge now uses the same pill styling as the profile header.

---

## [2.6.0] - 2026-06-17

### Added

- "Fully BiS" badge on the player profile header -- appears automatically when a player has received every item on their BiS list (from any source: raid loot, M+, crafted, etc.). Visible to both raiders and officers. Closes #40.

---

## [2.5.0] - 2026-06-17

### Added

- Officer action audit log -- every officer mutation is now recorded in an append-only "Officer Audit Log" sheet. Covers: player add/remove, role/spec/trial/bench changes, BiS approvals/rejections/direct updates/submission toggles, signup approvals/denials, self-received approvals/rejections, loot direct-marks, M+ exclusion toggles/approvals/rejections/bulk-clear, officer note changes, and open/close toggles for signups, BiS submissions, and M+ exclusions. Closes #83.
- Dedicated Audit Log tab in the officer dashboard with Time, Changed By, Action, Target, From, and To columns. URLs (e.g. BiS links) render as truncated clickable links. Live search filter across officer, action, and player name.
- "Changed By" column schema in place for when Discord OAuth ships -- blank for now, wired up and ready (#25).

---

## [2.4.3] - 2026-06-17

### Added

- Pending action count badges on officer tab nav buttons -- Signups, BiS Submissions, M+ Exclusions, and Received Item Requests each show a red count badge when items need attention; Signups badge combines open signups and pending roster entries, with a separate badge on the Pending Roster sub-tab. Badges load on dashboard open and refresh automatically after any approve/reject action. Closes #76.

---

## [2.4.2] - 2026-06-17

### Added

- Last received item highlight on the player profile -- shows the most recent loot upgrade(s) prominently with item name colored by difficulty, date, and a gold accent, always visible without expanding the full history. Groups multiple items received on the same night. Closes #41.
- Date now shown on every entry in the expanded Items Received list alongside slot and difficulty.

---

## [2.4.1] - 2026-06-17

### Added

- BiS completion percentage in the player profile header -- shows percentage complete and received/total count, calculated from raid loot history and self-reported items. Closes #39.

---

## [2.4.0] - 2026-06-17

### Added

- Unmanaged Items sub-tab on the Priority tab -- lists all items with no players ranked yet, grouped by slot type with collapsible armor sub-sections (Head, Shoulders, etc.). Closes #13.
- Red notification badge on the Priority sidebar nav button and on the Unmanaged Items sub-tab chip showing the count of unmanaged items; badge appears immediately on dashboard load.
- Armor slot sub-sections (Head, Shoulders, Chest, etc.) are now individually collapsible on both the Priority List and Unmanaged Items tabs.

---

## [2.3.1] - 2026-06-16

### Fixed

- Version number now appears in the footer on the profile and signup views (was only shown on the landing view).

### Changed

- Player card section labels renamed for clarity: "BiS Checklist" -> "BiS List", "BiS Link" -> "BiS Source".
- M+ Exclusion section moved below BiS List on the player card.

---

## [2.3.0] - 2026-06-16

### Added

- M+ Excl. column on the officer roster table with a green checkmark for excluded players, matching the BiS Link column style.
- Officer direct mark received: when an officer marks an item as received from the player profile, it is approved immediately without going through the approval queue. The source badge and green row highlight appear inline without a reload.
- Mark received button now shows on M+, Crafted, and Catalyst BiS rows (previously hidden). Source dropdown is pre-selected to match the known source.
- Player Settings section in the officer profile is now collapsible, starting collapsed. Clicking the section label expands or collapses it without affecting the controls inside.

### Changed

- Officer dashboard tab layout restructured: Contested Items and Loot Fairness merged under a single Loot tab with sub-tabs. Priority remains a standalone tab. Received Item Requests moved to the bottom of the sidebar.
- Signups and Pending Roster are now sub-tabs within the Signups tab rather than separate sidebar entries.
- Player profile in the officer roster now opens as an inline row directly below the clicked player instead of at the bottom of the page. Clicking the same player again closes it.
- Toggling M+ exclusion from the officer profile now immediately updates the M+ Excl. column in the roster table without requiring a reload.
- Expand/collapse hints changed from "tap to" to "click to" throughout the officer profile.

---

## [2.2.0] - 2026-06-16

### Added

- Signup approve/deny: officer approve writes applicant to Pending Roster sheet and marks status in Roster Responses; deny marks the row as Denied. Status badges shown on all signup cards.
- Pending Roster tab in the officer dashboard: lists approved applicants awaiting formal roster placement, with Add to Roster (pre-fills the Add Player modal) and Remove buttons.
- M+ Exclusion system: raiders submit a Raider.io profile link from their character profile to request exclusion from dungeon loot consideration. Officers open/close the form via a toggle in the M+ Exclusions tab.
- Discord bot notifications for M+ exclusion submissions via the `/mplus` endpoint.
- M+ exclusion status derived entirely from the M+ Exclusion Requests sheet (approved rows) merged with a ScriptProperties manual override list -- no Roster sheet column required.
- Officer can manually mark or unmark any player as M+ excluded from the Player Settings section of their profile (button toggle matching Trial/Bench pattern).
- Optional officer note on M+ exclusion approvals -- officer enters a note before confirming approval; note is stored in column 6 of the M+ Exclusion Requests sheet and shown in italic on the raider's profile below the Excluded badge.
- Clear All Exclusions button in the M+ Exclusions tab for season resets -- removes all manual exclusions and resets all Approved rows to Reset in the sheet. Requires a two-step confirm.
- M+ Excl. column on the officer roster table with a green checkmark for excluded players, matching the BiS Link column style.

### Fixed

- Add to Roster in the Pending Roster tab was silently failing because `prompt()` is blocked in GAS iframes -- replaced with an inline nickname form using `addEventListener`.
- Approve/Cancel buttons in the inline nick prompt were unresponsive -- root cause was two child divs inside a `display:flex` row parent; fixed by wrapping injected HTML in a single `width:100%` container.
- Player added from Pending Roster did not appear in the roster tab until a full reload -- `buildRosterTable()` and `buildStatsBar()` are now called immediately on success.
- Approved signups reappeared when switching back to the Signups tab because `buildSignupsTab()` re-fetches on every switch -- approved entries are now filtered client-side before rendering.
- Officer view showed two M+ exclusion sections (profile section and Player Settings button) simultaneously -- M+ exclusion profile section is now suppressed when `backTo === 'officer'`.

---

## [2.1.0] - 2026-06-15

### Added

- Discord notifications via the team-phoenix bot for all three raider submission actions: raid signup, self-received item request, and BiS list submission
- `sendToBot()` helper in `PhoenixRosterWebApp.gs` posts to `/signup`, `/selfreceived`, and `/bis` endpoints on the bot after each write

---

## [2.0.6] - 2026-06-15

### Reverted

- Removed mobile overflow hiding and roster table scroll wrapper -- the officer dashboard is desktop-first and the overflow-x:hidden approach was clipping UI elements. PR #67 toolbar/nav improvements are kept.

---

## [2.0.5] - 2026-06-15

### Fixed

- Mobile horizontal scroll: apply `overflow-x:hidden` to both `html` and `body` -- setting it on `body` alone allows browsers to transfer the scroll to the `html` element

---

## [2.0.4] - 2026-06-15

### Fixed

- Page-level horizontal scroll on mobile suppressed; only the roster table container scrolls horizontally

---

## [2.0.3] - 2026-06-15

### Changed

- Roster table on mobile: BiS Link column hidden to reduce width; table wrapped in a horizontal scroll container so only the table scrolls, not the whole page

---

## [2.0.2] - 2026-06-15

### Changed

- Officer dashboard switched back to centered layout at `max-width:1600px` so the header and content share the same centre column on wide screens
- Officer mobile layout: toolbar now stacks title above buttons (no more mid-word button wrapping); nav tabs replaced wrapping rows with a single horizontal scroll strip

---

## [2.0.1] - 2026-06-15

### Added

- Landing page stats row: Raiders count and Items This Tier, displayed below the selection card
- Landing page Recent Loot: last 10 items distributed across all players, sorted by date, showing player name, item, difficulty badge, and date
- Clicking the header on any page navigates back to the roster

### Changed

- Officer dashboard is now left-aligned so the sidebar sits near the left edge on wide screens; max-width raised to 1400px
- Landing content wrapped in a card panel (dark background, gold top accent border) for visual presence on wide screens
- Header subtitle changed from "Loot Priority" to "Raid Hub" on both pages
- Officer Access link moved to the bottom of the landing card
- Version number now appears in the `index.html` footer

---

## [2.0.0] - 2026-06-15

### Changed

- Split monolithic `app.js` (2130 lines) into 12 focused modules: `common.js`, `roster.js`, `signup.js`, `officer.js`, and 8 tab-specific files under `js/tabs/`
- Officer panel moved to a dedicated `officer.html` page; `index.html` now serves public views only (roster, profile, signup)
- Officer password gate now appears immediately on `officer.html` load -- no data is fetched until authentication succeeds
- Officer sessions expire after 2 hours; re-visiting the page after expiry prompts for the password again
- `css/officer.css` stub added for a future officer-styles split pass

---

## [1.8.0] - 2026-06-15

### Added

- Items Received on player profiles now shows the slot and difficulty for each item
- Slot label uses the same color coding as the BiS priority list
- Tier token names (e.g. "Voidcast Fanatical Nullcore") resolve correctly via prefix match against Item Lookup, handling the armor-type suffix added in the sheet

---

## [1.7.0] - 2026-06-15

### Added

- Officer profile view: "Player Settings" section to change a player's role, trial status, and bench status without editing the sheet directly
- Role change also updates the Priority column (Tank=3, Heal=4, DPS=5); Raid Leader and Officer priorities (1-2) are left untouched
- Bench toggle writes priority 6 when benching; derives the correct priority from the player's role when un-benching
- Officer notes per player -- free-text, stored server-side, visible only in the officer dashboard

### Changed

- "Requests" nav tab renamed to "Received Item Requests" for clarity

---

## [1.6.0] - 2026-06-15

### Added

- BiS list URL submission built into the webapp -- raiders submit from their character profile (replaces the Google Form)
- Officers can open/close BiS submissions globally from the new "BiS Submissions" officer dashboard tab
- Officers can grant per-player BiS submission access from the raider's profile card, independent of the global toggle
- Per-player access is automatically revoked after the player submits
- Officer profile view: "Update BiS Link" form to set a player's BiS URL directly without the approval queue
- BiS Submissions tab: pending submissions listed as cards with Approve and Reject buttons; approving writes the URL to the Roster sheet
- Apps Script: setBisSubmissionsOpen, submitBiS, getPendingBiS, approveBiS, rejectBiS, updateBisLink, allowBisForPlayer, revokeBisForPlayer actions; bisSubmissionsOpen and bisAllowedPlayers included in buildPayload

### Changed

- Muted and dim text colors lightened (--text-muted: #c4bdb2, --text-dim: #aea9a0) for better readability on dark backgrounds
- Base font size increased to 18px with a comprehensive rem-scale bump across all small text
- Stat card number size reduced to 1.8rem; stat label to 0.8rem to prevent oversizing at new base
- Officer sidebar tab text reduced to 0.82rem

---

## [1.5.0] - 2026-06-15

### Added

- Raiders can mark BiS items as received outside of raid (M+, Great Vault, Crafted, Catalyst, World Drop) directly from their character profile
- Inline source picker form expands per item -- source required, notes optional
- Submissions go to a new "Self Received Requests" sheet with status Pending/Approved/Rejected
- Officer dashboard: new "Requests" tab lists all pending requests with Approve and Reject buttons
- Approving a request busts the roster cache and shows a gold source badge on the player's profile
- Apps Script: requestSelfReceived, getPendingRequests, approveRequest, rejectRequest actions; getSelfReceived included in buildPayload
- TODO(auth) markers in both Apps Script and JS indicate where Discord OAuth will bypass officer approval

### Notes

- Self-reported items are excluded from Loot Fairness -- that tab reflects RCLootCouncil raid distributions only

---

## [1.4.0] - 2026-06-15

### Added

- Season signup form -- multi-step flow (character/realm, class grid, spec/off-specs/role, Discord/notes, confirmation) accessible from the landing page
- Custom realm combobox with live filtering across all NA and OCE realms
- Off-spec checkboxes exclude whichever main spec is selected and update live on change
- Role selector shown only for hybrid classes (Death Knight, Demon Hunter, Druid, Evoker, Monk, Paladin, Priest, Shaman, Warrior)
- Officers can open/close signups from the Signups tab -- state persists server-side via Apps Script ScriptProperties and is reflected in the landing page CTA
- Submissions are written to a "Roster Responses" sheet (auto-created if missing)
- Officer Signups tab fetches and displays all submissions as cards, newest first
- Delete button on each submission card -- removes the row from the sheet and the card from the DOM without a full reload
- Clear Cache button in the officer dashboard toolbar
- Color-coded class and spec display on player profiles and the roster table

### Changed

- Apps Script write pattern established: GET-based `?action=...` JSONP calls handle all writes (`submitSignup`, `deleteSignup`, `setSignupsOpen`) -- no POST endpoint required

---

## [1.3.0] - 2026-06-14

### Added

- Officer view sidebar navigation — vertical nav replaces flat tab bar, sticky on desktop and collapses to horizontal row on mobile
- Stats bar at the top of the officer dashboard showing Raiders count, Avg Attendance, Items Distributed, and BiS Submitted ratio
- "Data as of HH:MM" timestamp in the officer toolbar showing when the roster was last fetched
- Attendance tab threshold slider — filter players at or below any attendance %, defaulting to 90%
- Priority tab item search — live filter across all items by name
- Collapsible priority sections — click any section header (Trinkets, Armor, Weapons, etc.) to collapse or expand
- Loot Fairness difficulty filter — All / Heroic / Mythic chips filter the bar chart and average line
- Average line marker on the Loot Fairness chart with a legend showing the roster average item count
- "Received (Heroic)" / "Received (Mythic)" badge on contested items for players who already got that item, with strikethrough styling
- Difficulty shown per item in player profile Items Received section
- Backend: `lootCounts` now includes `heroicCount`, `mythicCount`, and per-item `difficulty` field

### Changed

- Loot Fairness bars are now grouped by role (Tanks / Healers / Melee / Ranged / Bench) with coloured section headers
- Loot Fairness bars increased from 6px to 10px height
- Roster attendance column now shows a mini progress bar below the percentage
- Roster player avatars now use a solid 2px role-coloured border
- Search bars moved above filter chips on the roster tab for better flow
- "BiS Conflicts" tab renamed to "Contested Items"

---

## [1.2.0] - 2026-06-14

### Added

- Priority tab in the officer dashboard — full ranked list for every item, grouped by type (Trinkets, Armor by slot, Weapons, Jewelry)
- Player names in priority lists are role-coloured with a role badge (TANK / HEAL / MELEE / RANGED) to the right
- By Raid sort placeholder (disabled until raid source data is available)

---

## [1.1.0] - 2026-06-14

### Added

- Sort chips on the officer roster (Name / Attendance / Items) — clicking twice reverses order
- Player name search filters the roster live as you type
- BiS item search filters roster to players who have a specific item in their BiS list, with a player count badge
- Role filter chips on the officer roster (Tank / Healers / Melee / Ranged) — clicking a second time deselects
- CHANGELOG, CONTRIBUTING, PR template, issue templates, ROADMAP, .gitignore, and VS Code workspace settings

---

## [1.0.0] - 2026-06-14

### Added

- Raider view: character select, attendance bar, items received, BiS link, loot priority table
- Officer dashboard with password login (session-scoped)
- Roster tab: full player table with attendance, items received, BiS link status, trial/bench tags
- Roster filters: Low Attendance, No BiS Link, Trials Only, Bench Only
- Expandable player profiles inline in the officer roster
- BiS Conflicts tab: raid items sorted by how many players want them, with priority ranks
- Loot Fairness tab: bar chart of items received per player, coloured by role
- Attendance tab: players below 90% sorted lowest first with penalty dates
- 5-minute server-side cache via Google Apps Script with manual clear option
