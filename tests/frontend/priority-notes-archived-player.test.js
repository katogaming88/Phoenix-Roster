import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// item_preferences has no archived-player cleanup (unlike priority_order,
// #824's add_signup_to_roster() fix) -- a departed player's wishlist notes
// just sit there forever. buildPriorityNotesTab()/updatePriorityNotesBadge()
// (Priority > Notes sub-tab) used to still render/count them, falling back
// to "Player #<id>" since rosterById (built from the active-roster-only
// DATA.roster) had no entry for them. Both now skip any player_id missing
// from the roster.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox({ itemSlots = {}, itemIds = {}, itemPlaceholders = {}, roster = [], prefs = [] } = {}) {
  const sandbox = {
    console,
    document: { getElementById: () => null },
    DATA: { itemSlots, itemIds, itemPlaceholders, roster },
    escHtml: (s) => String(s),
    itemNameBlockHtml: (name) => '<span>' + name + '</span>',
    classBadgeStyle: () => '',
    normalise: (s) => String(s || '').toLowerCase(),
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox._teamItemPreferences = prefs;
  return sandbox;
}

describe('buildPriorityNotesTab: archived players', () => {
  it("omits a note from a player who is no longer on the roster (not just falls back to 'Player #id')", () => {
    const itemSlots = { 'Seed Test Staff': 'Two-Hand' };
    const itemIds = { 'Seed Test Staff': 1 };
    // Player 5 was on the roster when they wrote this note; they've since
    // been archived (removed or main-swapped), so DATA.roster no longer has
    // an entry for id 5.
    const roster = [{ id: 9, firstName: 'Fxhp', nameRealm: 'Fxhp-Area 52' }];
    const prefs = [{ player_id: 5, item_id: 1, status: 'bis', slot: null, note: 'leftover note from departed raider' }];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefs });
    sandbox.document.getElementById = (id) => (id === 'priorityNotesContent' ? el : null);

    sandbox.buildPriorityNotesTab();

    expect(el.innerHTML).not.toContain('leftover note from departed raider');
    expect(el.innerHTML).not.toContain('Player #5');
    expect(el.innerHTML).toContain('No wishlist notes yet');
  });

  it('still shows an active roster player alongside an archived one on the same item', () => {
    const itemSlots = { 'Seed Test Staff': 'Two-Hand' };
    const itemIds = { 'Seed Test Staff': 1 };
    const roster = [{ id: 9, firstName: 'Fxhp', nameRealm: 'Fxhp-Area 52' }];
    const prefs = [
      { player_id: 5, item_id: 1, status: 'bis', slot: null, note: 'archived player note' },
      { player_id: 9, item_id: 1, status: 'good', slot: null, note: 'active player note' }
    ];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefs });
    sandbox.document.getElementById = (id) => (id === 'priorityNotesContent' ? el : null);

    sandbox.buildPriorityNotesTab();

    expect(el.innerHTML).not.toContain('archived player note');
    expect(el.innerHTML).toContain('active player note');
    expect(el.innerHTML).toContain('Fxhp');
  });
});

describe('updatePriorityNotesBadge: archived players', () => {
  it("doesn't count a note from a player no longer on the roster", () => {
    const itemIds = { 'Seed Test Staff': 1 };
    const roster = [{ id: 9, firstName: 'Fxhp', nameRealm: 'Fxhp-Area 52' }];
    const prefs = [{ player_id: 5, item_id: 1, status: 'bis', slot: null, note: 'leftover note' }];
    const badge = { textContent: '', style: { display: '' } };
    const sandbox = makeSandbox({ itemIds, roster, prefs });
    sandbox.document.getElementById = (id) => (id === 'prioNotesBadge' ? badge : null);

    sandbox.updatePriorityNotesBadge();

    expect(badge.textContent).toBe(0);
    expect(badge.style.display).toBe('none');
  });
});
