// fetch-item-stats.js
// Fetches each item's secondary stat types (Crit/Haste/Mastery/Vers) and main
// stat type(s) (Strength/Agility/Intellect) from Blizzard's Game Data API and
// writes a ready-to-paste UPDATE SQL file. Requires Node 18+ (uses native
// fetch). No external dependencies.
//
// --- Setup ---
// Requires BLIZZARD_CLIENT_ID/BLIZZARD_CLIENT_SECRET in .env (see #559 --
// register a client at develop.battle.net, client_credentials flow only).
//
// --- How to run ---
// 1. In the Supabase SQL Editor, run:
//      select wow_item_id from items where wow_item_id is not null
//    and export the result as item_ids.csv (single `wow_item_id` column).
// 2. node scripts/fetch-item-stats.js
// 3. Paste the generated item_stats_update.sql into the Supabase SQL Editor.
//
// --- Output ---
// item_stats_update.sql -- one `update items set secondary_stats = ...,
// main_stats = ...` statement per item that returned data (Blizzard or the
// Wowhead fallback below). Both columns are `[]` (not null) when the item is
// confirmed to roll none of the tracked types -- null stays reserved for
// items this script hasn't successfully fetched from either source yet.
// main_stats can hold more than one value: this expansion's itemization lets
// a single item scale with several main stats at once (e.g. a Mail shoulder
// piece both a Hunter and an Elemental Shaman can use), so it's an array like
// secondary_stats, not a single value.
//
// Items that 404 against Blizzard (not yet in its static item database --
// happens for an entire still-PTR tier, since Blizzard's static-us
// namespace lags PTR the same way Wowhead's *default* tooltip data env
// does) fall back to Wowhead's tooltip API with dataEnv=2 (its PTR/beta
// data environment -- dataEnv=1, what fetch-items.js's icon lookup uses,
// only has live-realm data). Confirmed live: dataEnv=2 returns full stats
// for a current-tier PTR item that dataEnv=1 returns empty for -- found by
// inspecting Viserio's (wowutils.com) own network requests, which use this
// same param. Whatever still 404s/empties out against both is printed
// separately and left untouched -- true here only for a wrong/retired
// wow_item_id, not an expected PTR gap anymore.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SECONDARY_STAT_TYPES = new Set(['CRIT_RATING', 'HASTE_RATING', 'MASTERY_RATING', 'VERSATILITY']);
const MAIN_STAT_TYPES = new Set(['STRENGTH', 'AGILITY', 'INTELLECT']);

// Wowhead's tooltip HTML uses the plain display name, not the Blizzard enum.
const WOWHEAD_STAT_TEXT = {
  'Critical Strike': 'CRIT_RATING',
  Haste: 'HASTE_RATING',
  Mastery: 'MASTERY_RATING',
  Versatility: 'VERSATILITY'
};

// Main stats aren't plain text in Wowhead's tooltip HTML the way secondary
// stats are -- they're marked with a numeric comment code, and this
// expansion's hybrid-stat items (one item usable by several main stats) get
// their own combo codes rather than repeating the single-stat ones. Verified
// directly against raw tooltips for The Coiled Altar's items this session;
// stat3/stat4 (Agility-only/Strength-only) follow the same numbering but
// weren't directly observed in that batch -- double check against a known
// single-main-stat weapon (e.g. a Rogue dagger or Warrior sword) if this ever
// looks wrong.
const WOWHEAD_STAT_ID_TO_MAIN_STATS = {
  3: ['AGILITY'],
  4: ['STRENGTH'],
  5: ['INTELLECT'],
  71: ['AGILITY', 'STRENGTH', 'INTELLECT'],
  72: ['AGILITY', 'STRENGTH'],
  73: ['AGILITY', 'INTELLECT'],
  74: ['STRENGTH', 'INTELLECT']
};

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function getAccessToken(clientId, clientSecret) {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`Token request HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// Words for STRENGTH/AGILITY/INTELLECT as they appear in Blizzard's own
// Equip:/Use: prose (e.g. "increasing your Strength or Agility by 521").
// Used only as a fallback when an item has no raw main-stat entry/marker --
// many raid trinkets (procs, on-use effects) carry their intended stat
// restriction in the effect text rather than an actual stat budget on the
// item, since the trinket's Stamina/secondary-stat entry is all it has on
// the tooltip otherwise. Confirmed live against several current-tier
// trinkets this session: Blizzard consistently names the exact restricted
// stat(s) in the effect description when a proc is stat-locked (e.g. Idol of
// the Howling Nexus: "increasing your Strength or Agility by 521"), and uses
// generic "primary stat" phrasing or lists all three when a trinket is meant
// to be universal -- so this only ever narrows main_stats when the text is
// actually specific, never on a generic/universal proc.
const MAIN_STAT_WORDS = { Strength: 'STRENGTH', Agility: 'AGILITY', Intellect: 'INTELLECT' };

function extractMainStatsFromEffectText(text) {
  const found = [];
  for (const [word, type] of Object.entries(MAIN_STAT_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text) && !found.includes(type)) found.push(type);
  }
  return found;
}

// Blizzard's item_subclass.name and Wowhead's tooltip subtype text don't
// always agree on wording for the same subclass -- confirmed live: Blizzard
// returns "Warglaives" (plural) for Demon Hunter's weapon type, Wowhead's
// tooltip renders "Warglaive" (singular) for the same subclass id on a
// still-PTR item Blizzard hasn't indexed yet. js/common.js's
// CLASS_WEAPON_TYPES only lists one spelling per type, so an unnormalized
// mismatch here would silently exclude that weapon from the very class it's
// meant for. Normalize known mismatches to the singular form
// CLASS_WEAPON_TYPES uses; add another entry here if a future tier surfaces
// a new one (the console log below always prints the raw captured value, so
// a new mismatch is visible immediately rather than silently wrong).
const WEAPON_SUBTYPE_ALIASES = { Warglaives: 'Warglaive' };

function normalizeWeaponSubtype(name) {
  if (!name) return name;
  return WEAPON_SUBTYPE_ALIASES[name] || name;
}

// Only Weapon (item_class id 2) and Shield (Armor/id 4, subclass id 6) rows
// get a weapon_subtype -- everything else's item_subclass name is an armor
// slot/material name, not a weapon type, and js/common.js's
// CLASS_WEAPON_TYPES/CLASS_SHIELD_USERS filter only ever checks Weapon/Off
// Hand rows anyway (#609).
function weaponSubtypeFromItemClass(itemClass, itemSubclass) {
  if (!itemClass || !itemSubclass) return null;
  if (itemClass.id === 2) return normalizeWeaponSubtype(itemSubclass.name);
  if (itemClass.id === 4 && itemSubclass.id === 6) return normalizeWeaponSubtype(itemSubclass.name);
  return null;
}

async function fetchBlizzardStats(wowItemId, token) {
  const res = await fetch(`https://us.api.blizzard.com/data/wow/item/${wowItemId}?namespace=static-us&locale=en_US`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const types = (data.preview_item?.stats ?? []).map((s) => s.type?.type);
  const stats = types.filter((type) => SECONDARY_STAT_TYPES.has(type));
  let mainStats = types.filter((type) => MAIN_STAT_TYPES.has(type));
  if (!mainStats.length) {
    const effectText = (data.preview_item?.spells ?? []).map((s) => s.description || '').join(' ');
    mainStats = extractMainStatsFromEffectText(effectText);
  }
  const weaponSubtype = weaponSubtypeFromItemClass(data.preview_item?.item_class, data.preview_item?.item_subclass);
  return { stats, mainStats, weaponSubtype };
}

// Fallback for items still 404ing against Blizzard (current-tier PTR items).
// dataEnv=2 is Wowhead's PTR/beta data environment -- confirmed live this
// returns full stats where dataEnv=1 (fetch-items.js's icon lookup) is empty.
async function fetchWowheadStats(wowItemId) {
  const res = await fetch(`https://nether.wowhead.com/tooltip/item/${wowItemId}?dataEnv=2&locale=0`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
  });
  // Unknown ids come back as a 404 with a JSON {error} body, not a bare HTTP error.
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) return { notFound: true };

  // Secondary/primary stats sit between the armor line and the trailing
  // name/desc extras marker -- restrict the text search to that window so a
  // stat name can't accidentally match inside a proc effect description.
  const statBlock = data.tooltip?.match(/<!--rf-->([\s\S]*?)<!--nameDescStats-->/)?.[1] ?? '';
  const stats = Object.entries(WOWHEAD_STAT_TEXT)
    .filter(([text]) => statBlock.includes(text))
    .map(([, type]) => type);

  let mainStats = [];
  for (const m of statBlock.matchAll(/<!--stat(\d+)-->/g)) {
    const types = WOWHEAD_STAT_ID_TO_MAIN_STATS[Number(m[1])];
    if (types) for (const t of types) if (!mainStats.includes(t)) mainStats.push(t);
  }
  if (!mainStats.length) {
    const effectText = data.tooltip?.split('<!--nameDescStats-->')[1] ?? '';
    mainStats = extractMainStatsFromEffectText(effectText.replace(/<[^>]+>/g, ' '));
  }

  // The weapon-type/shield line renders as e.g. <!--scstart2:7-->Sword<!--scend-->
  // (2 = Weapon item class, 7 = subclass id) -- appears before <!--rf-->, so
  // it's read off the full tooltip, not the stat-only statBlock window above.
  // Same class-id gate as weaponSubtypeFromItemClass: only Weapon (2) or
  // Shield (4/6) counts.
  const scMatch = data.tooltip?.match(/<!--scstart(\d+):(\d+)-->\s*<span[^>]*>([^<]+)<\/span>/);
  const weaponSubtype =
    scMatch && (scMatch[1] === '2' || (scMatch[1] === '4' && scMatch[2] === '6'))
      ? normalizeWeaponSubtype(scMatch[3])
      : null;

  return { stats, mainStats, weaponSubtype };
}

function parseItemIds(csv) {
  const lines = csv.trim().split('\n');
  if (lines[0].trim() !== 'wow_item_id') {
    console.error(`Unexpected item_ids.csv header: ${lines[0]}`);
    process.exit(1);
  }
  return lines
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  loadEnv();
  const { BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET } = process.env;
  if (!BLIZZARD_CLIENT_ID || !BLIZZARD_CLIENT_SECRET) {
    console.error('BLIZZARD_CLIENT_ID/BLIZZARD_CLIENT_SECRET must be set in .env (see #559).');
    process.exit(1);
  }

  if (!existsSync('item_ids.csv')) {
    console.error(
      'item_ids.csv not found -- export `select wow_item_id from items` from the Supabase SQL Editor first.'
    );
    process.exit(1);
  }

  console.log('Requesting OAuth token...');
  const token = await getAccessToken(BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET);

  const ids = parseItemIds(readFileSync('item_ids.csv', 'utf8'));
  console.log(`Fetching stats for ${ids.length} items...\n`);

  const updates = [];
  const notFound = [];

  for (const id of ids) {
    try {
      const result = await fetchBlizzardStats(id, token);
      if (!result.notFound) {
        updates.push({ id, stats: result.stats, mainStats: result.mainStats, weaponSubtype: result.weaponSubtype });
        console.log(
          `[OK]   ${id}: secondary=${result.stats.length ? result.stats.join(', ') : '(none)'} main=${result.mainStats.length ? result.mainStats.join(', ') : '(none)'} weapon=${result.weaponSubtype ?? '(n/a)'}`
        );
        await sleep(100);
        continue;
      }

      const fallback = await fetchWowheadStats(id);
      if (fallback.notFound) {
        notFound.push(id);
        console.log(`[404]  ${id}: not found on Blizzard or Wowhead`);
      } else {
        updates.push({
          id,
          stats: fallback.stats,
          mainStats: fallback.mainStats,
          weaponSubtype: fallback.weaponSubtype
        });
        console.log(
          `[OK]   ${id}: secondary=${fallback.stats.length ? fallback.stats.join(', ') : '(none)'} main=${fallback.mainStats.length ? fallback.mainStats.join(', ') : '(none)'} weapon=${fallback.weaponSubtype ?? '(n/a)'} (via Wowhead fallback)`
        );
      }
    } catch (err) {
      console.error(`[FAIL] ${id}: ${err.message}`);
    }
    await sleep(100);
  }

  const sql = updates
    .map((u) => {
      const weaponSubtypeSql = u.weaponSubtype ? `'${u.weaponSubtype.replace(/'/g, "''")}'` : 'NULL';
      return `update items set secondary_stats = '${JSON.stringify(u.stats)}'::jsonb, main_stats = '${JSON.stringify(u.mainStats)}'::jsonb, weapon_subtype = ${weaponSubtypeSql} where wow_item_id = ${u.id};`;
    })
    .join('\n');
  writeFileSync('item_stats_update.sql', sql + '\n', 'utf8');

  console.log(`\nDone.`);
  console.log(`  item_stats_update.sql -- ${updates.length} rows`);
  if (notFound.length) {
    console.log(`  ${notFound.length} items not found on either source: ${notFound.join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
