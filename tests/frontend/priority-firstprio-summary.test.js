import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Priority List sub-tab's "conflicts" banner used to flag every player
// holding 2+ #1 priorities team-wide as an outlier -- once a raid has 30+
// managed items that's nearly the whole roster, making the flag useless
// noise. getPriorityListConflicts() no longer includes that (duplicateGroups
// removed); it's replaced by getPriorityFirstPrioSummary(), an always-visible
// full-roster table instead of an outlier list. Same-boss #1 stacking (a
// real same-kill scheduling conflict) stays in both: as its own banner entry
// in getPriorityListConflicts(), and as a per-row flag in the summary table.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox({ priorityLiveFirstPrios = [], priorityStaleAfterHeroic = [], priorityDrift = [] } = {}) {
  const sandbox = {
    console,
    window: {},
    document: { getElementById: () => null },
    DATA: {
      priorityLiveFirstPrios,
      priorityStaleAfterHeroic,
      priorityDrift,
      itemSlots: {},
      itemIds: {},
      roster: []
    },
    _teamCfg: { supabaseTeamId: 1 },
    featureEnabled: () => true,
    escHtml: (s) => String(s),
    normalise: (s) =>
      String(s || '')
        .toLowerCase()
        .trim(),
    getBisItems: () => [],
    supabaseClient: null,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  return sandbox;
}

describe('getPriorityListConflicts (no longer flags plain #1-count holders)', () => {
  it('does not flag a player holding several #1s across unrelated bosses', () => {
    const rows = [
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item A', track: 'Hero', boss: 'Boss 1' },
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item B', track: 'Hero', boss: 'Boss 2' },
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item C', track: 'Hero', boss: 'Boss 3' }
    ];
    const sandbox = makeSandbox({ priorityLiveFirstPrios: rows });
    const conflicts = sandbox.getPriorityListConflicts();
    expect(conflicts.count).toBe(0);
    expect(conflicts.sameBossGroups).toEqual([]);
    expect(conflicts).not.toHaveProperty('duplicateGroups');
  });

  it('still flags two #1s dropping from the same boss+track as a real conflict', () => {
    const rows = [
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item A', track: 'Hero', boss: 'Boss 1' },
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item B', track: 'Hero', boss: 'Boss 1' }
    ];
    const sandbox = makeSandbox({ priorityLiveFirstPrios: rows });
    const conflicts = sandbox.getPriorityListConflicts();
    expect(conflicts.count).toBe(1);
    expect(conflicts.sameBossGroups).toEqual([
      { nameRealm: 'Alpha-Realm', boss: 'Boss 1', itemNames: ['Item A', 'Item B'] }
    ]);
  });

  it('does not flag the same boss on different difficulty tracks', () => {
    const rows = [
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item A', track: 'Hero', boss: 'Boss 1' },
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item B', track: 'Myth', boss: 'Boss 1' }
    ];
    const sandbox = makeSandbox({ priorityLiveFirstPrios: rows });
    expect(sandbox.getPriorityListConflicts().sameBossGroups).toEqual([]);
  });

  it('still surfaces stale-after-heroic entries', () => {
    const stale = [{ name_realm: 'Alpha-Realm', item_name: 'Item A' }];
    const sandbox = makeSandbox({ priorityStaleAfterHeroic: stale });
    const conflicts = sandbox.getPriorityListConflicts();
    expect(conflicts.count).toBe(1);
    expect(conflicts.staleEntries).toEqual(stale);
    expect(conflicts).not.toHaveProperty('driftEntries');
  });
});

// Drift moved out of getPriorityListConflicts() into its own section (its
// own collapsible banner, see buildPriorityDriftBannerHtml()) rather than a
// third entry type mixed into the stale/same-boss conflicts list.
describe('getPriorityDriftInfo', () => {
  it('reports the drift count and entries from DATA.priorityDrift', () => {
    const drift = [{ item_name: 'Item B', track: 'Hero', saved_top3: ['Alpha'], current_top3: ['Bravo'] }];
    const sandbox = makeSandbox({ priorityDrift: drift });
    expect(sandbox.getPriorityDriftInfo()).toEqual({ count: 1, entries: drift });
  });

  it('reports zero when there is no drift', () => {
    const sandbox = makeSandbox();
    expect(sandbox.getPriorityDriftInfo()).toEqual({ count: 0, entries: [] });
  });
});

describe('getPriorityFirstPrioSummary (full-roster #1 count table)', () => {
  it('returns every player holding at least one #1, sorted by count descending', () => {
    const rows = [
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item A', track: 'Hero', boss: 'Boss 1' },
      { player_id: 2, name_realm: 'Bravo-Realm', item_name: 'Item B', track: 'Hero', boss: 'Boss 2' },
      { player_id: 2, name_realm: 'Bravo-Realm', item_name: 'Item C', track: 'Hero', boss: 'Boss 3' },
      { player_id: 2, name_realm: 'Bravo-Realm', item_name: 'Item D', track: 'Hero', boss: 'Boss 4' }
    ];
    const sandbox = makeSandbox({ priorityLiveFirstPrios: rows });
    const summary = sandbox.getPriorityFirstPrioSummary();
    expect(summary).toEqual([
      { nameRealm: 'Bravo-Realm', count: 3, sameBossGroups: [] },
      { nameRealm: 'Alpha-Realm', count: 1, sameBossGroups: [] }
    ]);
  });

  it('flags same-boss stacking on a player row without excluding them', () => {
    const rows = [
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item A', track: 'Hero', boss: 'Boss 1' },
      { player_id: 1, name_realm: 'Alpha-Realm', item_name: 'Item B', track: 'Hero', boss: 'Boss 1' }
    ];
    const sandbox = makeSandbox({ priorityLiveFirstPrios: rows });
    const summary = sandbox.getPriorityFirstPrioSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(2);
    expect(summary[0].sameBossGroups).toEqual([{ boss: 'Boss 1', itemNames: ['Item A', 'Item B'] }]);
  });

  it('returns an empty array when nobody holds a #1', () => {
    const sandbox = makeSandbox({ priorityLiveFirstPrios: [] });
    expect(sandbox.getPriorityFirstPrioSummary()).toEqual([]);
  });
});

describe('buildPriorityFirstPrioSummaryHtml', () => {
  it('renders a row per player with their count and a same-boss badge when applicable, when expanded', () => {
    const sandbox = makeSandbox();
    const rows = [
      { nameRealm: 'Alpha-Realm', count: 3, sameBossGroups: [{ boss: 'Boss 1', itemNames: ['Item A', 'Item B'] }] },
      { nameRealm: 'Bravo-Realm', count: 1, sameBossGroups: [] }
    ];
    const html = sandbox.buildPriorityFirstPrioSummaryHtml(rows, true);
    expect(html).toContain('Alpha-Realm');
    expect(html).toContain('3 #1s');
    expect(html).toContain('Bravo-Realm');
    expect(html).toContain('1 #1<');
    expect(html).toContain('Same boss: Boss 1');
  });

  it('starts collapsed by default, hiding the per-player rows behind a summary line', () => {
    const sandbox = makeSandbox();
    const rows = [
      { nameRealm: 'Alpha-Realm', count: 4, sameBossGroups: [{ boss: 'Boss 1', itemNames: ['Item A', 'Item B'] }] },
      { nameRealm: 'Bravo-Realm', count: 1, sameBossGroups: [] }
    ];
    const html = sandbox.buildPriorityFirstPrioSummaryHtml(rows, false);
    expect(html).not.toContain('Alpha-Realm');
    expect(html).not.toContain('prio-firstprio-row');
    expect(html).toContain('#1 Priorities Held (2 players)');
    expect(html).toContain('1 at 4+');
    expect(html).toContain('1 same-boss');
  });

  it('renders nothing when there are no rows', () => {
    const sandbox = makeSandbox();
    expect(sandbox.buildPriorityFirstPrioSummaryHtml([], true)).toBe('');
  });

  it('flags a row at the threshold (4) with the highlighted count class', () => {
    const sandbox = makeSandbox();
    const html = sandbox.buildPriorityFirstPrioSummaryHtml(
      [{ nameRealm: 'Alpha-Realm', count: 4, sameBossGroups: [] }],
      true
    );
    expect(html).toContain('prio-firstprio-count-flagged');
  });

  it('does not flag a row just below the threshold', () => {
    const sandbox = makeSandbox();
    const html = sandbox.buildPriorityFirstPrioSummaryHtml(
      [{ nameRealm: 'Alpha-Realm', count: 3, sameBossGroups: [] }],
      true
    );
    expect(html).not.toContain('prio-firstprio-count-flagged');
  });
});
