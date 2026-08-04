// Generates the insert for tier_token_map (see
// supabase/migrations/20260804013135_tier_token_map.sql) -- one row per
// class per slot, linking the generic per-armor-type token item (what
// actually drops, e.g. "Venomwoven Idol") to that class's resolved tier item
// (what the wishlist should display, e.g. "Damned Necrolyte's Charred
// Grasps"). Token names follow this tier's TOKEN_SLOT_KEYWORDS /
// TOKEN_ARMOR_SUFFIXES pattern in scripts/fetch-items.js: "Venom<suffix>
// <noun>", suffix by armor type, noun by slot.
//
// Run: node scripts/generate-tier-token-map-sql.js
// Writes tier_token_map_insert.sql. Both the token items (normal season
// import) and the resolved items (scripts/fetch-tier-resolved-items.js) must
// already be imported into `items` before this runs in the SQL Editor --
// it matches both sides by name, not hardcoded ids.

import { writeFileSync } from 'node:fs';

const TOKEN_NOUN_BY_SLOT = {
  Head: 'Effigy',
  Shoulder: 'Remnant',
  Chest: 'Icon',
  Hands: 'Idol',
  Legs: 'Relic'
};

const TOKEN_SUFFIX_BY_ARMOR = {
  Mail: 'cast',
  Leather: 'cured',
  Plate: 'forged',
  Cloth: 'woven'
};

// class, armor_type, then the 5 slots' resolved item names (must match
// tier_resolved_items.csv exactly -- items.name has a unique index on
// lower(name), so an exact-string match here is required for the subquery
// below to resolve).
const CLASS_RESOLVED_ITEMS = [
  {
    class: 'Death Knight',
    armor_type: 'Plate',
    items: {
      Head: "Baleful Grave-Knight's Casque",
      Shoulder: "Baleful Grave-Knight's Gibbets",
      Chest: "Baleful Grave-Knight's Breastplate",
      Hands: "Baleful Grave-Knight's Deathgrips",
      Legs: "Baleful Grave-Knight's Greaves"
    }
  },
  {
    class: 'Demon Hunter',
    armor_type: 'Leather',
    items: {
      Head: "Abyssal Doomhound's Relentless Stare",
      Shoulder: "Abyssal Doomhound's Jaws",
      Chest: "Abyssal Doomhound's Coreguard",
      Hands: "Abyssal Doomhound's Studded Gauntlets",
      Legs: "Abyssal Doomhound's Legwraps"
    }
  },
  {
    class: 'Druid',
    armor_type: 'Leather',
    items: {
      Head: "Enigmatic Dreamwatcher's Somnolent Stare",
      Shoulder: "Enigmatic Dreamwatcher's Plumage",
      Chest: "Enigmatic Dreamwatcher's Lunar Raiment",
      Hands: "Enigmatic Dreamwatcher's Gauntlets",
      Legs: "Enigmatic Dreamwatcher's Leggings"
    }
  },
  {
    class: 'Evoker',
    armor_type: 'Mail',
    items: {
      Head: "Calamitous Echo's Magmashapers",
      Shoulder: "Calamitous Echo's Sundered Peaks",
      Chest: 'Searing Caldera of Calamity',
      Hands: "Calamitous Echo's Ebon Greathorns",
      Legs: 'Earthen Pillars of Calamity'
    }
  },
  {
    class: 'Hunter',
    armor_type: 'Mail',
    items: {
      Head: "Skulking Viper's Weeping Fangs",
      Shoulder: 'Jaws of the Skulking Viper',
      Chest: "Skulking Viper's Scuteplate",
      Hands: "Skulking Viper's Hidepiercers",
      Legs: "Skulking Viper's Coiled Legwraps"
    }
  },
  {
    class: 'Mage',
    armor_type: 'Cloth',
    items: {
      Head: 'Crown of the Primal Leywarden',
      Shoulder: "Primal Leywarden's Manaflux",
      Chest: 'Crest of the Primal Leywarden',
      Hands: "Primal Leywarden's Manashapers",
      Legs: "Primal Leywarden's Tailored Legwraps"
    }
  },
  {
    class: 'Monk',
    armor_type: 'Leather',
    items: {
      Head: "Monkey King's Unyielding Visage",
      Shoulder: 'Tassels of the Monkey King',
      Chest: 'Battle Gi of the Monkey King',
      Hands: "Monkey King's Fighting Fists",
      Legs: 'Pantaloons of the Monkey King'
    }
  },
  {
    class: 'Paladin',
    armor_type: 'Plate',
    items: {
      Head: 'Warhelm of the Consecrated Flame',
      Shoulder: 'Pauldrons of the Consecrated Flame',
      Chest: 'Bulwark of the Consecrated Flame',
      Hands: 'Gauntlets of the Consecrated Flame',
      Legs: 'Greaves of the Consecrated Flame'
    }
  },
  {
    class: 'Priest',
    armor_type: 'Cloth',
    items: {
      Head: "Cosmic Penitent's Truesight",
      Shoulder: "Cosmic Penitent's Echoing Screams",
      Chest: "Cosmic Penitent's Eclipsing Robes",
      Hands: "Cosmic Penitent's Celestial Grips",
      Legs: 'Enveloping Legwraps of the Cosmic Penitent'
    }
  },
  {
    class: 'Rogue',
    armor_type: 'Leather',
    items: {
      Head: "Chosen Bloodslayer's Spirit Shroud",
      Shoulder: "Chosen Bloodslayer's Voodoo Guards",
      Chest: "Chosen Bloodslayer's Banded Poncho",
      Hands: "Chosen Bloodslayer's Fanged Grips",
      Legs: "Chosen Bloodslayer's Reinforced Pants"
    }
  },
  {
    class: 'Shaman',
    armor_type: 'Mail',
    items: {
      Head: 'Serpent Crown of the Ophidian Oracle',
      Shoulder: 'Hissing Mantle of the Ophidian Oracle',
      Chest: 'Fanged Raiment of the Ophidian Oracle',
      Hands: 'Hexing Grips of the Ophidian Oracle',
      Legs: 'Leggings of the Ophidian Oracle'
    }
  },
  {
    class: 'Warlock',
    armor_type: 'Cloth',
    items: {
      Head: 'Skull of the Damned Necrolyte',
      Shoulder: 'Spires of the Damned Necrolyte',
      Chest: "Damned Necrolyte's Rattling Robes",
      Hands: "Damned Necrolyte's Charred Grasps",
      Legs: "Damned Necrolyte's Leg Bindings"
    }
  },
  {
    class: 'Warrior',
    armor_type: 'Plate',
    items: {
      Head: 'Tempered Horns of the Jade Warlord',
      Shoulder: 'Raging Pauldrons of the Jade Warlord',
      Chest: 'Cuirass of the Jade Warlord',
      Hands: 'Jeweled Gauntlets of the Jade Warlord',
      Legs: 'Greaves of the Jade Warlord'
    }
  }
];

function sqlEscape(val) {
  return `'${String(val).replace(/'/g, "''")}'`;
}

function tokenName(slot, armorType) {
  return `Venom${TOKEN_SUFFIX_BY_ARMOR[armorType]} ${TOKEN_NOUN_BY_SLOT[slot]}`;
}

function main() {
  const rows = [];
  for (const { class: className, armor_type, items } of CLASS_RESOLVED_ITEMS) {
    for (const [slot, resolvedName] of Object.entries(items)) {
      rows.push({
        class: className,
        token: tokenName(slot, armor_type),
        resolved: resolvedName
      });
    }
  }

  const values = rows
    .map(
      (r) =>
        `  ((select id from items where lower(name) = lower(${sqlEscape(r.token)})), ${sqlEscape(r.class)}, (select id from items where lower(name) = lower(${sqlEscape(r.resolved)})))`
    )
    .join(',\n');

  const sql = `-- Generated by scripts/generate-tier-token-map-sql.js. Run after both the\n-- token items (normal season import) and tier_resolved_items.csv are\n-- already imported into items -- this matches both sides by name.\ninsert into public.tier_token_map (token_item_id, class, resolved_item_id)\nvalues\n${values};\n`;

  writeFileSync('tier_token_map_insert.sql', sql, 'utf8');
  console.log(`Done. tier_token_map_insert.sql -- ${rows.length} rows`);
}

main();
