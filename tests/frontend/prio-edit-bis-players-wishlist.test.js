import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A raider who just filled out their wishlist had no bis_items row yet, so
// the priority-edit modal's "BiS Players" pool -- sourced only from
// DATA.bisList -- never surfaced them. An officer wanting to hand-add a
// brand-new team member to the bottom of an existing priority order without
// regenerating the whole list via "Suggest Order" had to fall back to "Show
// all roster" and hunt them down in the full roster instead.
// prioEditGetBisPlayers() now also includes anyone with a wishlist status of
// 'bis', 'good', or 'ok' for the item -- genuine interest in winning it off
// the priority list -- but not 'catalyst' (wants it only via the Catalyst)
// or 'pass' (explicitly doesn't want it).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox({ roster, bisList, teamItemPreferences, itemIds }) {
  var sandbox = {
    console,
    document: { getElementById: () => null },
    window: {},
    DATA: { itemIds: itemIds, roster: roster, bisList: bisList || {} },
    normalise: (str) =>
      String(str || '')
        .toLowerCase()
        .trim(),
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox._teamItemPreferences = teamItemPreferences;
  return sandbox;
}

describe('prioEditGetBisPlayers wishlist inclusion', () => {
  const roster = [
    { id: 1, nameRealm: 'Alpha-Realm' },
    { id: 2, nameRealm: 'Bravo-Realm' },
    { id: 3, nameRealm: 'Charlie-Realm' }
  ];
  const itemIds = { 'Test Item': 42 };

  it('includes a player whose only signal is a wishlist bis tag', () => {
    const sandbox = makeSandbox({
      roster,
      itemIds,
      bisList: { 'Alpha-Realm': [{ item: 'Test Item' }] },
      teamItemPreferences: [{ player_id: 2, item_id: 42, status: 'bis' }]
    });
    sandbox.PRIO_EDIT.item = 'Test Item';

    const result = sandbox.prioEditGetBisPlayers();

    expect(result).toContain('Alpha-Realm');
    expect(result).toContain('Bravo-Realm');
  });

  it('does not duplicate a player already present via bis_items', () => {
    const sandbox = makeSandbox({
      roster,
      itemIds,
      bisList: { 'Alpha-Realm': [{ item: 'Test Item' }] },
      teamItemPreferences: [{ player_id: 1, item_id: 42, status: 'bis' }]
    });
    sandbox.PRIO_EDIT.item = 'Test Item';

    const result = sandbox.prioEditGetBisPlayers().filter((n) => n === 'Alpha-Realm');

    expect(result).toHaveLength(1);
  });

  it('includes good and ok wishlist tiers alongside bis', () => {
    const sandbox = makeSandbox({
      roster,
      itemIds,
      bisList: {},
      teamItemPreferences: [
        { player_id: 1, item_id: 42, status: 'bis' },
        { player_id: 2, item_id: 42, status: 'good' },
        { player_id: 3, item_id: 42, status: 'ok' }
      ]
    });
    sandbox.PRIO_EDIT.item = 'Test Item';

    const result = sandbox.prioEditGetBisPlayers();

    expect(result).toEqual(expect.arrayContaining(['Alpha-Realm', 'Bravo-Realm', 'Charlie-Realm']));
    expect(result).toHaveLength(3);
  });

  it('excludes catalyst and pass wishlist tiers, and other items', () => {
    const sandbox = makeSandbox({
      roster,
      itemIds,
      bisList: {},
      teamItemPreferences: [
        { player_id: 1, item_id: 42, status: 'catalyst' },
        { player_id: 2, item_id: 42, status: 'pass' },
        { player_id: 3, item_id: 99, status: 'bis' }
      ]
    });
    sandbox.PRIO_EDIT.item = 'Test Item';

    const result = sandbox.prioEditGetBisPlayers();

    expect(result).toEqual([]);
  });

  it('is a no-op when wishlist prefs have not loaded yet', () => {
    const sandbox = makeSandbox({
      roster,
      itemIds,
      bisList: { 'Alpha-Realm': [{ item: 'Test Item' }] },
      teamItemPreferences: null
    });
    sandbox.PRIO_EDIT.item = 'Test Item';

    const result = sandbox.prioEditGetBisPlayers();

    expect(result).toEqual(['Alpha-Realm']);
  });
});
