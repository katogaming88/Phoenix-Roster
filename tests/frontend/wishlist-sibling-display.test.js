import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Display-side follow-up to the item-level completeness fix: the card
// header's "N tagged" count, the colored dots, and button highlighting all
// used to look up a row's status via an exact-slot-only match, so a ring/
// trinket tagged under one numbered slot (Finger 1/Trinket 1) showed as
// untagged under its sibling (Finger 2/Trinket 2) even though
// wishlistCompleteness() already counted it as covered there. This tests
// wishlistDisplayStatus() (the fix) and wishlistCollapsibleCardHTML()'s new
// otherSourcesCovered param directly.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox(itemSlots, itemIds, prefs, itemPlaceholders) {
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

  sandbox.DATA = { itemSlots, itemPlaceholders: itemPlaceholders || {}, itemIds, bisList: {} };
  sandbox._wishlistPrefs = prefs;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistExpandedSlots = {};
  return sandbox;
}

describe('wishlistDisplayStatus (sibling-aware display)', () => {
  it('a ring tagged only under Finger 1 displays that status under Finger 2 too', () => {
    const itemSlots = { 'Ring A': 'Finger' };
    const itemIds = { 'Ring A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: 'Finger 1' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    expect(sandbox.wishlistDisplayStatus(1, 'Finger 1')).toBe('good');
    expect(sandbox.wishlistDisplayStatus(1, 'Finger 2')).toBe('good');
  });

  it('a trinket tagged only under Trinket 2 displays that status under Trinket 1 too', () => {
    const itemSlots = { 'Trinket A': 'Trinket' };
    const itemIds = { 'Trinket A': 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'pass', note: null, slot: 'Trinket 2' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    expect(sandbox.wishlistDisplayStatus(1, 'Trinket 1')).toBe('pass');
  });

  it('does not mirror a placeholder (M+/Crafted/Catalyst) tagged in one numbered slot into its sibling', () => {
    const itemSlots = { 'M+': '' };
    const itemIds = { 'M+': 1 };
    const itemPlaceholders = { 'M+': true };
    const prefs = [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs, itemPlaceholders);

    expect(sandbox.wishlistDisplayStatus(1, 'Finger 1')).toBe('bis');
    expect(sandbox.wishlistDisplayStatus(1, 'Finger 2')).toBeNull();
  });

  it('Weapon and Off Hand stay independent (no sibling mirroring)', () => {
    const itemSlots = { Sword: 'One-Hand' };
    const itemIds = { Sword: 1 };
    const prefs = [{ id: 1, item_id: 1, status: 'good', note: null, slot: 'Weapon' }];
    const sandbox = makeSandbox(itemSlots, itemIds, prefs);

    expect(sandbox.wishlistDisplayStatus(1, 'Weapon')).toBe('good');
    expect(sandbox.wishlistDisplayStatus(1, 'Off Hand')).toBeNull();
  });
});

describe('wishlistCollapsibleCardHTML otherSourcesCovered', () => {
  it('renders green even with untagged items when otherSourcesCovered is true', () => {
    const sandbox = makeSandbox({}, {}, []);
    const summaryItems = [
      { itemId: 1, slot: 'Neck' },
      { itemId: 2, slot: 'Neck' }
    ]; // neither tagged
    const html = sandbox.wishlistCollapsibleCardHTML('Neck', 'Neck', summaryItems, '', false, true);

    expect(html).toContain('var(--heal)'); // green
    expect(html).toContain('0 tagged');
  });

  it('does not force green when otherSourcesCovered is false and items are untagged', () => {
    const sandbox = makeSandbox({}, {}, []);
    const summaryItems = [{ itemId: 1, slot: 'Neck' }];
    const html = sandbox.wishlistCollapsibleCardHTML('Neck', 'Neck', summaryItems, '', false, false);

    expect(html).not.toContain('var(--heal)');
  });

  it('officerCovered alone does not force green (text-only note)', () => {
    const sandbox = makeSandbox({}, {}, []);
    const summaryItems = [{ itemId: 1, slot: 'Neck' }];
    const html = sandbox.wishlistCollapsibleCardHTML('Neck', 'Neck', summaryItems, '', true, false);

    expect(html).toContain('officer BiS set');
    expect(html).not.toContain('var(--heal)');
  });
});
