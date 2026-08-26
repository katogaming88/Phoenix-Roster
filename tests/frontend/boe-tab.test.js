import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged } from './helpers/common-sandbox.js';

// js/tabs/tab-boe.js is a plain browser script (no exports), so these tests
// load it into a vm sandbox with the browser globals stubbed -- the
// audit-log-tab.test.js harness shape, with the recorder spies from
// self-received-corrections.test.js. The lifecycle RPCs themselves are
// covered by tests/rls/boe.test.js; here we assert the tab's wiring (#747):
// how rows partition into sections, when action buttons render, what reaches
// each RPC, the client-side audit writes, the keyset paging chain, and the
// summary math.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAB_BOE_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-boe.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

const CONTAINERS = ['boeSummary', 'boeOpen', 'boeAwaiting', 'boeHistory'];

function makeEl(extra) {
  return Object.assign({ value: '', style: {}, textContent: '', innerHTML: '', disabled: false }, extra);
}

// Routes .from(table) to a fixed row set with real keyset semantics (the
// keysetClient contract from helpers/supabase-mock.js, but per-table and with
// an rpc router), so an implementation whose .gt()/.limit() quietly did
// nothing would fail here instead of passing against a truncating server. A
// table source given as a function overrides the keyset semantics entirely
// (for error pages).
function makeBoeClient({ items = [], listings = [], rpc = {} } = {}) {
  const captured = { byTable: {}, gts: [], rpcCalls: [] };
  const tableRows = { boe_items: items, boe_listings: listings };
  function builder(table) {
    const calls = { select: null, countRequested: false, eq: [], order: [], gt: null, limit: null };
    const b = {
      select(c, opts) {
        calls.select = c;
        calls.countRequested = !!(opts && opts.count);
        return b;
      },
      eq(c, v) {
        calls.eq.push([c, v]);
        return b;
      },
      order(c, opts) {
        calls.order.push([c, opts]);
        return b;
      },
      gt(c, v) {
        calls.gt = [c, v];
        captured.gts.push([table, c, v]);
        return b;
      },
      limit(n) {
        calls.limit = n;
        return b;
      },
      then(ok, err) {
        return Promise.resolve()
          .then(() => {
            const src = tableRows[table];
            if (typeof src === 'function') return src(calls);
            const after = calls.gt ? calls.gt[1] : null;
            const limit = calls.limit || 1000;
            const slice = src.filter((r) => after === null || r.id > after).slice(0, limit);
            return { data: slice, error: null, count: after === null ? src.length : null };
          })
          .then(ok, err);
      }
    };
    (captured.byTable[table] = captured.byTable[table] || []).push(calls);
    return b;
  }
  const client = {
    from(table) {
      return builder(table);
    },
    rpc(name, args) {
      captured.rpcCalls.push({ name, args });
      const fn = rpc[name];
      return Promise.resolve(fn ? fn(args) : { data: null, error: null });
    }
  };
  return { client, captured };
}

const managerRpc = (extra) => Object.assign({ is_boe_manager: () => ({ data: true, error: null }) }, extra);

function loadSandbox({ client, els = {}, boeEnabled = true, session = null, guildLevel, confirmResult = true } = {}) {
  const spies = { audit: [], confirms: [] };
  CONTAINERS.forEach((id) => {
    if (!els[id]) els[id] = makeEl();
  });
  const sandbox = {
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    console,
    document: { getElementById: (id) => els[id] || null },
    window: guildLevel === undefined ? {} : { _guildOfficerAccessLevel: guildLevel },
    escHtml: (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    featureEnabled: (key) => (key === 'boe' ? boeEnabled : true),
    getDiscordSession: () => session,
    confirm: (msg) => {
      spies.confirms.push(msg);
      return confirmResult;
    },
    writeAuditLog: (action, targetType, targetId, detail) => {
      spies.audit.push({ action, targetType, targetId, detail });
    },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(TAB_BOE_JS, sandbox, { filename: 'tab-boe.js' });
  // js/common.js owns fetchAllPaged; tab-boe.js calls it as a global.
  sandbox.fetchAllPaged = realFetchAllPaged();
  return { sandbox, els, spies };
}

async function build(opts) {
  const loaded = loadSandbox(opts);
  loaded.sandbox.buildBoeTab();
  for (let i = 0; i < 12; i++) await flush();
  return loaded;
}

function boeRow(over) {
  return Object.assign(
    {
      id: 1,
      team_id: 1,
      player_id: null,
      finder_name: 'Kae-Tichondrius',
      item_name: 'Voidglass Cloak',
      track: 'Hero',
      note: null,
      status: 'found',
      found_at: '2026-08-20T01:00:00Z',
      sold_at: null,
      payout_paid_at: null,
      retired_at: null,
      sale_price: null,
      finder_payout: null,
      guild_cut: null
    },
    over
  );
}

const FOUND = () => boeRow({ id: 1 });
const LISTED = () =>
  boeRow({
    id: 2,
    item_name: 'Sash of the Fallen Star',
    status: 'listed',
    track: null,
    found_at: '2026-08-19T01:00:00Z'
  });
const SOLD = () =>
  boeRow({
    id: 3,
    item_name: 'Bindings of Depth',
    finder_name: 'Ashveil-Tichondrius',
    status: 'sold',
    sold_at: '2026-08-21T02:00:00Z',
    sale_price: 250000,
    finder_payout: 50000,
    guild_cut: 200000
  });
const PAID = () =>
  boeRow({
    id: 4,
    item_name: 'Girdle of Night',
    status: 'paid',
    sold_at: '2026-08-18T02:00:00Z',
    payout_paid_at: '2026-08-22T02:00:00Z',
    sale_price: 100000,
    finder_payout: 20000,
    guild_cut: 80000
  });
const RETIRED = () =>
  boeRow({ id: 5, item_name: 'Drape of Embers', status: 'retired', retired_at: '2026-08-23T02:00:00Z' });
const ALL_ROWS = () => [FOUND(), LISTED(), SOLD(), PAID(), RETIRED()];
const LISTING_ROW = () => ({ id: 11, boe_item_id: 2, listed_at: '2026-08-19T12:00:00Z', price: 300000, note: null });

describe('buildBoeTab sections', () => {
  it('partitions rows into Open, Awaiting Payout, and History by status', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [LISTING_ROW()], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('Voidglass Cloak');
    expect(els.boeOpen.innerHTML).toContain('Sash of the Fallen Star');
    expect(els.boeOpen.innerHTML).not.toContain('Bindings of Depth');
    expect(els.boeAwaiting.innerHTML).toContain('Bindings of Depth');
    expect(els.boeAwaiting.innerHTML).not.toContain('Girdle of Night');
    expect(els.boeHistory.innerHTML).toContain('Girdle of Night');
    expect(els.boeHistory.innerHTML).toContain('Drape of Embers');
  });

  it('shows the listing history inline on the open item', async () => {
    const { client } = makeBoeClient({ items: [LISTED()], listings: [LISTING_ROW()], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('300,000');
  });

  it('shows the raider-submitted note on the open item', async () => {
    // The submit form's note reaches officers nowhere else; the Open row is
    // its one surfacing point.
    const { client } = makeBoeClient({
      items: [boeRow({ id: 7, note: 'from trash before boss 2' })],
      listings: [],
      rpc: managerRpc()
    });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('from trash before boss 2');
  });

  it('renders a per-section empty state when a section has no rows', async () => {
    const { client } = makeBoeClient({ items: [], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('No open BoEs');
    expect(els.boeAwaiting.innerHTML).toContain('Nothing awaiting payout');
    expect(els.boeHistory.innerHTML).toContain('No paid or retired BoEs yet');
  });

  it('reads both tables team-scoped, keyset-ordered by id', async () => {
    const { client, captured } = makeBoeClient({ items: [], listings: [], rpc: managerRpc() });
    await build({ client });
    ['boe_items', 'boe_listings'].forEach((table) => {
      const q = captured.byTable[table][0];
      expect(q.select).toContain('id');
      expect(q.eq).toEqual([['team_id', 1]]);
      expect(q.order).toEqual([['id', { ascending: true }]]);
      expect(q.limit).toBe(1000);
    });
  });

  it('renders an error paragraph, not an empty state, when a paged read fails', async () => {
    const { client } = makeBoeClient({
      items: () => ({ data: null, error: { message: 'boom' } }),
      listings: [],
      rpc: managerRpc()
    });
    const { els } = await build({ client });
    expect(els.boeSummary.innerHTML).toContain('Could not load');
    expect(els.boeOpen.innerHTML).not.toContain('No open BoEs');
  });
});

describe('manager gating', () => {
  it('a BoE manager sees the action buttons', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('Record Listing');
    expect(els.boeOpen.innerHTML).toContain('Record Sale');
    expect(els.boeOpen.innerHTML).toContain('Retire');
    expect(els.boeAwaiting.innerHTML).toContain('Mark Paid');
  });

  it('a read-only officer sees the grant note and no buttons', async () => {
    const { client } = makeBoeClient({
      items: ALL_ROWS(),
      listings: [],
      rpc: { is_boe_manager: () => ({ data: false, error: null }) }
    });
    const { els } = await build({ client });
    expect(els.boeSummary.innerHTML).toContain('assigned by a site admin');
    expect(els.boeOpen.innerHTML).not.toContain('<button');
    expect(els.boeAwaiting.innerHTML).not.toContain('<button');
  });

  it('a site admin gets the buttons without an is_boe_manager round trip', async () => {
    const { client, captured } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: {} });
    const { els } = await build({ client, session: { isAdmin: true } });
    expect(els.boeOpen.innerHTML).toContain('Record Sale');
    expect(captured.rpcCalls.filter((c) => c.name === 'is_boe_manager')).toEqual([]);
  });

  // The grant went guild-wide in #766, so the gate takes no team argument.
  // Passing one would raise "function does not exist" against the new schema.
  it('the manager check passes no team argument', async () => {
    const { client, captured } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    await build({ client });
    const calls = captured.rpcCalls.filter((c) => c.name === 'is_boe_manager');
    expect(calls.length).toBe(1);
    expect(calls[0].args).toBeUndefined();
  });

  it('a server denial surfaces as an error and writes no audit entry', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client } = makeBoeClient({
      items: [SOLD()],
      listings: [],
      rpc: managerRpc({ boe_mark_paid: () => ({ data: null, error: { message: 'Not authorized' } }) })
    });
    const loaded = await build({ client, els });
    const btn = makeEl({ textContent: 'Mark Paid' });
    loaded.sandbox.markBoePaid(3, btn);
    await flush();
    expect(els['boe-status-3'].textContent).toBe('Not authorized');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Mark Paid');
    expect(loaded.spies.audit).toEqual([]);
  });
});

describe('price parsing and recording a sale', () => {
  it('parses "250,000" to 250000, calls boe_record_sale, and renders the returned split without a refetch', async () => {
    const els = { 'boe-sale-price-1': makeEl(), 'boe-status-1': makeEl() };
    const { client, captured } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc({
        boe_record_sale: () => ({
          data: [{ sale_price: 250000, finder_payout: 50000, guild_cut: 200000 }],
          error: null
        })
      })
    });
    const loaded = await build({ client, els });
    els['boe-sale-price-1'].value = '250,000';
    loaded.sandbox.confirmBoeSale(1, makeEl({ textContent: 'Confirm' }));
    await flush();
    const sale = captured.rpcCalls.find((c) => c.name === 'boe_record_sale');
    expect(sale.args).toEqual({ p_id: 1, p_sale_price: 250000 });
    expect(els.boeAwaiting.innerHTML).toContain('Voidglass Cloak');
    expect(els.boeAwaiting.innerHTML).toContain('50,000');
    expect(els.boeAwaiting.innerHTML).toContain('200,000');
    // The split came from the RPC's return row: still exactly one boe_items read.
    expect(captured.byTable.boe_items).toHaveLength(1);
  });

  it('blocks an invalid price client-side with text feedback and no RPC call', async () => {
    const els = { 'boe-sale-price-1': makeEl(), 'boe-status-1': makeEl() };
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    for (const bad of ['abc', '', '0']) {
      els['boe-sale-price-1'].value = bad;
      loaded.sandbox.confirmBoeSale(1, makeEl({ textContent: 'Confirm' }));
      await flush();
    }
    expect(els['boe-status-1'].textContent).toBe('Enter a price in gold, like 250,000.');
    expect(captured.rpcCalls.filter((c) => c.name === 'boe_record_sale')).toEqual([]);
  });

  it('parseGoldInput and formatGold round-trip the money formats', () => {
    const { sandbox } = loadSandbox({ client: makeBoeClient().client });
    expect(sandbox.parseGoldInput('250,000')).toBe(250000);
    expect(sandbox.parseGoldInput(' 1 000 000 ')).toBe(1000000);
    expect(sandbox.parseGoldInput('250000g')).toBe(250000);
    expect(sandbox.parseGoldInput('abc')).toBe(null);
    expect(sandbox.parseGoldInput('')).toBe(null);
    expect(sandbox.parseGoldInput('-5')).toBe(null);
    expect(sandbox.formatGold(1234567)).toBe('1,234,567');
    expect(sandbox.formatGold(0)).toBe('0');
  });
});

describe('lifecycle actions', () => {
  it('records a listing with price and note, audits it, and re-renders the row as Listed', async () => {
    const els = { 'boe-listing-price-1': makeEl(), 'boe-listing-note-1': makeEl(), 'boe-status-1': makeEl() };
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    els['boe-listing-price-1'].value = '150,000';
    els['boe-listing-note-1'].value = 'weekend relist';
    loaded.sandbox.confirmBoeListing(1, makeEl({ textContent: 'Confirm' }));
    await flush();
    const listing = captured.rpcCalls.find((c) => c.name === 'boe_record_listing');
    expect(listing.args).toEqual({ p_id: 1, p_price: 150000, p_note: 'weekend relist' });
    expect(loaded.spies.audit).toHaveLength(1);
    expect(loaded.spies.audit[0].action).toBe('BoE Listed');
    expect(loaded.spies.audit[0].targetType).toBe('boe_items');
    expect(loaded.spies.audit[0].targetId).toBe(1);
    expect(loaded.spies.audit[0].detail).toContain('Voidglass Cloak');
    expect(loaded.spies.audit[0].detail).toContain('150,000');
    expect(els.boeOpen.innerHTML).toMatch(/>Listed<\/span>/);
    expect(els.boeOpen.innerHTML).toContain('150,000');
  });

  it('marks a payout paid, audits it, and moves the row to History', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client, captured } = makeBoeClient({ items: [SOLD()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    loaded.sandbox.markBoePaid(3, makeEl({ textContent: 'Mark Paid' }));
    await flush();
    expect(captured.rpcCalls.find((c) => c.name === 'boe_mark_paid').args).toEqual({ p_id: 3 });
    expect(loaded.spies.audit[0].action).toBe('BoE Payout Paid');
    expect(loaded.spies.audit[0].detail).toContain('50,000');
    expect(loaded.spies.audit[0].detail).toContain('Ashveil-Tichondrius');
    expect(els.boeHistory.innerHTML).toContain('Bindings of Depth');
    expect(els.boeAwaiting.innerHTML).toContain('Nothing awaiting payout');
  });

  it('retires an item behind a confirm, audits it, and declines cleanly', async () => {
    const els = { 'boe-status-1': makeEl() };
    const declined = await build({
      client: makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() }).client,
      els: { 'boe-status-1': makeEl() },
      confirmResult: false
    });
    declined.sandbox.retireBoe(1, makeEl({ textContent: 'Retire' }));
    await flush();
    expect(declined.spies.confirms).toHaveLength(1);
    expect(declined.spies.audit).toEqual([]);

    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const accepted = await build({ client, els });
    accepted.sandbox.retireBoe(1, makeEl({ textContent: 'Retire' }));
    await flush();
    expect(captured.rpcCalls.find((c) => c.name === 'boe_retire').args).toEqual({ p_id: 1 });
    expect(accepted.spies.audit[0].action).toBe('BoE Retired');
    expect(accepted.spies.audit[0].detail).toContain('Voidglass Cloak');
    expect(accepted.els.boeHistory.innerHTML).toContain('Voidglass Cloak');
  });
});

describe('history paging', () => {
  it('pages the read by keyset when the team has more than one page of rows', async () => {
    const items = [];
    for (let i = 1; i <= 1150; i++) {
      items.push(
        boeRow({
          id: i,
          item_name: 'Item ' + i,
          status: 'paid',
          sold_at: '2026-08-01T00:00:00Z',
          payout_paid_at: '2026-08-02T00:00:00Z',
          sale_price: 1000,
          finder_payout: 200,
          guild_cut: 800
        })
      );
    }
    const { client, captured } = makeBoeClient({ items, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(captured.gts).toContainEqual(['boe_items', 'id', 1000]);
    expect(els.boeHistory.innerHTML).toContain('Item 1150');
  });
});

describe('summary strip', () => {
  it('totals guild income over sold and paid, and outstanding payouts over sold', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    // guild_cut: 200,000 (sold) + 80,000 (paid); finder_payout outstanding: 50,000 (sold only)
    expect(els.boeSummary.innerHTML).toContain('280,000');
    expect(els.boeSummary.innerHTML).toContain('50,000');
  });
});

describe('access bails', () => {
  it('renders the turned-off note and fetches nothing when the boe flag is off', async () => {
    const { client, captured } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client, boeEnabled: false });
    expect(els.boeSummary.innerHTML).toContain('turned off');
    expect(captured.byTable).toEqual({});
    expect(captured.rpcCalls).toEqual([]);
  });

  it('bails with a note for guild officer access and fetches nothing', async () => {
    const { client, captured } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client, guildLevel: 'guild' });
    expect(els.boeSummary.innerHTML).toContain('guild officer access');
    expect(captured.byTable).toEqual({});
  });
});

describe('accessible markup', () => {
  it('uses real table headers, status text badges, and a per-row status region', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.boeOpen.innerHTML).toContain('<th scope="col">');
    expect(els.boeOpen.innerHTML).toContain('role="status"');
    expect(els.boeOpen.innerHTML).toMatch(/>Found<\/span>/);
    expect(els.boeOpen.innerHTML).toMatch(/>Listed<\/span>/);
    expect(els.boeHistory.innerHTML).toMatch(/>Paid<\/span>/);
    expect(els.boeHistory.innerHTML).toMatch(/>Retired<\/span>/);
  });
});
