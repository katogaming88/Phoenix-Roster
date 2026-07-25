import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Completeness (#515): a wishlist is complete once every required
// WISHLIST_SLOTS row has at least one tagged item (any status), with Off
// Hand only required when the raider's BiS Weapon pick is a real One-Hand
// item.

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

const ALL_SLOTS = [
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

function fullPrefsExcept(itemSlots, itemIds, exclude) {
  const prefs = [];
  let id = 1;
  Object.keys(itemSlots).forEach((name) => {
    if (exclude.indexOf(name) !== -1) return;
    prefs.push({ id: id, item_id: itemIds[name], status: 'good', note: null, slot: null });
    id++;
  });
  return prefs;
}

describe('wishlistCompleteness', () => {
  it('is complete when every slot (minus Off Hand, no weapon tagged) has an item', () => {
    const itemSlots = {
      Helm: 'Head',
      Necklace: 'Neck',
      Pauldrons: 'Shoulder',
      Cape: 'Back',
      Robe: 'Chest',
      Bands: 'Wrist',
      Gloves: 'Hands',
      Girdle: 'Waist',
      Trousers: 'Legs',
      Boots: 'Feet',
      'Ring A': 'Finger',
      'Ring B': 'Finger',
      'Trinket A': 'Trinket',
      'Trinket B': 'Trinket',
      Staff: 'Two-Hand'
    };
    const itemIds = {};
    Object.keys(itemSlots).forEach((n, i) => (itemIds[n] = i + 1));
    const prefs = fullPrefsExcept(itemSlots, itemIds, []);
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).toEqual([]);
    expect(result.totalRequired).toBe(15); // Off Hand not required, Weapon covered by Staff
  });

  it('lists missing rows when slots are untouched', () => {
    const itemSlots = { Helm: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Necklace: 2 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).toContain('Neck');
    expect(result.missingRows).not.toContain('Head');
  });

  it('requires Off Hand when the BiS Weapon pick is One-Hand', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.requiredRows).toContain('Off Hand');
    expect(result.missingRows).toContain('Off Hand');
  });

  it('does not require Off Hand for a Two-Hand BiS weapon', () => {
    const itemSlots = { Staff: 'Two-Hand' };
    const itemIds = { Staff: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.requiredRows).not.toContain('Off Hand');
  });

  it('does not require Off Hand when nothing is tagged BiS for Weapon yet', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    // tagged 'good', not 'bis' -- shouldn't trigger the One-Hand requirement
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.requiredRows).not.toContain('Off Hand');
    // Weapon itself is still missing since only 'good' isn't required to be 'bis',
    // but a tagged pref of any status should count as covering the Weapon row.
    expect(result.missingRows).not.toContain('Weapon');
  });

  it('satisfies both Finger 1 and Finger 2 from a single tagged ring (data-model limitation)', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).not.toContain('Finger 1');
    expect(result.missingRows).not.toContain('Finger 2');
  });

  it('Other Sources (placeholder) rows count toward completeness via their explicit slot', () => {
    const itemSlots = { 'M+': '' };
    const itemIds = { 'M+': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Neck' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).not.toContain('Neck');
  });

  it('an officer bis_items pick for a slot counts toward completeness even if the raider never tagged it', () => {
    const itemSlots = { Helm: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Necklace: 2 };
    const prefs = []; // raider never touched their wishlist at all
    const bisList = { Kat: [{ item: 'Helm', dbSlot: 'Head' }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).not.toContain('Head');
    expect(result.missingRows).toContain('Neck');
  });

  it('officer bis_items Weapon pick determines Off Hand requirement when the raider has no Weapon tag', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [];
    const bisList = { Kat: [{ item: 'Sword', dbSlot: 'Weapon' }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);

    const result = sandbox.wishlistCompleteness();
    expect(result.requiredRows).toContain('Off Hand');
    expect(result.missingRows).toContain('Off Hand');
    expect(result.missingRows).not.toContain('Weapon');
  });

  it('legacy officer bis_items rows without dbSlot still resolve via catalog slot', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [];
    const bisList = { Kat: [{ item: 'Ring A', dbSlot: null }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).not.toContain('Finger 1');
  });

  it('an officer bis_items pick from a different season view does not count toward completeness', () => {
    const itemSlots = { Helm: 'Head', Necklace: 'Neck' };
    const itemIds = { Helm: 1, Necklace: 2 };
    const prefs = [];
    const bisList = { Kat: [{ item: 'Helm', dbSlot: 'Head' }] };
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, bisList);
    sandbox.DATA.seasonView = 'S2';
    sandbox.DATA.itemZones = { Helm: 1 };
    sandbox.DATA.raidZones = [{ wclZoneId: '1', season: 'S1' }];

    const result = sandbox.wishlistCompleteness();
    expect(result.missingRows).toContain('Head');
  });
});
