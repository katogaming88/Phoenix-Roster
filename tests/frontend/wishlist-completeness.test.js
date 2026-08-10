import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Completeness (#515, item-level follow-up): a wishlist is complete once
// every eligible real catalog item across every required WISHLIST_SLOTS row
// has a status (any of BiS/Good/OK/Catalyst/Pass) -- not just one item per
// row. An officer's bis_items pick for a row covers only that one exact
// item, not the whole row. Off Hand is only required when the raider's BiS
// Weapon pick is a real One-Hand item.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox(itemSlots, itemIds, prefs, bisList) {
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
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots, itemPlaceholders: {}, itemIds, bisList: bisList || {} };
  sandbox._wishlistPrefs = prefs;
  sandbox._wishlistPlayerFirstName = 'Kat';
  return sandbox;
}

// Real callers always build buckets via wishlistBucketRealItems() (with the
// raider's actual armor-type/main-stat/role/class filters) and pass them in
// -- these tests use the unfiltered form (nulls) since none of these
// fixtures need armor/stat/role scoping.
function completenessFor(sandbox) {
  const buckets = sandbox.wishlistBucketRealItems(null, null, null, null);
  return sandbox.wishlistCompleteness(buckets);
}

describe('wishlistCompleteness (item-level)', () => {
  it('is complete once every eligible item in every required row is tagged', () => {
    const itemSlots = { Helm: 'Head', Necklace: 'Neck', Staff: 'Two-Hand' };
    const itemIds = { Helm: 1, Necklace: 2, Staff: 3 };
    const prefs = [
      { id: 1, item_id: 1, status: 'good', note: null, slot: null },
      { id: 2, item_id: 2, status: 'pass', note: null, slot: null },
      { id: 3, item_id: 3, status: 'bis', note: null, slot: null }
    ];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).toEqual([]);
    expect(result.taggedCount).toBe(3);
    expect(result.totalRequired).toBe(3); // Off Hand not required (Two-Hand weapon)
  });

  it('flags a row as missing when only some of its eligible items are tagged', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head' };
    const itemIds = { Helm: 1, Circlet: 2 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).toContain('Head');
    expect(result.missingCounts.Head).toBe(1);
    expect(result.taggedCount).toBe(1);
    expect(result.totalRequired).toBe(2);
  });

  it('a row with no eligible catalog items is never missing', () => {
    const itemSlots = { Helm: 'Head' };
    const itemIds = { Helm: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).not.toContain('Neck');
  });

  it('requires Off Hand when the BiS Weapon pick is One-Hand', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.requiredRows).toContain('Off Hand');
  });

  it('does not require Off Hand for a Two-Hand BiS weapon', () => {
    const itemSlots = { Staff: 'Two-Hand' };
    const itemIds = { Staff: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.requiredRows).not.toContain('Off Hand');
  });

  it('does not require Off Hand when nothing is tagged BiS for Weapon yet', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    // tagged 'good', not 'bis' -- shouldn't trigger the One-Hand requirement
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.requiredRows).not.toContain('Off Hand');
    expect(result.missingRows).not.toContain('Weapon');
  });

  it('a ring tagged only under Finger 1 also covers Finger 2 (same physical item, same stats either finger)', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: 'Finger 1' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).not.toContain('Finger 1');
    expect(result.missingRows).not.toContain('Finger 2');
  });

  it('a trinket tagged only under Trinket 2 also covers Trinket 1', () => {
    const itemSlots = { 'Trinket A': 'Trinket' };
    const itemIds = { 'Trinket A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'ok', note: null, slot: 'Trinket 2' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).not.toContain('Trinket 1');
    expect(result.missingRows).not.toContain('Trinket 2');
  });

  it('two different rings each tagged once (one per numbered slot) both count as fully rated -- an untagged third ring still shows missing on both', () => {
    const itemSlots = { 'Ring A': 'Finger', 'Ring B': 'Finger', 'Ring C': 'Finger' };
    const itemIds = { 'Ring A': 1, 'Ring B': 2, 'Ring C': 3 };
    const prefs = [
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1' },
      { id: 2, item_id: 2, status: 'good', note: null, slot: 'Finger 2' }
      // Ring C never tagged at all
    ];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    // Ring A and Ring B are each fully rated (their one tag counts for both
    // numbered slots), so only Ring C's missing rating shows up -- once per
    // row, since it's eligible under both.
    expect(result.missingRows).toContain('Finger 1');
    expect(result.missingRows).toContain('Finger 2');
    expect(result.missingCounts['Finger 1']).toBe(1);
    expect(result.missingCounts['Finger 2']).toBe(1);
  });

  it('an Other Sources (placeholder) tag does not satisfy a real raid-item row', () => {
    // Placeholders (M+/Crafted/Catalyst) are a separate, optional section --
    // tagging one for a slot no longer excuses tagging the real raid items
    // eligible for that row.
    const itemSlots = { Helm: 'Head', 'M+': '' };
    const itemIds = { Helm: 1, 'M+': 2 };
    const prefs = [{ id: 1, item_id: 2, status: 'bis', note: null, slot: 'Head' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = completenessFor(sandbox);
    expect(result.missingRows).toContain('Head');
    expect(result.missingCounts.Head).toBe(1);
  });

  it('an officer bis_items pick covers only that one item, not the whole row', () => {
    const itemSlots = { Helm: 'Head', Circlet: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Circlet: 2, Necklace: 3 };
    const prefs = []; // raider never touched their wishlist at all
    const bisList = { Kat: [{ item: 'Helm', dbSlot: 'Head' }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);

    const result = completenessFor(sandbox);
    expect(result.missingRows).toContain('Head');
    expect(result.missingCounts.Head).toBe(1); // Circlet still untagged
    expect(result.missingRows).toContain('Neck');
  });

  it('officer bis_items Weapon pick determines Off Hand requirement when the raider has no Weapon tag', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [];
    const bisList = { Kat: [{ item: 'Sword', dbSlot: 'Weapon' }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);

    const result = completenessFor(sandbox);
    expect(result.requiredRows).toContain('Off Hand');
    expect(result.missingRows).not.toContain('Weapon'); // officer's pick covers the only eligible Weapon item
  });

  it('an item outside the current season view never appears as required', () => {
    const itemSlots = { Helm: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Necklace: 2 };
    const prefs = [];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);
    sandbox.DATA.seasonView = 'S2';
    sandbox.DATA.itemZones = { Helm: 1 };
    sandbox.DATA.raidZones = [{ wclZoneId: '1', season: 'S1' }];

    const result = completenessFor(sandbox);
    expect(result.missingRows).not.toContain('Head'); // Helm is out of scope, not shown at all
    expect(result.missingRows).toContain('Neck');
  });
});
