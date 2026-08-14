import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Officer-side wishlist completeness banner (#515, item-level follow-up).
// tab-priority.js reuses tab-bis.js's BIS_SLOTS/BIS_CATALOG_SLOT_TO_ROWS/
// bisEligibleRealItemsBySlot rather than a third duplicate copy of that
// vocabulary -- stubbed directly here rather than loading the whole of
// tab-bis.js, same minimal-stub convention priority-export.test.js already
// uses for this file.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

const BIS_SLOTS = [
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
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
];
const BIS_CATALOG_SLOT_TO_ROWS = {
  Head: ['Head'],
  Neck: ['Neck'],
  Shoulder: ['Shoulder'],
  Back: ['Back'],
  Chest: ['Chest'],
  Wrist: ['Wrist'],
  Hands: ['Hands'],
  Waist: ['Waist'],
  Legs: ['Legs'],
  Feet: ['Feet'],
  Finger: ['Finger 1', 'Finger 2'],
  Trinket: ['Trinket 1', 'Trinket 2'],
  'One-Hand': ['Weapon'],
  'Two-Hand': ['Weapon'],
  Ranged: ['Weapon'],
  'Off Hand': ['Off Hand'],
  'Held In Off-hand': ['Off Hand']
};

// Faithful-enough reimplementation of tab-bis.js's bisSlotBuckets() for this
// standalone sandbox (same minimal-stub convention as BIS_SLOTS above) --
// dbSlot first, then best-effort catalog-slot fallback for legacy rows.
function bisSlotBuckets(items, itemSlots) {
  var buckets = {};
  var unassigned = [];
  items.forEach(function (entry) {
    var dbSlot = entry.dbSlot || entry.slot || '';
    if (dbSlot && BIS_SLOTS.indexOf(dbSlot) !== -1 && !buckets[dbSlot]) {
      buckets[dbSlot] = entry;
    } else {
      unassigned.push(entry);
    }
  });
  unassigned.forEach(function (entry) {
    var catalogSlot = itemSlots[entry.item] || '';
    var candidates = BIS_CATALOG_SLOT_TO_ROWS[catalogSlot] || [];
    for (var c = 0; c < candidates.length; c++) {
      if (!buckets[candidates[c]]) {
        buckets[candidates[c]] = entry;
        return;
      }
    }
  });
  return { buckets: buckets };
}

// Own minimal reimplementation of tab-bis.js's bisEligibleRealItemsBySlot()
// -- no armor/main-stat/role/class filtering (unused by these fixtures),
// just catalog-slot bucketing, so tests only need to control itemSlots.
function bisEligibleRealItemsBySlot(itemSlots, itemIds) {
  var buckets = {};
  BIS_SLOTS.forEach(function (s) {
    buckets[s] = [];
  });
  Object.keys(itemSlots).forEach(function (name) {
    var rows = BIS_CATALOG_SLOT_TO_ROWS[itemSlots[name] || ''] || [];
    rows.forEach(function (row) {
      buckets[row].push({ name: name, itemId: itemIds[name], rankName: name });
    });
  });
  return buckets;
}

function makeSandbox({
  itemSlots = {},
  itemIds = {},
  roster = [],
  prefsRows = [],
  bisEnabled = true,
  bisList = {}
} = {}) {
  const sandbox = {
    console,
    document: { getElementById: () => ({ innerHTML: '' }) },
    DATA: { itemSlots, itemIds, roster },
    _teamCfg: { supabaseTeamId: 1 },
    featureEnabled: () => bisEnabled,
    escHtml: (s) => String(s),
    BIS_SLOTS,
    BIS_CATALOG_SLOT_TO_ROWS,
    getBisItems: (firstName) => bisList[firstName] || [],
    bisSlotBuckets: (items) => bisSlotBuckets(items, itemSlots),
    bisEligibleRealItemsBySlot: () => bisEligibleRealItemsBySlot(itemSlots, itemIds),
    supabaseClient: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return Promise.resolve({ data: prefsRows, error: null });
          }
        };
      }
    },
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  return sandbox;
}

describe('getIncompleteWishlists (#515, item-level)', () => {
  it('returns empty when the bis feature flag is off', () => {
    const sandbox = makeSandbox({ bisEnabled: false });
    sandbox._teamItemPreferences = [];
    expect(sandbox.getIncompleteWishlists()).toEqual({ count: 0, raiders: [] });
  });

  it("returns empty while item_preferences hasn't loaded yet", () => {
    const sandbox = makeSandbox({});
    expect(sandbox.getIncompleteWishlists()).toEqual({ count: 0, raiders: [] });
  });

  it('flags a raider with an untagged item and lists the row with a count', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head' };
    const itemIds = { Helm: 1, Circlet: 2 };
    const roster = [{ id: 11, nameRealm: 'Kat-Illidan' }];
    const sandbox = makeSandbox({ itemSlots, itemIds, roster });
    sandbox._teamItemPreferences = [{ player_id: 11, item_id: 1, status: 'good', slot: null }];

    const result = sandbox.getIncompleteWishlists();
    expect(result.count).toBe(1);
    expect(result.raiders[0].nameRealm).toBe('Kat-Illidan');
    expect(result.raiders[0].missingRows).toContain('Head');
    expect(result.raiders[0].missingCounts.Head).toBe(1);
  });

  it('a row with no eligible catalog items is never flagged', () => {
    const itemSlots = { Helm: 'Head' };
    const itemIds = { Helm: 1 };
    const roster = [{ id: 11, nameRealm: 'Kat-Illidan' }];
    const sandbox = makeSandbox({ itemSlots, itemIds, roster });
    sandbox._teamItemPreferences = [{ player_id: 11, item_id: 1, status: 'good', slot: null }];

    const result = sandbox.getIncompleteWishlists();
    expect(result.count).toBe(0);
  });

  it('omits a raider whose wishlist has every eligible item tagged', () => {
    const itemSlots = { Staff: 'Two-Hand' };
    const itemIds = { Staff: 1 };
    const roster = [{ id: 11, nameRealm: 'Kat-Illidan' }];
    const prefsRows = [{ player_id: 11, item_id: 1, status: 'bis', slot: null }];
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefsRows });
    sandbox._teamItemPreferences = prefsRows;

    const result = sandbox.getIncompleteWishlists();
    expect(result.count).toBe(0);
  });

  it('fetchTeamItemPreferences then re-render populates the banner via renderWishlistIncompleteBanner', async () => {
    const itemSlots = {};
    const itemIds = {};
    const roster = [];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefsRows: [] });
    sandbox.document.getElementById = (id) => (id === 'wishlistIncompleteBanner' ? el : null);

    sandbox.renderWishlistIncompleteBanner();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sandbox._teamItemPreferences).toEqual([]);
    expect(el.innerHTML).toBe('');
  });

  it('an officer bis_items pick covers only that one item, not the whole row', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Circlet: 2, Necklace: 3 };
    const roster = [{ id: 11, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const bisList = { 'Kat-Illidan': [{ item: 'Helm', dbSlot: 'Head' }] };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, bisList });
    sandbox._teamItemPreferences = []; // raider never touched their wishlist

    const result = sandbox.getIncompleteWishlists();
    expect(result.count).toBe(1);
    expect(result.raiders[0].missingRows).toContain('Head');
    expect(result.raiders[0].missingCounts.Head).toBe(1); // Circlet still untagged
    expect(result.raiders[0].missingRows).toContain('Neck');
  });

  it('a ring tagged only under Finger 1 also covers Finger 2 for that same item', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const roster = [{ id: 11, nameRealm: 'Kat-Illidan' }];
    const sandbox = makeSandbox({ itemSlots, itemIds, roster });
    sandbox._teamItemPreferences = [{ player_id: 11, item_id: 1, status: 'good', slot: 'Finger 1' }];

    const result = sandbox.getIncompleteWishlists();
    expect(result.count).toBe(0);
  });

  it('renders a compact name-only banner on the Priority tab, no per-slot breakdown', async () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head' };
    const itemIds = { Helm: 1, Circlet: 2 };
    const roster = [{ id: 11, nameRealm: 'Kat-Illidan' }];
    const prefsRows = [{ player_id: 11, item_id: 1, status: 'good', slot: null }];
    const compactEl = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefsRows });
    sandbox.document.getElementById = (id) => (id === 'wishlistIncompleteBanner' ? compactEl : null);

    sandbox.renderWishlistIncompleteBanner();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(compactEl.innerHTML).toContain('Kat-Illidan');
    expect(compactEl.innerHTML).not.toContain('Head');
    expect(compactEl.innerHTML).toContain('BiS Lists');
  });
});

// Per-player completion badge (officer profile card's Wishlist section
// header, js/common.js officerWishlistSectionHTML()) -- unlike
// getIncompleteWishlists(), this needs one player's real tagged/total
// numbers whether they're complete or not, not just who's missing something.
describe('wishlistCompletionForPlayer', () => {
  it('returns null while item_preferences has not loaded yet', () => {
    const sandbox = makeSandbox({});
    const player = { id: 11, nameRealm: 'Kat-Illidan' };
    expect(sandbox.wishlistCompletionForPlayer(player)).toBeNull();
  });

  it('returns null when the bis feature flag is off', () => {
    const sandbox = makeSandbox({ bisEnabled: false });
    sandbox._teamItemPreferences = [];
    const player = { id: 11, nameRealm: 'Kat-Illidan' };
    expect(sandbox.wishlistCompletionForPlayer(player)).toBeNull();
  });

  it('reports 0/N for a raider who has tagged nothing at all', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head' };
    const itemIds = { Helm: 1, Circlet: 2 };
    const sandbox = makeSandbox({ itemSlots, itemIds });
    sandbox._teamItemPreferences = [];
    const player = { id: 11, nameRealm: 'Kat-Illidan' };

    const result = sandbox.wishlistCompletionForPlayer(player);
    expect(result.tagged).toBe(0);
    expect(result.total).toBe(2);
    // No 'bis'-status pref anywhere, so every required row (all of BIS_SLOTS
    // minus Off Hand, which isn't required by default) is still missing a
    // real BiS pick -- independent of the item-tagging total above.
    expect(result.missingBisRows).toEqual(BIS_SLOTS.filter((row) => row !== 'Off Hand'));
  });

  it('counts a partially-tagged raider correctly', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head' };
    const itemIds = { Helm: 1, Circlet: 2 };
    const sandbox = makeSandbox({ itemSlots, itemIds });
    sandbox._teamItemPreferences = [{ player_id: 11, item_id: 1, status: 'good', slot: null }];
    const player = { id: 11, nameRealm: 'Kat-Illidan' };

    const result = sandbox.wishlistCompletionForPlayer(player);
    expect(result.tagged).toBe(1);
    expect(result.total).toBe(2);
    // 'good' isn't 'bis' -- item-level tagging progressed but no slot has a
    // real BiS pick yet.
    expect(result.missingBisRows).toEqual(BIS_SLOTS.filter((row) => row !== 'Off Hand'));
  });

  it('reports tagged === total for a fully-tagged raider, but still flags missing BiS picks elsewhere', () => {
    const itemSlots = { Helm: 'Head' };
    const itemIds = { Helm: 1 };
    const sandbox = makeSandbox({ itemSlots, itemIds });
    sandbox._teamItemPreferences = [{ player_id: 11, item_id: 1, status: 'bis', slot: null }];
    const player = { id: 11, nameRealm: 'Kat-Illidan' };

    const result = sandbox.wishlistCompletionForPlayer(player);
    expect(result.tagged).toBe(1);
    expect(result.total).toBe(1);
    // Head got a real 'bis' tag, so it drops out of missingBisRows even
    // though every other slot (with nothing eligible to tag at all in this
    // fixture) is still counted as missing one.
    expect(result.missingBisRows).toEqual(BIS_SLOTS.filter((row) => row !== 'Off Hand' && row !== 'Head'));
  });
});
