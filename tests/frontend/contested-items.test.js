import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Contested Items used to read only from the officer's bis_items grid
// (DATA.bisList via getBisItems()) -- a team relying mainly on raiders
// tagging their own wishlist instead saw this tab read as almost entirely
// empty. buildContestedItemMap() now merges both sources per player via
// bisMergeWishlistPrefs() (same merge renderProfile()'s officer branch
// already uses), and buildConflicts() only lists items 2+ players actually
// want, collapsed by default with a click-to-expand player list.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFLICTS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-conflicts.js'), 'utf8');

// Faithful-enough reimplementation of common.js's bisMergeWishlistPrefs()
// for this standalone sandbox (same minimal-stub convention other
// tab-priority.js/tab-conflicts.js tests use) -- real items only, BiS status
// only, no placeholder handling (unused by these fixtures).
function bisMergeWishlistPrefs(prefs, officerBisItems, playerId) {
  var itemIds = { 'Item A': 1, 'Item B': 2, 'Item C': 3 };
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var fromWishlist = (prefs || [])
    .filter(function (p) {
      return p.status === 'bis';
    })
    .map(function (p) {
      return {
        item: idToName[p.item_id],
        slot: '',
        dbSlot: '',
        obtained: false,
        playerId: playerId,
        itemId: p.item_id,
        fromWishlist: true
      };
    });
  var wishlistItemNames = fromWishlist.map(function (e) {
    return e.item;
  });
  var officerSet = officerBisItems.filter(function (e) {
    return wishlistItemNames.indexOf(e.item) === -1;
  });
  return { fromWishlist: fromWishlist, officerSet: officerSet };
}

function makeSandbox({ roster = [], bisList = {}, teamItemPreferences = null, priorityOrder = {} } = {}) {
  const sandbox = {
    console,
    window: {},
    document: { getElementById: () => null },
    DATA: { roster, bisList, priorityOrder, itemSlots: {}, selfReceived: {} },
    _teamItemPreferences: teamItemPreferences,
    getBisItems: (nameRealm) => {
      var player = roster.find((p) => p.nameRealm === nameRealm);
      return player ? bisList[player.firstName] || [] : [];
    },
    bisMergeWishlistPrefs,
    normalise: (s) =>
      String(s || '')
        .toLowerCase()
        .trim(),
    escHtml: (s) => String(s),
    getSlotColor: () => 'var(--text)',
    getSeasonLootItems: () => [],
    fetchTeamItemPreferences: () => Promise.resolve([]),
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(CONFLICTS_JS, sandbox, { filename: 'tab-conflicts.js' });
  return sandbox;
}

describe('buildContestedItemMap (wishlist + officer BiS merge)', () => {
  it('picks up a raider whose only BiS source is their own wishlist tag', () => {
    const roster = [{ id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const teamItemPreferences = [{ player_id: 1, item_id: 1, status: 'bis' }];
    const sandbox = makeSandbox({ roster, teamItemPreferences });

    expect(sandbox.buildContestedItemMap()).toEqual({ 'Item A': ['Kat'] });
  });

  it('picks up a raider whose only BiS source is the officer bis_items grid', () => {
    const roster = [{ id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const bisList = { Kat: [{ item: 'Item A', slot: '' }] };
    const sandbox = makeSandbox({ roster, bisList, teamItemPreferences: [] });

    expect(sandbox.buildContestedItemMap()).toEqual({ 'Item A': ['Kat'] });
  });

  it('combines both sources across the roster without duplicating a player on the same item', () => {
    const roster = [
      { id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' },
      { id: 2, firstName: 'Snarge', nameRealm: 'Snarge-Illidan' }
    ];
    const bisList = { Snarge: [{ item: 'Item A', slot: '' }] };
    const teamItemPreferences = [{ player_id: 1, item_id: 1, status: 'bis' }];
    const sandbox = makeSandbox({ roster, bisList, teamItemPreferences });

    expect(sandbox.buildContestedItemMap()).toEqual({ 'Item A': ['Kat', 'Snarge'] });
  });

  it('excludes Other Sources placeholders (M+/Crafted/Catalyst)', () => {
    const roster = [{ id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const bisList = { Kat: [{ item: 'M+', slot: 'Head' }] };
    const sandbox = makeSandbox({ roster, bisList, teamItemPreferences: [] });

    expect(sandbox.buildContestedItemMap()).toEqual({});
  });
});

// 6 players is the minimum to count as "contested" (CONTESTED_ITEMS_MIN_PLAYERS)
// -- below that, wanting the same item isn't rare enough to matter. These
// helpers build a roster/prefs set where every player tags a given item_id
// BiS, so tests can dial the contesting count up/down past that threshold.
function makeRoster(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    firstName: 'Player' + (i + 1),
    nameRealm: 'Player' + (i + 1) + '-Illidan'
  }));
}
function makePrefsForItem(roster, itemId) {
  return roster.map((p) => ({ player_id: p.id, item_id: itemId, status: 'bis' }));
}

describe('buildConflicts', () => {
  it('only lists items wanted by 6+ players, not a handful of players', () => {
    const roster = makeRoster(7);
    // Item A: only the first 5 players (below threshold). Item B: all 7.
    const teamItemPreferences = makePrefsForItem(roster.slice(0, 5), 1).concat(makePrefsForItem(roster, 2));
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ roster, teamItemPreferences });
    sandbox.document.getElementById = (id) => (id === 'conflictsContent' ? el : null);

    sandbox.buildConflicts();

    expect(el.innerHTML).toContain('Item B');
    expect(el.innerHTML).not.toContain('Item A');
  });

  it('renders items collapsed by default with no player names visible', () => {
    const roster = makeRoster(6);
    const teamItemPreferences = makePrefsForItem(roster, 1);
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ roster, teamItemPreferences });
    sandbox.document.getElementById = (id) => (id === 'conflictsContent' ? el : null);

    sandbox.buildConflicts();

    expect(el.innerHTML).toContain('Item A');
    expect(el.innerHTML).toContain('6 players');
    expect(el.innerHTML).not.toContain('conflict-player-tag');
    expect(el.innerHTML).not.toContain('Player1<');
  });

  it('toggleContestedItem expands the item to reveal its contesting players', () => {
    const roster = makeRoster(6);
    const teamItemPreferences = makePrefsForItem(roster, 1);
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ roster, teamItemPreferences });
    sandbox.document.getElementById = (id) => (id === 'conflictsContent' ? el : null);

    sandbox.buildConflicts();
    sandbox.toggleContestedItem('Item A');

    expect(el.innerHTML).toContain('conflict-player-tag');
    expect(el.innerHTML).toContain('Player1');
    expect(el.innerHTML).toContain('Player6');
  });

  it('shows a loading state and fetches item_preferences when not yet loaded', async () => {
    const roster = [{ id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ roster, teamItemPreferences: null });
    sandbox.document.getElementById = (id) => (id === 'conflictsContent' ? el : null);
    sandbox.fetchTeamItemPreferences = () => Promise.resolve([]);

    sandbox.buildConflicts();
    expect(el.innerHTML).toContain('Loading');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sandbox._teamItemPreferences).toEqual([]);
  });

  it('shows an empty state when nothing is contested', () => {
    const roster = [{ id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan' }];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ roster, teamItemPreferences: [] });
    sandbox.document.getElementById = (id) => (id === 'conflictsContent' ? el : null);

    sandbox.buildConflicts();

    expect(el.innerHTML).toContain('No contested items');
  });
});
