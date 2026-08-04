import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #609: items.weapon_subtype (e.g. 'Sword', 'Staff', 'Shield') gates the
// Weapon/Off Hand rows by CLASS_WEAPON_TYPES/CLASS_SHIELD_USERS (js/common.js)
// on top of the existing armor-type/main-stat filters -- a Mage seeing a
// Mace or a Two-Handed Sword in their Weapon wishlist row was previously
// impossible to filter out, since neither armor_type nor main_stats rules
// it out (Maces/Swords carry no armor_type at all, and plenty of non-Mage
// classes share the same INTELLECT main stat).

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
      'Mage Sword': 'One-Hand',
      'Mage Staff': 'Two-Hand',
      'Some Mace': 'One-Hand',
      'Two-Hand Sword': 'Two-Hand',
      'A Dagger': 'One-Hand',
      'A Shield': 'Off Hand',
      'A Tome': 'Held In Off-hand',
      'Unbackfilled Axe': 'One-Hand'
    },
    itemPlaceholders: {},
    itemIds: {
      'Mage Sword': 1,
      'Mage Staff': 2,
      'Some Mace': 3,
      'Two-Hand Sword': 4,
      'A Dagger': 5,
      'A Shield': 6,
      'A Tome': 7,
      'Unbackfilled Axe': 8
    },
    itemArmorTypes: {},
    itemMainStats: {},
    itemWeaponSubtypes: {
      'Mage Sword': 'Sword',
      'Mage Staff': 'Staff',
      'Some Mace': 'Mace',
      'Two-Hand Sword': 'Sword',
      'A Dagger': 'Dagger',
      'A Shield': 'Shield'
      // 'A Tome' and 'Unbackfilled Axe' intentionally omitted -- no
      // weapon_subtype set (either a non-weapon off-hand item, or not yet
      // backfilled).
    }
  };
  return sandbox;
}

describe('wishlistBucketRealItems -- weapon type filtering (#609)', () => {
  it('shows a Mage only the weapon subtypes their class can equip in that hand', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged', 'Mage');
    const names = buckets.Weapon.map((i) => i.name);
    expect(names).toContain('Mage Sword'); // One-Hand Sword -- allowed
    expect(names).toContain('Mage Staff'); // Two-Hand Staff -- allowed
    expect(names).toContain('A Dagger'); // One-Hand Dagger -- allowed
    expect(names).not.toContain('Some Mace'); // Mage has no One-Hand Mace
    expect(names).not.toContain('Two-Hand Sword'); // Mage has no Two-Hand Sword
  });

  it('excludes a Shield from the Off Hand row for a non-shield class', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged', 'Mage');
    expect(buckets['Off Hand'].map((i) => i.name)).not.toContain('A Shield');
  });

  it('shows a Shield to a shield-eligible class (Warrior)', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Plate', 'STRENGTH', 'Melee', 'Warrior');
    expect(buckets['Off Hand'].map((i) => i.name)).toContain('A Shield');
  });

  it('leaves a non-weapon Off Hand item (no weapon_subtype) universal regardless of class', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged', 'Mage');
    expect(buckets['Off Hand'].map((i) => i.name)).toContain('A Tome');
  });

  it('excludes every Two-Hand weapon for a class with no Two-Hand entry at all (Rogue)', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Leather', 'AGILITY', 'Melee', 'Rogue');
    expect(buckets.Weapon.map((i) => i.name)).not.toContain('Two-Hand Sword');
    expect(buckets.Weapon.map((i) => i.name)).not.toContain('Mage Staff');
    expect(buckets.Weapon.map((i) => i.name)).toContain('A Dagger'); // One-Hand Dagger -- Rogue can use
  });

  it('shows an unbackfilled item (no weapon_subtype yet) to every class', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Cloth', 'INTELLECT', 'Ranged', 'Mage');
    expect(buckets.Weapon.map((i) => i.name)).toContain('Unbackfilled Axe');
  });

  it('applies no weapon-type filter at all when the player has no class on file', () => {
    const sandbox = makeSandbox();
    const buckets = sandbox.wishlistBucketRealItems(null, null, null, null);
    expect(buckets.Weapon.map((i) => i.name)).toContain('Some Mace');
    expect(buckets.Weapon.map((i) => i.name)).toContain('Two-Hand Sword');
    expect(buckets['Off Hand'].map((i) => i.name)).toContain('A Shield');
  });
});
