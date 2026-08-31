import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// prioEditFetchFairnessWarnings() builds the Priority Edit modal's per-row
// warning icon ("Already #1 on X from this boss" / "Holds N other #1
// priorities"). Its sameBossItems half was already scoped to the track
// currently being edited (r.track === track), but otherItems counted every
// row from priority_order_live_first_prios regardless of track -- so a
// player whose only other #1 was on the OTHER difficulty still showed the
// "Holds N other #1 priorities" warning while editing Heroic (or vice
// versa). Hero and Myth are separate priority lists on purpose, the same
// scoping already settled for prioEditFirstPriorityCounts() (#838) and
// avg_existing_rank (20260831122259, #839) -- this closes the same gap here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox({ roster, rows, item, difficulty, itemBosses }) {
  var supabaseClient = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        then(cb) {
          return Promise.resolve({ data: rows, error: null }).then(cb);
        }
      };
    }
  };

  var sandbox = {
    console,
    document: { getElementById: () => null },
    window: {},
    DATA: {
      itemIds: { 'Test Item': 42, 'Other Item A': 1, 'Other Item B': 2 },
      itemBosses: itemBosses || {},
      roster
    },
    resolveSeasonViewCode: () => 'S1',
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox.prioEditRenderList = function () {};
  sandbox.PRIO_EDIT.item = item;
  sandbox.PRIO_EDIT.difficulty = difficulty;
  return sandbox;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('prioEditFetchFairnessWarnings track scoping', () => {
  const roster = [{ id: 1, nameRealm: 'Alpha-Realm' }];

  it('does not warn about a #1 held on a different track', async () => {
    var rows = [{ player_id: 1, item_id: 1, item_name: 'Other Item A', track: 'Myth', boss: '' }];
    var sandbox = makeSandbox({ roster, rows, item: 'Test Item', difficulty: 'Heroic' });

    sandbox.prioEditFetchFairnessWarnings();
    await flush();

    expect(sandbox.PRIO_EDIT.fairnessWarnings['Alpha-Realm']).toBeUndefined();
  });

  it('still warns about a #1 held on the same track', async () => {
    var rows = [{ player_id: 1, item_id: 1, item_name: 'Other Item A', track: 'Hero', boss: '' }];
    var sandbox = makeSandbox({ roster, rows, item: 'Test Item', difficulty: 'Heroic' });

    sandbox.prioEditFetchFairnessWarnings();
    await flush();

    expect(Object.keys(sandbox.PRIO_EDIT.fairnessWarnings['Alpha-Realm'].otherItems)).toEqual(['Other Item A']);
  });

  it('a mixed-track set only counts the currently-edited track', async () => {
    var rows = [
      { player_id: 1, item_id: 1, item_name: 'Other Item A', track: 'Hero', boss: '' },
      { player_id: 1, item_id: 2, item_name: 'Other Item B', track: 'Myth', boss: '' }
    ];
    var heroic = makeSandbox({ roster, rows, item: 'Test Item', difficulty: 'Heroic' });
    heroic.prioEditFetchFairnessWarnings();
    await flush();
    expect(Object.keys(heroic.PRIO_EDIT.fairnessWarnings['Alpha-Realm'].otherItems)).toEqual(['Other Item A']);

    var mythic = makeSandbox({ roster, rows, item: 'Test Item', difficulty: 'Mythic' });
    mythic.prioEditFetchFairnessWarnings();
    await flush();
    expect(Object.keys(mythic.PRIO_EDIT.fairnessWarnings['Alpha-Realm'].otherItems)).toEqual(['Other Item B']);
  });

  it('same-boss detection stays scoped to the current track too', async () => {
    var itemBosses = { 'Test Item': 'Some Boss', 'Other Item A': 'Some Boss' };
    var rows = [{ player_id: 1, item_id: 1, item_name: 'Other Item A', track: 'Myth', boss: 'Some Boss' }];
    var sandbox = makeSandbox({ roster, rows, item: 'Test Item', difficulty: 'Heroic', itemBosses: itemBosses });

    sandbox.prioEditFetchFairnessWarnings();
    await flush();

    // Myth same-boss row must not leak into a Heroic edit's warnings at all.
    expect(sandbox.PRIO_EDIT.fairnessWarnings['Alpha-Realm']).toBeUndefined();
  });
});
