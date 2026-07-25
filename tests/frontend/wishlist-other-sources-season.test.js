import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Other Sources rows (M+/Crafted/Catalyst) aren't tied to a raid zone, so
// isItemInSeasonScope() used to always treat them as in-scope regardless of
// season -- a raider's (or officer's) placeholder pick made during Season 1
// kept showing up forever, even in a Season 2 view. Placeholder rows now
// carry their own `season` column, and the Wishlist's Other Sources card
// (wishlistOtherSourceHTML/wishlistOtherSourcesSectionHTML) filters by it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox({ itemIds, itemPlaceholders, seasonView, prefs }) {
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

  sandbox.DATA = { itemIds, itemPlaceholders, itemSlots: {}, seasonView };
  sandbox._wishlistPrefs = prefs;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox.wishlistOpen = () => false;
  return sandbox;
}

describe('wishlistOtherSourceHTML -- season scoping', () => {
  it('shows an Other Sources row tagged for the currently-viewed season', () => {
    const sandbox = makeSandbox({
      itemIds: { 'M+': 1 },
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2',
      prefs: [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Head', season: 'Midnight Season 2' }]
    });

    const html = sandbox.wishlistOtherSourceHTML('M+', {});
    expect(html).toContain('M+ - Head');
  });

  it('hides an Other Sources row tagged for a different (older) season', () => {
    const sandbox = makeSandbox({
      itemIds: { 'M+': 1 },
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2',
      prefs: [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Head', season: 'Midnight Season 1' }]
    });

    const html = sandbox.wishlistOtherSourceHTML('M+', {});
    expect(html).not.toContain('M+ - Head');
    expect(html).toContain('No slots tagged yet');
  });

  it('still shows a legacy Other Sources row with no season stamped', () => {
    const sandbox = makeSandbox({
      itemIds: { 'M+': 1 },
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2',
      prefs: [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Head', season: null }]
    });

    const html = sandbox.wishlistOtherSourceHTML('M+', {});
    expect(html).toContain('M+ - Head');
  });
});

describe('wishlistOtherSourcesSectionHTML -- season scoping', () => {
  it("excludes a stale-season placeholder row from the card's tagged-count summary", () => {
    const sandbox = makeSandbox({
      itemIds: { 'M+': 1, Crafted: 2, Catalyst: 3 },
      itemPlaceholders: { 'M+': true, Crafted: true, Catalyst: true },
      seasonView: 'Midnight Season 2',
      prefs: [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Head', season: 'Midnight Season 1' }]
    });

    const html = sandbox.wishlistOtherSourcesSectionHTML();
    expect(html).toContain('0 tagged');
  });
});
