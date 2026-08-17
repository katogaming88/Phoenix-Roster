import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The officer "Suggest Order" button (prioEditGenerate()) calls
// generate_priority_order and shows its raw ranked order as-is. If the
// algorithm's #1 pick already holds rank 1 on some other item/difficulty's
// saved priority order, an officer had no way to avoid stacking a second #1
// on the same person short of manually reordering. A re-click now promotes
// the next eligible (no existing #1 elsewhere) candidate into the #1 slot
// instead -- but only on a re-click, so the first suggestion still always
// shows the algorithm's true top pick.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeEl() {
  return { disabled: false, textContent: '', style: {}, innerHTML: '' };
}

function makeSandbox({ roster, rows, priorityOrder }) {
  var supabaseClient = {
    rpc() {
      return Promise.resolve({ data: rows, error: null });
    }
  };
  var els = {
    prioEditGenBtn: makeEl(),
    prioEditStatus: makeEl(),
    prioEditList: makeEl(),
    prioEditCount: makeEl(),
    prioEditPool: makeEl()
  };

  var sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    window: {},
    DATA: { itemIds: { 'Test Item': 42 }, roster, priorityOrder },
    normalise: (str) =>
      String(str || '')
        .toLowerCase()
        .trim(),
    resolveSeasonViewCode: () => 'S1',
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  // Real render functions need a lot more DOM than this test cares about --
  // prioEditGenerate()'s own behavior (ranked/scores/suggestedOnce) is what's
  // under test, not the rendering it triggers afterward.
  sandbox.prioEditRenderList = function () {};
  sandbox.prioEditRenderPool = function () {};
  sandbox.PRIO_EDIT.item = 'Test Item';
  sandbox.PRIO_EDIT.difficulty = 'Heroic';
  return { sandbox, els };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('prioEditGenerate avoid-double-#1 re-suggest', () => {
  const roster = [
    { id: 1, nameRealm: 'Alpha-Realm' },
    { id: 2, nameRealm: 'Bravo-Realm' },
    { id: 3, nameRealm: 'Charlie-Realm' }
  ];
  const rows = [
    { player_id: 1, weighted_total: 30 },
    { player_id: 2, weighted_total: 20 },
    { player_id: 3, weighted_total: 10 }
  ];
  // Alpha already holds rank 1 on a different item's Heroic priority order.
  const priorityOrder = { 'Other Item': { heroic: ['Alpha-Realm'] } };

  it('first suggestion shows the raw #1 pick even if they already hold a #1 elsewhere', async () => {
    const { sandbox } = makeSandbox({ roster, rows, priorityOrder });

    sandbox.prioEditGenerate();
    await flush();

    expect(sandbox.PRIO_EDIT.ranked[0]).toBe('Alpha-Realm');
    expect(sandbox.PRIO_EDIT.suggestedOnce).toBe(true);
  });

  it('a re-click promotes the next eligible candidate to #1 instead', async () => {
    const { sandbox, els } = makeSandbox({ roster, rows, priorityOrder });

    sandbox.prioEditGenerate();
    await flush();
    sandbox.prioEditGenerate();
    await flush();

    expect(sandbox.PRIO_EDIT.ranked[0]).toBe('Bravo-Realm');
    expect(sandbox.PRIO_EDIT.ranked).toEqual(['Bravo-Realm', 'Alpha-Realm', 'Charlie-Realm']);
    expect(els.prioEditStatus.textContent).toContain('Bravo-Realm');
    expect(els.prioEditStatus.textContent).toContain('promoted');
  });

  it('leaves the order alone once the top pick is already conflict-free', async () => {
    const cleanRows = [
      { player_id: 2, weighted_total: 30 },
      { player_id: 1, weighted_total: 20 },
      { player_id: 3, weighted_total: 10 }
    ];
    const { sandbox } = makeSandbox({ roster, rows: cleanRows, priorityOrder });

    sandbox.prioEditGenerate();
    await flush();
    sandbox.prioEditGenerate();
    await flush();

    expect(sandbox.PRIO_EDIT.ranked).toEqual(['Bravo-Realm', 'Alpha-Realm', 'Charlie-Realm']);
  });

  it('does not touch the ranking when nobody has a #1 conflict', async () => {
    const { sandbox } = makeSandbox({ roster, rows, priorityOrder: {} });

    sandbox.prioEditGenerate();
    await flush();
    sandbox.prioEditGenerate();
    await flush();

    expect(sandbox.PRIO_EDIT.ranked).toEqual(['Alpha-Realm', 'Bravo-Realm', 'Charlie-Realm']);
  });
});

describe('prioEditGenerate re-suggest when everyone already has a #1', () => {
  const roster = [
    { id: 1, nameRealm: 'Alpha-Realm' },
    { id: 2, nameRealm: 'Bravo-Realm' },
    { id: 3, nameRealm: 'Charlie-Realm' }
  ];
  const rows = [
    { player_id: 1, weighted_total: 30 },
    { player_id: 2, weighted_total: 20 },
    { player_id: 3, weighted_total: 10 }
  ];
  // Alpha holds 3 #1s, Bravo holds 1, Charlie holds 2 -- nobody is at zero,
  // so a re-click should fall back to whoever has the fewest (Bravo).
  const priorityOrder = {
    'Item A': { heroic: ['Alpha-Realm'] },
    'Item B': { heroic: ['Alpha-Realm'] },
    'Item C': { mythic: ['Alpha-Realm'] },
    'Item D': { heroic: ['Bravo-Realm'] },
    'Item E': { heroic: ['Charlie-Realm'] },
    'Item F': { mythic: ['Charlie-Realm'] }
  };

  it('promotes whoever has the fewest #1s elsewhere, not just anyone without one', async () => {
    const { sandbox, els } = makeSandbox({ roster, rows, priorityOrder });

    sandbox.prioEditGenerate();
    await flush();
    sandbox.prioEditGenerate();
    await flush();

    expect(sandbox.PRIO_EDIT.ranked).toEqual(['Bravo-Realm', 'Alpha-Realm', 'Charlie-Realm']);
    expect(els.prioEditStatus.textContent).toContain('Bravo-Realm');
    expect(els.prioEditStatus.textContent).toContain('fewest');
  });

  it('stops re-promoting once the top pick already has the fewest', async () => {
    const bravoTopRows = [
      { player_id: 2, weighted_total: 30 },
      { player_id: 1, weighted_total: 20 },
      { player_id: 3, weighted_total: 10 }
    ];
    const { sandbox } = makeSandbox({ roster, rows: bravoTopRows, priorityOrder });

    sandbox.prioEditGenerate();
    await flush();
    sandbox.prioEditGenerate();
    await flush();

    // Bravo (1 #1 elsewhere) is already the fewest among the three --
    // nobody else beats that, so no swap happens.
    expect(sandbox.PRIO_EDIT.ranked).toEqual(['Bravo-Realm', 'Alpha-Realm', 'Charlie-Realm']);
  });
});
