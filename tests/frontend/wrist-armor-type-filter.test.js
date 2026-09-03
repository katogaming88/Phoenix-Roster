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

// Regression: Wrist was wrongly listed in WISHLIST_UNIVERSAL_ROWS /
// BIS_UNIVERSAL_ROWS as if bracers were armor-agnostic jewelry (like Neck/
// Back/Finger/Trinket/Weapon genuinely are) -- reported live: a raider's
// Wishlist Wrist row showed Cloth/Leather/Mail/Plate bracers all mixed
// together instead of just their own armor type. Every Wrist row in the
// catalog carries a real armor_type, confirmed against the live DB (2 Cloth,
// 2 Leather, 2 Mail, 2 Plate), so it should always have been filtered like
// Head/Chest/Legs/etc.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');
const BIS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-bis.js'), 'utf8');

function loadSandbox(sources) {
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
  sandbox.formatDateTime = realCommon.formatDateTime;
  sandbox.localTimeZoneNote = realCommon.localTimeZoneNote;
  vm.createContext(sandbox);
  sources.forEach((src, i) => vm.runInContext(src, sandbox, { filename: `src${i}.js` }));
  return sandbox;
}

describe('WISHLIST_UNIVERSAL_ROWS / BIS_UNIVERSAL_ROWS', () => {
  it('does not treat Wrist as armor-agnostic', () => {
    const wishlistSandbox = loadSandbox([COMMON_JS, WISHLIST_JS]);
    expect(wishlistSandbox.WISHLIST_UNIVERSAL_ROWS.Wrist).toBeUndefined();

    const bisSandbox = loadSandbox([COMMON_JS, BIS_JS]);
    expect(bisSandbox.BIS_UNIVERSAL_ROWS.Wrist).toBeUndefined();
  });

  it('still treats genuinely armor-agnostic rows as universal', () => {
    const sandbox = loadSandbox([COMMON_JS, WISHLIST_JS]);
    ['Neck', 'Back', 'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2', 'Weapon', 'Off Hand'].forEach((row) => {
      expect(sandbox.WISHLIST_UNIVERSAL_ROWS[row]).toBe(true);
    });
  });
});

describe('wishlistBucketRealItems Wrist filtering', () => {
  function makeCatalogSandbox() {
    const sandbox = loadSandbox([COMMON_JS, WISHLIST_JS]);
    sandbox.DATA = {
      itemSlots: {
        'Cloth Bands': 'Wrist',
        'Leather Bands': 'Wrist',
        'Mail Bands': 'Wrist',
        'Plate Bands': 'Wrist'
      },
      itemPlaceholders: {},
      itemIds: { 'Cloth Bands': 1, 'Leather Bands': 2, 'Mail Bands': 3, 'Plate Bands': 4 },
      itemArmorTypes: {
        'Cloth Bands': 'Cloth',
        'Leather Bands': 'Leather',
        'Mail Bands': 'Mail',
        'Plate Bands': 'Plate'
      },
      itemMainStats: {}
    };
    return sandbox;
  }

  it("only shows the player's own armor type in the Wrist bucket", () => {
    const sandbox = makeCatalogSandbox();
    const buckets = sandbox.wishlistBucketRealItems('Leather', null);
    expect(buckets.Wrist.map((i) => i.name)).toEqual(['Leather Bands']);
  });

  it('shows every armor type when the player has none set (e.g. no class on file)', () => {
    const sandbox = makeCatalogSandbox();
    const buckets = sandbox.wishlistBucketRealItems(null, null);
    expect(buckets.Wrist.map((i) => i.name).sort()).toEqual([
      'Cloth Bands',
      'Leather Bands',
      'Mail Bands',
      'Plate Bands'
    ]);
  });
});
