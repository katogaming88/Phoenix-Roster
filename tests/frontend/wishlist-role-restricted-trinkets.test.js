import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #636: some trinkets' equip/on-use effect only benefits one role -- healing/
// shielding allies (useless to DPS), or reducing/absorbing damage the wearer
// takes (useless outside a tank spec) -- even though nothing in the
// catalog's stat data (armor_type/main_stats) rules them out.
// HEALER_ONLY_TRINKETS/TANK_ONLY_TRINKETS (js/common.js) are Kat-curated
// denylists, checked against the viewing player's SPEC_ROLE ('Heal'/'Tank'),
// not their class or main stat.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = {
    itemSlots: {
      'Trinket of Mending': 'Trinket',
      'Trinket of Bulwarking': 'Trinket',
      'Trinket of Smiting': 'Trinket'
    },
    itemPlaceholders: {},
    itemIds: { 'Trinket of Mending': 1, 'Trinket of Bulwarking': 2, 'Trinket of Smiting': 3 },
    itemArmorTypes: {},
    itemMainStats: {
      'Trinket of Mending': ['INTELLECT'],
      'Trinket of Bulwarking': ['STRENGTH'],
      'Trinket of Smiting': ['INTELLECT']
    }
  };
  sandbox.HEALER_ONLY_TRINKETS = { 'Trinket of Mending': true };
  sandbox.TANK_ONLY_TRINKETS = { 'Trinket of Bulwarking': true };
  return sandbox;
}

describe('wishlistBucketRealItems -- healer-only trinket filtering (#636)', () => {
  it('hides a healer-only trinket from a DPS spec', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged');
    const names = buckets['Trinket 1'].map((i) => i.name);
    expect(names).toContain('Trinket of Smiting');
    expect(names).not.toContain('Trinket of Mending');
  });

  it('shows the healer-only trinket to a Heal-role viewer', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Heal');
    expect(buckets['Trinket 1'].map((i) => i.name)).toContain('Trinket of Mending');
  });

  it('shows the healer-only trinket when no role is known (no filter applied)', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', null);
    expect(buckets['Trinket 1'].map((i) => i.name)).toContain('Trinket of Mending');
  });

  it('applies to both Trinket 1 and Trinket 2 rows', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged');
    expect(buckets['Trinket 2'].map((i) => i.name)).not.toContain('Trinket of Mending');
  });
});

describe('wishlistBucketRealItems -- tank-only trinket filtering (#636 follow-up)', () => {
  it('hides a tank-only trinket from a non-Tank role', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Plate', 'STRENGTH', 'Melee');
    expect(buckets['Trinket 1'].map((i) => i.name)).not.toContain('Trinket of Bulwarking');
  });

  it('shows the tank-only trinket to a Tank-role viewer', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Plate', 'STRENGTH', 'Tank');
    expect(buckets['Trinket 1'].map((i) => i.name)).toContain('Trinket of Bulwarking');
  });

  it('shows the tank-only trinket when no role is known (no filter applied)', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Plate', 'STRENGTH', null);
    expect(buckets['Trinket 1'].map((i) => i.name)).toContain('Trinket of Bulwarking');
  });
});

// Guards against an accidental future edit silently dropping/renaming a
// confirmed entry -- every name Kat-confirmed against real proc text and
// cross-checked against items.name in prod, not guessed from item names
// alone.
describe('HEALER_ONLY_TRINKETS / TANK_ONLY_TRINKETS -- real registry contents', () => {
  it('contains exactly the confirmed role-restricted Season 1/2 trinkets', () => {
    // A bare sandbox, not makeSandbox() -- that helper always overwrites
    // both maps with synthetic values for the describe blocks above, which
    // would mask the real ones here.
    const sandbox = {
      window: {},
      location: { search: '', pathname: '/' },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
      console,
      Intl,
      setTimeout,
      clearTimeout
    };
    vm.createContext(sandbox);
    vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });

    expect(Object.keys(sandbox.HEALER_ONLY_TRINKETS).sort()).toEqual([
      'Light of the Cosmic Crescendo',
      'Preternatural Antivenom',
      'Soulcoiler Ritual Vessel',
      'Volatile Void Suffuser'
    ]);
    expect(Object.keys(sandbox.TANK_ONLY_TRINKETS).sort()).toEqual([
      "First Mate's Shellward",
      'Idol of the Howling Nexus'
    ]);
  });
});
