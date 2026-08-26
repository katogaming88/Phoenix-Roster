import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Officer corrections for self-received decisions (#756): the Requests tab
// gains a "Recent decisions" section listing approved and rejected rows with
// per-row Revert-to-pending (plain UPDATE through the existing officer
// policy) and Delete (the delete_self_received_request RPC, which writes its
// own audit entry server-side). Also pins the in-passing fix that
// approveRequest()/rejectRequest() stop writing a null audit detail. Same vm
// sandbox pattern as tests/frontend/audit-log-tab.test.js; RLS and the RPC
// itself are covered by tests/rls/self-received-corrections.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAB_REQUESTS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-requests.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

// Routes .from(table) chains (select/eq/in/order/update) to per-test
// resolvers and captures .rpc(name, args) calls, keyed by function name.
function makeClient({ tables = {}, rpc = {} } = {}) {
  const captured = { byTable: {}, rpcCalls: [] };
  function builder(table, resolve) {
    const calls = { select: null, update: null, eq: [], in: [], order: [] };
    const b = {
      select(c) {
        calls.select = c;
        return b;
      },
      update(obj) {
        calls.update = obj;
        return b;
      },
      eq(c, v) {
        calls.eq.push([c, v]);
        return b;
      },
      in(c, v) {
        calls.in.push([c, v]);
        return b;
      },
      order(c, opts) {
        calls.order.push([c, opts]);
        return b;
      },
      then(ok, err) {
        return Promise.resolve()
          .then(() => resolve(calls))
          .then(ok, err);
      }
    };
    captured.byTable[table] = captured.byTable[table] || [];
    captured.byTable[table].push(calls);
    return b;
  }
  const client = {
    from(table) {
      return builder(table, (calls) => (tables[table] ? tables[table](calls) : { data: null, error: null }));
    },
    rpc(name, args) {
      captured.rpcCalls.push({ name, args });
      const fn = rpc[name];
      return Promise.resolve(fn ? fn(args) : { data: null, error: null });
    }
  };
  return { client, captured };
}

function makeEl(extra) {
  return Object.assign(
    {
      value: '',
      style: {},
      textContent: '',
      innerHTML: '',
      querySelector: () => null
    },
    extra
  );
}

// A fake decision card the flows look up via
// document.querySelector('.request-card[data-row="<id>"]').
function makeCard(attrs) {
  const revertBtn = { disabled: false, textContent: 'Revert to pending' };
  const deleteBtn = { disabled: false, textContent: 'Delete' };
  revertBtn.nextElementSibling = deleteBtn;
  deleteBtn.previousElementSibling = revertBtn;
  const card = {
    removed: false,
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
    remove() {
      card.removed = true;
    }
  };
  return { card, revertBtn, deleteBtn };
}

function loadSandbox({ client, els = {}, bySelector = {}, confirmResult = true, bisEntries = [] } = {}) {
  const spies = {
    audit: [],
    notify: [],
    badges: 0,
    confirms: []
  };
  const sandbox = {
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    console,
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: (sel) => bySelector[sel] || null
    },
    confirm: (msg) => {
      spies.confirms.push(msg);
      return confirmResult;
    },
    writeAuditLog: (action, targetType, targetId, detail) => {
      spies.audit.push({ action, targetType, targetId, detail });
    },
    notifyPlayer: (playerId, message) => {
      spies.notify.push({ playerId, message });
    },
    updateNavBadges: () => {
      spies.badges += 1;
    },
    findRosterPlayerByNameRealm: (nameRealm) => (nameRealm ? { id: 7, nameRealm } : null),
    getBisItems: () => bisEntries,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(TAB_REQUESTS_JS, sandbox, { filename: 'tab-requests.js' });
  return { sandbox, spies };
}

const APPROVED_ROW = {
  id: 5,
  status: 'approved',
  track: 'Hero',
  source: 'Great Vault',
  note: 'Catalized',
  slot: null,
  submitted_at: '2026-08-26T00:41:36Z',
  player_id: 151,
  self_item_id: 354,
  players: { name_realm: 'Bearsdh-Zul’jin' },
  items: { name: 'Gaze of the Coiled Watcher', slot: 'Head' }
};

const REJECTED_ROW = {
  id: 6,
  status: 'rejected',
  track: 'Champion',
  source: 'Crafted',
  note: '',
  slot: 'Wrist',
  submitted_at: '2026-08-25T00:00:00Z',
  player_id: 152,
  self_item_id: 115,
  players: { name_realm: 'Someraider-Illidan' },
  items: { name: 'Crafted', slot: 'Placeholder' }
};

function decisionTables(rows) {
  return {
    self_received_requests: (calls) => {
      if (calls.in.length) return { data: rows, error: null };
      return { data: [], error: null };
    }
  };
}

describe('buildRequestsTab fetches and renders recent decisions', () => {
  it('issues the decisions query alongside the pending one', async () => {
    const { client, captured } = makeClient({ tables: decisionTables([APPROVED_ROW]) });
    const els = { requestsContainer: makeEl(), requestsDecisions: makeEl() };
    const { sandbox } = loadSandbox({ client, els });
    sandbox.buildRequestsTab();
    await flush();
    const queries = captured.byTable.self_received_requests;
    expect(queries.length).toBe(2);
    const decisions = queries.find((c) => c.in.length);
    expect(decisions.eq).toContainEqual(['team_id', 1]);
    expect(decisions.in).toContainEqual(['status', ['approved', 'rejected']]);
    expect(decisions.order).toContainEqual(['submitted_at', { ascending: false }]);
    for (const col of ['id', 'status', 'track', 'source', 'note', 'slot', 'player_id', 'self_item_id']) {
      expect(decisions.select).toContain(col);
    }
  });

  it('renders decision cards with status labels and real action buttons', async () => {
    const { client } = makeClient({ tables: decisionTables([APPROVED_ROW, REJECTED_ROW]) });
    const els = { requestsContainer: makeEl(), requestsDecisions: makeEl() };
    const { sandbox } = loadSandbox({ client, els });
    sandbox.buildRequestsTab();
    await flush();
    const html = els.requestsDecisions.innerHTML;
    expect(html).toContain('Gaze of the Coiled Watcher');
    expect(html).toContain('Approved');
    expect(html).toContain('Rejected');
    expect(html).toContain('<button');
    expect(html).toContain('Revert to pending');
    expect(html).toContain('Delete');
    expect(html).toContain('data-status="approved"');
  });

  it('renders an empty state when there are no decisions', async () => {
    const { client } = makeClient({ tables: decisionTables([]) });
    const els = { requestsContainer: makeEl(), requestsDecisions: makeEl() };
    const { sandbox } = loadSandbox({ client, els });
    sandbox.buildRequestsTab();
    await flush();
    expect(els.requestsDecisions.innerHTML).toContain('No decisions yet.');
  });
});

describe('deleteRequest', () => {
  function setup({ rpc, confirmResult = true } = {}) {
    const { client, captured } = makeClient({ rpc });
    const { card, revertBtn, deleteBtn } = makeCard({
      'data-row': '5',
      'data-name-realm': 'Bearsdh-Zul’jin',
      'data-item': 'Gaze of the Coiled Watcher',
      'data-player-id': '151',
      'data-status': 'approved'
    });
    const errorEl = makeEl();
    const els = { requestsDecisions: makeEl(), 'decision-error-5': errorEl };
    const bySelector = { '.request-card[data-row="5"]': card };
    const { sandbox, spies } = loadSandbox({ client, els, bySelector, confirmResult });
    return { sandbox, spies, captured, card, revertBtn, deleteBtn, errorEl };
  }

  it('confirms, calls the RPC, and removes the card on success', async () => {
    const { sandbox, spies, captured, card } = setup();
    sandbox.deleteRequest(5, setupBtn(card));
    await flush();
    expect(spies.confirms.length).toBe(1);
    expect(captured.rpcCalls).toContainEqual({ name: 'delete_self_received_request', args: { p_id: 5 } });
    expect(card.removed).toBe(true);
    // The RPC writes the audit entry server-side and delete stays silent.
    expect(spies.audit.length).toBe(0);
    expect(spies.notify.length).toBe(0);
  });

  it('does nothing when the confirm is declined', async () => {
    const { sandbox, captured, card, deleteBtn } = setup({ confirmResult: false });
    sandbox.deleteRequest(5, deleteBtn);
    await flush();
    expect(captured.rpcCalls.length).toBe(0);
    expect(deleteBtn.disabled).toBe(false);
    expect(card.removed).toBe(false);
  });

  it('surfaces an RPC error inline and re-enables the buttons', async () => {
    const { sandbox, spies, card, deleteBtn, revertBtn, errorEl } = setup({
      rpc: {
        delete_self_received_request: () => ({ data: null, error: { message: 'Self-received request not found' } })
      }
    });
    sandbox.deleteRequest(5, deleteBtn);
    await flush();
    expect(errorEl.textContent).toContain('Self-received request not found');
    expect(deleteBtn.disabled).toBe(false);
    expect(revertBtn.disabled).toBe(false);
    expect(card.removed).toBe(false);
    expect(spies.audit.length).toBe(0);
  });
});

// deleteRequest is invoked from the card's own Delete button.
function setupBtn(card) {
  const revertBtn = { disabled: false, textContent: 'Revert to pending' };
  const deleteBtn = { disabled: false, textContent: 'Delete', previousElementSibling: revertBtn };
  return deleteBtn;
}

describe('revertRequest', () => {
  function setup({ tables, bySelector: extraSel } = {}) {
    const { client, captured } = makeClient({
      tables: tables || {
        self_received_requests: (calls) => {
          if (calls.update) return { data: null, error: null };
          if (calls.in.length) return { data: [], error: null };
          return { data: [], error: null };
        }
      }
    });
    const { card, revertBtn, deleteBtn } = makeCard({
      'data-row': '5',
      'data-name-realm': 'Bearsdh-Zul’jin',
      'data-item': 'Gaze of the Coiled Watcher',
      'data-player-id': '151',
      'data-status': 'approved'
    });
    const errorEl = makeEl();
    const els = {
      requestsContainer: makeEl(),
      requestsDecisions: makeEl(),
      'decision-error-5': errorEl
    };
    const bySelector = Object.assign({ '.request-card[data-row="5"]': card }, extraSel);
    const { sandbox, spies } = loadSandbox({ client, els, bySelector });
    return { sandbox, spies, captured, card, revertBtn, deleteBtn, errorEl };
  }

  it('updates the row back to pending, audits with the item and prior status, notifies, and rebuilds', async () => {
    const { sandbox, spies, captured, revertBtn } = setup();
    sandbox.revertRequest(5, revertBtn);
    await flush();
    const update = captured.byTable.self_received_requests.find((c) => c.update);
    expect(update.update).toEqual({ status: 'pending' });
    expect(update.eq).toContainEqual(['id', 5]);
    expect(update.eq).toContainEqual(['team_id', 1]);
    expect(spies.audit.length).toBe(1);
    expect(spies.audit[0].action).toBe('Self-Received Reverted');
    expect(spies.audit[0].targetType).toBe('players');
    expect(spies.audit[0].targetId).toBe(7);
    expect(spies.audit[0].detail).toContain('Gaze of the Coiled Watcher');
    expect(spies.audit[0].detail).toContain('approved');
    expect(spies.notify.length).toBe(1);
    expect(spies.notify[0].message).toContain('Gaze of the Coiled Watcher');
    // The tab rebuild re-queries pending and decisions.
    expect(captured.byTable.self_received_requests.length).toBeGreaterThanOrEqual(3);
    expect(spies.badges).toBeGreaterThanOrEqual(1);
  });

  it('surfaces an update error inline (the team-check trigger raise lands here)', async () => {
    const { sandbox, spies, revertBtn, deleteBtn, errorEl } = setup({
      tables: {
        self_received_requests: (calls) => {
          if (calls.update)
            return {
              data: null,
              error: { message: 'team_id 1 does not match players.team_id for player_id 151' }
            };
          return { data: [], error: null };
        }
      }
    });
    sandbox.revertRequest(5, revertBtn);
    await flush();
    expect(errorEl.textContent).toContain('does not match players.team_id');
    expect(revertBtn.disabled).toBe(false);
    expect(deleteBtn.disabled).toBe(false);
    expect(spies.audit.length).toBe(0);
    expect(spies.notify.length).toBe(0);
  });
});

describe('selfReceivedObtainedBisEntry (the passive BiS Manager hint)', () => {
  const row = (over) => Object.assign({}, APPROVED_ROW, over);

  it('matches an approved row whose bis entry is obtained', () => {
    const { sandbox } = loadSandbox({
      bisEntries: [{ itemId: 354, dbSlot: null, obtained: true }]
    });
    expect(sandbox.selfReceivedObtainedBisEntry(row())).toBeTruthy();
  });

  it('respects the slot rule when the request carries one', () => {
    const { sandbox } = loadSandbox({
      bisEntries: [{ itemId: 115, dbSlot: 'Feet', obtained: true }]
    });
    expect(sandbox.selfReceivedObtainedBisEntry(row({ self_item_id: 115, slot: 'Wrist' }))).toBeFalsy();
  });

  it('never matches a rejected row', () => {
    const { sandbox } = loadSandbox({
      bisEntries: [{ itemId: 354, dbSlot: null, obtained: true }]
    });
    expect(sandbox.selfReceivedObtainedBisEntry(row({ status: 'rejected' }))).toBeFalsy();
  });

  it('ignores unobtained entries and survives missing bis data', () => {
    const { sandbox } = loadSandbox({
      bisEntries: [{ itemId: 354, dbSlot: null, obtained: false }]
    });
    expect(sandbox.selfReceivedObtainedBisEntry(row())).toBeFalsy();
    const bare = loadSandbox({ bisEntries: [] }).sandbox;
    expect(bare.selfReceivedObtainedBisEntry(row())).toBeFalsy();
  });
});

describe('approve and reject audit details name the item (in-passing fix)', () => {
  function setup(updateResult) {
    const { client, captured } = makeClient({
      tables: {
        self_received_requests: (calls) => {
          if (calls.update) return updateResult || { data: null, error: null };
          if (calls.in.length) return { data: [], error: null };
          return { data: [], error: null };
        }
      }
    });
    const { card } = makeCard({
      'data-row': '9',
      'data-name-realm': 'Someraider-Illidan',
      'data-item': 'Seed Test Robe'
    });
    const els = { requestsContainer: makeEl(), requestsDecisions: makeEl() };
    const bySelector = { '.request-card[data-row="9"]': card };
    const { sandbox, spies } = loadSandbox({ client, els, bySelector });
    return { sandbox, spies, captured };
  }

  it('approveRequest passes the item name as the audit detail', async () => {
    const { sandbox, spies } = setup();
    sandbox.approveRequest(9, { disabled: false, textContent: 'Approve' });
    await flush();
    expect(spies.audit.length).toBe(1);
    expect(spies.audit[0].action).toBe('Self-Received Approved');
    expect(spies.audit[0].detail).toContain('Seed Test Robe');
  });

  it('rejectRequest passes the item name as the audit detail', async () => {
    const { sandbox, spies } = setup();
    sandbox.rejectRequest(9, { disabled: false, textContent: 'Reject' });
    await flush();
    expect(spies.audit.length).toBe(1);
    expect(spies.audit[0].action).toBe('Self-Received Rejected');
    expect(spies.audit[0].detail).toContain('Seed Test Robe');
  });
});
