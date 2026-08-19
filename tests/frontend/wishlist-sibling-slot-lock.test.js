import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A ring/trinket item lists under both its numbered cards (Finger 1/Finger 2,
// Trinket 1/Trinket 2 share one item pool). Once it's BiS on one of the two,
// the app mirrors that same status onto the sibling row (item_preferences.
// synced_bis marks which side is the mirror). Only the *mirrored* row is
// locked -- every status button, not just BiS -- since it's the same
// physical item and there's no independent status to give it there. The row
// the raider actually clicked (synced_bis: false) stays freely editable even
// though it too reads BiS.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox(existingPrefs) {
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

  sandbox.DATA = {
    itemSlots: { 'Ring A': 'Finger' },
    itemPlaceholders: {},
    itemIds: { 'Ring A': 1 },
    wishlistOpen: true
  };
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerNameRealm = 'Kat-Illidan';
  sandbox._wishlistPrefs = existingPrefs;
  return sandbox;
}

describe('wishlistRowHTML sibling-slot BiS note', () => {
  it('flags the mirrored (synced_bis) row, pointing back at the explicit slot', () => {
    const sandbox = makeSandbox([
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 2', 0);
    expect(html).toContain('Already your Finger 1 BiS pick');
  });

  it('does NOT flag the explicit row (synced_bis: false), even though it too reads BiS', () => {
    const sandbox = makeSandbox([
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 1', 0);
    expect(html).not.toContain('Already your');
  });

  it('disables the BiS button itself on the mirrored row', () => {
    const sandbox = makeSandbox([
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 2', 0);
    const bisButtonMatch = html.match(/<button[^>]*wishlistSetStatus\(1,'Finger 2','bis'\)[^>]*/);
    expect(bisButtonMatch).toBeTruthy();
    // The onclick attribute lands after the disabled attribute in source order.
    const bisButtonTag = html.slice(0, html.indexOf(bisButtonMatch[0]) + bisButtonMatch[0].length);
    const tagStart = bisButtonTag.lastIndexOf('<button');
    expect(bisButtonTag.slice(tagStart)).toContain('disabled');
  });

  it('also disables the Good button on the mirrored row -- the whole row is locked, not just BiS', () => {
    const sandbox = makeSandbox([
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 2', 0);
    const goodButtonMatch = html.match(/<button[^>]*wishlistSetStatus\(1,'Finger 2','good'\)[^>]*/);
    expect(goodButtonMatch).toBeTruthy();
    const goodButtonTag = html.slice(0, html.indexOf(goodButtonMatch[0]) + goodButtonMatch[0].length);
    const tagStart = goodButtonTag.lastIndexOf('<button');
    expect(goodButtonTag.slice(tagStart)).toContain('disabled');
  });

  it('does NOT disable the BiS button on the explicit row', () => {
    const sandbox = makeSandbox([
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 1', 0);
    const bisButtonMatch = html.match(/<button[^>]*wishlistSetStatus\(1,'Finger 1','bis'\)[^>]*/);
    expect(bisButtonMatch).toBeTruthy();
    const bisButtonTag = html.slice(0, html.indexOf(bisButtonMatch[0]) + bisButtonMatch[0].length);
    const tagStart = bisButtonTag.lastIndexOf('<button');
    expect(bisButtonTag.slice(tagStart)).not.toContain('disabled');
  });

  it('shows no note when the sibling row has no BiS tag', () => {
    const sandbox = makeSandbox([]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 2', 0);
    expect(html).not.toContain('Already your');
  });

  it('shows no note when the sibling row is Good, not BiS', () => {
    const sandbox = makeSandbox([{ id: 1, item_id: 1, status: 'good', note: null, slot: 'Finger 1' }]);
    const html = sandbox.wishlistRowHTML('Ring A', 1, 'Finger 2', 0);
    expect(html).not.toContain('Already your');
  });

  it('does not flag a regular (non-disambiguated) gear-slot row', () => {
    const sandbox = makeSandbox([]);
    sandbox.DATA.itemSlots = { Helm: 'Head' };
    sandbox.DATA.itemIds = { Helm: 2 };
    const html = sandbox.wishlistRowHTML('Helm', 2, null, 0);
    expect(html).not.toContain('Already your');
  });
});
