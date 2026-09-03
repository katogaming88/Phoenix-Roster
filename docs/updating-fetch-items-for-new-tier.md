# Updating `fetch-items.js` for a new tier

`scripts/fetch-items.js` generates `items.csv` and `item_bosses_raw.csv` for seeding the `items` and `item_bosses` Supabase tables at the start of a new raid tier. It pulls the raid's full loot table -- item id, name, equip slot, and boss source -- in one fetch from the Wowhead zone page, then queries Wowhead once per item for just the icon (via Wowhead's lightweight tooltip JSON endpoint, not the full item page). See [issue #132](https://github.com/katogaming88/WGA-Raid-Hub/issues/132) for the full manual SQL workflow and column reference this feeds into.

This is now the **sole** source for the web app's item catalog (name/slot/armor-type/boss) -- the GAS "Item Lookup" sheet was retired as a data source in [#391](https://github.com/katogaming88/WGA-Raid-Hub/issues/391). There's no second catalog to keep in sync each tier; whatever lands in `items`/`item_bosses` via this workflow is what the site shows.

## What to update each tier

### 1. `TOKEN_SLOT_KEYWORDS` (top of the file)

Tier set tokens are typed `Junk` on Wowhead, so the script can't get their slot from the type. Instead it matches a keyword in the item name to a slot. Update the keyword list and the comment above it with the new tier's name and token prefix:

```js
// Current tier: The Venomous Abyss (12.1)
// Token prefix: Venom (e.g. Venomforged Effigy)
const TOKEN_SLOT_KEYWORDS = {
  effigy:  'Head',
  icon:    'Chest',
  idol:    'Hands',
  relic:   'Legs',
  remnant: 'Shoulder',
};
```

Look up the new tier's token names on Wowhead (search the tier's tokens, e.g. "Voidwoven") and map each token noun to its slot.

`TOKEN_ARMOR_SUFFIXES` (cast/cured/forged/woven -> Mail/Leather/Plate/Cloth) has held steady across tiers so far -- only touch it if a new tier breaks that naming pattern.

### 2. `ZONE_ID` / `ZONE_IS_PTR` / `WCL_ZONE_ID`

The script pulls the item ID list and Wowhead type automatically from the raid zone page's embedded loot table (the `drops` Listview), so there's no more hand-pasting a `RAW_DATA` array.

1. Find the new raid's Wowhead zone page, e.g. `wowhead.com/zone=<id>/<zone-slug>` (or `wowhead.com/ptr/zone=<id>/<zone-slug>` while the tier is still on PTR).
2. Set `ZONE_ID` to that numeric id, and `ZONE_IS_PTR` to `true`/`false` depending on whether the raid is live yet.
3. Flip `ZONE_IS_PTR` to `false` once the tier ships and the zone page moves off `/ptr/`.
4. Set `WCL_ZONE_ID` to the raid's **Warcraft Logs** zone id -- a completely different number from `ZONE_ID` (WCL uses its own small sequential numbering, e.g. Voidspire is WCL zone 46, not its Wowhead id). Confirm it directly on warcraftlogs.com, not by reusing `ZONE_ID`. This must match whatever `raid_zones.wcl_zone_id` gets entered for this tier in Season Settings, since that's what the season filter (#535) compares `items.wcl_zone_id` against. WCL assigns a *separate* zone id for a raid's PTR period than its live release, so whatever you tag here during PTR needs a full re-fetch/re-tag once the tier ships live -- not just flipping `ZONE_IS_PTR`.

The script classifies each item's Wowhead type from its `classs`/`subclass` fields on the loot table (see `classifyWowheadType` in the script) -- Decor/Reagent are skipped automatically via `SKIP_TYPES`, and tier tokens are classified as `Junk` so the existing token-keyword/boss-source logic handles them. Slot comes from the loot table's numeric equip-slot code via `INVTYPE_SLOT_NAME`, and boss comes from its `sourcemore` field. You don't need to filter, classify, or look anything up by hand.

### 3. Everything else is stable

`INVTYPE_SLOT_NAME`, `ARMOR_SUBCLASS_NAME`, `SKIP_TYPES`, and the token-armor suffix map are keyed off Wowhead's own numeric item-class codes and general slot names, which don't change tier to tier. Leave them alone unless a new tier introduces an item class/subclass or equip-slot code you haven't seen before (the script will log `slot: ??` for anything it can't resolve, or a `[WARN]` for an unrecognized `classs`/`subclass`, which is your signal to add a mapping).

## Running it

```
node scripts/fetch-items.js
```

Requires Node 18+ (uses native `fetch`). No install step, no dependencies.

## After it runs

- Check the console output for `[FAIL]` and `[SKIP]` lines -- these need manual follow-up. `[FAIL]` now only means the per-item icon lookup failed (the item still gets a row, just with a blank `icon`); `[SKIP]` means a Junk item that didn't match a token keyword and had no boss source.
- Check the end-of-run warning about empty slots in `items.csv` -- fill those in by hand before importing.
- **Treat the `boss` column in `item_bosses_raw.csv` as a rough first pass, not authoritative.** It comes from the zone loot table's own boss attribution, which is generally reliable but has been wrong for a handful of items in the past (multi-boss trinkets, world drops, etc). Use `scripts/item-bosses-sql.js` (paste the zone page's Items-tab table directly, with encounter-name reconciliation via `ENCOUNTER_MAP`) as the more reliable source for the actual `item_bosses` insert -- don't just trust `item_bosses_raw.csv` as-is.

## Reconciling `item-bosses-sql.js` against `items.csv`

`item-bosses-sql.js` works off whatever you paste from the Wowhead Items tab, with none of `fetch-items.js`'s own filtering (`SKIP_TYPES`, slot resolution) applied to it. That paste always includes rows `fetch-items.js` correctly left out of `items.csv` -- so its generated `INSERT` will reference `wow_item_id`s that don't exist in `items` yet, and the `(select id from items where wow_item_id = ...)` subquery for each of those resolves to `NULL`. Since `item_bosses.item_id` is `NOT NULL`, even one such row aborts the *entire* multi-row insert.

Before running it, diff every `wow_item_id` the generated SQL references against `items.csv` (a one-liner: parse both, `Set` of ids, filter). Anything referenced by the SQL but missing from the CSV falls into one of two buckets -- **look each one up on Wowhead to tell which**:

- **Actually not a catalog item** -- housing decor, companions/pets, and similar cosmetics show up in the Items tab paste alongside real gear. Delete that row from the `item_bosses` insert.
- **A real, trackable non-equippable item that `fetch-items.js` missed** -- e.g. a `Curio`-slot class-set trade token (see `tab-bis.js`'s note on `Curio`: not equippable, but still a real priority-tracked catalog item, same category as the existing `Chiming Void Curio (Tier)` Season 1 row). These get missed because Wowhead's `sourcemore` field on the zone loot table was empty for them when `fetch-items.js` scraped it -- same root cause as the "Zone Drop" items below, not an exclusion. Add a row for it to `items.csv` by hand instead of dropping its boss row: `wow_item_id,"name","slot","armor_type",,"icon",WCL_ZONE_ID` (icon via `https://nether.wowhead.com/tooltip/item/<id>?dataEnv=1&locale=0`'s `icon` field, same endpoint `fetchIcon()` uses).

Anything `item-bosses-sql.js` prints under "Manual lookup needed" ("Zone Drop") needs an actual in-game kill to resolve, not a Wowhead item-page lookup -- "Zone Drop" is Wowhead's own placeholder for "boss not attributed yet" (common while a tier's still on PTR and datamining is incomplete), so the item's own page won't have a better answer either. Cross-reference the unresolved `wow_item_id`s against `items.csv` to get each item's real name/slot to make them easy to find in-game (same diff as above gives you this for free).

**Before running either `item_bosses` insert, verify parity**: the row count in `items.csv` should exactly equal the total rows across the "resolved" `item-bosses-sql.js` batch (minus whatever got excluded as non-catalog, plus any manually-added rows like the `Curio` case above) plus the manually-verified batch. Every item should have exactly one boss row, and no boss row should reference an item that isn't in `items.csv` -- if those two sets don't match 1:1, something upstream is still wrong.

## Generating the import SQL

Once `items.csv` is finalized (all `sort_id`s and manual rows filled in), run:

```
node scripts/items-csv-to-sql.js
```

This writes `items_insert.sql` -- a ready-to-paste `insert into items (...)` statement, with `items.csv`'s blank `armor_type`/`sort_id` cells converted to SQL `null` and names/icons properly quote-escaped. Paste that into the Supabase SQL Editor and run it first, since the `item_bosses` inserts' `(select id from items where wow_item_id = ...)` subqueries depend on those rows already existing.

## Importing

`items.csv` columns match the `items` table (`wow_item_id, name, slot, armor_type, sort_id, icon, wcl_zone_id`) -- `sort_id` is left blank and needs manual fill-in per issue #132's guidance. `wcl_zone_id` is filled in automatically from the `WCL_ZONE_ID` constant (#535) -- not `ZONE_ID`, which is Wowhead's own zone numbering -- it scopes the item to this tier so old-season loot stops showing up in the Priority tab, BiS grid, and Wishlist once a newer tier's items are imported. Import via the Supabase SQL Editor, not the CLI (per project convention, DB writes are manual): first `items_insert.sql` (see above), then the `item_bosses` inserts. `item_bosses_raw.csv` uses `wow_item_id` as a placeholder key -- swap it for the DB-assigned `id` after `items.csv` is imported, same as noted in the script's header comment; once `items_insert.sql` has run, `item_bosses_raw.csv` itself can be discarded (it's not tracked in git, and it's fully superseded by `item-bosses-sql.js`'s output plus any manual in-game boss verification).

## BoEs: `fetch-boe-items.js` (#875)

`fetch-items.js` never sees a raid's Bind-on-Equip drops: the zone page's `drops` list it parses is boss loot, and Wowhead has no trash-drop list to scrape. The BoEs are catalog rows all the same (the found form's picker offers them and `submit_boe_found` links a find to one), so they get their own small route:

1. Add the raid's BoE names to a file under `scripts/boe-names/` (one file per raid, e.g. `midnight-s2.txt`): the raid's `raid_zones.wcl_zone_id` on the first data line, then one name per line as Wowhead spells it. A BoE nobody has found yet is added when it appears. `aliases.txt` beside them lists known misspellings in `boe_items` as `wrong => Catalog Name`; it is temporary and goes with the Google Form in #750's close-out, since the picker stops misspellings arriving in bulk and a single one is a manager's Edit.
2. Run `node scripts/fetch-boe-items.js`. Each name goes through Wowhead's search-suggestion endpoint (`/search/suggestions-template?q=<name>&locale=0`), which returns the item id, icon, armor type and slot in one hit; the tooltip endpoint `fetchIcon()` uses confirms the id. A name that does not come back as exactly one item hit is reported and left out, never guessed.
3. It writes `data/sql/boe-catalog.sql` (gitignored, like every generated SQL here): one transaction that inserts the rows into `items` with `is_boe` set (`on conflict ((lower(name))) do nothing`, so a re-run is a no-op and a name that already exists as a boss drop is reported rather than flagged), then links `boe_items` rows to them by name and by alias, keeping an aliased row's submitted spelling in its note. Apply it by hand at a checkpoint:

```
psql service=wga-admin -X -v ON_ERROR_STOP=1 -f data/sql/boe-catalog.sql
```

The rows cannot ride in a migration: `seed.sql` inserts `items` ids 1 to 3 explicitly after migrations run, so sequence-assigned rows there would break every `supabase db reset` on the primary key. `buildItemMaps()` in `js/common.js` keeps flagged rows out of every existing map, which is what keeps BoEs out of the BiS grid, the wishlist and the Priority tab.

## Fetching secondary stats, main stats, and weapon subtype (#560, #609)

Once the new tier's rows exist in `items`, run `scripts/fetch-item-stats.js` to backfill `secondary_stats` (which of Crit/Haste/Mastery/Vers the item rolls, used by the Priority tab), `main_stats` (which of Strength/Agility/Intellect the item scales with, used by the Wishlist/BiS-grid Trinket/Weapon/Off Hand filter), and `weapon_subtype` (e.g. 'Sword'/'Staff'/'Shield', used by the same filter's `CLASS_WEAPON_TYPES`/`CLASS_SHIELD_USERS` class-eligibility check, #609) -- all three come from the same Blizzard/Wowhead calls, no extra fetches needed:

1. In the Supabase SQL Editor, run `select wow_item_id from items where wow_item_id is not null` and export the result as `item_ids.csv`.
2. `node scripts/fetch-item-stats.js` -- requires `BLIZZARD_CLIENT_ID`/`BLIZZARD_CLIENT_SECRET` in `.env` (see #559).
3. Paste the generated `item_stats_update.sql` into the Supabase SQL Editor.

**A new tier's items 404 against Blizzard's API for as long as the tier is still PTR-only** -- Blizzard's static item database lags PTR. The script automatically falls back to Wowhead's tooltip API (`nether.wowhead.com/tooltip/item/<id>?dataEnv=2&locale=0`) for anything Blizzard 404s on -- `dataEnv=2` is Wowhead's PTR/beta data environment, confirmed live to return full stats where `dataEnv=1` (used by `fetch-items.js`'s icon lookup, which only needs the icon slug and doesn't care about live-vs-PTR stat values) comes back empty. Found by inspecting the actual network requests of a similar tool (Viserio, on wowutils.com), which uses this same param. Only an item missing from *both* sources gets logged as not-found and left untouched.

**`main_stats` can hold more than one value** -- this expansion's itemization lets a single item scale with several main stats at once (e.g. a Mail shoulder piece both a Hunter and an Elemental Shaman can use), shown on Wowhead/Blizzard as e.g. "Agility or Intellect". Wowhead marks these with numeric comment codes on the tooltip (`<!--stat73-->` = Agility or Intellect, etc -- see `WOWHEAD_STAT_ID_TO_MAIN_STATS` in the script) rather than plain stat-name text the way secondary stats are marked. Some trinkets (procs/on-use effects) have no raw stat entry at all and only imply their restriction in the Equip:/Use: effect description -- the script falls back to scanning that text for an explicit Strength/Agility/Intellect mention (`extractMainStatsFromEffectText`) when the raw stat list comes back empty, since Blizzard consistently names the exact stat when a proc is genuinely restricted and uses generic/all-three phrasing for universal trinkets.

## `items.is_ptr` (#561 follow-up)

Same PTR gap, client side this time: the Wowhead hover-tooltip widget (`window.whTooltips`, loaded on index.html/officer.html) resolves a bare `wowhead.com/item=<id>` link against live data only, so a still-PTR item's hover tooltip shows empty/wrong stats even once `secondary_stats` has the real data server-side. `itemNameBlockHtml()` (js/common.js) checks `items.is_ptr` and links to `wowhead.com/ptr/item=<id>` instead when true.

While importing a new tier, set it in the same SQL Editor paste as the rest of the import (or a follow-up statement): `update items set is_ptr = true where wcl_zone_id = <this tier's WCL_ZONE_ID>;`. Flip it back to `false` for the same rows once the tier ships live, same time `WCL_ZONE_ID` goes into `raid_zones` below.

Once you're ready to go live with the new tier, add its `WCL_ZONE_ID` to `raid_zones` and to the team's `raidProgression` in **Season Settings** -- that's what flips the season filter (#535) over to showing these items by default instead of requiring "Show all seasons". Also flip `items.is_ptr` back to `false` for this tier's rows (`update items set is_ptr = false where wcl_zone_id = <WCL_ZONE_ID>;`) and re-run `scripts/fetch-item-stats.js` to pick up anything that only resolved via the Wowhead PTR fallback -- Blizzard's static item database should have real data for all of it now.
