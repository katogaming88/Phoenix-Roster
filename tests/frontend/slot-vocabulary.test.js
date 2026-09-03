import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// The tab renders timestamps through formatDateTime() and the zone note
// through localTimeZoneNote(), both js/common.js globals (#905); the real
// ones, so the suite cannot pin a shape the shipped helpers need not have.
const realCommon = loadCommonJs(quietConsole);

// #453: items.slot used to hold a hand-typed spreadsheet vocabulary ('Boots',
// 'Gloves', 'Ring', '1H/2H', 'OH'...) that matched neither the game, Wowhead,
// nor bis_items.slot -- so every consumer carried a synonym table. The catalog
// is now normalized to the canonical names, and those synonym halves are gone.
// These tests pin the surviving vocabulary so a regression can't quietly
// reintroduce a second dialect.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const BIS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-bis.js'), 'utf8');

function load(src, extra = {}) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    ...extra
  };
  sandbox.formatDateTime = realCommon.formatDateTime;
  sandbox.localTimeZoneNote = realCommon.localTimeZoneNote;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'src.js' });
  return sandbox;
}

// The exact vocabulary the catalog now stores, per the Wowhead <inventorySlot>
// values the migration re-derived every row from.
const CANONICAL = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger',
  'Trinket',
  'One-Hand',
  'Two-Hand',
  'Ranged',
  'Off Hand',
  'Held In Off-hand'
];

const LEGACY = ['Boots', 'Gloves', 'Belt', 'Bracers', 'Cloak', 'Shoulders', 'Ring', '1H/2H', 'OH', 'Unknown'];

describe('BIS_CATALOG_SLOT_TO_ROWS (#453)', () => {
  const { BIS_CATALOG_SLOT_TO_ROWS: MAP, BIS_SLOTS } = load(BIS_JS);

  it('covers every canonical catalog slot', () => {
    const missing = CANONICAL.filter((s) => !(s in MAP));
    expect(missing).toEqual([]);
  });

  it('no longer carries any legacy spreadsheet word', () => {
    const stragglers = LEGACY.filter((s) => s in MAP);
    expect(stragglers).toEqual([]);
  });

  it('every mapped row is a real BIS_SLOTS row', () => {
    const bogus = Object.values(MAP)
      .flat()
      .filter((row) => !BIS_SLOTS.includes(row));
    expect(bogus).toEqual([]);
  });

  it('a type that fits two positions fans out to both', () => {
    // A ring cannot say which finger; only the officer's assignment can.
    expect(MAP.Finger).toEqual(['Finger 1', 'Finger 2']);
    expect(MAP.Trinket).toEqual(['Trinket 1', 'Trinket 2']);
  });

  it('every weapon type collapses to the single Weapon row', () => {
    expect(MAP['One-Hand']).toEqual(['Weapon']);
    expect(MAP['Two-Hand']).toEqual(['Weapon']);
    expect(MAP.Ranged).toEqual(['Weapon']);
  });

  it('shields and held-in-off-hand items share the Off Hand row', () => {
    expect(MAP['Off Hand']).toEqual(['Off Hand']);
    expect(MAP['Held In Off-hand']).toEqual(['Off Hand']);
  });

  it('slotless catalog values map to no row', () => {
    // Placeholder (M+/Crafted/Catalyst) and Curio (a class-set trade token)
    // name a loot source, not a gear position.
    expect(MAP.Placeholder).toBeUndefined();
    expect(MAP.Curio).toBeUndefined();
  });
});

describe('getSlotColor (#453)', () => {
  const { getSlotColor } = load(COMMON_JS);

  it('colors every canonical catalog slot (nothing falls through to default)', () => {
    const uncolored = CANONICAL.filter((s) => getSlotColor(s) === 'var(--text)');
    expect(uncolored).toEqual([]);
  });

  it('colors the numbered BiS positions the same as their type', () => {
    expect(getSlotColor('Finger 1')).toBe(getSlotColor('Finger'));
    expect(getSlotColor('Trinket 2')).toBe(getSlotColor('Trinket'));
    expect(getSlotColor('Weapon')).toBe(getSlotColor('Two-Hand'));
  });

  it('is case-insensitive, as callers pass either vocabulary', () => {
    expect(getSlotColor('feet')).toBe(getSlotColor('Feet'));
  });

  it('groups armor, jewelry, and weapons distinctly', () => {
    expect(getSlotColor('Feet')).toBe('var(--tank)');
    expect(getSlotColor('Finger')).toBe('var(--ranged)');
    expect(getSlotColor('Trinket')).toBe('var(--gold)');
    expect(getSlotColor('Two-Hand')).toBe('var(--melee)');
  });

  it('a legacy word is no longer special-cased', () => {
    // Not an assertion that they *should* be uncolored so much as proof the
    // synonym table is gone -- these values no longer exist in the catalog.
    expect(getSlotColor('Boots')).toBe('var(--text)');
    expect(getSlotColor('1H/2H')).toBe('var(--text)');
  });
});
