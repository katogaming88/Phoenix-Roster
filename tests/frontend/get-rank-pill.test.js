import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// getRank()/rankPillHTML() used to treat DATA.priorityOrder[itemName] as a
// flat array, but it's actually {heroic?: string[], mythic?: string[]}
// (mapSupabasePriorityOrder()) -- so `list.length`/`list[i]` on that object
// were always undefined and the lookup loop never ran, silently returning
// null for every player on every item. The visible symptom: the rank pill
// next to each BiS row on a raider's own profile always showed "-", even
// when the item had a real priority order. CHANGELOG shows the identical
// bug got fixed independently in tab-conflicts.js's Contested Items view
// ("Rank labels now display in Contested Items") but this copy was never
// touched. Fixed to search both tracks and return every one the player
// ranks on, using full name_realm identity (not first name) so two roster
// characters sharing a first name can't collide here either.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs() {
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
  return sandbox;
}

describe('getRank (rank pill data)', () => {
  it('finds a heroic rank in the {heroic, mythic} priorityOrder shape', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      priorityOrder: { 'Signet of the Starved Beast': { heroic: ['Katorri-Stormrage', 'Snarge-Illidan'] } }
    };
    expect(sandbox.getRank('Katorri-Stormrage', 'Signet of the Starved Beast')).toEqual([{ pos: 1, diff: 'heroic' }]);
    expect(sandbox.getRank('Snarge-Illidan', 'Signet of the Starved Beast')).toEqual([{ pos: 2, diff: 'heroic' }]);
  });

  it('returns both tracks when a player is ranked on heroic and mythic for the same item', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      priorityOrder: {
        'Signet of the Starved Beast': {
          heroic: ['Katorri-Stormrage'],
          mythic: ['Snarge-Illidan', 'Katorri-Stormrage']
        }
      }
    };
    expect(sandbox.getRank('Katorri-Stormrage', 'Signet of the Starved Beast')).toEqual([
      { pos: 1, diff: 'heroic' },
      { pos: 2, diff: 'mythic' }
    ]);
  });

  it('returns [] when the item has no priority order at all', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { priorityOrder: {} };
    expect(sandbox.getRank('Katorri-Stormrage', 'Unmanaged Item')).toEqual([]);
  });

  it('returns [] when the player is not on either track', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      priorityOrder: { 'Signet of the Starved Beast': { heroic: ['Snarge-Illidan'] } }
    };
    expect(sandbox.getRank('Katorri-Stormrage', 'Signet of the Starved Beast')).toEqual([]);
  });

  it('does not confuse two characters sharing a first name when looked up by identity', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      priorityOrder: { 'Signet of the Starved Beast': { heroic: ['Katorri-Illidan', 'Katorri-Stormrage'] } }
    };
    expect(sandbox.getRank('Katorri-Stormrage', 'Signet of the Starved Beast')).toEqual([{ pos: 2, diff: 'heroic' }]);
    expect(sandbox.getRank('Katorri-Illidan', 'Signet of the Starved Beast')).toEqual([{ pos: 1, diff: 'heroic' }]);
  });
});

describe('rankPillHTML', () => {
  it('renders a dash for an unranked item', () => {
    const sandbox = loadCommonJs();
    expect(sandbox.rankPillHTML([])).toContain('-');
    expect(sandbox.rankPillHTML(null)).toContain('-');
  });

  it('renders a heroic pill in the heal color, labeled "<pos> H"', () => {
    const sandbox = loadCommonJs();
    const html = sandbox.rankPillHTML([{ pos: 1, diff: 'heroic' }]);
    expect(html).toContain('1 H');
    expect(html).toContain('var(--heal)');
    expect(html).not.toContain('var(--ranged)');
  });

  it('renders a mythic pill in the ranged (purple) color, labeled "<pos> M"', () => {
    const sandbox = loadCommonJs();
    const html = sandbox.rankPillHTML([{ pos: 1, diff: 'mythic' }]);
    expect(html).toContain('1 M');
    expect(html).toContain('var(--ranged)');
    expect(html).not.toContain('var(--heal)');
  });

  it('renders heroic and mythic as separate pills, each its own color, when ranked on both', () => {
    const sandbox = loadCommonJs();
    const html = sandbox.rankPillHTML([
      { pos: 1, diff: 'heroic' },
      { pos: 3, diff: 'mythic' }
    ]);
    expect(html).toContain('1 H');
    expect(html).toContain('3 M');
    // Two distinct <span class="rank-pill" ...> boxes, not one pill with a
    // combined label -- and each carries its own track color.
    const pillMatches = html.match(/<span class="rank-pill"[^>]*>/g);
    expect(pillMatches).toHaveLength(2);
    expect(pillMatches[0]).toContain('var(--heal)');
    expect(pillMatches[1]).toContain('var(--ranged)');
  });
});

// officerWishlistRowHTML() (officer read view of a raider's wishlist) used
// to render name/slot/status only, with no rank pill at all -- an officer
// had to leave the card and open the item's Set Priority modal separately
// just to see where a wishlisted item currently ranked, even though the
// raider's own wishlist view (js/wishlist.js's wishlistRowHTML) already
// showed this. Now takes the wishlist owner's nameRealm and reuses the same
// getRank()/rankPillHTML() pair.
describe('officerWishlistRowHTML rank pill', () => {
  function makeSandbox() {
    const sandbox = loadCommonJs();
    sandbox.PROFILE_WISHLIST_STATUS_LABELS = [
      { value: 'bis', label: 'BiS', color: 'var(--gold)', rgb: '214,163,68' },
      { value: 'good', label: '2nd Choice', color: 'var(--heal)', rgb: '61,220,132' }
    ];
    return sandbox;
  }

  it('shows the raider’s current rank pill for a real catalog item', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      priorityOrder: { 'Signet of the Starved Beast': { heroic: ['Katorri-Stormrage'] } },
      itemIcons: {},
      itemWowIds: {},
      itemIsPtr: {},
      itemPlaceholders: {}
    };
    const html = sandbox.officerWishlistRowHTML(
      'Signet of the Starved Beast',
      { status: 'bis', note: null },
      {},
      'Trinket 1',
      'Katorri-Stormrage'
    );
    expect(html).toContain('1 H');
  });

  it('renders a dash when the raider has no rank on that item yet', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = { priorityOrder: {}, itemIcons: {}, itemWowIds: {}, itemIsPtr: {}, itemPlaceholders: {} };
    const html = sandbox.officerWishlistRowHTML(
      'Signet of the Starved Beast',
      { status: 'good', note: null },
      {},
      'Trinket 1',
      'Katorri-Stormrage'
    );
    expect(html).toContain('-');
  });

  it('skips the rank pill entirely for an Other Sources placeholder (M+/Crafted/Catalyst)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      // A rank entry exists for 'M+' itself (unrelated real-world scenario
      // guard), but placeholders aren't a real raid-drop item with a
      // priority order worth showing.
      priorityOrder: { 'M+': { heroic: ['Katorri-Stormrage'] } },
      itemIcons: {},
      itemWowIds: {},
      itemIsPtr: {},
      itemPlaceholders: { 'M+': true }
    };
    const html = sandbox.officerWishlistRowHTML(
      'M+',
      { status: 'bis', note: null },
      {},
      'Shoulder',
      'Katorri-Stormrage'
    );
    expect(html).not.toContain('rank-pill');
    expect(html).not.toContain('1 H');
  });

  it('renders a dash when no nameRealm is passed (defensive, should not throw)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = { priorityOrder: {}, itemIcons: {}, itemWowIds: {}, itemIsPtr: {}, itemPlaceholders: {} };
    const html = sandbox.officerWishlistRowHTML(
      'Signet of the Starved Beast',
      { status: 'good', note: null },
      {},
      'Trinket 1'
    );
    expect(html).toContain('-');
  });
});
