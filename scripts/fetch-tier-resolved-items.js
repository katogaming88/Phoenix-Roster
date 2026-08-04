// One-off companion to fetch-items.js: seeds the 65 class-specific tier-set
// pieces (Head/Shoulder/Chest/Hands/Legs x 13 classes) for Midnight Season 2
// (patch 12.1, "The Venomous Abyss"). These never appear in fetch-items.js's
// normal zone-loot-table scrape because they don't physically drop -- raiders
// get a generic armor-type token instead (e.g. "Venomwoven Idol") and convert
// it into their class's named piece via an NPC. Item ids/names/slots below
// were sourced from each class's Wowhead item-set page (PTR domain, since
// 12.1 hasn't shipped live as of this writing) and independently verified
// per-item against Wowhead's XML tooltip inventorySlot field.
//
// No item_bosses rows are generated -- these items have no boss source.
//
// Run: node scripts/fetch-tier-resolved-items.js
// Requires Node 18+ (native fetch). Writes tier_resolved_items.csv in the
// same wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id shape as
// fetch-items.js's items.csv, ready to paste into items_insert.sql (or run
// through scripts/items-csv-to-sql.js) alongside the rest of the season's
// item catalog import.

import { writeFileSync } from 'node:fs';

// Same WCL_ZONE_ID as fetch-items.js's current tier (#535 season filter).
const WCL_ZONE_ID = 57;

const TIER_ITEMS = [
  // Death Knight -- Plate -- Baleful Grave-Knight's Crucible (item-set 2055)
  { id: 271474, name: "Baleful Grave-Knight's Casque", slot: 'Head', armor_type: 'Plate' },
  { id: 271472, name: "Baleful Grave-Knight's Gibbets", slot: 'Shoulder', armor_type: 'Plate' },
  { id: 271477, name: "Baleful Grave-Knight's Breastplate", slot: 'Chest', armor_type: 'Plate' },
  { id: 271475, name: "Baleful Grave-Knight's Deathgrips", slot: 'Hands', armor_type: 'Plate' },
  { id: 271473, name: "Baleful Grave-Knight's Greaves", slot: 'Legs', armor_type: 'Plate' },

  // Demon Hunter -- Leather -- Abyssal Doomhound's Pursuit (item-set 2056)
  { id: 271537, name: "Abyssal Doomhound's Relentless Stare", slot: 'Head', armor_type: 'Leather' },
  { id: 271535, name: "Abyssal Doomhound's Jaws", slot: 'Shoulder', armor_type: 'Leather' },
  { id: 271540, name: "Abyssal Doomhound's Coreguard", slot: 'Chest', armor_type: 'Leather' },
  { id: 271538, name: "Abyssal Doomhound's Studded Gauntlets", slot: 'Hands', armor_type: 'Leather' },
  { id: 271536, name: "Abyssal Doomhound's Legwraps", slot: 'Legs', armor_type: 'Leather' },

  // Druid -- Leather -- Bark of the Enigmatic Dreamwatcher (item-set 2057)
  { id: 271528, name: "Enigmatic Dreamwatcher's Somnolent Stare", slot: 'Head', armor_type: 'Leather' },
  { id: 271526, name: "Enigmatic Dreamwatcher's Plumage", slot: 'Shoulder', armor_type: 'Leather' },
  { id: 271531, name: "Enigmatic Dreamwatcher's Lunar Raiment", slot: 'Chest', armor_type: 'Leather' },
  { id: 271529, name: "Enigmatic Dreamwatcher's Gauntlets", slot: 'Hands', armor_type: 'Leather' },
  { id: 271527, name: "Enigmatic Dreamwatcher's Leggings", slot: 'Legs', armor_type: 'Leather' },

  // Evoker -- Mail -- Echo of Calamity (item-set 2058)
  { id: 271501, name: "Calamitous Echo's Magmashapers", slot: 'Head', armor_type: 'Mail' },
  { id: 271499, name: "Calamitous Echo's Sundered Peaks", slot: 'Shoulder', armor_type: 'Mail' },
  { id: 271504, name: 'Searing Caldera of Calamity', slot: 'Chest', armor_type: 'Mail' },
  { id: 271502, name: "Calamitous Echo's Ebon Greathorns", slot: 'Hands', armor_type: 'Mail' },
  { id: 271500, name: 'Earthen Pillars of Calamity', slot: 'Legs', armor_type: 'Mail' },

  // Hunter -- Mail -- Skulking Viper's Ambush (item-set 2059)
  { id: 271492, name: "Skulking Viper's Weeping Fangs", slot: 'Head', armor_type: 'Mail' },
  { id: 271490, name: 'Jaws of the Skulking Viper', slot: 'Shoulder', armor_type: 'Mail' },
  { id: 271495, name: "Skulking Viper's Scuteplate", slot: 'Chest', armor_type: 'Mail' },
  { id: 271493, name: "Skulking Viper's Hidepiercers", slot: 'Hands', armor_type: 'Mail' },
  { id: 271491, name: "Skulking Viper's Coiled Legwraps", slot: 'Legs', armor_type: 'Mail' },

  // Mage -- Cloth -- Primal Leywarden's Attire (item-set 2060)
  { id: 271564, name: 'Crown of the Primal Leywarden', slot: 'Head', armor_type: 'Cloth' },
  { id: 271562, name: "Primal Leywarden's Manaflux", slot: 'Shoulder', armor_type: 'Cloth' },
  { id: 271567, name: 'Crest of the Primal Leywarden', slot: 'Chest', armor_type: 'Cloth' },
  { id: 271565, name: "Primal Leywarden's Manashapers", slot: 'Hands', armor_type: 'Cloth' },
  { id: 271563, name: "Primal Leywarden's Tailored Legwraps", slot: 'Legs', armor_type: 'Cloth' },

  // Monk -- Leather -- Guile of the Monkey King (item-set 2061)
  { id: 271519, name: "Monkey King's Unyielding Visage", slot: 'Head', armor_type: 'Leather' },
  { id: 271517, name: 'Tassels of the Monkey King', slot: 'Shoulder', armor_type: 'Leather' },
  { id: 271522, name: 'Battle Gi of the Monkey King', slot: 'Chest', armor_type: 'Leather' },
  { id: 271520, name: "Monkey King's Fighting Fists", slot: 'Hands', armor_type: 'Leather' },
  { id: 271518, name: 'Pantaloons of the Monkey King', slot: 'Legs', armor_type: 'Leather' },

  // Paladin -- Plate -- Radiance of the Consecrated Flame (item-set 2062)
  { id: 271465, name: 'Warhelm of the Consecrated Flame', slot: 'Head', armor_type: 'Plate' },
  { id: 271463, name: 'Pauldrons of the Consecrated Flame', slot: 'Shoulder', armor_type: 'Plate' },
  { id: 271468, name: 'Bulwark of the Consecrated Flame', slot: 'Chest', armor_type: 'Plate' },
  { id: 271466, name: 'Gauntlets of the Consecrated Flame', slot: 'Hands', armor_type: 'Plate' },
  { id: 271464, name: 'Greaves of the Consecrated Flame', slot: 'Legs', armor_type: 'Plate' },

  // Priest -- Cloth -- Cosmic Penitent's Raiment (item-set 2063)
  { id: 271555, name: "Cosmic Penitent's Truesight", slot: 'Head', armor_type: 'Cloth' },
  { id: 271553, name: "Cosmic Penitent's Echoing Screams", slot: 'Shoulder', armor_type: 'Cloth' },
  { id: 271558, name: "Cosmic Penitent's Eclipsing Robes", slot: 'Chest', armor_type: 'Cloth' },
  { id: 271556, name: "Cosmic Penitent's Celestial Grips", slot: 'Hands', armor_type: 'Cloth' },
  { id: 271554, name: 'Enveloping Legwraps of the Cosmic Penitent', slot: 'Legs', armor_type: 'Cloth' },

  // Rogue -- Leather -- Chosen Bloodslayer's Hexweave (item-set 2064)
  { id: 271510, name: "Chosen Bloodslayer's Spirit Shroud", slot: 'Head', armor_type: 'Leather' },
  { id: 271508, name: "Chosen Bloodslayer's Voodoo Guards", slot: 'Shoulder', armor_type: 'Leather' },
  { id: 271513, name: "Chosen Bloodslayer's Banded Poncho", slot: 'Chest', armor_type: 'Leather' },
  { id: 271511, name: "Chosen Bloodslayer's Fanged Grips", slot: 'Hands', armor_type: 'Leather' },
  { id: 271509, name: "Chosen Bloodslayer's Reinforced Pants", slot: 'Legs', armor_type: 'Leather' },

  // Shaman -- Mail -- Ophidian Oracle's Prophecy (item-set 2065)
  { id: 271483, name: 'Serpent Crown of the Ophidian Oracle', slot: 'Head', armor_type: 'Mail' },
  { id: 271481, name: 'Hissing Mantle of the Ophidian Oracle', slot: 'Shoulder', armor_type: 'Mail' },
  { id: 271486, name: 'Fanged Raiment of the Ophidian Oracle', slot: 'Chest', armor_type: 'Mail' },
  { id: 271484, name: 'Hexing Grips of the Ophidian Oracle', slot: 'Hands', armor_type: 'Mail' },
  { id: 271482, name: 'Leggings of the Ophidian Oracle', slot: 'Legs', armor_type: 'Mail' },

  // Warlock -- Cloth -- Damned Necrolyte's Shattered Restraints (item-set 2066)
  { id: 271546, name: 'Skull of the Damned Necrolyte', slot: 'Head', armor_type: 'Cloth' },
  { id: 271544, name: 'Spires of the Damned Necrolyte', slot: 'Shoulder', armor_type: 'Cloth' },
  { id: 271549, name: "Damned Necrolyte's Rattling Robes", slot: 'Chest', armor_type: 'Cloth' },
  { id: 271547, name: "Damned Necrolyte's Charred Grasps", slot: 'Hands', armor_type: 'Cloth' },
  { id: 271545, name: "Damned Necrolyte's Leg Bindings", slot: 'Legs', armor_type: 'Cloth' },

  // Warrior -- Plate -- Jade Warlord's Dominion (item-set 2067)
  { id: 271456, name: 'Tempered Horns of the Jade Warlord', slot: 'Head', armor_type: 'Plate' },
  { id: 271454, name: 'Raging Pauldrons of the Jade Warlord', slot: 'Shoulder', armor_type: 'Plate' },
  { id: 271459, name: 'Cuirass of the Jade Warlord', slot: 'Chest', armor_type: 'Plate' },
  { id: 271457, name: 'Jeweled Gauntlets of the Jade Warlord', slot: 'Hands', armor_type: 'Plate' },
  { id: 271455, name: 'Greaves of the Jade Warlord', slot: 'Legs', armor_type: 'Plate' }
];

// Same lightweight tooltip endpoint fetch-items.js uses for icons -- dataEnv=1
// resolves the icon slug fine even for PTR-only items (only stat values need
// the dataEnv=2 PTR fallback, see docs/updating-fetch-items-for-new-tier.md).
async function fetchIcon(id) {
  const res = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
  });
  if (!res.ok) throw new Error(`Tooltip HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.icon ?? null;
}

function csvEscape(val) {
  if (val == null || val === '') return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rows = [];
  for (const item of TIER_ITEMS) {
    let icon = null;
    try {
      icon = await fetchIcon(item.id);
      console.log(`[OK]   ${item.id}: ${item.name} | ${item.slot} | ${item.armor_type} | icon: ${icon}`);
    } catch (err) {
      console.error(`[FAIL] ${item.id}: ${item.name} | icon lookup failed (${err.message})`);
    }
    rows.push({ ...item, icon });
    await sleep(150);
  }

  const csv = [
    'wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id',
    ...rows.map(
      (r) => `${r.id},${csvEscape(r.name)},${csvEscape(r.slot)},${csvEscape(r.armor_type)},,${csvEscape(r.icon)},${WCL_ZONE_ID}`
    )
  ].join('\n');
  writeFileSync('tier_resolved_items.csv', csv, 'utf8');

  console.log(`\nDone. tier_resolved_items.csv -- ${rows.length} rows`);
  if (rows.some((r) => !r.icon)) {
    console.log('WARNING: Some items have no icon. Check rows with empty icon in tier_resolved_items.csv.');
  }
}

main();
