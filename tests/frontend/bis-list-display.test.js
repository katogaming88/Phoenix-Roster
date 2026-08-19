import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// BiS List display fixes: (1) rows now sort into canonical gear-slot order
// (bis_items/the wishlist merge previously rendered in whatever order rows
// came back in, which put wishlist-merged entries out of order); (2) the
// wishlist-BiS merge (previously raider-profile-only via wishlist.js's
// wishlistBisMergeGroups) is now also available to the officer's read view
// of a raider's profile via the shared bisMergeWishlistPrefs() core.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

describe('bisDisplaySortKey / BiS List row ordering', () => {
  it('sorts entries into canonical gear-slot order regardless of input order', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Helm: 'Head', Girdle: 'Waist', Bands: 'Wrist', Cape: 'Back', Necklace: 'Neck' };
    const entries = [
      { item: 'Girdle', slot: '', dbSlot: '' },
      { item: 'Bands', slot: '', dbSlot: '' },
      { item: 'Cape', slot: '', dbSlot: '' },
      { item: 'Helm', slot: '', dbSlot: '' },
      { item: 'Necklace', slot: '', dbSlot: '' }
    ];

    const sorted = entries
      .slice()
      .sort((a, b) => sandbox.bisDisplaySortKey(a, itemSlots) - sandbox.bisDisplaySortKey(b, itemSlots));

    expect(sorted.map((e) => e.item)).toEqual(['Helm', 'Necklace', 'Cape', 'Bands', 'Girdle']);
  });

  it('prefers an explicit dbSlot/slot over the catalog-derived row', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Ring: 'Finger' };
    const entry = { item: 'Ring', slot: '', dbSlot: 'Finger 2' };
    expect(sandbox.bisDisplaySortKey(entry, itemSlots)).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Finger 2'));
  });

  it('falls back to the catalog slot, collapsing Finger/Trinket to their first row', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Ring: 'Finger', Charm: 'Trinket' };
    const ringEntry = { item: 'Ring', slot: '', dbSlot: '' };
    const trinketEntry = { item: 'Charm', slot: '', dbSlot: '' };
    expect(sandbox.bisDisplaySortKey(ringEntry, itemSlots)).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Finger 1'));
    expect(sandbox.bisDisplaySortKey(trinketEntry, itemSlots)).toBe(
      sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Trinket 1')
    );
  });

  it('places an unrecognisable entry (e.g. a placeholder without a slot) last', () => {
    const sandbox = makeSandbox();
    const entry = { item: 'M+', slot: '', dbSlot: '' };
    expect(sandbox.bisDisplaySortKey(entry, {})).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.length);
  });
});

describe('bisMergeWishlistPrefs (shared merge core)', () => {
  it('a wishlist BiS real item supersedes the officer pick for the same catalog slot', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'New Helm': 1 },
      itemSlots: { 'New Helm': 'Head', 'Old Helm': 'Head' },
      itemPlaceholders: {}
    };
    const prefs = [{ item_id: 1, status: 'bis', slot: null }];
    const officerBisItems = [{ item: 'Old Helm', slot: '', dbSlot: '' }];

    const result = sandbox.bisMergeWishlistPrefs(prefs, officerBisItems, 11);
    expect(result.fromWishlist).toEqual([
      { item: 'New Helm', slot: '', dbSlot: '', obtained: false, playerId: 11, itemId: 1, fromWishlist: true }
    ]);
    expect(result.officerSet).toEqual([]);
  });

  it('a wishlist BiS placeholder (Other Sources) supersedes the officer pick only for its exact row', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'M+': 1 },
      itemSlots: {},
      itemPlaceholders: { 'M+': true }
    };
    const prefs = [{ item_id: 1, status: 'bis', slot: 'Waist' }];
    const officerBisItems = [
      { item: 'M+', slot: 'Waist', dbSlot: 'Waist' },
      { item: 'M+', slot: 'Wrist', dbSlot: 'Wrist' }
    ];

    const result = sandbox.bisMergeWishlistPrefs(prefs, officerBisItems, 11);
    expect(result.officerSet).toEqual([{ item: 'M+', slot: 'Wrist', dbSlot: 'Wrist' }]);
  });

  it('leaves the officer set untouched when prefs is empty', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = { itemIds: {}, itemSlots: {}, itemPlaceholders: {} };
    const officerBisItems = [{ item: 'Helm', slot: '', dbSlot: '' }];

    const result = sandbox.bisMergeWishlistPrefs([], officerBisItems, 11);
    expect(result.fromWishlist).toEqual([]);
    expect(result.officerSet).toEqual(officerBisItems);
  });

  it('dedupes a real item BiS on both numbered slots (Trinket 1 + Trinket 2) into a single row', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'Soulcoiler Ritual Vessel': 320 },
      itemSlots: { 'Soulcoiler Ritual Vessel': 'Trinket' },
      itemPlaceholders: {}
    };
    const prefs = [
      { item_id: 320, status: 'bis', slot: 'Trinket 1' },
      { item_id: 320, status: 'bis', slot: 'Trinket 2' }
    ];

    const result = sandbox.bisMergeWishlistPrefs(prefs, [], 175);
    expect(result.fromWishlist).toEqual([
      {
        item: 'Soulcoiler Ritual Vessel',
        slot: '',
        dbSlot: '',
        obtained: false,
        playerId: 175,
        itemId: 320,
        fromWishlist: true
      }
    ]);
  });

  it('does not dedupe two different placeholder rows for the same catalog item (e.g. M+ wanted on both rings)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'M+': 1 },
      itemSlots: {},
      itemPlaceholders: { 'M+': true }
    };
    const prefs = [
      { item_id: 1, status: 'bis', slot: 'Finger 1' },
      { item_id: 1, status: 'bis', slot: 'Finger 2' }
    ];

    const result = sandbox.bisMergeWishlistPrefs(prefs, [], 175);
    expect(result.fromWishlist).toHaveLength(2);
    expect(result.fromWishlist.map((e) => e.slot).sort()).toEqual(['Finger 1', 'Finger 2']);
  });

  it('ignores non-BiS wishlist tags (Good/OK/etc. never supersede the officer pick)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'New Helm': 1 },
      itemSlots: { 'New Helm': 'Head', 'Old Helm': 'Head' },
      itemPlaceholders: {}
    };
    const prefs = [{ item_id: 1, status: 'good', slot: null }];
    const officerBisItems = [{ item: 'Old Helm', slot: '', dbSlot: '' }];

    const result = sandbox.bisMergeWishlistPrefs(prefs, officerBisItems, 11);
    expect(result.fromWishlist).toEqual([]);
    expect(result.officerSet).toEqual(officerBisItems);
  });
});
