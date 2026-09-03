// fetch-items.js
// Fetches item data from Wowhead and outputs CSVs for Supabase import.
// Requires Node 18+ (uses native fetch). No external dependencies.
//
// Outputs:
//   items.csv         -- ready to import into the `items` table
//   item_bosses.csv   -- raw boss mappings (uses wow_item_id; swap for DB id after import)
//
// Usage: node scripts/fetch-items.js

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// UPDATE THESE EACH TIER
// Slot keywords and armor type suffixes are specific to each raid tier.
// The suffix pattern (cast/cured/forged/woven) is consistent across tiers.
// The slot keywords and prefix change each tier -- update them here.
//
// Current tier: The Tidebound Grotto (12.1) -- single-boss raid, like Sporefall.
// No tier-token names confirmed yet; leave the previous tier's keywords in
// place as a harmless default -- if this raid's loot has no tier tokens (as
// expected for a single-boss instance), none of these will match and the
// script's [WARN]/[SKIP] output on a run will confirm it either way.
const TOKEN_SLOT_KEYWORDS = {
  effigy: 'Head',
  icon: 'Chest',
  idol: 'Hands',
  relic: 'Legs',
  remnant: 'Shoulder'
};

// Wowhead zone id for the current raid, and whether it's still PTR-only
// (unreleased raids live under /ptr/zone=... until the patch ships).
// Find it from the raid's Wowhead URL, e.g. wowhead.com/ptr/zone=16671/the-tidebound-grotto.
const ZONE_ID = 16671;
const ZONE_IS_PTR = true;

// Warcraft Logs zone id for the same raid (#535) -- NOT the same number as
// ZONE_ID above. WCL uses its own small sequential zone numbering (Voidspire
// is WCL zone 46, Sporefall is 50) completely unrelated to Wowhead's zone ids.
// This must match whatever `raid_zones.wcl_zone_id` this tier gets tagged
// with in Season Settings, since that's what the season filter (#535)
// compares items.wcl_zone_id against. Confirm the live vs PTR id directly on
// warcraftlogs.com -- WCL assigns a *different* zone id for a raid's PTR
// period than its live release (Sporefall was 50 live / 51 PTR), so whatever
// gets tagged here during PTR needs a full re-fetch/re-tag once the tier
// ships live, not just a flag flip.
const WCL_ZONE_ID = 57;
// ---------------------------------------------------------------------------

// Types to skip entirely. Junk is NOT here -- tier tokens have type Junk on Wowhead,
// so Junk items are fetched and kept only if they have a raid boss source.
const SKIP_TYPES = new Set(['Decor', 'Reagent', 'Cosmetic']);

// Wowhead's item classId/subclassId (embedded in the zone loot Listview) map
// onto the same coarse categories the rest of this script keys off of.
// classId 20 = Miscellaneous decor/cosmetic junk (always skip).
// classId 15 = Miscellaneous "junk" -- subclass 1 is plain reagents (skip),
//   everything else (tier-token idols, relic-shaped trinkets, etc.) is kept
//   as 'Junk' so the existing token/boss-source logic below decides.
// classId 4 = Armor -- subclass 1-4 are the real armor materials; other
//   armor subclasses are accessories (rings, amulets, cloaks, shields, ...)
//   that don't need an armor_type, and get their slot from the numeric
//   inventory-slot code below rather than needing a further breakdown here.
// classId 2 = Weapons -- same story, slot comes from the numeric code.
const ARMOR_SUBCLASS_NAME = { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate' };

function classifyWowheadType(item) {
  if (item.classs === 20) return 'Decor';
  if (item.classs === 15) return item.subclass === 1 ? 'Reagent' : 'Junk';
  if (item.classs === 4) {
    const armor = ARMOR_SUBCLASS_NAME[item.subclass];
    return armor ? `${armor} Armor` : 'Accessory';
  }
  if (item.classs === 2) return 'Weapon';
  console.log(
    `[WARN] item ${item.id} (${item.name}) has unrecognized classs ${item.classs}/${item.subclass}, treating as Decor`
  );
  return 'Decor';
}

// Blizzard's InventoryType enum, as embedded in the zone loot Listview's
// numeric `slot` field. Text matches the vocabulary Wowhead's own item XML
// uses, since that's what's already stored in items.slot/bis_items.slot.
// 0 means "no equip slot" -- tier tokens and class-set trade tokens -- which
// resolves to null so the caller falls back to parseTokenFromName().
const INVTYPE_SLOT_NAME = {
  1: 'Head',
  2: 'Neck',
  3: 'Shoulder',
  5: 'Chest',
  6: 'Waist',
  7: 'Legs',
  8: 'Feet',
  9: 'Wrist',
  10: 'Hands',
  11: 'Finger',
  12: 'Trinket',
  13: 'One-Hand',
  14: 'Off Hand',
  15: 'Ranged',
  16: 'Back',
  17: 'Two-Hand',
  20: 'Chest',
  21: 'One-Hand',
  22: 'Off Hand',
  23: 'Held In Off-hand',
  26: 'Ranged'
};

function getSlotFromInvType(slotCode) {
  return INVTYPE_SLOT_NAME[slotCode] ?? null;
}

// Wowhead embeds the raid's full loot table -- including name, equip slot,
// and boss source -- as a Listview data array on the zone page (id: 'drops'),
// so all of that can be read straight off one page fetch instead of hitting
// Wowhead again per item.
async function fetchZoneItems(zoneId, isPtr) {
  const url = `https://www.wowhead.com/${isPtr ? 'ptr/' : ''}zone=${zoneId}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
  });
  if (!res.ok) throw new Error(`Zone page HTTP ${res.status}`);
  const html = await res.text();

  const dropsIdx = html.indexOf("id: 'drops'");
  if (dropsIdx === -1) throw new Error("Could not find 'drops' Listview on zone page");
  const dataIdx = html.indexOf('data:', dropsIdx);
  const arrStart = html.indexOf('[', dataIdx);
  if (dataIdx === -1 || arrStart === -1) throw new Error("Could not find drops 'data:' array");

  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) {
        arrEnd = i;
        break;
      }
    }
  }
  if (arrEnd === -1) throw new Error('Could not find end of drops data array');

  return JSON.parse(html.slice(arrStart, arrEnd + 1));
}

// The zone page's loot table doesn't carry the icon slug, so that's the one
// thing still fetched per item -- from Wowhead's lightweight tooltip JSON
// endpoint (what their own tooltip widget uses), not the full item page.
export async function fetchIcon(id) {
  const res = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
  });
  if (!res.ok) throw new Error(`Tooltip HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.icon ?? null;
}

// Tier token name parsing -- slot from keyword, armor type from suffix
const TOKEN_ARMOR_SUFFIXES = {
  cast: 'Mail',
  cured: 'Leather',
  forged: 'Plate',
  woven: 'Cloth'
};

function parseTokenFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  let slot = null;
  for (const [keyword, s] of Object.entries(TOKEN_SLOT_KEYWORDS)) {
    if (lower.includes(keyword)) {
      slot = s;
      break;
    }
  }
  let armor_type = null;
  for (const [suffix, a] of Object.entries(TOKEN_ARMOR_SUFFIXES)) {
    if (lower.includes(suffix)) {
      armor_type = a;
      break;
    }
  }
  return slot && armor_type ? { slot, armor_type } : null;
}

function getArmorType(wowheadType) {
  return wowheadType.endsWith(' Armor') ? wowheadType.slice(0, -6) : null;
}

function csvEscape(val) {
  if (val == null || val === '') return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Fetching loot table for zone ${ZONE_ID}...`);
  const zoneItems = await fetchZoneItems(ZONE_ID, ZONE_IS_PTR);
  console.log(`Found ${zoneItems.length} items on the zone page.\n`);

  const filtered = zoneItems.filter((item) => !SKIP_TYPES.has(classifyWowheadType(item)));
  console.log(`Processing ${filtered.length} items (skipped ${zoneItems.length - filtered.length} Decor/Reagent)...\n`);

  const itemRows = [];
  const bossRows = [];

  for (const item of filtered) {
    const { id, name } = item;
    const wowheadType = classifyWowheadType(item);
    const slot = getSlotFromInvType(item.slot);
    const armor_type = getArmorType(wowheadType);
    const boss = item.sourcemore?.[0]?.n ?? null;

    let icon = null;
    try {
      icon = await fetchIcon(id);
    } catch (err) {
      console.error(`[FAIL] ${id}: icon lookup failed (${err.message})`);
    }

    if (wowheadType === 'Junk') {
      const token = parseTokenFromName(name);
      if (token) {
        itemRows.push({
          wow_item_id: id,
          name,
          slot: token.slot,
          armor_type: token.armor_type,
          icon,
          wcl_zone_id: WCL_ZONE_ID
        });
        if (boss) bossRows.push({ wow_item_id: id, boss });
        console.log(
          `[OK]   ${id}: ${name} | slot: ${token.slot} | armor: ${token.armor_type} | boss: ${boss ?? '(not found)'}`
        );
      } else if (boss) {
        itemRows.push({ wow_item_id: id, name, slot: slot ?? '', armor_type, icon, wcl_zone_id: WCL_ZONE_ID });
        bossRows.push({ wow_item_id: id, boss });
        console.log(`[OK]   ${id}: ${name} | slot: ${slot ?? '??'} | boss: ${boss}`);
      } else {
        console.log(`[SKIP] ${id}: ${name} | Junk with no parseable token name or boss source, skipping`);
      }
    } else {
      itemRows.push({ wow_item_id: id, name, slot: slot ?? '', armor_type, icon, wcl_zone_id: WCL_ZONE_ID });
      if (boss) bossRows.push({ wow_item_id: id, boss });
      console.log(`[OK]   ${id}: ${name} | slot: ${slot ?? '??'} | boss: ${boss ?? '(not found)'}`);
    }

    await sleep(150);
  }

  const itemsCsv = [
    'wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id',
    ...itemRows.map(
      (r) =>
        `${r.wow_item_id},${csvEscape(r.name)},${csvEscape(r.slot)},${csvEscape(r.armor_type)},,${csvEscape(r.icon)},${r.wcl_zone_id}`
    )
  ].join('\n');
  writeFileSync('items.csv', itemsCsv, 'utf8');

  // item_bosses uses wow_item_id as a placeholder.
  // After importing items.csv, replace wow_item_id with the DB-assigned `id`.
  const bossesCsv = ['wow_item_id,boss', ...bossRows.map((r) => `${r.wow_item_id},${csvEscape(r.boss)}`)].join('\n');
  writeFileSync('item_bosses_raw.csv', bossesCsv, 'utf8');

  console.log(`\nDone.`);
  console.log(`  items.csv          -- ${itemRows.length} rows`);
  console.log(`  item_bosses_raw.csv -- ${bossRows.length} rows`);
  if (itemRows.some((r) => !r.slot)) {
    console.log('\nWARNING: Some items have no slot. Check rows with empty slot in items.csv.');
  }
}

// Run only when executed directly, so tests can import the module without
// kicking off the Wowhead fetches.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
