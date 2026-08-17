import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The read-only Priority List sub-tab (buildPriorityTab()'s renderItem())
// showed each ranked player's name/role but nothing about what they
// actually tagged their wishlist as for that item -- an officer had to
// leave the tab and check the raider's wishlist separately to see whether a
// #1 pick was a real BiS tag, a sidegrade, or untagged entirely.
// _prioBestWishlistStatus() looks up the best (BiS-first) status across
// however many item_preferences rows a player has for that item_id
// (Finger 1/2, Trinket 1/2, Weapon/Off Hand all write separate rows for the
// same item).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox(teamItemPreferences) {
  const sandbox = {
    console,
    window: {},
    document: { getElementById: () => null },
    DATA: {},
    _teamCfg: { supabaseTeamId: 1 },
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox._teamItemPreferences = teamItemPreferences;
  return sandbox;
}

describe('_prioBestWishlistStatus', () => {
  it('returns null when the player never tagged this item at all', () => {
    const sandbox = makeSandbox([{ player_id: 1, item_id: 99, status: 'bis' }]);
    expect(sandbox._prioBestWishlistStatus(42, 1)).toBeNull();
  });

  it('returns the single tagged status for that item/player', () => {
    const sandbox = makeSandbox([{ player_id: 1, item_id: 42, status: 'good' }]);
    expect(sandbox._prioBestWishlistStatus(42, 1)).toBe('good');
  });

  it('picks the best (BiS-first) status across multiple rows for the same item (e.g. Finger 1/2)', () => {
    const sandbox = makeSandbox([
      { player_id: 1, item_id: 42, status: 'ok', slot: 'Finger 1' },
      { player_id: 1, item_id: 42, status: 'bis', slot: 'Finger 2' }
    ]);
    expect(sandbox._prioBestWishlistStatus(42, 1)).toBe('bis');
  });

  it('does not mix up two different players tagging the same item', () => {
    const sandbox = makeSandbox([
      { player_id: 1, item_id: 42, status: 'pass' },
      { player_id: 2, item_id: 42, status: 'bis' }
    ]);
    expect(sandbox._prioBestWishlistStatus(42, 1)).toBe('pass');
    expect(sandbox._prioBestWishlistStatus(42, 2)).toBe('bis');
  });

  it('returns null when _teamItemPreferences has not loaded yet', () => {
    const sandbox = makeSandbox(null);
    expect(sandbox._prioBestWishlistStatus(42, 1)).toBeNull();
  });
});
