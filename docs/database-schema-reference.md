# Database Schema Reference

A full column-by-column breakdown of every table in the WGA Raid Hub database.
Includes notes on redundancies and why they exist.

> **Where truth lives:** for structure (columns, types, constraints, indexes,
> FKs, ER diagrams), the generated docs in [`dbdoc/`](../dbdoc/README.md) are
> canonical; they are regenerated from the migrations and CI fails when they
> drift. This file is canonical for semantics: what columns mean, why
> redundancies exist, and trigger behavior. RLS policies are documented in
> [RLS.md](RLS.md). Where a column table below disagrees with `dbdoc/`,
> `dbdoc/` is right; fixing the stale text here is welcome but this file is
> not machine-checked.

---

## Table of Contents

- [items](#items)
- [item_bosses](#item_bosses)
- [bis_items](#bis_items)
- [rclc_loot](#rclc_loot)
- [priority_order](#priority_order)
- [season_signups](#season_signups)
- [attendance](#attendance)
- [players](#players)
- [team_members](#team_members)
- [teams](#teams)
- [team_settings](#team_settings)
- [audit_log](#audit_log)
- [site_admins](#site_admins)
- [scoring](#scoring)
- [player_wcl_season_perf](#player_wcl_season_perf)
- [classes_specs](#classes_specs)
- [self_received_requests](#self_received_requests)
- [bis_requests](#bis_requests)
- [mplus_exclusion_requests](#mplus_exclusion_requests)
- [boe_items](#boe_items)
- [boe_listings](#boe_listings)
- [boe_managers](#boe_managers)
- [Triggers](#triggers)
- [Redundancies & Design Notes](#redundancies--design-notes)

---

## `items`

Master item catalog. Every loot piece the system knows about.

| Column           | Type | Purpose                                                                   |
| ---------------- | ---- | ------------------------------------------------------------------------- |
| `id`             | int4 | Internal PK used as FK everywhere else                                    |
| `wow_item_id`    | int4 | Blizzard's item ID (used for Wowhead links and tooltip lookups)           |
| `name`           | text | Display name of the item                                                  |
| `slot`           | text | Gear slot (e.g. "Head", "Trinket")                                        |
| `armor_type`     | text | Plate/Mail/Leather/Cloth -- used to filter BiS lists by class             |
| `sort_id`        | int4 | Controls display order within a slot                                      |
| `is_placeholder` | bool | Marks synthetic items added before real loot data exists (e.g. early PTR) |
| `icon`           | text | Wowhead icon name, for the item image                                     |
| `secondary_stats` | jsonb | Secondary stats from Wowhead (#560), shown as pills                       |
| `main_stats`     | jsonb | Main stats from Wowhead (#609)                                            |
| `weapon_subtype` | text | Weapon subtype (Staff, Dagger, ...) for weapons (#609)                    |
| `wcl_zone_id`    | int4 | The raid the item drops in, matching `raid_zones.wcl_zone_id`; scopes the item to a season (#535) |
| `is_ptr`         | bool | Fetched from a PTR zone page and not yet live (#561)                      |
| `is_boe`         | bool | A season BoE (#875): offered by the found form's picker and linked by `submit_boe_found`; kept out of every other view |

---

## `item_bosses`

Maps each item to the boss(es) that drop it. Multi-row per item when the same item drops from multiple bosses.

| Column    | Type | Purpose                          |
| --------- | ---- | -------------------------------- |
| `item_id` | int4 | FK -> `items.id`                 |
| `boss`    | text | Boss name string (e.g. "Onyxia") |

---

## `bis_items`

A player's current BiS list -- which items they need and whether they have them.

| Column      | Type | Purpose                                 |
| ----------- | ---- | --------------------------------------- |
| `id`        | int4 | PK                                      |
| `player_id` | int4 | FK -> `players.id`                      |
| `item_id`   | int4 | FK -> `items.id` -- the item they want  |
| `obtained`   | bool        | Whether they have received it this tier |
| `updated_at` | timestamptz | Auto-set on every UPDATE via trigger    |

---

## `rclc_loot`

Raw loot history imported from the RCLootCouncil addon export.

| Column       | Type        | Purpose                                                                                |
| ------------ | ----------- | -------------------------------------------------------------------------------------- |
| `id`         | int4        | PK                                                                                     |
| `team_id`    | int4        | FK -> `teams.id` -- denormalized for query filtering and RLS                           |
| `player_id`  | int4        | FK -> `players.id` -- the character the item was awarded to (historical fact; departed characters resolve to archived stub rows) |
| `item_id`    | int4        | FK -> `items.id`                                                                       |
| `track`      | text        | Item upgrade track, CHECK values Champion/Hero/Myth -- derived from the instance string's difficulty suffix on import (Normal -> Champion, Heroic -> Hero, Mythic -> Myth, decided on #343) |
| `season`     | text        | Season string (e.g. "MN1")                                                             |
| `awarded_at` | timestamptz | Timestamp of loot award                                                                |
| `rclc_id`    | text        | RCLootCouncil's own record ID -- primary deduplication key on re-import                |
| `dedupe_key` | text        | Composite hash (player + item + date) -- fallback deduplication when rclc_id is absent |
| `boss`       | text        | Boss the item dropped from at time of award (event-level record, not a lookup)         |

---

## `priority_order`

Ordered loot priority lists managed by officers -- who gets the next drop for a given item.

| Column       | Type | Purpose                                   |
| ------------ | ---- | ----------------------------------------- |
| `id`         | int4 | PK                                        |
| `team_id`    | int4 | FK -> `teams.id`                          |
| `season`     | text | Season this priority list applies to      |
| `item_id`    | int4 | FK -> `items.id`                          |
| `track`      | text | Item track this priority applies to, CHECK values Hero/Myth -- Champion loot never enters the priority system (first-weeks loot council, #343) |
| `rank`       | int4 | Ordinal position (1 = next in line)       |
| `player_id`  | int4        | FK -> `players.id` -- who is at this rank |
| `updated_at` | timestamptz | Auto-set on every UPDATE via trigger      |

---

## `season_signups`

Applications submitted by players (or prospective members) to join a raid team for a season.

Lifecycle: `pending` -> `approved` -> `added` (or `rejected` at review). The "Pending Roster" from the old sheet is not a table: it is the set of rows with `status = 'approved'` and `approved_player_id` still NULL, exposed to the officer UI through the `pending_roster` view. No `players` row exists until an officer promotes the signup with `add_signup_to_roster(signup_id, is_trial, archive_player_id)`, which creates (or unarchives) the player, optionally archives a main-swap predecessor, and sets `status = 'added'` plus `approved_player_id` in one transaction. The `season_signups_player_only_when_added` CHECK enforces that only `added` rows link to a player. See [database-decisions.md](database-decisions.md) for why this is a signup state rather than a flag on `players`.

| Column                | Type        | Purpose                                                                          |
| --------------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`                  | int4        | PK                                                                               |
| `team_id`             | int4        | FK -> `teams.id`                                                                 |
| `signup_name_realm`   | text        | Character name-realm as entered by the applicant (free text -- no player FK yet) |
| `class_spec_id`       | int4        | FK -> `classes_specs.id` -- the spec they are applying as                        |
| `off_specs`           | text        | Off-specs they can play                                                          |
| `main_swap`           | bool        | Whether they want to swap mains from last season                                 |
| `player_note`         | text        | Free-text note from the applicant                                                |
| `submitted_at`        | timestamptz | When the signup was submitted                                                    |
| `status`              | text        | Workflow state: pending/approved/rejected/added                                  |
| `swap_class_spec_id`  | int4        | FK -> `classes_specs.id` -- the new spec they would swap to                      |
| `season`              | text        | Which season this signup is for                                                  |
| `reviewed_at`         | timestamptz | When an officer acted on it                                                      |
| `reviewed_by`         | int4        | FK -> `team_members.id` (officer who reviewed)                                   |
| `signup_officer_note` | text        | Officer's internal note on the application                                       |
| `approved_player_id`  | int4        | FK -> `players.id` ON DELETE SET NULL -- the player row created when the signup is added to the roster (status `added`) |
| `updated_at`          | timestamptz | Auto-set on every UPDATE via trigger                                             |
| `swap_from_name_realm` | text       | The old character's name-realm for a verified-claim mainswap (`js/signup.js`'s `discordSession.nameRealm` when the typed name differs from the applicant's Discord claim); null for the free-typed "I'm switching mains" case, which has no claim backing it |

---

## `attendance`

Per-player, per-raid-night attendance records.

| Column            | Type | Purpose                                                                       |
| ----------------- | ---- | ----------------------------------------------------------------------------- |
| `id`              | int4 | PK                                                                            |
| `team_id`         | int4 | FK -> `teams.id` -- denormalized for filtering and RLS                        |
| `player_id`       | int4 | FK -> `players.id`                                                            |
| `raid_date`       | date | Date of the raid night                                                        |
| `status`          | text | Present/Absent/Late/Bench/Excused                                             |
| `report_excluded` | bool | Whether this record is excluded from attendance reports (e.g. cancelled raid) |
| `report_id`       | text | External report identifier (Warcraft Logs report ID)                          |

---

## `players`

The active raid roster. One row per character on a team.

| Column            | Type | Purpose                                              |
| ----------------- | ---- | ---------------------------------------------------- |
| `id`              | int4 | PK                                                   |
| `team_id`         | int4 | FK -> `teams.id`                                     |
| `name_realm`      | text | "CharName-RealmName" -- canonical character identity |
| `class_spec_id`   | int4 | FK -> `classes_specs.id`                             |
| `is_trial`        | bool | Whether they are on trial (affects loot and scoring) |
| `is_bench`        | bool | Bench player flag                                    |
| `nickname`        | text | Display name override shown in the UI                |
| `bis_link`        | text | URL to their external BiS list (Wowhead, etc.)       |
| `join_date`       | date | When they joined the roster                          |
| `m_plus_excluded`  | bool        | Whether they are excluded from M+ tracking                                      |
| `m_plus_note`      | text        | Reason for M+ exclusion                                                         |
| `team_member_id`   | int4        | FK -> `team_members.id` ON DELETE SET NULL -- links character to Discord account; many characters can share one team_member (the person layer) |
| `archived_at`      | timestamptz | Soft-delete timestamp. Null = active roster. Populated on character swap/removal; archived stubs (name only, no class/spec) represent departed characters kept for history FKs |
| `updated_at`       | timestamptz | Auto-set on every UPDATE via trigger                                             |

---

## `team_members`

Links Discord/auth users to a team. The account-level membership layer, separate from the character roster.

| Column         | Type | Purpose                                                                       |
| -------------- | ---- | ----------------------------------------------------------------------------- |
| `id`           | int4 | PK                                                                            |
| `team_id`      | int4 | FK -> `teams.id`                                                              |
| `discord_id`   | text | Discord user snowflake -- used for auth and notifications                     |
| `auth_user_id` | uuid | FK -> `auth.users.id` (Supabase auth)                                         |
| `role`         | text | Team role: officer/member/viewer                                              |
| `name_realm`   | text | The character this member considers their main (see note on redundancy below) |
| `updated_at`   | timestamptz | Auto-set on every UPDATE via trigger                                   |

---

## `teams`

Top-level tenant. One row per raid team.

| Column | Type | Purpose                            |
| ------ | ---- | ---------------------------------- |
| `id`   | int4 | PK                                 |
| `name` | text | Display name of the team           |
| `slug` | text | URL-safe identifier used in routes |

---

## `team_settings`

Key-value config blob per team. One row per team.

| Column    | Type  | Purpose                                                                    |
| --------- | ----- | -------------------------------------------------------------------------- |
| `team_id` | int4  | PK + FK -> `teams.id`                                                      |
| `config`  | jsonb | Freeform settings (loot rules, scoring weights, display preferences, etc.) |
| `updated_at` | timestamptz | Auto-set on every UPDATE via trigger                            |

---

## `audit_log`

Immutable event log of officer actions for accountability.

| Column        | Type        | Purpose                                                     |
| ------------- | ----------- | ----------------------------------------------------------- |
| `id`          | int4        | PK                                                          |
| `team_id`     | int4        | FK -> `teams.id`                                            |
| `actor_id`    | uuid        | FK -> `auth.users.id` -- who performed the action           |
| `action`      | text        | Action type string (e.g. "loot_awarded", "player_promoted") |
| `target_type` | text        | Entity type affected (e.g. "player", "item")                |
| `target_id`   | int4        | PK of the affected entity                                   |
| `detail`      | jsonb       | Before/after values or extra context for the action         |
| `created_at`  | timestamptz | When the action occurred                                    |

---

## `site_admins`

Global super-admins who can manage any team on the site. Separate from team-scoped membership.

| Column         | Type | Purpose                    |
| -------------- | ---- | -------------------------- |
| `id`           | int8 | PK                         |
| `discord_id`   | text | Discord snowflake for auth |
| `auth_user_id` | uuid | FK -> `auth.users.id`      |

---

## `scoring`

Cached computed scores per player per season. Denormalized for fast UI rendering -- all values are derivable from `attendance` and `rclc_loot`. Unique on `(player_id, season)` so history is preserved across seasons.

| Column              | Type    | Purpose                                                           |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `id`                | int4    | PK                                                                |
| `player_id`         | int4    | FK -> `players.id`                                                |
| `season`            | text    | Season this score applies to (e.g. "MN1")                         |
| `recent_score`      | numeric | Score based on recent raid performance (recency-weighted)         |
| `trend_score`       | numeric | Score trajectory -- whether performance is improving or declining |
| `best_score`        | numeric | All-time or current-tier peak score                               |
| `performance_score` | numeric | Parse/performance component of overall score                      |
| `attendance_score`  | numeric | Attendance component of overall score                             |
| `attendance_pct`    | numeric     | Raw attendance percentage (separate from the weighted score)      |
| `updated_at`        | timestamptz | Auto-set on every UPDATE via trigger                              |

---

## `player_wcl_season_perf`

WCL character page performance averages per player per season. Written once at the start of a new season by officers triggering a fetch for all current roster players. Never mutated after the initial write. Used as the baseline for heroic priority generation.

| Column            | Type        | Purpose                                                              |
| ----------------- | ----------- | -------------------------------------------------------------------- |
| `id`              | int4        | PK                                                                   |
| `player_id`       | int4        | FK -> `players.id`                                                   |
| `team_id`         | int4        | FK -> `teams.id` (denormalized for RLS)                              |
| `season`          | text        | Season the data was pulled for (e.g. "MN1")                          |
| `best_perf_avg`   | numeric     | WCL character page best performance average                          |
| `median_perf_avg` | numeric     | WCL character page median performance average                        |
| `fetched_at`      | timestamptz | When the data was pulled from WCL                                    |

Unique on `(player_id, season)`.

---

## `classes_specs`

Lookup table of every valid WoW class/spec combination.

| Column  | Type | Purpose                                                   |
| ------- | ---- | --------------------------------------------------------- |
| `id`    | int4 | PK                                                        |
| `class` | text | Class name (e.g. "Paladin")                               |
| `spec`  | text | Spec name (e.g. "Holy")                                   |
| `role`  | text | Tank/Heal/Melee/Ranged -- drives buff coverage and comp analysis |

---

## `self_received_requests`

Player-submitted claims that they received a drop (self-reported loot tracking, pending officer approval). Inserts arrive only through `submit_self_received()`/`direct_mark_received()`, and single-row deletes only through `delete_self_received_request()` (#756) -- the table has no INSERT or DELETE policy for any role.

| Column         | Type        | Purpose                                              |
| -------------- | ----------- | ---------------------------------------------------- |
| `id`           | int4        | PK                                                   |
| `team_id`      | int4        | FK -> `teams.id` (denormalized)                      |
| `player_id`    | int4        | FK -> `players.id`                                   |
| `self_item_id` | int4        | FK -> `items.id` -- item they claim to have received |
| `submitted_at` | timestamptz | When they submitted the claim                        |
| `status`       | text        | CHECK values pending/approved/rejected               |
| `track`        | text        | Item track, CHECK values Champion/Hero/Myth -- split from the sheet's Source cell prefix (#322, renamed per #343) |
| `source`       | text        | Where the item came from (Bonus Roll, Great Vault, Crafted, ...) -- the other half of the Source split |
| `note`         | text        | Player note from the request form                    |
| `slot`         | text        | Raw `bis_items.slot` the approval sync targets (#386); null on rows predating it |

---

## `bis_requests`

Player requests to be added to the BiS list for a specific item (officer-approval workflow).

| Column            | Type        | Purpose                                                  |
| ----------------- | ----------- | -------------------------------------------------------- |
| `id`              | int4        | PK                                                       |
| `team_id`         | int4        | FK -> `teams.id` (denormalized)                          |
| `player_id`       | int4        | FK -> `players.id`                                       |
| `bis_req_item_id` | int4        | FK -> `bis_items.id` -- the BiS list link change request |
| `submitted_at`    | timestamptz | When the request was made                                |
| `status`          | text        | Pending/approved/denied                                  |

---

## `mplus_exclusion_requests`

Season-long M+ exemption request queue. Players submit a request when they have no more meaningful gear upgrades available from M+. The durable exemption state lives on `players.m_plus_excluded`; this table is the intake workflow. No season column -- the table is wiped between seasons (by design, not a bug).

| Column          | Type        | Purpose                                                |
| --------------- | ----------- | ------------------------------------------------------ |
| `id`            | int4        | PK                                                     |
| `team_id`       | int4        | FK -> `teams.id` (denormalized)                        |
| `player_id`     | int4        | FK -> `players.id`                                     |
| `reason`        | text        | Player-provided reason                                 |
| `submitted_at`  | timestamptz | When it was submitted                                  |
| `status`        | text        | pending/approved/denied                                |
| `raiderio_url`  | text        | Raider.IO profile link for officer to verify key count |
| `officer_notes` | text        | Internal officer note on the decision                  |
| `updated_at`    | timestamptz | Auto-set on every UPDATE via trigger                   |

---

## `boe_items`

One row per found Bind-on-Equip, carrying the lifecycle (found -> listed -> sold -> paid, plus retired) and the money receipt once sold. Grant-only writes through the BoE RPCs; no direct INSERT ([#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745)).

| Column           | Type        | Purpose                                                                 |
| ---------------- | ----------- | ----------------------------------------------------------------------- |
| `id`             | int4        | PK                                                                      |
| `team_id`        | int4        | FK -> `teams.id`                                                        |
| `player_id`      | int4        | FK -> `players.id`, null when the finder is not resolved                |
| `finder_name`    | text        | Raw name-realm as submitted; kept even when `player_id` resolves        |
| `item_id`        | int4        | FK -> `items.id`, opportunistic exact-name match (BoEs are mostly absent from the loot catalog) |
| `item_name`      | text        | The identity, since `item_id` is usually null                          |
| `track`          | text        | CHECK Champion/Hero/Myth, or null                                       |
| `upgrade_rank`   | text        | The tooltip's "2/6", CHECK N/N shape; with the track it is the identity of the item in the payout queue (#865). Null on rows imported from the sheets |
| `season`         | text        | `team_settings.config->>'seasonName'` snapshot at submit                |
| `note`           | text        | Free-text note                                                          |
| `status`         | text        | CHECK found/listed/sold/paid/retired                                    |
| `found_at`       | timestamptz | When the find was submitted                                             |
| `sold_at`        | timestamptz | Set on sale                                                            |
| `payout_paid_at` | timestamptz | Set when the finder is paid                                            |
| `retired_at`     | timestamptz | Set on retire                                                          |
| `sale_price`     | int8        | Gross sale in gold, present iff sold/paid                              |
| `finder_payout`  | int8        | The finder's cut, present iff sold/paid; never more than the sale net of the fee (#861) |
| `guild_cut`      | int8        | `sale_price - ah_fee - finder_payout`, what the bank receives, present iff sold/paid (#861) |
| `ah_fee`         | int8        | The game's fixed 5% auction house fee on the sale, whole gold, present iff sold/paid; `finder_payout + guild_cut + ah_fee = sale_price` by constraint (#861) |
| `payout_floor`   | int8        | Snapshot of the payout floor in force at sale                         |
| `payout_pivot`   | int8        | Snapshot of the payout pivot in force at sale                         |
| `payout_donated` | bool        | The finder's cut was, or is to be, kept by the guild (#862): the raider's intent at submit, the manager's decision at settle |
| `updated_at`     | timestamptz | Auto-set on every UPDATE via trigger                                  |
| `created_at`     | timestamptz | Row creation                                                          |

---

## `boe_listings`

One row per AH listing event, so relists keep their history instead of collapsing into a lifecycle column ([#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745)).

| Column        | Type        | Purpose                                    |
| ------------- | ----------- | ------------------------------------------ |
| `id`          | int4        | PK                                         |
| `team_id`     | int4        | FK -> `teams.id`, must match the item team |
| `boe_item_id` | int4        | FK -> `boe_items.id` (cascade)             |
| `listed_at`   | timestamptz | When it was listed                         |
| `price`       | int8        | Listing price in gold                      |
| `note`        | text        | Free-text note                             |
| `updated_at`  | timestamptz | Auto-set on every UPDATE via trigger       |
| `created_at`  | timestamptz | Row creation                               |

---

## `boe_managers`

The standalone grant that gates BoE money mutations, same shape as `guild_officers` and `site_admins` ([#745](https://github.com/katogaming88/WGA-Raid-Hub/issues/745), reshaped guild-wide in [#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766)). No team column on purpose: BoEs are guild property, so a grantee is authorized on every team's finds.

| Column         | Type        | Purpose                                                    |
| -------------- | ----------- | ---------------------------------------------------------- |
| `id`           | int4        | PK                                                          |
| `discord_id`   | text        | Discord snowflake, unique. Known at grant time              |
| `auth_user_id` | uuid        | FK -> `auth.users.id`, nullable. What `is_boe_manager()` matches |
| `created_at`   | timestamptz | Row creation                                                |

Two identity columns for the same reason `site_admins` and `guild_officers` have them: a site admin can grant to someone who has not signed in yet. `auth_user_id` resolves at grant time when that Discord account already exists in `auth.users`, and `link_auth_user_to_member()` fills it on their first login otherwise. A null `auth_user_id` means the grant is not active yet, and `admin_list_boe_managers()` returns the column so the admin UI can say so.

---

## Triggers

Two shared trigger functions handle cross-cutting DB invariants.

### `set_updated_at()`

A `BEFORE UPDATE` trigger on each mutable table. Sets `updated_at = now()` automatically on every write so application code never has to pass it explicitly.

Tables: `players`, `season_signups`, `bis_items`, `scoring`, `mplus_exclusion_requests`, `priority_order`, `team_members`, `team_settings`.

`updated_at` is nullable with no default, on purpose (#272): these tables have no separate created-at column, so the value stays NULL until the first real UPDATE. A row with a NULL `updated_at` is a fresh insert; a non-NULL one has actually been edited. Populating it at insert time would erase that distinction.

### `check_team_id_matches_player()`

A `BEFORE INSERT OR UPDATE` trigger on every table that carries a denormalized `team_id` alongside a `player_id` FK. Raises an exception if the two disagree -- i.e. if the row's `team_id` does not match `players.team_id` for the given `player_id`. Skips the check when `player_id` is null (allowed on `rclc_loot` after a player is deleted).

Tables: `attendance`, `rclc_loot`, `bis_requests`, `self_received_requests`, `mplus_exclusion_requests`, `priority_order`.

Note: `bis_items` is excluded -- it has no denormalized `team_id` and derives team through `player_id` by design.

---

## Redundancies & Design Notes

### 1. `rclc_loot.boss` vs `item_bosses.boss`

Both store a boss name as free text but serve different purposes. `item_bosses` is a curated static mapping of what boss an item _can_ drop from. `rclc_loot.boss` is the boss recorded _at the moment loot was awarded_ from the addon export -- it is event-level historical data. The loot row captures what actually happened; the item mapping captures current design knowledge. If `item_bosses` were always complete and accurate, `rclc_loot.boss` could theoretically be derived, but it's kept on the loot row for import fidelity.

### 2. `rclc_id` vs `dedupe_key` in `rclc_loot`

Both exist for deduplication on re-import but handle different failure modes. `rclc_id` is the addon's own ID -- reliable when present. `dedupe_key` is a composite hash (player + item + date) we control, acting as a fallback when `rclc_id` is absent or potentially unreliable. Having both makes re-imports robust against either field being malformed.

### 3. `team_id` denormalized across many tables

`attendance`, `rclc_loot`, `self_received_requests`, `bis_requests`, `mplus_exclusion_requests`, `season_signups`, and `priority_order` all carry `team_id` even though `player_id` already implies a team via `players.team_id`. This is intentional denormalization for two reasons: (1) it avoids joining through `players` on every query, and (2) it allows Supabase Row-Level Security policies to filter by team directly on these tables. The tradeoff is that `team_id` could drift out of sync with `players.team_id` if a player is transferred between teams. The `check_team_id_matches_player()` trigger guards against this on write.

### 4. `players.name_realm` vs `team_members.name_realm`

These look like the same field but represent different layers. `players.name_realm` is the roster character (the actual raider). `team_members.name_realm` is the character a Discord account has linked to themselves for identity purposes. A team member's linked character might not match any roster player (e.g. an officer managing from the bench, or a prospective applicant). They will often be the same string but are conceptually distinct.

### 5. `site_admins` vs `team_members` sharing `discord_id` and `auth_user_id`

These fields appear in both tables but are not redundant -- they serve different scopes. `team_members` is team-scoped membership; `site_admins` is a global super-admin check that must work without joining through any team. Keeping them in a separate table also prevents a site admin from implicitly appearing as a member of every team.

### 6. `self_received_requests` vs `bis_requests` -- similar structure, different workflows

These two tables are structurally nearly identical (team_id, player_id, item FK, submitted_at, status) but model two distinct officer workflows:

- `self_received_requests`: "I received a drop -- please mark it obtained on my BiS list." The item FK points to `items`.
- `bis_requests`: "Please change the link for my bis list & update my bis items." The item FK points to `bis_items` (a BiS list entry, not just an item).

They are similar enough that they could be merged with a `type` discriminator, but keeping them separate gives each its own RLS, officer queue, and history without conditional logic.

### 7. `scoring` -- fully derived/cached data

Every column in `scoring` can be computed from `attendance` and `rclc_loot` using the scoring formula. The table exists purely as a write-through cache so leaderboard and roster pages avoid expensive aggregations on every load. The main risk is staleness: if attendance or loot records change without re-running the scoring job, these numbers will drift out of sync with reality.
