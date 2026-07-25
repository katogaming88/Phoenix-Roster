import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #529: prioEditSave() used to resolve PRIO_EDIT.ranked entries to player_id
// via a rosterMap keyed by normalise(firstName). Two roster characters
// sharing a first name silently collided there (the second overwrites the
// first in the map build), so ranking "the other twin" for an item could
// resolve to and save the wrong player's player_id. PRIO_EDIT.ranked now
// carries full name_realm identity and rosterMap is keyed the same way, so
// this can no longer happen.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeEl() {
  return { disabled: false, textContent: '', style: {} };
}

function makeSandbox({ roster, ranked, itemIds }) {
  var rpcCalls = [];
  var supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    }
  };
  var els = {
    prioEditSaveBtn: makeEl(),
    prioEditStatus: makeEl(),
    prioEditError: makeEl(),
    priorityContent: makeEl(),
    unmanagedContent: makeEl(),
    prioNavBadge: makeEl(),
    prioSubBadge: makeEl(),
    prioListBadge: makeEl(),
    priorityConflictsBanner: makeEl(),
    prioEditModal: { classList: { remove: () => {}, add: () => {} } }
  };

  var sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    window: { DATA: { seasonName: 'Season 1' } },
    DATA: { seasonName: 'Season 1', itemIds, roster, itemSlots: {}, itemBosses: {} },
    seasonCodeForDisplay: (name) => (name === 'Season 1' ? 'S1' : name),
    resolveSeasonViewCode: () => 'S1',
    normalise: (str) =>
      String(str || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim(),
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox.PRIO_EDIT.item = 'Signet of the Starved Beast';
  sandbox.PRIO_EDIT.difficulty = 'Heroic';
  sandbox.PRIO_EDIT.ranked = ranked;
  return { sandbox, rpcCalls, els };
}

describe('prioEditSave twin resolution (#529)', () => {
  it('resolves each ranked identity to its own distinct player_id, not the last twin seen', () => {
    const roster = [
      { id: 101, firstName: 'Katorri', nameRealm: 'Katorri-Stormrage' },
      { id: 202, firstName: 'Katorri', nameRealm: 'Katorri-Illidan' }
    ];
    const itemIds = { 'Signet of the Starved Beast': 5 };
    const { sandbox, rpcCalls } = makeSandbox({
      roster,
      ranked: ['Katorri-Illidan', 'Katorri-Stormrage'],
      itemIds
    });

    sandbox.prioEditSave();

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('save_priority_order');
    // Order matters (it's the rank), and each entry must map to its own
    // player -- not both collapsing to whichever roster row was inserted
    // into rosterMap last.
    expect(rpcCalls[0].params.p_player_ids).toEqual([202, 101]);
  });

  it('still resolves a single unambiguous player correctly', () => {
    const roster = [{ id: 11, firstName: 'Snarge', nameRealm: 'Snarge-Illidan' }];
    const itemIds = { 'Signet of the Starved Beast': 5 };
    const { sandbox, rpcCalls } = makeSandbox({ roster, ranked: ['Snarge-Illidan'], itemIds });

    sandbox.prioEditSave();

    expect(rpcCalls[0].params.p_player_ids).toEqual([11]);
  });

  it('errors out (rather than silently misattributing) when an identity matches no roster player', () => {
    const roster = [{ id: 11, firstName: 'Snarge', nameRealm: 'Snarge-Illidan' }];
    const itemIds = { 'Signet of the Starved Beast': 5 };
    const { sandbox, rpcCalls, els } = makeSandbox({ roster, ranked: ['Ghost-Illidan'], itemIds });

    sandbox.prioEditSave();

    expect(rpcCalls).toHaveLength(0);
    expect(els.prioEditError.textContent).toContain('Ghost-Illidan');
    expect(els.prioEditError.style.display).toBe('');
  });
});
