import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// wishlistSetNote() previously only wrote to the exact slot it was called
// for, unlike wishlistSetStatus() which already mirrors into the sibling
// row (Finger 1/2, Trinket 1/2 -- same physical item). That let a raider's
// note drift independently between the two numbered slots for the same
// item, showing as two different notes on what reads as one opinion.
// Mirroring is conditional: only when the sibling row already exists, so
// typing a note doesn't silently create a new 'good'-tagged row on an
// otherwise-untouched sibling slot (wishlistUpsert()'s insert branch
// defaults status to 'good').

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox({ itemSlots = {}, itemIds = {}, itemPlaceholders = {}, prefs = [] } = {}) {
  const updates = [];
  const inserts = [];
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
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots, itemPlaceholders, itemIds, wishlistOpen: true };
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPrefs = prefs;

  sandbox.supabaseClient = {
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row });
          return { select: () => Promise.resolve({ data: [{ id: inserts.length + 100, ...row }], error: null }) };
        },
        update(patch) {
          const call = { table, patch, filters: {} };
          updates.push(call);
          const builder = {
            eq(col, val) {
              call.filters[col] = val;
              return builder;
            },
            is(col, val) {
              call.filters[col] = val;
              return builder;
            },
            select: () => Promise.resolve({ data: [{ id: 1, ...patch }], error: null })
          };
          return builder;
        }
      };
    }
  };
  return { sandbox, updates, inserts };
}

describe('wishlistSetNote sibling mirroring', () => {
  it('mirrors the note to the sibling slot when it already exists', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [
      { id: 1, item_id: 1, status: 'good', note: 'old', slot: 'Finger 1' },
      { id: 2, item_id: 1, status: 'good', note: 'old', slot: 'Finger 2' }
    ];
    const { sandbox, updates } = makeSandbox({ itemSlots, itemIds, prefs });

    sandbox.wishlistSetNote(1, 'Finger 1', 'new note');

    expect(updates).toHaveLength(2);
    expect(updates.every((u) => u.patch.note === 'new note')).toBe(true);
    const slots = updates.map((u) => u.filters.slot).sort();
    expect(slots).toEqual(['Finger 1', 'Finger 2']);
  });

  it('does not create a new sibling row when it does not already exist', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: 'Finger 1' }];
    const { sandbox, updates, inserts } = makeSandbox({ itemSlots, itemIds, prefs });

    sandbox.wishlistSetNote(1, 'Finger 1', 'solo note');

    expect(updates).toHaveLength(1);
    expect(updates[0].filters.slot).toBe('Finger 1');
    expect(inserts).toHaveLength(0);
  });

  it('does not mirror notes for a placeholder item (M+/Crafted/Catalyst)', () => {
    const itemSlots = { 'M+': '' };
    const itemIds = { 'M+': 1 };
    const itemPlaceholders = { 'M+': true };
    const prefs = [
      { id: 1, item_id: 1, status: 'bis', note: 'old', slot: 'Finger 1' },
      { id: 2, item_id: 1, status: 'bis', note: 'old', slot: 'Finger 2' }
    ];
    const { sandbox, updates } = makeSandbox({ itemSlots, itemIds, itemPlaceholders, prefs });

    sandbox.wishlistSetNote(1, 'Finger 1', 'placeholder note');

    expect(updates).toHaveLength(1);
    expect(updates[0].filters.slot).toBe('Finger 1');
  });

  it('does not mirror for Weapon/Off Hand (no sibling entry, can be two different items)', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [
      { id: 1, item_id: 1, status: 'good', note: 'old', slot: 'Weapon' },
      { id: 2, item_id: 1, status: 'good', note: 'old', slot: 'Off Hand' }
    ];
    const { sandbox, updates } = makeSandbox({ itemSlots, itemIds, prefs });

    sandbox.wishlistSetNote(1, 'Weapon', 'weapon-only note');

    expect(updates).toHaveLength(1);
    expect(updates[0].filters.slot).toBe('Weapon');
  });
});
