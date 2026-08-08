# Database Decisions Log

A running record of settled database/schema decisions and the reasoning behind them. Each entry links back to the GitHub issue comment with the full discussion -- this log is a summary and index, not a replacement for that context.

Issues carrying a decision are tagged with the `decision` label: `gh issue list --label decision --state all`.

Each heading's date is the real calendar date the decision was made. It is deliberately **not** taken from the accompanying migration's filename: those timestamps only have to increase monotonically, and have drifted well ahead of real time (the migration written on 2026-07-11 is named `20260726...`). Entries from 2026-07-12 through 2026-07-18 were dated that way by mistake and have been corrected to when they were actually committed.

---

## 2026-08-08 -- `wcl-progression-sync`: extend the cron sync to Heroic, not just Mythic (#629)

Decided directly in conversation, expanding #629's original ask (automate the AOTC date) to the same live pull-count/best-%/kill-date tracking Mythic already gets, since AOTC is really just one derived fact from that same Heroic data.

- **One unfiltered fights query instead of two filtered ones.** #629 flagged that adding a Heroic query would roughly double this job's WCL API usage. Instead, the `reports()` query dropped its `fights(difficulty: 5)` filter in favor of a bare `fights { ... difficulty ... }` and buckets each fight into a Mythic or Heroic `DifficultyAgg` in the same pass -- no extra request/page loop per zone. LFR/Normal fights ride along in the same response and are simply ignored.
- **`team_raid_progress` gained `heroic_pulls`/`heroic_best_pct`/`heroic_report_code`/`heroic_fight_id`** to sit alongside the `heroic_date` column that already existed (added with #285 but never written to by anything automatic -- only the officer-triggered "Fetch from WCL" button computed a Heroic kill date, and only for the AOTC field).
- **No cron write into `team_settings.config.raidProgression`.** #629 flagged that AOTC only exists inside that JSON blob and a cron merge into it would be uglier than a normalized column write. Sidestepped entirely: the public progression card now prefers the *live* `team_raid_progress` Heroic kill date on a raid's last boss over the officer-typed `raid.aotcDate` field, falling back to it only when the sync hasn't produced one yet. AOTC updates itself the moment the sync sees the kill, with zero risk of a cron job clobbering an officer's manual entry (there's nothing to clobber -- it never writes there).
- **Displayed per-boss, not just used for AOTC.** Each boss row on the progression card now shows a second Heroic line (kill date once cleared, otherwise live pulls + best % remaining, with a report link when the sync found one) -- the same shape the Mythic row already has via `_renderPullsBadge()`, factored into a parallel `_renderHeroicRow()`. Mythic's own "killed" gating (`boss.mythicDate`, config-JSON, officer-confirmed via Save) is untouched -- only the new Heroic row is fully live/unconfirmed, since there's no equivalent manually-saved per-boss Heroic field to prefer it over.
- Implemented in `20260808164225_team_raid_progress_heroic_columns.sql` (schema only) plus a `wcl-progression-sync` function-body change -- no RLS change, existing "Officers write team_raid_progress" policy already covers the new columns.

## 2026-08-07 -- `update_own_signup()`: allow editing an already-`added` signup while its season is still open

Decided directly in conversation (no tracking issue), found from a screenshot: a raider already promoted to the roster (`status = 'added'`) saw a hard "signup details are locked" message even while the team's signup window for that season was still open and other raiders were still submitting.

- **Root cause**: `update_own_signup()` (from #500) locked any `status = 'added'` row outright, treating "already on the roster" as always meaning "the signup window is closed." Those aren't the same thing -- an officer can (and routinely does) promote signups while the season's signup window stays open for everyone else.
- **The season-open check is free**: `get_own_signup()` already only returns an `added` row while its `season` still matches `team_settings.config.activeSignupSeason` -- once an officer moves that setting on, the row stops coming back and the raider gets a fresh form instead. So "the raider is looking at their added signup" and "signups for that season are still open" were already the same fact; `update_own_signup()` just wasn't using it. The fix re-derives the same check server-side (season match) rather than trusting the client.
- **Edit does not touch the live roster directly.** Considered auto-syncing the edited name/class/spec straight onto the `players` row `add_signup_to_roster()` already created, but Kat rejected that -- an officer should still have to approve any change to someone already on the roster. Instead, editing an `added` signup reverts it to `pending` (clearing `approved_player_id`/`reviewed_at`/`reviewed_by`/`signup_officer_note`, same as the existing `approved`-not-yet-promoted edit path from #500) and sends it back through normal officer review + a fresh `add_signup_to_roster()` promotion, which naturally applies the edit via its existing upsert-by-`name_realm` behavior.
- **`approved_player_id` is nulled alongside the status revert** -- required by the pre-existing `season_signups_player_only_when_added` CHECK (only `added` rows may have it set).
- Implemented in `20260807232530_update_own_signup_allow_added_while_open.sql`, function body only -- no RLS or schema change. `docs/RLS.md`'s `update_own_signup` entry and `tests/rls/own-signup.test.js` updated to match.

## 2026-08-06 -- `add_signup_to_roster()`: compute join_date in America/New_York, not the session's UTC current_date

Decided directly in conversation (no tracking issue), found live: pushing Phoenix's pending roster to active in the evening EDT set new characters' `join_date` one calendar day ahead (Aug 6 EDT showed as Aug 7).

- **Root cause**: `add_signup_to_roster()` used bare `current_date` for a new character's `join_date`. Supabase's DB session runs in UTC by default (confirmed: `show timezone` -> UTC), so `current_date` is "today in UTC," not "today in the raid's local timezone." Past roughly 8pm EDT / 9pm EST, UTC has already rolled to the next calendar day. Same class of bug the rest of this codebase already accounts for elsewhere (`import_rclc_loot()`'s `awarded_at`, `mapSupabaseLoot()` in `js/common.js`) -- just missed here since `join_date` is a plain `date` column, not a `timestamptz`, so there was no obvious "at time zone" spot to reach for.
- **Fix**: compute `v_today := (now() at time zone 'America/New_York')::date` once at the top of the function and use it everywhere `current_date` was used -- both the new-character `join_date` insert and the join_date-carry-over guard added earlier the same day (20260806202156), which compared against `current_date` too and inherited the same one-day-early cutoff.
- **Test coverage**: `tests/rls/promotion.test.js` gained an assertion that a newly-created character's `join_date` matches `(now() at time zone 'America/New_York')::date` computed independently in the test -- proves the fix's actual behavior rather than depending on wall-clock luck (the bug is only externally observable as wrong in the roughly-4-hour daily window where UTC and America/New_York disagree on the date).
- **Swept for the same bug elsewhere**: `current_date` only appears in this function's own migration history across the whole `supabase/migrations/` tree -- no other latent instance found.
- **Known pre-existing bad data not covered by this migration**: Phoenix's roster push tonight straddled the UTC midnight rollover before this fix shipped -- 5 of the pushed characters landed with `join_date = 2026-08-07` instead of `2026-08-06` (`Saucewell-Area 52`, `Khaosmagi-Thrall`, `Sullÿ-Thrall`, `Drowzen-Moon Guard`, `Astraoneiros-Area 52`; ids 176/182/185/190/197). Corrected with a one-off `update ... where id in (...)` run directly against production -- the fix only prevents this going forward, it doesn't repair rows already written under the old function.

## 2026-08-06 -- `import_rclc_loot()`: parse track from anywhere in the instance string, not just after the last hyphen

Decided directly in conversation (no tracking issue), found while backfilling Phoenix's missing Sporefall loot history and noticing every imported row showed "Other" instead of its real difficulty in the Loot feed.

- **Root cause**: track parsing assumed every RCLC `instance` string has the fixed shape `"<Name>-<Difficulty>"` and took everything after the *last* hyphen as the difficulty word (`regexp_replace(instance, '^.*-', '')`). Sporefall is a Mythic Flex raid (15-25 players), and RCLC's instance string for it is `"Sporefall-Mythic - Flexible Raiding"` -- a second hyphen before the flex qualifier. The greedy match consumed through that second hyphen too, leaving `"Flexible Raiding"` as the parsed suffix instead of `"Mythic"`, so `track` landed `null` on every Sporefall row.
- **Fix**: search the whole instance string for `mythic`/`heroic`/`normal` as a standalone word (case-insensitive, `~* '\mword\M'`) instead of assuming a fixed trailing shape. Robust to whatever comes after the difficulty word. Implemented in `20260806214054_import_rclc_loot_flex_track_suffix.sql`, same 3-arg signature -- function body only, no RLS or schema change.
- **Test coverage added**: `tests/rls/rclc-loot-import.test.js` -- nothing tested this function before. Covers the classic `"<Name>-<Difficulty>"` format, the Sporefall flex format (regression case), an unrecognized instance string staying `null` rather than guessing, item/player resolution, the unknown-player archived-stub path, unresolved-item counting, dedupe-by-`rclc_id`, and the officer/team-leader authorization gate.
- **Pre-existing bad data already backfilled manually**, not by this migration: the 10 Sporefall rows already imported to Phoenix before this fix landed had `track = null`. Fixed with a one-off `UPDATE ... where rclc_id in (...)` mapping each row back to its correct track by hand, run directly against production. Nothing else affected -- Sporefall was the only raid using a flex-qualified instance string so far.

## 2026-08-06 -- `archive_current_season()`: wipe placeholder BiS entries too, not just real items

Decided directly in conversation (no tracking issue), found while walking through what "Start New Season" does before running it on Phoenix tonight.

- **Previous behavior (#498)**: the season-end `bis_items` wipe explicitly excluded placeholder rows (`and not i.is_placeholder` in the DELETE) -- items tagged as "Other Sources" (M+/Crafted/Catalyst), which have no real `wow_item_id` and exist purely to flag a slot as covered by something other than a raid drop. Real item picks were wiped; these carried forward untouched.
- **Why that's wrong**: per Kat, every BiS list/wishlist is scoped to a season the same as real items are -- what a raider wants from a Mythic+ vault, or has crafted, can target a completely different slot next tier. There's no more reason to carry a stale placeholder forward than a stale real-item pick.
- **Fix**: dropped the `is_placeholder` exclusion from the DELETE in `archive_current_season()` -- the whole `bis_items` table gets wiped for the active roster on archive, not just the real-item subset. The season-history snapshot (`v_bis_snapshot`) was never filtered by `is_placeholder` in the first place, so nothing changes about what's preserved in `seasonHistory`. Implemented in `20260806210047_archive_season_wipe_placeholder_bis.sql`, function body only -- no RLS or schema change. Confirmation-dialog copy in `js/tabs/tab-season.js` updated to match (previously said "M+/Crafted/Catalyst entries are kept").

## 2026-08-06 -- `add_signup_to_roster()`: carry `join_date` to the new character on a main-swap archive

Decided directly in conversation (no tracking issue), found while walking through what Phoenix's "Start New Season" / pending-roster push would do before running it tonight.

- **Root cause**: same shape as the `team_member_id` fix below (2026-08-03) but a separate gap the original fix didn't cover. On a genuine main-swap (new character name/realm, distinct from the old one), the new `players` row is a plain insert with `join_date = current_date` -- there's no `(team_id, name_realm)` conflict to trigger the on-conflict branch that would otherwise preserve an existing date. Every main-swap silently reset the raider's displayed tenure to "today."
- **Fix**: capture the archived row's `join_date` alongside `team_member_id`, then apply it to the new row only if the new row's `join_date` is still today's date (i.e. it went through the plain-insert path, not the on-conflict reactivation path). Implemented in `20260806202156_add_signup_to_roster_carry_join_date.sql`, same 5-arg signature -- function body only, no RLS or schema change.
- **Reactivating a previously-archived alt as the swap target still lands on the swapped-from date, not the alt's own original history.** The existing on-conflict branch already refreshes a reactivated archived character's `join_date` to today (same as it refreshes `is_trial`) regardless of this fix -- so there was never an "alt's own date" being preserved for this fix to protect. The swap-carry logic runs after that refresh and overwrites the resulting today's-date with the swapped-from date, same as the plain-insert case. Covered by `tests/rls/promotion.test.js`.
- **No backfill.** Unlike the `team_member_id` fix, this doesn't correct any already-processed signups -- Phoenix's roster push happens after this migration ships, so nothing needed fixing retroactively.

## 2026-08-03 -- `add_signup_to_roster()`: carry `team_member_id` to the new character on a main-swap archive

Decided directly in conversation (no tracking issue): found while investigating why a Hellfire officer (Crilynn-Nesingwary, `team_members.role = 'officer'`) lost dashboard access after a main-swap signup archived her old character in favor of a new one (Vellisara-Nesingwary).

- **Root cause**: `add_signup_to_roster`'s `p_archive_player_id` path only set `archived_at = now()` on the old `players` row -- it never moved `team_member_id` (the Discord account / role link) to the newly inserted row for the new character name. The account link was orphaned onto an inactive, archived character; the new active character came in completely unclaimed.
- **Not officer-specific.** Any raider's claimed-character link breaks the same way on a main-swap, officer or not -- confirmed 11 approved-but-not-yet-pushed main-swap signups on Phoenix at the time, one of which (`Ród-Shadowsong <- Hotstreak-Shadowsong`) also carried an officer's link and would have hit the identical failure if pushed to roster before this fix.
- **Fix**: capture the archived row's `team_member_id` before nulling it out, then apply it to the new row only if the new row doesn't already have one (protects the reactivation path, where an existing archived row matching the new name might already carry its own link). Implemented in `20260803230409_add_signup_to_roster_carry_team_member.sql`, same 5-arg signature as `20260726145742_players_backup_tank_healer.sql`, function body only -- no RLS or schema change.
- **Known pre-existing bad data not covered by this migration**: Crilynn/Vellisara on Hellfire still needs a manual backfill (`players.team_member_id` moved from the archived Crilynn row to the active Vellisara row) since the fix only prevents the bug going forward, it doesn't repair signups already processed under the old function.

## 2026-07-31 -- `generate_priority_order()`: bench/trial sort by tier, not by a second score multiplier

Decided directly in conversation (no tracking issue): an officer flagged that a trial DPS could outrank a long-term healer for the same item, which felt wrong even though nothing stops an officer from manually reordering the generated list afterward.

- **Root cause was structural, not a bad constant.** The old design multiplied `role_mult` (Tank 0.50 / Heal 0.75 / Ranged-Melee 1.0) by a second status multiplier (flat 0.85 trial / 0.45 bench for Ranged-Melee, `role_mult * 0.80`/`0.65` for Tank/Heal) to push bench/trial below full-status raiders. A flat 0.85 for trial DPS is higher than a full-status healer's own 0.75, so trial DPS could beat full heal outright. Retuning the constants to fix that (and the analogous trial-vs-full-tank case) while also preserving trial-lighter-than-bench and dps>heal>tank ordering within each tier turned out to have no solution wider than a razor-thin band -- one shared multiplicative score can't encode two independent orderings (status tier, and role-within-tier) at once.
- **Sort by tier first, role/score second, instead.** `status_tier` (0 full / 1 trial / 2 bench, bench taking precedence if a player is somehow both) is now a pure `order by` key, not a score input. No bench/trial raider of any role can outrank a full-status raider by construction, regardless of role weights -- no constant-tuning needed.
- **Status no longer discounts `weighted_total` at all.** A bench/trial raider's score is `raw_score * role_mult` (plus the existing item-ownership and wishlist multipliers), identical math to a full-status raider. Officers now see a trial/bench raider's real weighted score; status only changes which tier they sort into. This removed the old `BENCH_ROLE_MULTIPLIER`/`TRIAL_ROLE_MULTIPLIER`/flat bench/trial constants entirely -- one less set of magic numbers to retune later.
- Implemented in `20260801032445_priority_tier_bench_trial.sql`, replacing `generate_priority_order()` from `20260710130000_priority_generator.sql`/`20260720165552_priority_wishlist_ranking.sql`. No RLS or schema change -- function body only.

## 2026-07-30 -- Guild Officer access tier (#607): standalone grant (`guild_officers`), full on players/attendance/bios, view-only elsewhere, approvals/settings/priority-gen/loot-import stay blocked

Implements [#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607): elevated (not full) cross-team access for people with genuine guild-wide authority -- e.g. a Guild Master who raids on one team but isn't part of that team's own officer/team_leader roster and may still need to step in and resolve issues on any team.

- **Standalone grant, not derived from `team_members.role`.** Considered and rejected: "anyone who is `officer`/`team_leader` on at least one team also gets this on every other team." That doesn't cover the actual motivating case -- a Guild Master with no team-officer role anywhere still needs the access, and conversely a team's own officer shouldn't automatically get elevated rights on every other team just by virtue of running their own roster. Went with a new `guild_officers(id, discord_id, auth_user_id)` table instead, structurally identical to `site_admins` and managed the same way (grant/revoke by Discord ID from `admin.html`'s new Guild Officers tab, `is_site_admin()`-gated).
- **New `is_guild_officer()`**, guild-wide, no `team_id` param, mirroring `is_site_admin()` exactly -- a fifth, orthogonal tier alongside the [#294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294) vocabulary (raider/officer/team_leader/site_admin), not a value squeezed into `team_members.role`.
- **Full access** (OR'd into existing officer-write policies, plus `write_audit_log()` so those writes' self-logging doesn't fail): `players`, `attendance`. Also `set_guild_officer_bios()` -- a deliberate reversal of the 2026-07-26 decision that only `is_site_admin()` should write guild-wide bios. That reasoning was specifically about a *single team's own* leader having no natural authority over guild-wide content; a guild officer, by definition here, represents genuine cross-team leadership, so the exclusion doesn't apply to this new tier.
- **View-only**: `audit_log` SELECT gets `OR is_guild_officer()`, same for `team_members` SELECT (the Roster tab's Discord Claims panel reads it). The four officer report views and `priority_order` SELECT needed **no RLS change at all** -- both were already public-read/cross-team-readable; the view-only requirement for those was purely a frontend gating problem (hide the edit/regenerate controls), not a database one.
- **Deliberately excluded, no RLS change**: `bis_requests`, `mplus_exclusion_requests`, `season_signups`, `self_received_requests` (approvals), `team_settings` (season settings), `priority_order` write policy (generation/editing), `rclc_loot` write policy (loot import), `team_members` write policy. `is_guild_officer()` is never OR'd into any of these -- a guild-officer-only caller is denied by RLS exactly like a raider, independent of whatever the frontend renders.

## 2026-07-29 -- `items.main_stats`: array, spec-scoped filtering, Trinket/Weapon/Off Hand only

Decided directly in conversation (no tracking issue): filter Wishlist/BiS-grid Trinket/Weapon/Off Hand rows by whether the raider's spec can use the item's main stat, same as `items.armor_type` already gates the armor rows.

- **Array, not a single value** -- nullable jsonb, e.g. `["AGILITY","INTELLECT"]`, mirroring `secondary_stats`'s shape/semantics (`null` = not yet backfilled, `[]` = confirmed stat-less/universal). Necessary because this expansion's itemization lets one item roll several usable main stats at once (e.g. a Mail shoulder both a Hunter and an Elemental Shaman can use).
- **Backfilled by `scripts/fetch-item-stats.js`** (extended, not a new script) -- Blizzard's `preview_item.stats[].type.type` already yields clean `STRENGTH`/`AGILITY`/`INTELLECT` values; the Wowhead PTR fallback needed a second parsing path since Wowhead marks primary stats with numeric comment codes (`<!--stat5-->` etc), not the plain-text stat names secondary stats use.
- **Falls back to the item's Equip:/Use: effect text when there's no raw stat entry at all** -- many raid trinkets (procs/on-use effects) carry their stat restriction only in the effect description (e.g. Hex Lord's Dooming Idol drains/restores Intellect via its proc, with no stat line on the tooltip). Blizzard consistently names the exact stat(s) in that text when a trinket is genuinely restricted, and uses generic phrasing or lists all three when a trinket is meant to be universal -- confirmed empirically against several current-tier trinkets, so this only ever narrows `main_stats`, never over-filters a universal proc.
- **Filter scoped to Trinket 1/2, Weapon, Off Hand only** -- Neck/Back/Wrist/Finger never roll a main stat in this expansion's itemization, so they're intentionally left unfiltered rather than gated on data that will always be absent.
- **Keyed by spec, not class, for the lookup** -- `specMainStat(class, spec)` in `js/common.js`, not a flat `spec -> stat` map -- because Death Knight's "Frost" spec (Strength) and Mage's "Frost" spec (Intellect) are the same string with different meanings. Druid/Monk/Paladin/Shaman (main stat varies across all their specs) and Demon Hunter's Devourer tank spec (Intellect, unlike Havoc/Vengeance's Agility) get per-spec overrides; every other class/spec resolves from a flat per-class stat.

## 2026-07-26 -- `players.is_backup_tank`/`is_backup_healer`: independent, non-exclusive, always-on flags

Decided directly in conversation (no tracking issue): a way for officers to mark designated backup tanks/healers on the roster.

- **Multiple raiders can hold either designation at once** -- no single-holder exclusivity, no auto-clearing a previous holder. Same shape as `is_trial`/`is_bench`: independent booleans, no cross-player bookkeeping.
- **Not restricted to a player's current role** -- a Melee DPS with a tank offspec can be flagged Backup Tank. The columns carry no role check, client or server side.
- **Always available, no feature flag** -- unlike Bench (gated by `featureEnabled('bench')`), every team gets both toggles unconditionally.
- **Public badge, same visibility as Trial/Bench** -- shown on the profile page (shared by index.html and officer.html's inline render) and as a status tag in the officer roster table. Not shown on the public roster table, since Trial/Bench aren't either.
- **Threaded through `add_signup_to_roster()` at promotion time**, not stored on `season_signups` -- same pattern `is_trial` already uses, since there's nothing on a signup itself to derive a backup-role designation from (no smart default, unlike Trial's "new character, not a main-swap" heuristic).
- **Adding the two trailing parameters produced a second, distinct function overload** rather than replacing `add_signup_to_roster()` in place -- confirmed against a local `db reset`, which left the old 3-arg and new 5-arg signatures both callable. The migration explicitly drops the old overload and re-grants the new one (`authenticated` only, revoked from `anon`/`public`) rather than relying on `CREATE OR REPLACE` to carry grants forward, since a genuinely new function doesn't inherit them and Postgres grants EXECUTE to `PUBLIC` by default.

---

## 2026-07-26 -- Guild Officer Bios move to `site_settings`, gated by `is_site_admin()`

Decided directly in conversation (no tracking issue): Guild Officer Bios (#577/#586) had been stored in `team_settings.config.guildOfficerBios`, which is scoped per team_id -- a bio saved on one team's site never showed up on another's, even though the guild's officers are the same people regardless of which team's site you're viewing.

- **Moved to `site_settings.guild_officer_bios`** (a new jsonb column on the existing guild-wide singleton table added for maintenance mode, #245) -- same shape/RLS/public-read pattern as `maintenance_mode`, no new table, no new RLS policy needed (the table's existing "Public read site_settings" `using (true)` policy and base grant already cover it).
- **Write access gated by `is_site_admin()`**, not `my_team_role(team_id) = 'team_leader'` -- a team's own leader has no natural authority over guild-wide content. New `set_guild_officer_bios()` RPC mirrors `admin_set_maintenance_mode()`'s shape exactly (`SECURITY DEFINER`, `is_site_admin()` check, its own `write_audit_log()` call).
- The officer editor (`officer.html`'s Bios tab) still shows the current Guild bios to any officer, read-only, with the add/save/reorder controls disabled and a note shown when the logged-in user isn't a site admin -- rather than hiding the section outright, so a non-admin officer can still see who's listed.
- Existing data backfilled from whichever team had a non-empty `guildOfficerBios` (only one did), then that now-dead key stripped from every team's `team_settings.config`.

---

## 2026-07-25 -- `incoming_roster` view exposes `swap_from_name_realm`

Decided directly in conversation (no tracking issue) while building the signup-time "who else already plays this class" feature: a returning roster member who submits a genuine main-swap to a *different* character name would otherwise show up twice in that comparison -- once under their current roster character, once under the new incoming one -- since the client had no way to know one supersedes the other.

- **Added `s.swap_from_name_realm` to the `incoming_roster` view's column list** (appended at the end, not inserted mid-list -- `CREATE OR REPLACE VIEW` can only add trailing columns without erroring). Not a security change: character names are already public everywhere else in this app (roster, bios, loot log); the view's existing officer-only boundary (`player_note`, `signup_officer_note`, `reviewed_at`, `reviewed_by`, `off_specs`, `main_swap`, `submitted_at`) is unchanged.
- Client-side (`js/signup.js`'s `signupClassmatesPool()`), an incoming row's `swapFromNameRealm` now excludes that name+realm from the roster half of the comparison pool entirely, rather than showing both. A same-name resubmission (no real swap, just resigning under the same character) is handled separately by de-duping on name+realm, keeping the incoming entry.
- Migration (`20260726104522_incoming_roster_swap_from_name_realm.sql`) had to sort *after* `20260726104514_incoming_roster_public_view.sql` (the view's actual `CREATE VIEW`) -- a real ordering conflict, not just cosmetic drift, since a plain `CREATE VIEW` errors if the view already exists.

---

## 2026-07-23 -- Un-bundles signups from `seasonView` (#549 correction): `signupSeason` keeps its own independent setting

Surfaced during implementation, before #549 shipped: bundling `signupSeason` into `seasonView` (the 2026-07-22 entry below) assumed the two concepts move on the same timeline. They don't. Signups for the next tier routinely open while the current tier is still being raided -- that overlap is the normal case, not an edge case -- but item/BiS/Wishlist scoping is about what raiders should see for tonight's raid. Pointing `seasonView` at the next season to open its signups would have also flipped every raider's Priority tab/BiS grid/Wishlist to that next season's (probably still-incomplete) item catalog mid-raid.

- **`signupSeason` (`team_settings.config.activeSignupSeason`) is un-retired.** Signups keep their own independent free-typed setting, exactly as before #549 touched it -- separate Season Settings card, separate save path, separate RPC/view reads (`submit_season_signup`, `get_own_signup`, `incoming_roster`). None of the DB objects `activeSignupSeason` already touched needed changing; the migration proposed in the original #549 work was never applied to production and was reverted before merge.
- **`seasonView` keeps its full original scope for item/BiS/Wishlist**: the `raid_zones`-sourced dropdown, `isItemInSeasonScope()`/`currentZoneIdsForSeason()` reading `DATA.raidZones` instead of `DATA.raidProgression`, and the four "Show all seasons" checkboxes' retirement all stand as decided in the entry below. Only the "signups read/write `seasonView` directly" clause is reversed.
- **The two settings are allowed to diverge on purpose.** An officer can have `seasonView` unset (raiders see the live season's items) while `signupSeason` already points at the next tier (new recruits get tagged correctly) -- that's the actual intended workflow, not a state to guard against.

[Full discussion -> #549](https://github.com/katogaming88/WGA-Raid-Hub/issues/549)

---

## 2026-07-22 -- Unified `seasonView` setting (#549): replaces `raidProgression`-based item scoping, `signupSeason`, and "Show all seasons"

Surfaced while importing Season 2 (The Venomous Abyss) items ahead of actually switching the team over to it: #535 shipped item-catalog season scoping reading `DATA.raidProgression`, but `raidProgression` is really WCL progress-tracking config (which raids to pull kill/attendance data for), not a good source for "which season's loot to show." There was no way to prep Season 2's item catalog/wishlist/signups while Season 1 was still the live, actively-tracked season without either editing the live `raidProgression` (reshaping what raiders see immediately) or relying on the "Show all seasons" checkbox (shows everything unfiltered, not a specific season). Separately, `signupSeason` (`team_settings.config.activeSignupSeason`) already solved a version of this same problem for signups alone -- a real precedent for "a season you're actively managing, separate from the live raiding season," just reinvented ad hoc and shared with nothing else.

- **A single `team_settings.config.seasonView`, nullable.** Empty/unset resolves to "whichever season is live" (`DATA.seasonName`) -- today's default behavior for everything. Explicit values come from **`raid_zones.season`** (distinct values, e.g. `"Midnight Season 2"`), not a free-typed field and not the JS-constant mechanism #537 proposed (see below) -- `raid_zones` is already the authoritative `wcl_zone_id <-> season` mapping used for WCL progress tracking (#285), so making a season selectable is just adding its `raid_zones` row, a step already required for that tier eventually anyway.
- **One Season Settings dropdown** ("Season your team is planning"), not per-tab toggles.
- **Everything season-scoped reads `seasonView` instead of its own mechanism**: the Priority tab/BiS grid's `isItemInSeasonScope()`/`currentZoneIds()` (`raidProgression`-derived today, #535), the Wishlist's season filter, and `signupSeason` (retired as its own free-typed field -- signups read/write `seasonView` directly). The "Show all seasons" checkboxes are **retired entirely**, not kept alongside the picker -- auditing an old BiS entry means picking that old season by name from `seasonView`, not a separate blanket "show everything unfiltered" toggle.
- **`raidProgression`/`seasonName`/attendance/WCL progress tracking are untouched.** An officer can point `seasonView` at Season 2 to manage signups/wishlist/BiS-prep for it while Season 1 keeps raiding, tracking attendance, and pulling WCL data normally -- these are deliberately decoupled concepts now.
- **Fail-open only applies to the default (unset) case.** Unset resolves to the live season and fails open the way #535 does today (no season tag, or no `raid_zones` rows configured at all, still shows -- an incompletely-onboarded team isn't punished with an empty catalog). An **explicitly** set `seasonView` filters strictly: no `raid_zones` row for that season yet, or zero items/signups tagged to it, means an empty view, not a fallback to "show everything" or a silent default back to the live season. This doubles as the way to verify a new tier's import actually worked -- point `seasonView` at it and watch views go from empty to populated as the import completes.
- **Supersedes part of #537.** That decision's constant was meant to carry `wclZoneId` and "drive both this issue's auto-naming and #535's items/bosses season filter" -- wrong now that the filter reads `seasonView`/`raid_zones.season` instead of a JS constant. #537's actual scope (auto-generating `seasonName`/`signupSeason` display strings from a code+prefix pattern for the "New Season" button) is unaffected; only that one clause is corrected here rather than edited in place (matching how the #455 entry handled correcting stale references in older entries).

[Full discussion -> #549](https://github.com/katogaming88/WGA-Raid-Hub/issues/549)

---

## 2026-07-22 -- Scoping `items` by raid tier (#535): a global `wcl_zone_id` column, not a per-team season label or a per-team override table

`items`/`item_bosses` have no season/tier concept at all -- every item ever imported sits in the same flat catalog forever, and the Priority tab, BiS grid, and Wishlist all list the entire unfiltered catalog. Confirmed while scoping a re-import for Season 2: nothing today would stop Season 1 bosses/items from showing up right alongside Season 2's once imported.

- **`items.wcl_zone_id`, not a free-text `items.season` column.** `items` has no `team_id` -- it's shared across all three teams (Phoenix, Hellfire, Immolation), while each team's own season name (`team_settings.config.seasonName`) is independently officer-typed and could label the same real raid tier differently between teams. A free-text season column on a *shared* table risks showing/hiding the wrong items for one team. `wcl_zone_id` mirrors `raid_zones.wcl_zone_id` (#285) -- a stable, team-agnostic identifier tied to the actual game content.
- **No per-team override table.** A single global zone ID per item is enough, since the underlying game content is identical across teams -- only each team's *current* zone selection differs, and that already lives in their own `team_settings.config.raidProgression`. "Current season" for filtering purposes is just whichever zone ID(s) appear in a team's own `raidProgression` right now, with no new season concept to introduce or keep in sync.
- **Filtered by default, with a "Show all seasons" toggle**, not fully hidden. Losing the ability to correct an old BiS entry or look something up during an audit was judged worse than the clutter this fixes.
- **Placeholder items (`M+`/`Crafted`/`Catalyst`) stay exempt from the filter** -- they aren't tied to a raid zone at all.
- **Rollout covers three places, not just the Priority tab that prompted this**: the Priority tab's item picker/boss filter/Unmanaged Items, the BiS 16-slot grid editor, and the raider Wishlist's per-slot item buckets. Officer loot import is unaffected either way since it matches pasted loot by item name, not a filtered list.

[Full discussion -> #535](https://github.com/katogaming88/WGA-Raid-Hub/issues/535)

---

## 2026-07-22 -- Season naming driven by a shared code constant, not free-typed per team (#537)

`seasonName`/`signupSeason`/`seasonCodePrefix`/`seasonDisplayPrefix` are all officer-typed free text stored independently per team in `team_settings.config`. All three teams raid the same real-world tier at once, but nothing enforces their season-name strings actually match -- and every downstream `season` column (`rclc_loot`, `priority_order`/scoring, `season_signups`) is a plain string-equality check against whatever got typed.

- **A single JS constant Kat updates once per real-world tier, not a DB reference table or a free-typed field.** Same manual-per-tier-edit workflow already used for `scripts/fetch-items.js`'s hardcoded zone ID -- every team's "New Season" button reads and applies the same value, so drift is structurally impossible rather than merely encouraged against. Deliberately not a DB table: avoids a new globally-shared table + RLS + admin UI for something that already has an equivalent manual-edit workflow elsewhere.
- **Shared with #535's per-item `wcl_zone_id`.** The same constant carries `{code, displayName, wclZoneId}` -- one per-tier update drives both this issue's auto-naming and #535's items/bosses season filter, instead of two per-tier configs that could themselves drift apart.
- **"New Season" combines archive + auto-name into one click**, replacing today's two-step "archive wipes the name -> officer retypes it" flow -- but still requires the same confirmation dialog as today's Archive button before it runs, since archiving stays a destructive, hard-to-reverse action regardless of how the new name gets filled in.
- **The generated name must still match the format the existing free-text `season` columns already compare against** (`seasonCodeForDisplay()`/`seasonDisplayName()` in `js/common.js`) -- this changes *where the value comes from*, not the string format those columns already expect.

[Full discussion -> #537](https://github.com/katogaming88/WGA-Raid-Hub/issues/537)

---

## 2026-08-03 -- Season code/display prefix hardcoded, no longer a per-team setting (#643)

`seasonCodePrefix`/`seasonDisplayPrefix` were an officer-editable per-team `team_settings.config` setting (#341), read at translation time by `_seasonCodePrefix()`/`_seasonDisplayPrefix()` in `js/common.js`. #537 already established that expansion boundaries require a manual code edit to `CURRENT_SEASON`, which made the per-team setting redundant with a step that already has to happen in code -- and, per #537's own decision log, a per-team value only risked two teams drifting to different prefixes for what's actually the same real-world expansion.

- **Now hardcoded constants** (`SEASON_CODE_PREFIX`/`SEASON_DISPLAY_PREFIX` in `js/common.js`), Kat-updated in the same commit as `CURRENT_SEASON` at an expansion boundary. Removed from `SEASON_CONFIG_KEYS` and the Season Settings UI entirely.
- **Verified no-op for existing data**: a read-only prod query confirmed no team had ever set a non-default value for either field, and every stored `seasonName` already matched the default `"Midnight Season N"` pattern -- no backfill/migration needed.
- **Season Name and Signup Season inputs simplified to a number** (`seasonNameInput`/`signupSeasonInput`, now `type="number"`) since the prefix is no longer officer-typed; `saveSeasonName()`/`saveSignupSeason()` compose the full name from the number + `SEASON_DISPLAY_PREFIX`. A capped dropdown (1/2/3) was considered and rejected -- season counts occasionally exceed 3 within an expansion, and a number input has no ceiling to maintain.
- **Follow-up filed separately, not addressed here**: #642, a "New Expansion" confirmation toggle on Start New Season as a safety net against forgetting to update `CURRENT_SEASON`/the prefix constants at the actual boundary.

[Full discussion -> #643](https://github.com/katogaming88/WGA-Raid-Hub/issues/643)

---

## 2026-07-16 -- Season signups now require a Discord login (reverses #403's anon-callable decision)

`submit_season_signup` was deliberately granted to `anon` in the 2026-07-10 entry below, for prospective recruits with no Discord session yet. That's reversed: every signup must now be tied to a real account, so an anonymous submitter has no way in.

- **`submit_season_signup` raises `Not signed in` when `auth.uid()` is null**, instead of opportunistically capturing `auth_user_id` only when present. `anon` loses execute on the function entirely; only `authenticated` can call it now (`20260716210158_submit_season_signup_require_auth.sql`).
- **Frontend gate matches the RPC gate**: `js/signup.js`'s `showSignupView()` renders a "You must sign in with Discord to do this" message with a login button in place of the step-1 form when there's no Discord session, rather than hiding the "Sign Up" nav item. The RPC check is the real guarantee; the frontend message just avoids a raider filling out four steps before hitting a wall.
- **Logging in still doesn't require a claimed character.** A raider can sign in with Discord and sign up with no character claimed at all -- claiming only gates the main-swap option (a swap must be tied to a claimed character to auto-fill "switching from", same PR), not the ability to sign up.

[Full discussion -> #513](https://github.com/katogaming88/WGA-Raid-Hub/issues/513)

---

## 2026-07-13 -- twitch-live-check / wcl-progression-sync (#493): pg_cron + pg_net replaces GitHub Actions scheduling

Both Edge Functions were originally put on a GitHub Actions cron schedule because this project had no `pg_cron`/`pg_net` infrastructure at the time (#285, #286 -- see the 2026-07-12 entry below). In practice, GitHub Actions' scheduled-workflow trigger never actually honored either workflow's cron expression: checking `twitch-live-check.yml`'s run history, real gaps between runs were 1-3 hours the entire time, not the 5 minutes it was scheduled for. That's a real correctness gap, not just cosmetic drift -- the landing-page "who's live" banner/widget trusts `streamers.is_live`, and a raider going live could show as offline there for up to an hour. Confirmed directly: a raider was live and playable on the Streams tab (which embeds Twitch directly, no `is_live` dependency) while `is_live` was still `false` from a check taken nearly an hour earlier.

- **`pg_cron` + `pg_net` enabled, calling both Edge Functions directly from Postgres** (`supabase/migrations/20260713234553_pg_cron_edge_function_scheduling.sql`), rather than switching to a different external cron service or making the landing-page UI tolerate staleness instead. Removes GitHub Actions' unreliable scheduling from the loop entirely for both functions.
- **Both workflows' `schedule:` trigger removed, `workflow_dispatch` kept** as a manual fallback/debug trigger -- pg_cron now owns the cadence for both.
- **`wcl-progression-sync` moved to pg_cron in the same migration**, on the assumption it has the same reliability gap, even though no missed scheduled run was directly observed for it -- its only invocations so far have been manual `workflow_dispatch` runs, so there's no scheduled-run history to check against.
- **Shared secrets stored in Supabase Vault** (`vault.create_secret`), not inlined in the migration -- the migration only schedules the cron jobs assuming `twitch_live_check_secret` / `wcl_progress_sync_secret` already exist in Vault, reusing the same values already set as GitHub Actions repo secrets and Edge Function secrets.

[Full discussion -> #493](https://github.com/katogaming88/WGA-Raid-Hub/issues/493)

---

## 2026-07-12 -- Mythic pull count/best % progression (#285): normalized WCL reference tables + a GitHub Actions cron, not a JSON blob or a manual-only refresh

Landing-page ask: show live pull count/best % on the current work-in-progress mythic boss, and total pulls on already-killed bosses, matching WCL's own reports view. `team_settings.config.raidProgression` already holds an officer-curated raid/boss list (Season Settings' "Refresh from WCL" button), but that list only stores `{name, mythicDate}` per boss -- no WCL encounter ID -- and only updates when an officer manually clicks refresh.

- **New `raid_zones`/`raid_encounters` tables, not reusing the config JSON.** Same category as `items`/`classes_specs`: shared reference data, public read, no authenticated write policy (only a service-role sync or manual SQL Editor edit ever touches them). `team_raid_progress` is the per-team row, one per encounter, upserted by the sync.
- **The sync re-queries WCL's `zone(id).encounters` every run rather than trusting `config.raidProgression`'s boss list for encounter IDs**, since `tab-season.js`'s `fetchWclForRaid()` discards the ID WCL returns before saving. The landing page's render side has the same gap -- it joins `DATA.raidProgress` to a boss by `(wclZoneId, normalised boss name)`, not encounter ID, since that's the only key `config.raidProgression` actually carries client-side.
- **A new `wcl-progression-sync` Edge Function on a GitHub Actions cron, not `wcl-sync` or a manual button.** `wcl-sync`'s existing actions all forward a real officer's JWT and are gated by `my_team_role()`; there's no logged-in officer for a scheduled job, so this new function uses the service-role key + a shared `x-cron-secret` header, mirroring `twitch-live-check` (chosen there because no `pg_cron`/`pg_net` infrastructure exists in this project's Supabase instance).
- **Cadence: every 30 minutes, but only Tue/Thu/Mon 9:30pm-midnight Eastern** (Kat's actual raid nights, Monday being the standing makeup/extra-day slot) -- pull counts only change during raid nights, so polling the rest of the week would just waste WCL API calls for no fresher data. GitHub Actions cron is UTC-only with no DST awareness, so the schedule is padded an hour on each side to cover both US DST offsets without a biannual manual edit (see `.github/workflows/wcl-progression-sync.yml`'s header comment for the exact UTC math).
- **`team_raid_progress` still gets an officer/team-leader write policy** even though the sync is the only writer today, matching the `streamers`/`player_wcl_season_perf` pattern of leaving a manual-correction path open.

[Full discussion -> #285](https://github.com/katogaming88/WGA-Raid-Hub/issues/285)

---

## 2026-07-11 -- Danger Zone request-table clears (#225): five single-purpose RPCs, not one generic one; loot stays a direct delete

The Danger Zone's seven "Clear ___ Sheet" ops were the last GAS call sites left standing once #386/#423/#453/#455 finished migrating everything else -- retiring Apps Script (#225) meant finally giving them a real destination instead of a dead GAS action.

- **Five separate `danger_clear_*` functions, not one function parameterized by table name.** Every other request-table write in this schema (`submit_self_received`, `direct_mark_received`, `set_team_setting`, etc.) is single-purpose SECURITY DEFINER, and a table-name-as-parameter design would mean building a `delete from` statement dynamically -- avoidable SQL-injection-adjacent surface for a feature that only ever needed five fixed targets.
- **All five are `is_site_admin()`-only, not `my_team_role() OR is_site_admin()`.** None of the underlying `DANGER_OPS` entries carry `teamLeader: true` except Clear Season History (the #294 decision), so these five stay narrower than the officer-or-site-admin shape `direct_mark_received()` uses.
- **`danger_clear_pending_roster` is a distinct, narrower op from `danger_clear_season_signups`.** The old GAS "Pending Roster" sheet was specifically the queue of approved-but-not-yet-added signups, not every signup ever submitted -- matched here to the `pending_roster` view's own definition (`status = 'approved' and approved_player_id is null`) rather than reusing the full-clear RPC with a filter flag, so the two operations can't be confused by a caller passing the wrong argument.
- **`rclc_loot` ("Clear Loot Data") gets no RPC at all.** Officers already hold a direct `ALL` grant on it for their own team (the same grant the loot-import path uses), so a Danger Zone SECURITY DEFINER wrapper would be narrowing access that already exists, not widening it. Stays a plain client-side delete.
- **"Clear Pasted Loot Sheet" is retired outright, not migrated.** #219 replaced the old paste-to-sheet-then-import flow with a direct paste-to-RPC import (`import_rclc_loot()`) that writes straight to `rclc_loot` with no staging table, so the sheet this op used to clear has had no Supabase-side equivalent since #219 shipped.

[Full discussion -> #225](https://github.com/katogaming88/WGA-Raid-Hub/issues/225)

---

## 2026-07-11 -- Dropped season_snapshots (#455): designed to replace the season history blob, never actually used

Surfaced while fixing #423 (Danger Zone's Clear Season History op described itself as clearing this table -- it never did). `season_snapshots` (`team_id`, `season`, `snapped_at`, `data jsonb`) was designed in the original migration plan (`docs/supabase-migration-plan.md`) to hold one row per archived season per team, explicitly called out as replacing "the season history blob" from the GAS Script Properties era.

- **What actually shipped instead:** #221 (PR #401) built the real archive/unarchive feature against `team_settings.config.seasonHistory` -- an array inside the general-purpose settings JSON blob -- rather than a `season_snapshots` row. That decision was never written down anywhere; it reads as an oversight, not a reconsideration. The table shipped with correct RLS from day one (team-leader write, per the #294 decision) and stayed accurately documented through several later RLS audits, but nothing in `js/` ever read or wrote it.
- **Verified dead before dropping:** 0 rows on both live teams, zero references anywhere in `js/`, zero foreign keys from any other table. The drop migration re-checks the row count at migration time rather than trusting that to still hold.
- **Not editing `docs/supabase-setup-guide.md`.** Rex owns later phases there per standing practice; this drop is noted for him separately rather than touched into the locked file.
- **Existing decision-log entries mentioning `season_snapshots`** (RLS policy history, e.g. the #413 and #294 entries below) are left as-is -- they're accurate records of decisions made about the table while it existed, not claims that it's still in use.

[Full discussion -> #455](https://github.com/katogaming88/WGA-Raid-Hub/issues/455)

---

## 2026-07-11 -- Item catalog slot vocabulary (#453): re-derived from Wowhead, not translated; duplicates deleted, not merged

`items.slot` held a vocabulary hand-typed into the retired GAS "Item Lookup" spreadsheet (`Boots`, `Gloves`, `Belt`, `Bracers`, `Cloak`, `Shoulders`, `Ring`, `1H/2H`, `OH`, `Unknown`). The game, Wowhead, `scripts/fetch-items.js`, and `bis_items.slot` all say `Feet`, `Hands`, `Waist`, `Wrist`, `Back`, `Shoulder`, `Finger`, and split weapons into `One-Hand`/`Two-Hand`/`Ranged` -- so the catalog was the only thing out of step, and every consumer carried a synonym table to bridge it. Surfaced while building #386, where the display slot and `bis_items.slot` diverging nearly shipped a silent no-op.

- **Slots re-derived from Wowhead by `wow_item_id` (the `&xml` endpoint's `<inventorySlot>`), not string-translated from the old words.** A mapping table cannot split `1H/2H` into One-Hand (12 items) / Two-Hand (5) / Ranged (2), and cannot recover `Unknown` (19 items) at all -- together ~30% of the catalog. Every item carries a `wow_item_id`, so the authoritative source was available and guessing was unnecessary.
- **The type-vs-position split is kept, because it is irreducible.** `items.slot` is an equip *type* (a ring fits either finger; Wowhead returns `Finger`, i.e. Blizzard's `InventoryType`), while `bis_items.slot` is a *position* (`Finger 1`). Only the officer's BiS assignment can say which, so `BIS_CATALOG_SLOT_TO_ROWS` still fans `Finger`/`Trinket` out to both numbered rows. This mirrors how the game models it (`INVTYPE_*` vs `INVSLOT_*`) and how the RCLootCouncil addon already does (`INVTYPE_FINGER = { "ring1", "ring2" }`).
- **19 duplicate rows deleted rather than merged, and a unique index added on `wow_item_id`.** The catalog held 132 rows for 113 distinct items -- every tier token existed twice, once hand-filed with a slot and once seeded bare as `Unknown`. They evaded `unique(lower(name))` because the hand-filed rows carry an armor-type suffix (`Alnforged Riftbloom (Plate)`) and the seeded ones do not; nothing enforced uniqueness on `wow_item_id`. Confirmed against the live database that no `bis_items`, `rclc_loot`, `priority_order`, `self_received_requests` or `item_bosses` row referenced a duplicate, and that all 19 survivors kept their boss mapping -- so a delete was safe and a merge unnecessary. The migration guards this rather than trusting it: it raises if any reference exists at run time.
- **Armor type dropped from tier-token names.** `Alnforged Riftbloom (Plate)` -> `Alnforged Riftbloom`; `items.armor_type` already stores `Plate`. The suffix was how the spreadsheet told four identically-named tokens apart, which the column now does. Only a suffix literally repeating `armor_type` is stripped, so `Chiming Void Curio (Tier)` -- a class-set trade token with no armor type -- is left alone. This has to run *after* the dedupe, since the bare names were exactly what the duplicate rows occupied.
- **`Curio` and `Placeholder` map to no BiS row on purpose.** The one Curio is a class-set trade token ("trade this for powerful class set armor"), and the placeholders (M+/Crafted/Catalyst) name a loot source. Neither names a gear position, so neither is exportable as a BiS slot.
- **Noted, not done: keying slots by the game's numeric `InventoryType`/`INVSLOT` id** with a reference table, which would buy FK integrity (`Trinket 3` becomes unstorable) and a natural sort order. Not needed to fix the above -- once the names are normalized they already agree -- so it stays a possible follow-up rather than scope here.

[Full discussion -> #453](https://github.com/katogaming88/WGA-Raid-Hub/issues/453)

---

## 2026-07-11 -- Self-received approval syncs bis_items.obtained (#386): a slot column plus a one-way trigger, not RPC-side writes

Approving a self-received item should tick the matching BiS row as obtained, so BiS Manager stays the one place officers actively *edit* a list and "Mark received" is only a received-state signal (#217's stated intent). Three decisions fell out of it.

- **Added `self_received_requests.slot` (nullable text)** rather than matching on `(player_id, item_id)` alone. `bis_items` is unique on `(player_id, item_id, coalesce(slot, ''))`, and the placeholder items -- `M+`, `Crafted`, `Catalyst` (`items.is_placeholder`) -- name a loot *source* rather than a piece of gear, so one player legitimately lists `M+` against six different slots (10 such rows live at the time of writing). An approved `M+` with no slot could not say which of those rows it filled; flipping all of them would fill six slots from one drop. The frontend already knew the answer (the "Mark received" button is rendered per BiS row) and simply had nowhere to put it.
- **The button sends the raw `bis_items.slot`, not the displayed slot name.** These diverge routinely -- the item catalog says `Boots`/`Gloves`/`Trinket` where `bis_items` says `Feet`/`Hands`/`Trinket 1` (and 30 live rows carry a blank BiS slot against a `Trinket` catalog slot). `mapSupabaseBisItems()` already exposed both as `entry.slot` (display) and `entry.dbSlot` (raw), for exactly this reason on the tab-bis.js delete/update path. Sending the display slot would have made the trigger match nothing for most real items -- a silent no-op, not an error.
- **The flip lives in a trigger on `self_received_requests`, not inside `submit_self_received()`/`direct_mark_received()`.** There is a third path to `approved` that is neither RPC: the officer Requests tab (`js/tabs/tab-requests.js`) approves a pending row with a plain `UPDATE`. A trigger catches all three (raider auto-approve, officer direct-mark, queue approval) and cannot be bypassed by a fourth. `SECURITY DEFINER`, since a raider auto-approving their own item is not an officer and writes to `bis_items` are restricted to officers.
- **One-way on purpose**: approving sets `obtained = true`; rejecting or reverting an approval never sets it back to `false`. An officer may have ticked the box by hand for an unrelated reason, and clearing it here would silently discard that. Unticking stays a deliberate officer action in BiS Manager.
- **Both RPCs were dropped and recreated, not `CREATE OR REPLACE`d.** A function is identified by `(name, argument types)`, so adding `p_slot` would have left the old 6-argument version in place as an overload that PostgREST could still resolve calls to.

[Full discussion -> #386](https://github.com/katogaming88/WGA-Raid-Hub/issues/386)

---

## 2026-07-10 -- Season-code to display-name mapping (#341): stays a frontend translation, now pattern-derived instead of hardcoded per season

`scoring.season`/`priority_order.season`/`rclc_loot.season` store a compact code (`MID1`, decided on #320) as the stable join/filter key across those tables, while officers see and type a free-text display name (`DATA.seasonName`, Season Settings tab -> `team_settings.config` via `saveTeamSetting()`, #221). Something has to translate between the two on every read/write that touches season data.

- **Kept as a frontend translation in `js/common.js`** (`seasonDisplayName()`/`seasonCodeForDisplay()`), rather than a dedicated `seasons` table or a `settings.config` key -- this was already the de facto mechanism since #209 (a single hardcoded `SEASON_LABELS` entry), just never formally decided.
- **Revised during the same PR from a hardcoded map to a pattern**: the first draft kept `SEASON_LABELS = { MID1: 'Midnight Season 1' }` as the permanent mechanism and documented a runbook ("add the next season's code here before officers start using it") -- flagged as insufficient before merge, since it required remembering a manual step at every season boundary with a silent failure mode if skipped (every `p_season`-resolving write would store the full display string instead of a short code). Replaced with a regex pattern (`'MID' + N` <-> `'Midnight Season ' + N`), so `MID2`, `MID3`, etc. translate automatically the moment they appear, no code change required. `SEASON_LABELS` is now empty by default and survives only as an explicit override for a season that breaks the pattern.
- **Revised again to make the prefixes themselves configurable**: `MID`/`Midnight Season` were still literal strings baked into the regex, so a future expansion (whose codes won't start with `MID`) would still need a code change. Moved them to `team_settings.config.seasonCodePrefix`/`seasonDisplayPrefix`, editable from a new "Season Code Prefix" field in Season Settings, defaulting to today's values when unset so no existing team needs a backfill. Flagged as an interim per-team setting: every team plays the same real-world expansion timeline, so this is really cross-team config that belongs on the site admin dashboard once #232 exists, not something each team's officers could independently drift on -- noted on #232 for when that lands.
- **No `data/seasons.json` involvement**: that file is an optional local input to the one-time legacy-loot-history import script (`scripts/import/generate.js`), not a repo-tracked or deployed artifact -- it doesn't intersect with this live-app translation at all.

[Full discussion -> #341](https://github.com/katogaming88/WGA-Raid-Hub/issues/341)

---

## 2026-07-10 -- players.officer_notes (#407): the column #407 assumed already existed had to be added

#407's premise -- "`players.officer_notes` already exists as a column in the schema but is never read or written anywhere in `js/`" -- was wrong. The column that actually exists is `mplus_exclusion_requests.officer_notes` (`initial_schema.sql`), a different table entirely; `dbdoc/public.players.md`'s relations diagram embeds that table's full column list next to `players`' own for the FK diagram, which is what got misread as a `players` column both when the issue was filed and when this fix's own PR first shipped without the column. Confirmed against the live database only after roster loads started failing with `column players.officer_notes does not exist`, well after the frontend write path (`renamePlayer`/`savePlayerNote`) had already been wired to it.

- **Plain `alter table ... add column officer_notes text`, no default, matching `m_plus_note`'s shape** -- an officer free-text field with no structural constraints of its own.
- **No RLS change**: `Officers write players` already grants UPDATE on the whole row to officer/team_leader; a new nullable column needs no new grant.
- **Takeaway for future request-table/column audits**: verify a claimed-existing column against the live database (or at minimum a full-text match on the exact table name in `dbdoc/schema.json`, not a substring/adjacent-context match) before writing the frontend side against it -- `dbdoc/`'s per-table relations diagrams intentionally embed related tables' columns for the ER diagram, which reads identically to that table's own column list at a skim.

[Full discussion -> #407](https://github.com/katogaming88/WGA-Raid-Hub/issues/407)

---

## 2026-07-10 -- Self-received request write path (#406): both submit and direct-mark go through SECURITY DEFINER RPCs, auto-approve now checks real Supabase Auth

`self_received_requests` fit the live feature exactly (`track`/`source`/`note` match `submitSelfReceivedRequest`'s payload one-to-one) -- it just never had an INSERT path or any frontend reference, matching #404/#405's finding for the other two request tables.

- **Two new RPCs, both SECURITY DEFINER: `submit_self_received()` (raider, granted to `anon`+`authenticated`) and `direct_mark_received()` (officer, granted to `authenticated` only).** Unlike `submit_bis_link()`/`submit_mplus_exclusion()`, the officer path here also needed a definer function rather than a plain RLS-gated insert -- `tests/rls/write-policies.test.js` already asserts request tables have no INSERT policy for anyone, officers included, so `direct_mark_received()` checks `my_team_role()`/`is_site_admin()` inside the function body instead.
- **Auto-approve now checks `auth.uid()` through `players.team_member_id -> team_members.auth_user_id`, replacing GAS's legacy Discord OAuth session-token check.** #222 already moved login itself onto Supabase Auth (`js/discord.js`'s `getDiscordSession()` wraps a real Supabase Auth session, not a GAS token), so "is the submitting raider signed in as this character" is a straight join instead of a client-supplied token GAS had to independently validate.
- **`DATA.selfReceived` (a player's approved self-received items, used for BiS-completion and profile badges) now reads from Supabase first, falling back to the Apps Script heavy chunk** -- same pattern as `bisList`/`priorityOrder` (#217, #220). Only `approved` rows are pulled; pending/rejected stay officer-queue-only.

[Full discussion -> #406](https://github.com/katogaming88/WGA-Raid-Hub/issues/406)

---

## 2026-07-10 -- Site-admin cross-team access on request tables (#413): four tables were missing OR is_site_admin()

While verifying #403's historical Hellfire signup backfill actually landed in production, the officer Signups History tab showed "No signups recorded" despite the data being confirmed correct via direct read-only access. Root cause: `my_team_role(team_id)` resolves per-team from `team_members`, and Kat's own account isn't a `team_members` row on Hellfire's team (a different Discord account holds team_leader there) -- so as far as RLS was concerned, the account had zero role on that team, same as any stranger.

That's expected behavior for a plain officer -- but Kat is also a site admin, and every other officer-scoped table already ORs in `is_site_admin()` so a site admin isn't limited to only the teams where they personally hold a `team_members` role (`audit_log`, `team_members`, `team_settings`, `season_snapshots`). Auditing every "Officers read/update" policy in the schema found four that never got this clause when `initial_schema.sql` created them: `season_signups`, `bis_requests`, `mplus_exclusion_requests`, `self_received_requests` -- all four "request" tables, all predating #403/#404/#405 (those PRs added RPCs/columns to three of them but never touched their read/update policies).

- **Added `OR is_site_admin()` to the read and update policies on all four tables**, matching the existing pattern exactly (`my_team_role(team_id) = ANY (ARRAY['officer','team_leader']) OR is_site_admin()`).
- **Updated `docs/RLS.md`'s per-table matrix and "Known issues" section**, which had also gone stale: it still said the write path for `season_signups`/`bis_requests`/`mplus_exclusion_requests` was "service-role only," true before #403-#405 but superseded once each got a narrow SECURITY DEFINER RPC. Those three PRs never triggered the "update RLS.md" CI check because none of them touched policy SQL -- only this PR's actual policy change did, which is exactly the gap that let the note go stale silently.
- **RLS test coverage added** (`tests/rls/read-matrix.test.js`, `write-policies.test.js`): site admin (a UID with no `team_members` row on either seeded team) can read all four tables and update at least one, proving the fix rather than just the policy text.

[Full discussion -> #413](https://github.com/katogaming88/WGA-Raid-Hub/issues/413)

---

## 2026-07-10 -- M+ exclusion write path (#405): approve now sets players.m_plus_excluded directly, rejection state derived live

Unlike `bis_requests` (#404), `mplus_exclusion_requests` already fit the live feature exactly (`reason`/`raiderio_url`/`status` match `submitMPlusExclusion`'s payload one-to-one) -- it just never got an INSERT path or any frontend reference. Confirmed 0 rows in production before writing this.

- **New `submit_mplus_exclusion()` RPC, SECURITY DEFINER, granted to `anon`** -- same trust model as `submit_bis_link()`/`submit_season_signup()`: the form runs unauthenticated on the public roster page. Re-validates `mPlusExclusionsOpen` server-side.
- **Approve now sets `players.m_plus_excluded`/`m_plus_note` directly, in the same officer action as marking the request approved.** GAS decoupled these: `approveMPlusExclusion` only ever updated the request's own status/note, and a _separate_ manual roster toggle (`setMPlusExcluded`, a Script Property array) was the only thing that actually excluded the player from weekly M+ requirements. That meant an approved request could sit approved indefinitely without the player ever actually being excluded, if the officer forgot the second step. Collapsing this into one write matches #404's BiS approve precedent (which also writes `players.bis_link` directly) and closes a real gap rather than just porting GAS's behavior faithfully.
- **`mPlusRejected`/`mPlusRejectionNote` are derived live from the most recent rejected request per player, not new `players` columns.** GAS tracked these via a Script-Property-backed scan of the whole exclusion sheet; `players` has no rejection-state columns, and adding one for what's fundamentally a request-table fact (was the raider's most recent submission turned down) would just duplicate state already in `mplus_exclusion_requests`. `fetchSupabaseMPlusRejections()` (`js/common.js`) queries the latest `rejected` row per `player_id` alongside the roster fetch and merges it in client-side.
- **Bulk "clear all" now just resets `players.m_plus_excluded = false` for the whole team**, with nothing else to reconcile -- GAS's version additionally flipped any `Approved` sheet rows to a `Reset` sentinel status so a later re-scan wouldn't double-count them; that bookkeeping only existed because the sheet itself was the source of truth for exclusion state. Since exclusion now lives solely on `players`, clearing it is the whole operation.

[Full discussion -> #405](https://github.com/katogaming88/WGA-Raid-Hub/issues/405)

---

## 2026-07-10 -- bis_requests repurposed for BiS link submissions (#404): dropped bis_req_item_id, gating moved to players.bis_allowed

`bis_requests` existed since `initial_schema.sql` with Officers read/update RLS already in place, but nothing ever wrote to it (confirmed 0 rows, 0 references in `js/`). Its shape -- `bis_req_item_id integer NOT NULL`, an FK to `items` -- couldn't hold what the live raider-facing feature actually submits: a whole BiS list URL (`js/common.js` `submitBiSForm` -> GAS `submitBiS`), one per player, unrelated to any single item. It looks like it was scaffolded generically alongside the other request tables (`self_received_requests`, `mplus_exclusion_requests`) assuming a per-item shape this feature never matched.

- **Repurposed the existing table rather than adding a second one**, since it was empty and unreferenced anywhere: dropped `bis_req_item_id`, added `bis_link text not null` and `player_note text`.
- **New `submit_bis_link()` RPC, SECURITY DEFINER, granted to `anon`** -- the submission form runs unauthenticated on the public roster page, same trust model as the GAS action it replaces. Re-validates the gate server-side (`team_settings.config.bisSubmissionsOpen` team-wide, or the player's own `bis_allowed`) rather than trusting the client's decision to show the form.
- **Per-player submission gating (`allowBisForPlayer`/`revokeBisForPlayer`) moved to a `players.bis_allowed` boolean column, not `team_settings`.** GAS stored this as a Script Property array toggled by any officer, no role distinction. The natural Supabase home for team-wide config, `set_team_setting()` (#221), is gated by "Team leaders write settings" -- routing a per-player toggle through it would have tightened today's any-officer access down to team_leader/site_admin only. A column on `players` keeps it on that table's existing officer-write rule instead (already officer _and_ team_leader), so the toggle stays exactly as accessible as it is today, with no new RPC.
- **Officer approve/reject and manual link edits write `bis_requests`/`players` directly** (two separate calls, not one transaction) -- both tables already have officer-write RLS, matching the direct-write pattern `js/tabs/tab-roster.js` already uses elsewhere. A failure between the two calls just leaves the request pending for a retry, no partial state an officer could act on incorrectly.

[Full discussion -> #404](https://github.com/katogaming88/WGA-Raid-Hub/issues/404)

---

## 2026-07-10 -- season_signups write path (#403): SECURITY DEFINER RPC granted to anon, no anti-spam token yet

`season_signups` had no INSERT path of any kind -- only officer read/update -- because the public signup form (`js/signup.js`) still wrote exclusively to the GAS "Roster Responses" Sheet, which the officer Signups/Pending Roster tabs stopped reading when they switched to Supabase-only reads in #328. Every real signup submitted since then landed somewhere no officer screen ever reads.

- **New `submit_season_signup()` RPC, SECURITY DEFINER, granted to `anon` (and `authenticated`)** -- unlike `claim_character()` (#212), which requires `auth.uid()`, this form runs for prospective recruits with no Discord session at all, so `anon` must be able to call it directly. It checks `team_settings.config.signupsOpen` server-side (the form's client-side gate was cosmetic only) and resolves `class_spec_id`/`swap_class_spec_id` from class/spec text itself, forcing `status = 'pending'`. `season_signups` still grants `anon` no direct table INSERT -- this function is the only write path.
- **No anti-spam token for v1.** #328's original out-of-scope note wanted an Edge Function with a spam token; Edge Functions are Phase 7 and don't exist yet. The `signupsOpen` server-side check alone is already strictly tighter than the status quo (GAS's `submitSignup` had no server-side gate at all), so shipping the RPC now without a token is not a regression. A token or the Edge Function replacement can be added later without a breaking change to the form's payload shape.
- **The free-text Discord Name field is dropped from the form**, per the #340 decision: the verified Discord link lives on `team_members` via the Claims flow now, and the typed handle predates that.
- **The GAS `submitSignup` call stays in place, called after the Supabase write succeeds**, solely for its Discord bot notification side effect -- #224 owns moving that notification to an Edge Function. No GAS code changed in this PR.
- **One-time historical backfill**: Hellfire's GAS sheet held ~21 real MID2 signups (Phoenix's sheet only had 2 June test rows, skipped). Cross-referenced against the live `players` table for team 2 to resolve each row's status: already-rostered names became `status = 'added'` with `approved_player_id` set (settled history, not a live queue item); the sheet's one `Denied` row became `rejected`; two names with no roster match and no denial (`Dhbruh-Dalaran`, flagged during the audit that opened #403, and `Poplockndots-Thrall`, found during this backfill) became `status = 'approved'` with `approved_player_id` left null, surfacing them in Pending Roster for an officer to actually decide on rather than leaving them invisible.

[Full discussion -> #403](https://github.com/katogaming88/WGA-Raid-Hub/issues/403)

---

## 2026-07-10 -- bis_items.slot (#393): officer-chosen slot for placeholder entries

Placeholder BiS entries (M+, Crafted, Catalyst) were displaying the literal word "Placeholder" as their slot -- `items.slot` is `NOT NULL`, and those rows store that sentinel since they name a loot source, not a gear slot. The old GAS BiS List sheet carried the real slot per-row instead (a player wrote "M+" into whichever slot's row they meant); that context was discarded at the #217/#320 migration, when `bis_items` collapsed to `(player_id, item_id)` with no home for it -- a known, documented, unrecoverable loss (`scripts/import/tables/bis.js`), same acceptance as the audit_log TARGET backfill (#377).

- **Added `bis_items.slot text`, nullable.** Originally scoped to placeholder rows only, but extended same-day once the editor moved to a fixed slot grid (below): "Finger"/"Trinket" alone can't say which of the two numbered rows a _real_ ring or trinket is for either, so every row the editor writes now carries an explicit `slot`, not just placeholder rows. Stays null only for legacy rows written before this column existed.
- **`bis_items_no_dupe_item_key` changed from `UNIQUE (player_id, item_id)` to a `UNIQUE (player_id, item_id, coalesce(slot, ''))` expression index**, so the same item (placeholder or real) can be aimed at two different slots for one player (e.g. both Finger slots at "M+", or two different rings each explicitly slotted). Legacy rows with `slot` still null keep deduping exactly as before, since `coalesce(slot, '')` collapses them all to `''`.
- **Frontend:** the BiS Manager editor became a fixed 16-slot grid (`BIS_SLOTS`, `js/tabs/tab-bis.js`) instead of a flat search-then-add list -- every row an officer fills writes its canonical slot to `bis_items.slot`, and the grid's per-row search is scoped to items whose catalog slot fits that row (`BIS_CATALOG_SLOT_TO_ROWS`), with M+/Crafted/Catalyst placeholders always offered everywhere. Delete/toggle-obtained now filter on `slot` too (`.eq('slot', ...)` / `.is('slot', null)`), since `item_id` alone no longer uniquely targets a row once more than one can share it.

[Full discussion -> #393](https://github.com/katogaming88/WGA-Raid-Hub/issues/393)

---

## 2026-07-09 -- Discord Claims display name (#389): new function, not a reuse of resolve_actor_name()

The Roster tab's Discord Claims list only ever showed the raw Discord snowflake id, making it hard for an officer to visually confirm the right account claimed the right character. `resolve_actor_name()` (#376) already resolves an actor uuid to a display name, but for a different purpose (the audit log's CHANGED BY column) with a resolution order that's wrong here: linked-character nickname/name first, Discord display name only as a last resort for a site admin acting cross-team.

- **New `resolve_discord_display_name(p_actor_id uuid, p_team_id integer)` function** instead of adding a mode flag to `resolve_actor_name()`. The claims-verification use case specifically wants the raw Discord display name every time, not the identity resolveAuditName prioritizes -- showing a claimed character's own nickname back as "the Discord name" would defeat the purpose (confirming the human behind the claim, not the character).
- **Same SECURITY DEFINER shape and gate** as `resolve_actor_name()`/`write_audit_log()`: officer/team_leader-or-site-admin on the team, since it's still surfacing `auth.users` PII not exposed to anon/authenticated directly.
- **Resolved client-side per claim, not joined in the query** -- `fetchTeamClaims()` (`js/discord.js`) only calls it for rows with a non-null `auth_user_id` (a pre-listed officer awaiting their first login has none yet), since a SECURITY DEFINER function can't be embedded in a PostgREST select the way a foreign-key join can.

[Full discussion -> #389](https://github.com/katogaming88/WGA-Raid-Hub/issues/389)

---

## 2026-07-09 -- RCLC loot import (#219): SECURITY INVOKER RPC, instance-suffix track, boss/itemID read straight off the export

The GAS paste-import only ever carried `id, player, date, itemName, instance` into the "Pasted Loot" sheet -- no difficulty, boss, or item-id derivation existed anywhere in the import path. Migrating this needed real new logic, not a straight port, and a sample live RCLC JSON export (provided by Kat) settled several things the issue itself had flagged as open:

- **Boss is directly in the export** (`"boss":"Chimaerus the Undreamt God"`) -- no `item_bosses` lookup needed at all, despite the issue's implementation steps suggesting one. `item_bosses` is many-to-many (`(item_id, boss)` composite PK, an item can drop from several bosses), so a lookup-based resolution would have been ambiguous anyway; the export already answers the question directly per row.
- **Item resolved by `itemID` (wow_item_id) first, name as fallback** -- the export's `itemID` field matches `items.wow_item_id` unambiguously, more reliable than name matching (special characters, renames). Mirrors the historical import's `itemIdByWowId` pattern for the legacy tracker source.
- **Track derived from the `instance` string's difficulty suffix only** (`"The Dreamrift-Mythic"` -> `Myth`), the same `parseTrack()` logic the one-time historical import already proved out. The export's `itemString` does technically encode the authoritative track via Blizzard bonus IDs, but decoding those needs a maintained bonus-ID reference table this repo doesn't have -- deferred as a documented future enhancement, not attempted now. Confirmed with Kat rather than half-implementing a guess.
- **"Source" is moot** -- `rclc_loot` has no column for it; the concept only applies to a different table (`self_received_requests`). What Kat actually wanted noted as "from the RCLC import" lives in the audit log action name (`'Loot Imported (RCLC)'`), not a data column.
- **Unresolved items are left `item_id = null` and counted, not auto-created.** Auto-creating a placeholder `items` row (matching the historical import's legacy-source behavior) would require `SECURITY DEFINER`, since `items` grants no authenticated role a direct write. Given the season's Item Lookup should already be populated before loot starts flowing, a genuinely unresolved item is a sign that needs updating, not something to paper over -- so the RPC stays `SECURITY INVOKER` instead, matching `add_signup_to_roster()`'s reasoning ("authorization comes from existing RLS") since officers already have full write access to both `players` and `rclc_loot` directly.
- **Player resolution is an exact `name_realm` match (case-insensitive), no diacritic folding**, unlike the Node-side one-time-import registry (`scripts/import/lib/registry.js`), which folds diacritics because sheet data was officer-typed by hand across multiple tabs inconsistently. RCLC reads the name straight from the game client, so it should already match the roster's `name_realm` exactly. Unknown names get an archived stub, same shape as the historical import's stub rows.
- **`awarded_at` combines the export's separate `date` and `time` fields** (assumed America/New_York, matching the site's existing display-timezone assumption for this data), an improvement over the GAS path, which discarded time-of-day entirely.
- **"Import History" moved to Supabase after all, but sourced from `audit_log`, not `rclc_loot` directly, and without a "Clear All" button.** Originally deferred (see below) because `rclc_loot` mixes paste-imports with the separate legacy-tracker rows the #320 historical import already merged in, with no column distinguishing which is which -- querying it directly would misrepresent old history as recent imports, and a "Clear All" could delete real history instead of just recent pastes. Kat wanted the visibility restored once the GAS-sourced version turned up permanently empty in practice (nothing writes to the old "Pasted Loot" sheet anymore). The fix: every successful import already logs one `'Loot Imported (RCLC)'` audit_log entry per row, and -- critically -- only genuine paste-imports ever produce that action, since it's called from nowhere else. Querying `audit_log` for that action (already RLS-scoped to the team via "Officers read audit_log") gives an exactly-accurate recent-imports list with zero schema change, reusing `resolveAuditTargetNames()`/`auditFormatTs()` from the Audit Log tab (#378). "Clear All" is dropped, not rebuilt: there's still no safe way to select only paste-imported rows out of `rclc_loot` for deletion. A properly-scoped season-reset-clearing feature is a future issue if it's ever needed, not something to improvise here.

[Full discussion -> #219](https://github.com/katogaming88/WGA-Raid-Hub/issues/219)

---

## 2026-07-09 -- Attendance writes (#218): writes-only, reads deliberately staying on Apps Script for now

Unlike roster (#216) and BiS (#217), attendance's Supabase table doesn't yet have a live pipeline feeding it real data. Checked the live DB before starting:

```
 team_id | count |    max     |    min
---------+-------+------------+------------
       1 |   829 | 2026-06-25 | 2026-03-17
```

Hellfire and Immolation have zero rows. Phoenix's 829 rows are a one-time historical import, frozen at 2026-06-25 -- the pipeline that actually produces new attendance data (`refreshAttendanceWCL` in `gs/Attendance.gs`, run weekly) still writes only to the Google Sheet, and that migration is a separate issue (#223, Phase 7), not done yet.

- **Writes move to Supabase; reads stay on the Apps Script Sheet.** Migrating grid reads now (mirroring #217's BiS precedent) would show an empty grid for any team without the historical import and a stale one for Phoenix, since nothing populates new raid nights in Supabase until #223 ships. `setPlayerStatus`/`toggleReportExcluded` (`js/tabs/tab-attendance.js`) now write to `attendance` via upsert/update, but `getAttendanceGrid` keeps reading the Sheet.
- **A second, separate write path existed and needed the same fix**: `saveAttendanceFromCard()` (`js/common.js`), fired from the player-profile "Attendance" history card rather than the Attendance tab's grid, called the same GAS `setAttendanceStatus` action through its own independent code path -- caught only during manual testing, not by grepping the issue's own scope notes (which only mentioned `tab-attendance.js`). Ported to the identical Supabase upsert + audit log shape as `setPlayerStatus`. Worth remembering for #219/#220: search the whole `js/` tree for a GAS action name before assuming a single call site, since this codebase has more than one UI surface writing to the same table more than once.
- **Accepted interim quirk: an officer's edit is session-only until reads migrate.** Since the grid still reads the untouched Sheet, a page reload shows the Sheet's stale value again -- the edit only persists in Supabase and in the existing local `_attendanceGrid` patch for the rest of that browser session. Confirmed acceptable with Kat: officer attendance workflows aren't moving onto this path in practice until the whole pipeline (including #223) is on Supabase; this PR exists to have the write half ready and waiting, not to be used for real edits yet.
- **`attendance.player_id`'s FK reconciled to `ON DELETE SET NULL`** (migration `20260709170000_attendance_player_id_set_null.sql`), matching `rclc_loot` and the decision #250 already called for but never actually migrated (the baseline dump still showed `ON DELETE CASCADE`). Column made nullable to support it; `check_team_id_matches_player()` already guards on `new.player_id is not null`, so this doesn't need a trigger change. Safety net only -- soft-delete via `archived_at` (#216/#258) is the only path roster removal takes today.
- **Audit action names and shapes carried over unchanged from GAS**: `'Attendance Status Set'` targets the player (`target_type: 'players'`, matching #216/#217's TARGET-durability reasoning), detail `"<old> -> <new>"` (matches the historical backfill's format for this exact action). `'Report Excluded'`/`'Report Exclusion Removed'` have no single player to target (they apply to a whole raid night), so `target_type`/`target_id` are `null` and the raid date goes in the detail string instead.

[Full discussion -> #218](https://github.com/katogaming88/WGA-Raid-Hub/issues/218)

---

## 2026-07-09 -- BiS list edits (#217): editor reworked to instant per-row writes; audit entries target the player, not the bis_items row

The old officer BiS editor (`js/tabs/tab-bis.js`) staged add/remove in a local array and pushed the whole list on one "Save" click, because the GAS `setBisItems` handler it called only ever supported rewriting a player's entire BiS column at once. `bis_items` supports true per-row insert/update/delete, and the issue itself flagged the editor's shape as an open design call rather than something to port as-is.

- **Reworked to instant writes, no staged state.** Picking an item, clicking `x`, and toggling the new "Obtained" checkbox each fire their own Supabase write immediately (one `audit_log` row apiece) instead of accumulating in `_bisListEditor.items` for a batched Save. Removes the "did I remember to hit Save" ambiguity the granular backend was meant to fix, and matches the instant-toggle pattern #216 already established for the Roster tab.
- **Audit entries use `target_type: 'players'` / `target_id: <player.id>`, not `'bis_items'` / `<bis_items.id>`.** `resolve_actor_name()`/`resolveAuditTargetNames()` (`tab-audit.js`) only ever resolve a TARGET by looking its primary key up in the live table. A `bis_items` id goes stale the instant "remove" runs (the row is gone), which would permanently blank TARGET for every remove entry and any add/obtain entry for an item later removed. `players.id` never disappears for an active roster member, so pointing at the player keeps TARGET showing the character name for all three actions, indefinitely. The action name and detail string (e.g. `"Chest Firelord's Vestments"`) already carry the item-level specifics; TARGET only needed to answer "which character."
- **BiS reads also moved to Supabase in the same PR**, ahead of what #217 literally scoped (writes only). Roster reads had their own migration issue before #216 shipped roster writes; BiS had no equivalent, so shipping writes-only would have made `DATA.bisList` (sourced from the Apps Script heavy chunk) go stale the moment any write landed -- a reload would show wrong BiS counts/contents everywhere the list is used (roster tab, contested items, profile checklist). `fetchSupabaseBisItems()`/`mapSupabaseBisItems()` (`js/common.js`) replace `heavy.bisList` when the Supabase read succeeds, keyed by the same raw-firstName convention `mapSupabaseRoster()` uses (`tab-conflicts.js`/`tab-priority.js` index `DATA.bisList[firstName]` directly, bypassing the normalised-lookup `getBisItems()` does).
- **Item ids resolved by exact `items.name` match at write time** (`resolveItemId()`), same approach #216 used for `classes_specs` -- no client-side id cache exists yet for either lookup table.

[Full discussion -> #217](https://github.com/katogaming88/WGA-Raid-Hub/issues/217)

---

## 2026-07-09 -- Roster edits (#216): Role dropdown dropped, Class+Spec write together

The old Player Settings panel (`js/common.js`) had three independent controls -- Role, Class, Spec -- each firing its own write, matching the old sheet's three separate columns. The migrated `players` table only has `class_spec_id` (a single FK into `classes_specs`, which pairs each class+spec with exactly one `role`); there's no column an independent role write or a class-only write could land on.

- **Role select removed entirely, replaced with a static read-only display of the derived value.** An independent role override doesn't fit the schema -- role always follows from whichever class_spec_id is set, so a selectable Role dropdown could only ever silently disagree with Class/Spec or do nothing.
- **Class and Spec stay as two dropdowns, but only Spec's onchange fires a write.** Picking a new Class only repopulates the Spec dropdown client-side (`officerUpdateClass`); the write (`officerSaveClassSpec` -> `updateClassSpecSupabase` in `js/tabs/tab-roster.js`) fires once a Spec is chosen, reading Class's current DOM value at that point and resolving both to one `classes_specs` row before updating `class_spec_id`. This mirrors the only state that's ever actually valid to write: a complete (class, spec) pair.
- **Audit label reuses `'Spec Changed'`** (not a new `'Class/Spec Changed'` label) since the historical backfill (`20260709140000_backfill_audit_log_detail.sql`) already maps `Spec Changed`/`Class Changed`/`Role Changed` to the same `'Changed to ' || to` summary shape -- one combined write reusing an existing label keeps the Audit Log tab's convention intact without adding a fourth near-duplicate action name.
- **Roster reads now include `players.id`** (`js/common.js` `fetchSupabaseRoster`/`mapSupabaseRoster`) so writes can target a row by primary key instead of `name_realm`, matching the `.eq('id', playerId)` pattern #216 called for.

[Full discussion -> #216](https://github.com/katogaming88/WGA-Raid-Hub/issues/216)

---

## 2026-07-09 -- anon/authenticated need USAGE on sequences too, not just table DML

#312 granted base table DML (`select/insert/update/delete` on all `public` tables) to `anon`/`authenticated` so RLS policies would actually get consulted on a write. Found while testing #216's Add Player flow: inserting into `players` still failed with `permission denied for sequence players_id_seq`, even though the row-level `"Officers write players"` policy permits the insert.

- **A serial/identity column's `nextval()` checks `USAGE` on its backing sequence before RLS is ever reached.** #312 only covered tables; nothing had exercised an `INSERT ... DEFAULT` through PostgREST until now, so the gap sat unnoticed. Same class of issue #332 flagged for `service_role` -- this is the `anon`/`authenticated` half of it.
- **Fix mirrors #312's shape exactly:** one additive migration (`20260709150000_sequence_grants.sql`, #383), `grant usage, select on all sequences in schema public to anon, authenticated` plus the matching `alter default privileges` so future sequences pick it up automatically. Doesn't loosen anything -- RLS still gates every row.
- **No dbdoc/RLS.md update needed** -- grants don't appear in either (confirmed against #312's precedent), so this is a schema-docs-CI no-op.

[Full discussion -> #383](https://github.com/katogaming88/WGA-Raid-Hub/issues/383)

---

## 2026-07-09 -- Historical audit_log.detail backfilled in place, legacy changed_by dropped rather than preserved

The Stage C import (#320) wrote the raw `{target, from, to, changed_by}` shape into `audit_log.detail` for every historical row; `write_audit_log()` (#214) and the Audit Log tab rewire (#378) both expect a single human-readable summary string instead. Migration `20260709140000_backfill_audit_log_detail.sql` (#377, split from #215) converts existing rows in place via `UPDATE ... WHERE jsonb_typeof(detail) = 'object'`.

- **One-time SQL backfill over fixing the importer and re-importing.** `scripts/import/tables/audit.js` doesn't need to change -- its own idempotency guard (`NOT EXISTS` on `(team_id, created_at, action)`) has nothing to do with this conversion, and a wipe-and-reimport would touch production data via delete+reinsert for no benefit over an in-place `UPDATE`.
- **Rerun-safe by construction, not by a migration-tracking table.** The `jsonb_typeof(detail) = 'object'` scope means a row already converted to a plain string is left alone on a second run, and any future write through `write_audit_log()` that happens to pass a jsonb object as `p_detail` would also need this same guard kept in mind if this migration ever needs to be edited.
- **Legacy `detail.changed_by` (a free-text Discord username, not an `auth.users` link) is dropped, not preserved.** Every historical row already has `actor_id = null` and always will (the sheet's Changed By was never an account link) -- these rows were never going to resolve a CHANGED BY through `resolve_actor_name()` (#376) regardless of what happens to `detail`, so keeping `changed_by` around in some structured form would only complicate the tab (#378) for a display gap that already existed. Confirmed with Kat rather than assumed.
- **Two corrections to the conversion map** as originally proposed in #215's comments, found by reconciling against the real distinct-action list in production (not just the `gs/wgaWebApp.gs` call sites): `Trial Status Changed`/`Bench Status Changed` store `to`/`from` as the literal strings `"TRUE"`/`"FALSE"`, not booleans; `Officer Granted`/`Officer Revoked`'s `to` is a raw Discord snowflake id, not human-readable, so both were moved from "use TO directly" into the empty-detail bucket -- TARGET (the username) already carries the meaningful part.

[Full discussion -> #377](https://github.com/katogaming88/WGA-Raid-Hub/issues/377)

---

## 2026-07-09 -- Actor-name resolution reads auth.users PII, so it's gated like a read policy, not just an execute grant

`resolve_actor_name(p_actor_id uuid, p_team_id integer)` (migration `20260709130000_resolve_actor_name.sql`, #376, split from #215) resolves `audit_log.actor_id` to a display name for the Audit Log tab's CHANGED BY column.

- **Internal authorization check, not just a GRANT restriction.** Every other SECURITY DEFINER function so far (`write_audit_log`, `claim_character`) only ever exposes or attributes the _caller's own_ data. This one is different: its Discord-display-name fallback path reads `auth.users.raw_user_meta_data` for an arbitrary other person (the case where a site admin acted on a team they don't belong to, so no `team_members` row exists to resolve a name from). Restricting `EXECUTE` to `authenticated` alone would let any raider harvest other people's Discord display names by probing actor uuids across teams they have nothing to do with. The function therefore re-checks the same `my_team_role(p_team_id) in ('officer','team_leader') or is_site_admin()` gate `"Officers read audit_log"` already enforces at the table level -- callers who couldn't read a team's audit log can't resolve names on it either.
- **Resolution order mirrors `resolveDiscordSession()`'s existing client-side priority** (`js/discord.js`): linked player's `nickname`, then the character-name part of `name_realm` (preferring the linked `players` row over `team_members.name_realm`'s legacy bridge column, same precedence `resolveDiscordSession()` uses), then the Discord display name, then `null`.

[Full discussion -> #376](https://github.com/katogaming88/WGA-Raid-Hub/issues/376)

---

## 2026-07-09 -- Audit log write path: security-definer writer is the only insert path

`audit_log` grants anon/authenticated only `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` -- no `INSERT` -- so a Phase 5 officer write feature has no direct path to log an action. `write_audit_log(p_team_id, p_action, p_target_type, p_target_id, p_detail)` (migration `20260709120000_write_audit_log.sql`) is the one function meant to ever insert into that table.

- **Same SECURITY DEFINER shape as `is_site_admin()`, `link_auth_user_to_member()`, `claim_character()`:** `plpgsql`, `set search_path to 'public'`, identity read directly from `auth.uid()` rather than a passed-in parameter, so a caller can't attribute an action to someone else.
- **`actor_id` is always `auth.uid()`**, never a caller-supplied value -- matches the column's FK to `auth.users` and keeps attribution trustworthy regardless of what the caller passes as arguments.
- **Gate is officer/team_leader-or-site-admin**, via `my_team_role(p_team_id) in ('officer', 'team_leader')` or `is_site_admin()` -- the same pair every other officer-tier policy in this schema checks (post-#294 rename; the value is no longer `admin`).
- **Every future Phase 5 officer-write RPC should follow this same shape** (security definer, `auth.uid()`-derived actor, officer/team_leader-or-site-admin gate) instead of re-deciding the pattern per call site. Wiring existing write flows (roster edits, BiS approvals, loot marks, still on the legacy Apps Script backend) onto this function is out of scope for #214 and left for those flows' own migration issues.

[Full discussion -> #214](https://github.com/katogaming88/WGA-Raid-Hub/issues/214)

---

## 2026-07-08 -- Loot attributes to characters; unknown loot names become archived stubs

The loot importer previously kept rows whose player name no longer matched the Roster with `player_id` null (67 of phoenix's 156 imported rows, spanning 24 departed characters). Any player-keyed view drops such rows, and the Supabase loot read (#209) is player-keyed, so those rows would have vanished from the site's loot totals and Recent Loot feed.

- **Unknown loot names now become archived stubs**, through the same `registry.resolveOrStub` path attendance and scoring always used: a departed character gets a `players` row with `archived_at` set and no class/spec, and the loot row points at it. A one-time relink script backfilled the pre-stub prod rows (stub inserts, then `player_id` updates keyed on `dedupe_key`, which embeds the normalized name-realm).
- **Layering principle:** `players` rows are characters; `team_members` is the person (Discord) layer; `players.team_member_id` links them, many characters to one person. Loot attribution stays character-level -- the historical fact of who the item dropped to. Person-level grouping (mainswaps, alts, same-name characters played by one human) is a `team_member_id` linking exercise through the claims flow and officer tooling, never a loot-schema change.
- The Snarge precedent holds: two characters sharing a first name stay two rows; whether one human plays both is person-layer information.

[Loot read switch -> #209](https://github.com/katogaming88/WGA-Raid-Hub/issues/209)

---

## 2026-07-07 -- Loot columns store item track, named and valued as track (Champion/Hero/Myth)

The `difficulty` columns on `rclc_loot`, `self_received_requests`, and `priority_order` were renamed to `track` with values `Champion`/`Hero`/`Myth` (migration `20260707221243_track_vocabulary`).

- **The semantic was always the item's upgrade track, not the raid difficulty.** The GAS app translated Normal-difficulty drops to "champion", and `self_received_requests` uses the same values for M+ vault, crafted, and catalyst items that never dropped at any raid difficulty. The #320 B2 decision kept "Heroic"/"Mythic" as convenience labels ("lines up with the instance difficulty made it easier"); #343 finished the thought by adopting the real track names, and kat confirmed the column "was only called difficulty because of it being derived from the Instance column."
- **RCLC input maps deterministically for raid drops** (Normal -> Champion, Heroic -> Hero, Mythic -> Myth, from the instance string's suffix). The RCLC itemString's bonus IDs encode the track authoritatively and are the preferred source for the Phase 5 ongoing import (#219).
- **`priority_order` allows only Hero/Myth, permanently.** Champion loot drops in the first weeks of a raid and is handed out by loot council (via RCLC's roll column), never through the priority system.

[Full discussion -> #343](https://github.com/katogaming88/WGA-Raid-Hub/issues/343)

---

## 2026-07-06 -- Pending roster is a season_signups state, not a players flag

The old sheet's "Pending Roster" tab (approved applicants waiting for the roster add) needed a database home. The candidate designs were a marker column on `players` (`is_pending boolean` or `rostered_at timestamptz`, with the player row created at approve time) versus keeping the whole staging phase inside `season_signups`.

- **Chosen: no `players` row until the roster add.** Pending roster is exactly `season_signups` with `status = 'approved'` and `approved_player_id IS NULL`. The UI reads it through the `pending_roster` view (`security_invoker = on`, so the officer-only `season_signups` policies apply to callers). Promotion is `add_signup_to_roster(signup_id, is_trial, archive_player_id)`, a `SECURITY INVOKER` function that creates or unarchives the player, optionally archives a main-swap predecessor, and flips the signup to `added` in one transaction. A one-directional CHECK (`season_signups_player_only_when_added`) guarantees only `added` rows link to a player, while still tolerating the FK's `ON DELETE SET NULL`.
- **Promotion upsert has three cases** on `(team_id, name_realm)`: new character (plain insert, trial by default, `join_date = current_date`); returning archived character (unarchive the old row, refresh spec/trial/join_date, keep the same `players.id` so loot and attendance history stays attached); already-active member (link and update spec only, preserving their existing `is_trial` and `join_date`).
- **Rejected: marker column on `players`.** Four reasons. (1) `players` is public-read (`USING (true)`), so approve-time creation leaks applicant names to anonymous API callers unless the public policy is rewritten and every existing row backfilled; signup data is officer-only today. (2) It duplicates state `season_signups.status` already holds, and Postgres cannot enforce a cross-table invariant without trigger sync between two officer-writable tables, so the copies drift. (3) A pending player row can silently acquire attendance/loot/scoring rows through the name-matching importers. (4) A returning character's archived row collides with `UNIQUE (team_id, name_realm)` at approve time, and dismissing a pending player has no good answer (hard-delete contradicts #258's soft-delete, archiving pollutes history with characters that never raided). Deferring creation makes all of these unrepresentable.

---

## 2026-07-05 -- Schema documentation: generated with tbls, not hand-drawn

Triggered by losing a hand-arranged Supabase schema visualizer layout: the visualizer stores table positions in browser localStorage, per device, so it can never serve as documentation.

- **Generated over hand-drawn.** A hand-drawn diagram drifts from the migrations, and a stale diagram is worse than none. The migration SQL is already the source of truth, so the diagram is generated from it: `tbls` introspects the local stack and writes `dbdoc/` (markdown plus Mermaid ER), and a CI job fails any PR where `dbdoc/` no longer matches the schema. Regenerate with `npm run db:docs`.
- **Mermaid over SVG.** Renders natively on GitHub and diffs as text, so schema changes show up readably in PR review. SVG lays out prettier but commits unreviewable blobs.
- **RLS documented by hand.** tbls introspects structure, not policies, so `docs/RLS.md` carries the per-table policy matrix, with its own CI guard: a PR touching policy SQL must touch RLS.md.
- **Rejected: Supabase visualizer as documentation** (device-local localStorage) and **dbdiagram.io as source of truth** (canvas lives in their cloud; same one-browser trap, plus a second schema definition to keep aligned).

---

## #250 -- Schema audit: Phase 1 review

- **Seasons table.** Adding a `seasons` lookup table (`slug` PK, `name`, `starts_at`, `ends_at`) instead of a format CHECK on `season text` columns. A CHECK can't catch a well-formed typo (`MN11` vs `MN1`); only an FK against a canonical table can. `ends_at IS NULL` also gives "current season" for free, which the priority generator and #143 (archived seasons) both need.
- **team_settings / season_snapshots SELECT policy.** Locked down to team members only (`my_team_role(team_id) is not null`). Both tables carry data with no reason to be publicly readable, unlike roster/loot which the public site intentionally exposes.
- **attendance FK on-delete.** Changed `attendance.player_id` to `ON DELETE SET NULL` (was `CASCADE`), matching `rclc_loot`. Soft-delete (`players.archived_at`, decided in #258) is the primary path; this FK change is the safety net if a hard-delete ever happens anyway.
- **Auth-link backfill.** Added an `AFTER INSERT` trigger on `team_members` and `site_admins` that backfills `auth_user_id` immediately if the person already has an `auth.users` row (covers the case where someone logs in via Discord before an officer seeds their row).

[Full discussion -> #250](https://github.com/katogaming88/WGA-Raid-Hub/issues/250)

---

## #257 -- Schema hardening (constraints, timestamps, triggers)

Umbrella issue. Original scope, later split into #262 (nullability/duplicate guards), #266 (updated_at), #267 (team_id consistency trigger):

- Unique constraints: `attendance(team_id, player_id, raid_date)`, `bis_items(player_id, item_id)`, `priority_order(team_id, season, item_id, difficulty, player_id)`, `priority_order(team_id, season, item_id, difficulty, rank)`, `item_bosses(item_id, boss)`, `classes_specs(class, spec)`, `teams.slug`.
- CHECK constraints on status/enum-like columns across `season_signups`, `attendance`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `rclc_loot.difficulty`, `priority_order.difficulty`, `classes_specs.role`, `items.armor_type`.
- **Original updated_at table list:** `players`, `bis_items`, `priority_order`, `team_members`, `team_settings`, `season_signups`. (Note: this list drifted when #266 was spun out -- see that entry and #272.)
- **Original team_id trigger table list:** `attendance`, `rclc_loot`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `priority_order` (six tables -- see #267/#271 for how `priority_order` got dropped along the way).

[Full discussion -> #257](https://github.com/katogaming88/WGA-Raid-Hub/issues/257)

---

## #258 -- Scoring, WCL data, and identity design decisions

- **scoring table:** add `season text NOT NULL`, unique key becomes `(player_id, season)`. Additive per season instead of overwritten, for trend analysis and priority generation.
- **player_wcl_season_perf (new table):** separate from `scoring` -- different source (WCL character API vs. team reports), different update cadence (once per season vs. per raid import). Holds `best_perf_avg` / `median_perf_avg` fetched at season start, used as the heroic priority baseline until current-season `scoring` data accumulates.
- **Identity/lifecycle fix:** `players.team_member_id` (FK -> `team_members.id`, nullable) links a character row to the person/Discord account. `players.archived_at` (soft-delete) preserves character history across a main-swap instead of losing it to a hard-delete. `season_signups.approved_player_id` (FK -> `players.id`, `ON DELETE SET NULL`) links a signup to the character it produced.
- **Season-scoping of wipe-between-seasons tables:** `scoring` gets a `season` column (preserve history). `mplus_exclusion_requests` and `bis_items` do NOT -- both wipe between seasons on purpose (gear/tier resets the exclusion criteria and BiS lists are rebuilt fresh each tier), and that intent is written down here so it isn't mistaken for a bug later.

[Full discussion -> #258](https://github.com/katogaming88/WGA-Raid-Hub/issues/258)

---

## #262 -- Nullability + duplicate-guard hardening

- `bis_items.item_id` and `mplus_exclusion_requests.player_id` set `NOT NULL` (both tables empty at the time, no backfill cost).
- `mplus_excl_one_pending_per_player` partial unique index (`(player_id) where status = 'pending'`) replaces the dropped `(player_id, week_of)` constraint -- one open request per player, resolved rows stay as history.
- **priority_order rank-reorder safety -- Option B (delete + reinsert).** The `(team_id, season, item_id, difficulty, rank)` unique constraint fails mid-statement on bulk re-rank updates (Postgres checks row-by-row). Decided to have the app delete + reinsert the full list per reorder, rather than making the constraint `DEFERRABLE`. **Scope note:** this decision applies only to the reorder app logic, which doesn't exist yet (the priority list feature is still GAS/Sheets-based) -- it does NOT apply to schema/trigger work on `priority_order`, which should proceed independent of when the reorder UI gets built. See [[project_priority_order_migration]] in memory and #271 for why this distinction matters.

[Full discussion -> #262](https://github.com/katogaming88/WGA-Raid-Hub/issues/262)

---

## #266 -- updated_at timestamps

- Added `updated_at timestamptz` + shared `set_updated_at()` BEFORE UPDATE trigger to six tables: `players`, `season_signups`, `bis_items`, `scoring`, `mplus_exclusion_requests`, `priority_order`.
- **Nullable, no default.** A freshly inserted row has `updated_at = NULL` until its first real update. None of these tables (aside from `season_signups`, which has `submitted_at`) have a separate created-at column, so leaving `updated_at` null at insert is what lets you tell "never edited since creation" apart from "edited at time X." (The original #266 write-up justified this as "no backfill needed," which isn't accurate -- `NOT NULL DEFAULT now()` backfills for free on `ADD COLUMN` -- the real reason is the one above; corrected in #272.)
- **Table list note:** this six-table list does not match #257's original list (`team_members` and `team_settings` were dropped, `scoring` and `mplus_exclusion_requests` were added). No comment anywhere explains the swap -- see #272, where the omission of `team_members`/`team_settings` was confirmed as unintentional and fixed.

[Full discussion -> #266](https://github.com/katogaming88/WGA-Raid-Hub/issues/266)

---

## #267 -- team_id consistency trigger

- Added `check_team_id_matches_player()` (BEFORE INSERT OR UPDATE) to five tables: `attendance`, `rclc_loot`, `bis_requests`, `self_received_requests`, `mplus_exclusion_requests`. Raises if the row's `team_id` doesn't match `players.team_id` for the given `player_id`; skips the check when `player_id` is null (allowed on `rclc_loot` after a player delete).
- `bis_items` intentionally excluded -- no denormalized `team_id`, derives team through the `player_id` FK by design.
- **`priority_order` was left off this list** despite being named in #257's original six-table scope. Confirmed a plain implementation oversight, not a deliberate exclusion -- fixed in #271.

[Full discussion -> #267](https://github.com/katogaming88/WGA-Raid-Hub/issues/267)

---

## #271 -- priority_order missing team_id consistency trigger

- Added `check_team_id_matches_player()` trigger to `priority_order` (table was empty, no backfill concern), bringing it in line with the other five tables from #267.

[Full discussion -> #271](https://github.com/katogaming88/WGA-Raid-Hub/issues/271)

---

## #272 -- updated_at coverage + nullable/default revisit

- **Coverage:** add `updated_at` + `set_updated_at()` trigger to `team_members` and `team_settings` too, matching #257's original scope. Both are clearly mutable (`role` changes, `auth_user_id` backfill, `name_realm` swaps on `team_members`; officer-edited `config` on `team_settings`) with no existing timestamp column, and no reason for the #266 omission was ever recorded.
- **Nullable/default:** confirmed keep nullable, no `DEFAULT now()` -- see the corrected rationale under #266 above.

[Full discussion -> #272](https://github.com/katogaming88/WGA-Raid-Hub/issues/272)

---

## #283 -- Roster "Priority" column's RL/Officer values are legacy, no migration needed

- The GAS Roster sheet's `Priority` column is documented as `1=RL, 2=Officer, 3=Tank, 4=Heal, 5=DPS, 6=Bench`, but every write path (`roleToPriority()`) only ever produces `3`/`4`/`5`/`6` -- nothing in the app has ever written `1` or `2`. Officer status is tracked entirely separately (Discord ID list today, `team_members.role` in the new schema).
- Confirmed with Kat: "RL" was never a distinct app concept, just a manual Sheet-only sort aid; a raid leader is almost always (not by rule) also an officer, and no dashboard permission or display logic has ever depended on it.
- **Decision:** no RL concept needs a home anywhere in the new schema. The already-migrated `players` table correctly has no equivalent column (role derives from `class_spec_id`, bench is its own `is_bench` boolean). Any leftover `1`/`2` in a live Sheet row is dead data with nothing to carry over.
- This also closes out this specific instance of the migration plan's open "does any officer hand-edit the Sheet in a way the dashboard can't do?" question -- no gap found.

[Full discussion -> #283](https://github.com/katogaming88/WGA-Raid-Hub/issues/283)

---

## #294 -- Permission tier names: raider / officer / team_leader, plus site_admin

- The word "admin" meant two unrelated things: the top per-team role in `team_members.role`, and the global `site_admins` table. No doc defined the difference, and `docs/supabase-setup-guide.md` lumped officer and admin into one tier even though three write policies separate them (`team_settings`, `team_members`, `season_snapshots`).
- **Decision:** the stored per-team role value `admin` is renamed to `team_leader`; the global tier is always written `site_admin`. Bare "admin" appears nowhere in docs or UI copy. The rename shipped as a migration that updates the stored values, the CHECK constraint, and all 20 policies that referenced the old literal (the three "Admins write ..." policies are now "Team leaders write ...").
- Live data confirmed the tier is load-bearing before renaming: each team has exactly one `team_leader` row, and two of the three are NOT site admins, so the role cannot be replaced by `site_admins` without over-granting.
- The UI will honor the officer/team-leader split when the frontend moves to Supabase; that scope (which Admin-tab panels tighten, which stay officer-level) is recorded in #317.

[Full discussion -> #294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294)

---

## #580 -- bis_items/item_preferences: season column for Other Sources placeholder scoping

- Other Sources rows (`M+`/`Crafted`/`Catalyst`, used as BiS/Wishlist stand-ins for gear not from a raid drop) aren't tied to a raid zone, so `isItemInSeasonScope()` always treated them as in scope regardless of the viewed season -- an officer's "M+ - Head" pick from Season 1 kept showing up forever, even in a Season 2 view, unlike real items (scoped via `items.wcl_zone_id`).
- **Decision:** added a nullable `season` text column to both `bis_items` and `item_preferences`. New rows (any item, not just placeholders) are stamped with `resolveSeasonView()`'s current value -- the same `raid_zones.season`-format string ("Midnight Season 1"), not the short `priority_order.season`-style code ("MID1"). `isItemInSeasonScope(name, rowSeason)` gained an optional second parameter used only for placeholders; real items still resolve purely through `items.wcl_zone_id`, ignoring it.
- Existing rows were backfilled to each team's `team_settings.config->>'seasonName'` (the best available guess for "when was this tagged"), since neither table nor any other table records a per-team "current season" more precisely than that free-text field.
- Rows with no season stamped (backfill gap, or any future manual insert that skips the column) fail open -- shown regardless of season -- matching the existing fail-open convention for real items with no `wcl_zone_id`.
- **Follow-up not included:** `getIncompleteWishlists()`'s completeness check (`js/tabs/tab-priority.js`) still counts a raider's own stale-season Other Sources tag as "covering" a slot -- only the *display* of these rows (BiS Lists editor, Wishlist's own Other Sources card) was season-scoped this pass.

[Full discussion -> #580](https://github.com/katogaming88/WGA-Raid-Hub/issues/580)

---

## #633 -- attendance.status: Late (with notice) / Late (no notice), 90%/50% weight

- Officers had no way to record a player showing up late without either marking them fully Present (overcounting) or as a harsher status like Excused/No Show that doesn't reflect "showed up, just not on time." Two new literal values were added to `attendance.status`'s CHECK constraint: `Late (with notice)` (90% weight) and `Late (no notice)` (50% weight) -- between `Present`/`Bench`/leave statuses (100%) and `Excused` (80%) on one side, and `No Show` (0%) on the other.
- `attendance.status` is a plain `text` column gated by a CHECK constraint, not a Postgres enum, so this is additive (`DROP CONSTRAINT` + re-`ADD` with the two new literals) -- no backfill needed, no existing rows affected.
- The weight/status list is duplicated client-side in ~6 places with no single source of truth (`ATTENDANCE_WEIGHTS_JS`, a separate and already-inconsistent `attendTrendValue`/`attendTrendColor` pair for the trend sparkline, `ATTENDANCE_STATUSES` in tab-attendance.js, two independently-declared `CARD_STATUSES` arrays in common.js for the profile card) -- all updated together this pass rather than consolidated, to keep the change additive and low-risk.
- Both new statuses count as "attended" for the trend chart's physical-presence tooltip (they did show up) but as "penalizing" in `mapSupabaseAttendanceDetails`'s below-threshold officer view (neither is full credit), same treatment as `Excused` already gets.
- **Follow-up not included** (tracked as a separate PR): tying the WCL attendance sync (`supabase/functions/wcl-sync`) into detecting probable lateness. Today the sync only determines report-wide presence/absence, not per-fight timing -- no raid-start-time-of-day is stored anywhere, and there's no "flag this row for officer review" concept in the schema. The agreed design for that follow-up: detect a player missing the raid's first logged pull but present in later ones, and flag the row via a new `source = 'WCL (Late?)'` value with `status` left empty (not set to `Present`), so it surfaces in the grid for an officer to manually classify -- the sync itself never guesses which of the two Late statuses applies.

[Full discussion -> #633](https://github.com/katogaming88/WGA-Raid-Hub/issues/633)

---

## #636 -- healer-only and tank-only trinkets filtered from wrong-role wishlist/BiS views

- Some trinkets' equip/on-use effect is entirely about healing/protecting allies (no damage, no self-buff a DPS spec could use) or entirely about reducing/absorbing damage the wearer takes (no throughput value outside a tank spec) -- but nothing in the catalog's stat data (`armor_type`/`main_stats`) rules either out, so the wrong-role specs saw them as options in the Wishlist and officer BiS grid. One of the four healer-only items (`Preternatural Antivenom`) isn't even Int-restricted -- its `main_stats` is `[]` (confirmed stat-less), so before this it showed to literally every spec in the game.
- **Decision:** two client-side denylists, not a schema column. `HEALER_ONLY_TRINKETS`/`TANK_ONLY_TRINKETS` (`js/common.js`) are Kat-curated `{itemName: true}` maps, same manual-per-tier-edit workflow already used for `CURRENT_SEASON`/`TOKEN_SLOT_KEYWORDS`. Rejected a new `items` column (manual curation via SQL Editor, or fragile tooltip-text parsing) since the affected set is expected to stay small. Every current-tier Intellect trinket (14) and every current-tier Strength/Agility/stat-less trinket (17) was checked live against Blizzard's/Wowhead's actual proc text before adding an entry -- not guessed from item names.
- Not a mechanical "must trigger off a specific word" rule -- `Soulcoiler Ritual Vessel` (healer) is a plain on-use ability, not gated behind a healing-spell cast, and `First Mate's Shellward` (tank) is a plain on-use shield, not a proc -- both still belong on their list since their only effect has zero value outside the intended role. `Idol of the Howling Nexus` (tank) was a genuine judgment call: its proc triggers off dodge/parry/block (tank avoidance stats), but has a guaranteed 15-second fallback trigger even at 0% dodge/parry/block, so it's not strictly *unusable* by a DPS spec -- included anyway since Kat confirmed it as one of the two Season 2 tank trinkets. Judgment call each time, Kat-confirmed per item, not automated.
- Checked against the viewing player's `SPEC_ROLE` value (`'Heal'`/`'Tank'`), not their class -- so e.g. a Discipline Priest still sees a healer-only trinket while a Shadow Priest doesn't, even though both are the same class.

[Full discussion -> #636](https://github.com/katogaming88/WGA-Raid-Hub/issues/636)

---

## #609 -- items.weapon_subtype: filter Weapon/Off Hand rows by class-allowed weapon type

- `items.slot` only ever distinguished One-Hand/Two-Hand/Ranged/Off Hand -- no weapon subtype (Sword/Axe/Mace/Dagger/Staff/Polearm/Warglaive/Bow/Gun/Shield) was stored anywhere, so e.g. a Mage's Weapon wishlist row showed every class's Maces and Polearms mixed in with actual Mage-usable weapons, since neither `armor_type` (weapons carry none) nor `main_stats` (shared across many classes) rules out a wrong weapon type.
- **New nullable `items.weapon_subtype` text column**, populated by `scripts/fetch-item-stats.js` in the same pass as `main_stats`/`secondary_stats` -- zero extra network calls, since the subtype name (e.g. `"Sword"`, `"Shield"`) is already present in both the Blizzard API response (`preview_item.item_subclass.name`) and the Wowhead tooltip fallback (the `<!--scstartCLASSID:SUBCLASSID--><span>NAME</span>` marker), gated to item_class id 2 (Weapon) or id 4/subclass 6 (Shield) so an armor piece's item_subclass name (e.g. "Rings") never gets miscategorized as a weapon type.
- **Class -> allowed weapon-type table** (`CLASS_WEAPON_TYPES`, `js/common.js`) is Kat-curated static game-design data, keyed by handedness (One-Hand/Two-Hand/Ranged) since the subtype name alone doesn't distinguish them -- e.g. Mage gets One-Hand Sword but not Two-Hand Sword, while still getting Two-Hand Staff. A web reference was tried first and rejected as unreliable (came back self-contradictory on armor types, and conflated classic-era mechanics like the pre-Legion separate Ranged slot with current retail). Warrior/Rogue deliberately omitted from Ranged despite being technically able to equip it -- neither receives a ranged weapon as loot in current itemization.
- **Shield eligibility** (`CLASS_SHIELD_USERS`) is a separate flag (Warrior/Paladin/Shaman only) checked against `weapon_subtype === 'Shield'` on the Off Hand row -- non-shield Off Hand items (tomes/orbs) carry no `weapon_subtype` at all and stay filtered by main-stat only, same as before.
- Same null-safe convention as every other catalog filter here: a null/unbackfilled `weapon_subtype` shows the item to everyone rather than hiding it, so existing (pre-backfill) items aren't affected until `fetch-item-stats.js` is re-run.

[Full discussion -> #609](https://github.com/katogaming88/WGA-Raid-Hub/issues/609)
