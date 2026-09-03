import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged, loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// The real _esc from js/common.js, which guild.html loads. A stand-in here
// could escape differently from the shipped one and the suite would not
// notice, which is the same reason realFetchAllPaged() exists.
const realEsc = loadCommonJs(quietConsole)._esc;

// js/boe-manage.js is a plain browser script (no exports), so these tests
// load it into a vm sandbox with the browser globals stubbed -- the
// audit-log-tab.test.js harness shape, with the recorder spies from
// self-received-corrections.test.js. The lifecycle RPCs themselves are
// covered by tests/rls/boe.test.js; here we assert the tab's wiring (#747):
// how rows partition into sections, when action buttons render, what reaches
// each RPC, the client-side audit writes, the keyset paging chain, and the
// summary math.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOE_MANAGE_JS = readFileSync(path.join(HERE, '../../js/boe-manage.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

const CONTAINERS = ['guildBoeSummary', 'guildBoeOpen', 'guildBoeAwaiting', 'guildBoeHistory'];

function makeEl(extra) {
  return Object.assign({ value: '', style: {}, textContent: '', innerHTML: '', disabled: false }, extra);
}

// Routes .from(table) to a fixed row set with real keyset semantics (the
// keysetClient contract from helpers/supabase-mock.js, but per-table and with
// an rpc router), so an implementation whose .gt()/.limit() quietly did
// nothing would fail here instead of passing against a truncating server. A
// table source given as a function overrides the keyset semantics entirely
// (for error pages).
function makeBoeClient({ items = [], listings = [], rpc = {}, updates = {}, catalog = [] } = {}) {
  const captured = { byTable: {}, gts: [], rpcCalls: [], updates: [] };
  // items is the BoE catalog read (#875): the rows flagged is_boe, id and name.
  const tableRows = { boe_items: items, boe_listings: listings, items: catalog };
  function builder(table) {
    const calls = { select: null, countRequested: false, eq: [], order: [], gt: null, limit: null, update: null };
    const b = {
      select(c, opts) {
        calls.select = c;
        calls.countRequested = !!(opts && opts.count);
        return b;
      },
      // An update chain (#874): .update(values).eq('id', n).select('id'). The
      // result echoes the matching rows with the values merged, or whatever
      // updates[table] returns: zero rows for a lost grant, an error for the
      // trigger's raise.
      update(values) {
        calls.update = values;
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
            if (calls.update) {
              captured.updates.push({ table, values: calls.update, eq: calls.eq });
              if (updates[table]) return updates[table](calls);
              const rows = Array.isArray(src) ? src : [];
              const hit = rows.filter((r) => calls.eq.every(([c, v]) => r[c] === v));
              return { data: hit.map((r) => Object.assign({}, r, calls.update)), error: null };
            }
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

function loadSandbox({ client, els = {}, confirmResult = true } = {}) {
  const spies = { audit: [], confirms: [], datalists: [] };
  CONTAINERS.forEach((id) => {
    if (!els[id]) els[id] = makeEl();
  });
  const sandbox = {
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    console,
    document: { getElementById: (id) => els[id] || null },
    window: {},
    _esc: realEsc,
    // js/common.js owns this, same as fetchAllPaged below; guild.html loads
    // that bundle, so calling it is legitimate and only the harness needs the
    // stand-in. Its real behaviour is pinned separately, further down, against
    // the actual common.js.
    teamNameForId: (id) =>
      ({ 1: 'Phoenix Reborn', 2: 'Hellfire', 3: 'Immolation', 4: 'Wrathless' })[id] || 'Team ' + id,
    confirm: (msg) => {
      spies.confirms.push(msg);
      return confirmResult;
    },
    // The fifth argument is the point of #774: the entry names the BoE row's
    // own team, not the page's. This page has no team.
    writeAuditLog: (action, targetType, targetId, detail, teamId) => {
      spies.audit.push({ action, targetType, targetId, detail, teamId });
    },
    // js/common.js owns the datalist writer (#875); both pages load it.
    renderBoeItemDatalist: (names) => {
      spies.datalists.push(names);
    },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(BOE_MANAGE_JS, sandbox, { filename: 'boe-manage.js' });
  // js/common.js owns fetchAllPaged; boe-manage.js calls it as a global.
  sandbox.fetchAllPaged = realFetchAllPaged();
  return { sandbox, els, spies };
}

// canManage is what js/guild.js resolves and hands in (is_boe_manager() or
// is_site_admin()). It arrives as a parameter rather than being worked out
// here, so this module has no opinion on identity at all.
async function build(opts) {
  const loaded = loadSandbox(opts);
  loaded.sandbox.buildBoeManage(opts && 'canManage' in opts ? opts.canManage : true);
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
      item_id: null,
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
      guild_cut: null,
      payout_donated: false,
      upgrade_rank: null
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
const LISTED_OTHER_TEAM = () => boeRow({ id: 2, team_id: 4, item_name: 'Wrathless Find', status: 'listed' });

describe('buildBoeManage sections', () => {
  it('partitions rows into Open, Awaiting Payout, and History by status', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [LISTING_ROW()], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('Voidglass Cloak');
    expect(els.guildBoeOpen.innerHTML).toContain('Sash of the Fallen Star');
    expect(els.guildBoeOpen.innerHTML).not.toContain('Bindings of Depth');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Bindings of Depth');
    expect(els.guildBoeAwaiting.innerHTML).not.toContain('Girdle of Night');
    expect(els.guildBoeHistory.innerHTML).toContain('Girdle of Night');
    expect(els.guildBoeHistory.innerHTML).toContain('Drape of Embers');
  });

  it('shows the listing history inline on the open item', async () => {
    const { client } = makeBoeClient({ items: [LISTED()], listings: [LISTING_ROW()], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('300,000');
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
    expect(els.guildBoeOpen.innerHTML).toContain('from trash before boss 2');
  });

  it('renders a per-section empty state when a section has no rows', async () => {
    const { client } = makeBoeClient({ items: [], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('No open BoEs');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Nothing awaiting payout');
    expect(els.guildBoeHistory.innerHTML).toContain('No paid or retired BoEs yet');
  });

  it('reads both tables unfiltered by team, keyset-ordered by id', async () => {
    // No client-side team filter since #765: the read policies are
    // my_team_role(team_id) in (officer, team_leader) or is_boe_manager() or
    // is_site_admin(), so the database already returns exactly the teams the
    // caller may see. Filtering here too would re-implement that, worse.
    const { client, captured } = makeBoeClient({ items: [], listings: [], rpc: managerRpc() });
    await build({ client });
    ['boe_items', 'boe_listings'].forEach((table) => {
      const q = captured.byTable[table][0];
      expect(q.select).toContain('id');
      expect(q.eq).toEqual([]);
      expect(q.order).toEqual([['id', { ascending: true }]]);
      expect(q.limit).toBe(1000);
    });
    expect(captured.byTable.boe_items[0].select).toContain('team_id');
  });

  it('renders an error paragraph, not an empty state, when a paged read fails', async () => {
    const { client } = makeBoeClient({
      items: () => ({ data: null, error: { message: 'boom' } }),
      listings: [],
      rpc: managerRpc()
    });
    const { els } = await build({ client });
    expect(els.guildBoeSummary.innerHTML).toContain('Could not load');
    expect(els.guildBoeOpen.innerHTML).not.toContain('No open BoEs');
  });
});

describe('manager gating (#774)', () => {
  it('a BoE manager sees the action buttons', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [] });
    const { els } = await build({ client, canManage: true });
    expect(els.guildBoeOpen.innerHTML).toContain('Record Listing');
    expect(els.guildBoeOpen.innerHTML).toContain('Record Sale');
    expect(els.guildBoeOpen.innerHTML).toContain('Retire');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Mark Paid');
  });

  it('a read-only officer sees the grant note and no buttons', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [] });
    const { els } = await build({ client, canManage: false });
    expect(els.guildBoeSummary.innerHTML).toContain('assigned by a site admin');
    expect(els.guildBoeOpen.innerHTML).not.toContain('<button');
    expect(els.guildBoeAwaiting.innerHTML).not.toContain('<button');
    expect(els.guildBoeHistory.innerHTML).not.toContain('<button');
  });

  // Who the caller is belongs to js/guild.js now. This module asks nothing
  // about identity, which is what lets it render on a page that does not
  // load js/discord.js and has no getDiscordSession() to call.
  it('resolves no identity of its own, on either read', async () => {
    const { client, captured } = makeBoeClient({ items: ALL_ROWS(), listings: [] });
    await build({ client, canManage: true });
    const identityCalls = captured.rpcCalls.filter((c) =>
      ['is_boe_manager', 'is_site_admin', 'is_any_team_officer'].includes(c.name)
    );
    expect(identityCalls).toEqual([]);
  });

  it('a server denial surfaces as an error and writes no audit entry', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client } = makeBoeClient({
      items: [SOLD()],
      listings: [],
      rpc: { boe_mark_paid: () => ({ data: null, error: { message: 'Not authorized' } }) }
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

// The page has no team, so writeAuditLog() cannot take one from _teamCfg
// (js/guild.js nulls it). It takes the BoE row's own team instead, which is
// also the right attribution for a read that spans every team since #765.
describe('audit entries name the BoE team, not the page (#774)', () => {
  it('logs a sale against the team that found it, not the viewer', async () => {
    const els = { 'boe-sale-price-2': makeEl({ value: '250,000' }) };
    const { client } = makeBoeClient({
      items: [LISTED_OTHER_TEAM()],
      listings: [],
      rpc: {
        boe_record_sale: () => ({
          data: [{ sale_price: 250000, finder_payout: 50000, guild_cut: 200000 }],
          error: null
        })
      }
    });
    const loaded = await build({ client, els });
    loaded.sandbox.confirmBoeSale(2, makeEl());
    await flush();
    await flush();
    expect(loaded.spies.audit).toHaveLength(1);
    expect(loaded.spies.audit[0].teamId).toBe(4);
  });

  it('names the row team on a listing, a payout and a retirement too', async () => {
    const { client } = makeBoeClient({ items: [LISTED_OTHER_TEAM()], listings: [] });
    const els = { 'boe-listing-price-2': makeEl({ value: '90000' }) };
    const loaded = await build({ client, els });
    loaded.sandbox.confirmBoeListing(2, makeEl());
    await flush();
    loaded.sandbox.retireBoe(2, makeEl());
    await flush();
    expect(loaded.spies.audit.map((a) => a.teamId)).toEqual([4, 4]);
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
    expect(els.guildBoeAwaiting.innerHTML).toContain('Voidglass Cloak');
    expect(els.guildBoeAwaiting.innerHTML).toContain('50,000');
    expect(els.guildBoeAwaiting.innerHTML).toContain('200,000');
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
    expect(els.guildBoeOpen.innerHTML).toMatch(/>Listed<\/span>/);
    expect(els.guildBoeOpen.innerHTML).toContain('150,000');
  });

  it('marks a payout paid, audits it, and moves the row to History', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client, captured } = makeBoeClient({ items: [SOLD()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    loaded.sandbox.markBoePaid(3, makeEl({ textContent: 'Mark Paid' }));
    await flush();
    expect(captured.rpcCalls.find((c) => c.name === 'boe_mark_paid').args).toEqual({ p_id: 3, p_donated: false });
    expect(loaded.spies.audit[0].action).toBe('BoE Payout Paid');
    expect(loaded.spies.audit[0].detail).toContain('50,000');
    expect(loaded.spies.audit[0].detail).toContain('Ashveil-Tichondrius');
    expect(els.guildBoeHistory.innerHTML).toContain('Bindings of Depth');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Nothing awaiting payout');
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
    expect(accepted.els.guildBoeHistory.innerHTML).toContain('Voidglass Cloak');
  });
});

describe('reading History by keyset', () => {
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
    const { sandbox, els } = await build({ client });
    expect(captured.gts).toContainEqual(['boe_items', 'id', 1000]);
    // The last row's name in History used to prove it arrived. History renders
    // twenty rows at a time since #863, so the proof is the model and the
    // summary strip, which count every row: 1150 x 800 guild cut.
    expect(sandbox._boeItems.length).toBe(1150);
    expect(els.guildBoeSummary.innerHTML).toContain('920,000');
  });
});

describe('summary strip', () => {
  it('totals guild income over sold and paid, and outstanding payouts over sold', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    // guild_cut: 200,000 (sold) + 80,000 (paid); finder_payout outstanding: 50,000 (sold only)
    expect(els.guildBoeSummary.innerHTML).toContain('280,000');
    expect(els.guildBoeSummary.innerHTML).toContain('50,000');
  });
});

// #765: BoEs are guild property, so a manager sees every team's finds in one
// list and each find names the team that found it. The team is credit, not a
// disambiguator, which is why it renders in History too rather than only where
// two teams' rows could be confused.
describe('cross-team view (#765)', () => {
  const CROSS_ROWS = () => [
    boeRow({ id: 1, team_id: 1, item_name: 'Phoenix Find', status: 'found' }),
    boeRow({ id: 2, team_id: 4, item_name: 'Wrathless Find', status: 'found' }),
    boeRow({
      id: 3,
      team_id: 2,
      item_name: 'Hellfire Sold',
      status: 'sold',
      sold_at: '2026-08-20T00:00:00Z',
      sale_price: 300000,
      finder_payout: 60000,
      guild_cut: 240000
    }),
    boeRow({
      id: 4,
      team_id: 1,
      item_name: 'Phoenix Paid',
      status: 'paid',
      sold_at: '2026-08-18T00:00:00Z',
      payout_paid_at: '2026-08-19T00:00:00Z',
      sale_price: 100000,
      finder_payout: 20000,
      guild_cut: 80000
    })
  ];

  it('renders rows from several teams, each naming its own team', async () => {
    const { client } = makeBoeClient({ items: CROSS_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('Phoenix Reborn');
    expect(els.guildBoeOpen.innerHTML).toContain('Wrathless');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Hellfire');
    // History carries the team too: the credit outlives the payout.
    expect(els.guildBoeHistory.innerHTML).toContain('Phoenix Reborn');
  });

  it('pairs each row with its own team rather than just naming every team somewhere', async () => {
    const { client } = makeBoeClient({ items: CROSS_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const rows = els.guildBoeOpen.innerHTML.split('<tr>').filter(Boolean);
    const phoenix = rows.find((r) => r.includes('Phoenix Find'));
    const wrathless = rows.find((r) => r.includes('Wrathless Find'));
    expect(phoenix).toContain('Phoenix Reborn');
    expect(phoenix).not.toContain('Wrathless');
    expect(wrathless).toContain('Wrathless');
    expect(wrathless).not.toContain('Phoenix Reborn');
  });

  it('surfaces a find on a team with no members and no roster', async () => {
    // The Wrathless case, and the reason this issue exists: hidden from the
    // switcher, so before this its finds were reachable only by hand-typing
    // ?team=wrathless into the officer dashboard.
    const { client } = makeBoeClient({
      items: [boeRow({ id: 9, team_id: 4, item_name: 'Unseen Cloak', player_id: null })],
      listings: [],
      rpc: managerRpc()
    });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('Unseen Cloak');
    expect(els.guildBoeOpen.innerHTML).toContain('Wrathless');
  });

  it('totals the headline figures over every team the viewer can see', async () => {
    const { client } = makeBoeClient({ items: CROSS_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    // guild_cut 240,000 (Hellfire, sold) + 80,000 (Phoenix, paid)
    expect(els.guildBoeSummary.innerHTML).toContain('320,000');
    // finder_payout outstanding: the sold row only
    expect(els.guildBoeSummary.innerHTML).toContain('60,000');
  });
});

describe('per-team credit line (#765)', () => {
  // Assert on the text a reader sees, not the markup carrying it: the count
  // sits in its own <strong>, so a tag-blind regex over innerHTML would pin
  // the styling rather than the pairing it is supposed to check.
  const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&middot;/g, '.');

  const TWO_TEAMS = () => [
    boeRow({ id: 1, team_id: 1, status: 'found' }),
    boeRow({ id: 2, team_id: 1, status: 'found' }),
    boeRow({
      id: 3,
      team_id: 1,
      status: 'paid',
      sold_at: '2026-08-18T00:00:00Z',
      payout_paid_at: '2026-08-19T00:00:00Z',
      sale_price: 100000,
      finder_payout: 20000,
      guild_cut: 80000
    }),
    boeRow({ id: 4, team_id: 4, status: 'found' })
  ];

  it('counts finds per team and sums guild_cut over sold and paid', async () => {
    const { client } = makeBoeClient({ items: TWO_TEAMS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = text(els.guildBoeSummary.innerHTML);
    expect(html).toContain('Found by team');
    expect(html).toMatch(/Phoenix Reborn 3 \(80,000g\)/);
  });

  it('shows a team that has found but not sold with zero gold', async () => {
    const { client } = makeBoeClient({ items: TWO_TEAMS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(text(els.guildBoeSummary.innerHTML)).toMatch(/Wrathless 1 \(0g\)/);
  });

  it('omits a team with no finds', async () => {
    const { client } = makeBoeClient({ items: TWO_TEAMS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeSummary.innerHTML).not.toContain('Hellfire');
    expect(els.guildBoeSummary.innerHTML).not.toContain('Immolation');
  });

  it('orders teams by find count, most finds first', async () => {
    const { client } = makeBoeClient({ items: TWO_TEAMS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = els.guildBoeSummary.innerHTML;
    expect(html.indexOf('Phoenix Reborn')).toBeLessThan(html.indexOf('Wrathless'));
  });

  it('the per-team gold sums to the headline guild income', async () => {
    // Both read guild_cut over sold and paid. Nothing else would notice the
    // two displays drifting apart, so this is the guard.
    const items = TWO_TEAMS().concat([
      boeRow({
        id: 5,
        team_id: 4,
        status: 'sold',
        sold_at: '2026-08-20T00:00:00Z',
        sale_price: 250000,
        finder_payout: 50000,
        guild_cut: 200000
      })
    ]);
    const { client } = makeBoeClient({ items, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = text(els.guildBoeSummary.innerHTML);
    expect(html).toContain('280,000'); // headline: 80,000 + 200,000
    expect(html).toMatch(/Phoenix Reborn 3 \(80,000g\)/);
    expect(html).toMatch(/Wrathless 2 \(200,000g\)/);
  });

  it('does not render the line at all when only one team has finds', async () => {
    // Today's reality on production. With one team it just restates the
    // headline in more words.
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeSummary.innerHTML).not.toContain('Found by team');
  });
});

describe('summary scope note (#765)', () => {
  it('tells a read-only officer the totals cover their own teams', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [] });
    const { els } = await build({ client, canManage: false });
    expect(els.guildBoeSummary.innerHTML).toContain('your own teams');
  });

  it('says nothing about scope to a manager, whose totals really are guild-wide', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeSummary.innerHTML).not.toContain('your own teams');
  });
});

describe('teamNameForId (js/common.js, #765)', () => {
  it('resolves every configured team, hidden ones included', () => {
    const sandbox = loadCommonJs();
    Object.keys(sandbox.TEAMS).forEach((slug) => {
      const cfg = sandbox.TEAMS[slug];
      expect(sandbox.teamNameForId(cfg.supabaseTeamId)).toBe(cfg.name);
    });
    expect(sandbox.teamNameForId(4)).toBe('Wrathless');
  });

  it('falls back rather than rendering undefined for an id TEAMS does not carry', () => {
    // Cannot happen today, but a team created on prod before js/common.js
    // catches up would otherwise put the string "undefined" in a table cell.
    const sandbox = loadCommonJs();
    expect(sandbox.teamNameForId(99)).toBe('Team 99');
    expect(sandbox.teamNameForId(null)).not.toContain('undefined');
  });
});

describe('accessible markup', () => {
  it('uses real table headers, status text badges, and a per-row status region', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    expect(els.guildBoeOpen.innerHTML).toContain('<th scope="col">');
    expect(els.guildBoeOpen.innerHTML).toContain('role="status"');
    expect(els.guildBoeOpen.innerHTML).toMatch(/>Found<\/span>/);
    expect(els.guildBoeOpen.innerHTML).toMatch(/>Listed<\/span>/);
    expect(els.guildBoeHistory.innerHTML).toMatch(/>Paid<\/span>/);
    expect(els.guildBoeHistory.innerHTML).toMatch(/>Retired<\/span>/);
  });
});

// boe_revert() shipped with the #745 backend, RLS-tested and documented, and
// never had a caller: the surface ran one way only, so a mistyped sale price
// or a premature Mark Paid could not be undone from the interface (#802).
//
// The RPC returns the new status as text, because the sold edge is
// listed-or-found depending on whether listing rows survive. The client takes
// that answer rather than recomputing it.
describe('undoing a lifecycle step (#802)', () => {
  const revertRpc = (status) => ({ boe_revert: () => ({ data: status, error: null }) });

  it('offers an undo on sold, paid and retired rows for a manager', async () => {
    const { client } = makeBoeClient({ items: [SOLD(), PAID(), RETIRED()], listings: [] });
    const { els } = await build({ client, canManage: true });
    expect(els.guildBoeAwaiting.innerHTML).toContain('Undo Sale');
    expect(els.guildBoeHistory.innerHTML).toContain('Undo Payout');
    expect(els.guildBoeHistory.innerHTML).toContain('Un-retire');
  });

  it('offers none of them to a read-only officer', async () => {
    const { client } = makeBoeClient({ items: [SOLD(), PAID(), RETIRED()], listings: [] });
    const { els } = await build({ client, canManage: false });
    expect(els.guildBoeAwaiting.innerHTML).not.toContain('Undo');
    expect(els.guildBoeHistory.innerHTML).not.toContain('Undo');
    expect(els.guildBoeHistory.innerHTML).not.toContain('Un-retire');
  });

  it('moves a paid row back to Awaiting Payout and clears the paid date', async () => {
    const { client } = makeBoeClient({ items: [PAID()], listings: [], rpc: revertRpc('sold') });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(4, makeEl());
    await flush();
    expect(loaded.els.guildBoeAwaiting.innerHTML).toContain('Girdle of Night');
    expect(loaded.els.guildBoeHistory.innerHTML).not.toContain('Girdle of Night');
    expect(loaded.sandbox.findBoeItem(4).payout_paid_at).toBeNull();
  });

  // The receipt is nulled server-side, so leaving it in the local row would
  // render a sale price against an item that is no longer sold.
  it('nulls the money columns on a sold row, not just the status', async () => {
    const { client } = makeBoeClient({ items: [SOLD()], listings: [], rpc: revertRpc('found') });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(3, makeEl());
    await flush();
    const item = loaded.sandbox.findBoeItem(3);
    expect(item.status).toBe('found');
    expect(item.sale_price).toBeNull();
    expect(item.finder_payout).toBeNull();
    expect(item.guild_cut).toBeNull();
    expect(item.sold_at).toBeNull();
    expect(loaded.els.guildBoeOpen.innerHTML).toContain('Bindings of Depth');
    expect(loaded.els.guildBoeAwaiting.innerHTML).not.toContain('Bindings of Depth');
  });

  it('takes the landing status from the RPC rather than recomputing it', async () => {
    // Same call, same local state, different server answer: the row lands
    // wherever the server says, because only it knows if listings survived.
    const a = makeBoeClient({ items: [SOLD()], listings: [], rpc: revertRpc('listed') });
    const one = await build({ client: a.client });
    one.sandbox.revertBoe(3, makeEl());
    await flush();
    expect(one.sandbox.findBoeItem(3).status).toBe('listed');

    const c = makeBoeClient({ items: [SOLD()], listings: [], rpc: revertRpc('found') });
    const two = await build({ client: c.client });
    two.sandbox.revertBoe(3, makeEl());
    await flush();
    expect(two.sandbox.findBoeItem(3).status).toBe('found');
  });

  it('returns a retired row to Open', async () => {
    const { client } = makeBoeClient({ items: [RETIRED()], listings: [], rpc: revertRpc('found') });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(5, makeEl());
    await flush();
    expect(loaded.els.guildBoeOpen.innerHTML).toContain('Drape of Embers');
    expect(loaded.els.guildBoeHistory.innerHTML).not.toContain('Drape of Embers');
    expect(loaded.sandbox.findBoeItem(5).retired_at).toBeNull();
  });

  // The RPC raises purpose-written messages, including the one about deleting
  // listing rows first. They go on the row verbatim.
  it('surfaces the server message on the row and writes no audit entry', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client } = makeBoeClient({
      items: [SOLD()],
      listings: [],
      rpc: { boe_revert: () => ({ data: null, error: { message: 'Not authorized' } }) }
    });
    const loaded = await build({ client, els });
    const btn = makeEl({ textContent: 'Undo Sale' });
    loaded.sandbox.revertBoe(3, btn);
    await flush();
    expect(els['boe-status-3'].textContent).toBe('Not authorized');
    expect(btn.disabled).toBe(false);
    expect(loaded.spies.audit).toEqual([]);
  });

  it('confirms before undoing money, and does nothing when declined', async () => {
    const { client, captured } = makeBoeClient({ items: [PAID()], listings: [], rpc: revertRpc('sold') });
    const loaded = await build({ client, confirmResult: false });
    loaded.sandbox.revertBoe(4, makeEl());
    await flush();
    expect(loaded.spies.confirms).toHaveLength(1);
    expect(captured.rpcCalls.filter((c) => c.name === 'boe_revert')).toEqual([]);
    expect(loaded.sandbox.findBoeItem(4).status).toBe('paid');
  });

  // Un-retiring restores a row to the open list and touches no money, so it
  // does not earn the same interruption a payout reversal does.
  it('does not confirm before un-retiring', async () => {
    const { client } = makeBoeClient({ items: [RETIRED()], listings: [], rpc: revertRpc('found') });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(5, makeEl());
    await flush();
    expect(loaded.spies.confirms).toEqual([]);
    expect(loaded.sandbox.findBoeItem(5).status).toBe('found');
  });

  it('audits the undo against the team that found it', async () => {
    const { client } = makeBoeClient({
      items: [
        boeRow({
          id: 9,
          team_id: 4,
          item_name: 'Wrathless Find',
          status: 'retired',
          retired_at: '2026-08-23T02:00:00Z'
        })
      ],
      listings: [],
      rpc: revertRpc('found')
    });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(9, makeEl());
    await flush();
    expect(loaded.spies.audit).toHaveLength(1);
    expect(loaded.spies.audit[0].teamId).toBe(4);
    expect(loaded.spies.audit[0].action).toBe('BoE Reverted');
    expect(loaded.spies.audit[0].detail).toContain('found');
  });
});

// History renders one page at a time (#863). Open and Awaiting Payout are
// working lists and stay whole; History grows with every settled sale and
// already held the whole legacy import, so it pushed everything below it out
// of reach.
describe('History paging (#863)', () => {
  const paidRows = (n) =>
    Array.from({ length: n }, (_, i) =>
      boeRow({
        id: 100 + i,
        item_name: 'Paid Item ' + (i + 1),
        // No track: boeRow()'s default 'Hero' badge follows the name in the
        // cell, which hides the 'Paid Item N<' anchors that tell Paid Item 1
        // from Paid Item 10 to 19 below.
        track: null,
        status: 'paid',
        sold_at: '2026-08-01T02:00:00Z',
        // Newest first, so Paid Item 1 is the most recent and lands on page 1.
        payout_paid_at: new Date(Date.UTC(2026, 7, 30, 0, 0, n - i)).toISOString(),
        sale_price: 100000,
        finder_payout: 20000,
        guild_cut: 80000
      })
    );

  // The count line is a static element on boe.html, not part of the History
  // render: a live region recreated by innerHTML is not announced. The two
  // buttons are rendered, so they are stubbed here only to observe focus.
  const pagerEls = () => ({
    guildBoeHistoryCount: makeEl(),
    boeHistoryPrev: makeEl({
      focused: 0,
      focus() {
        this.focused++;
      }
    }),
    boeHistoryNext: makeEl({
      focused: 0,
      focus() {
        this.focused++;
      }
    })
  });

  // Body rows only: _boeTable puts the header row in a <tr> too, so counting
  // every <tr> read one high and three of these tests could never pass.
  const rowsIn = (html) => ((html.split('<tbody>')[1] || '').match(/<tr>/g) || []).length;
  const gold = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + 'g';

  it('renders the first 20 of 21 rows, newest first, and says so', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { els } = await build({ client, els: pagerEls() });
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(20);
    expect(els.guildBoeHistory.innerHTML).toContain('Paid Item 1<');
    expect(els.guildBoeHistory.innerHTML).not.toContain('Paid Item 21<');
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 1 to 20 of 21');
  });

  it('disables Previous on the first page and Next on the last', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    expect(els.guildBoeHistory.innerHTML).toMatch(/id="boeHistoryPrev"[^>]*disabled/);
    expect(els.guildBoeHistory.innerHTML).not.toMatch(/id="boeHistoryNext"[^>]*disabled/);
    sandbox.boeHistoryPage(1);
    expect(els.guildBoeHistory.innerHTML).not.toMatch(/id="boeHistoryPrev"[^>]*disabled/);
    expect(els.guildBoeHistory.innerHTML).toMatch(/id="boeHistoryNext"[^>]*disabled/);
  });

  it('Next shows the 21st row alone and the count follows', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(1);
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(1);
    expect(els.guildBoeHistory.innerHTML).toContain('Paid Item 21<');
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 21 to 21 of 21');
    sandbox.boeHistoryPage(-1);
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(20);
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 1 to 20 of 21');
  });

  it('never pages past either end', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(-1);
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 1 to 20 of 21');
    sandbox.boeHistoryPage(1);
    sandbox.boeHistoryPage(1);
    sandbox.boeHistoryPage(1);
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 21 to 21 of 21');
  });

  it('shows no controls and an empty count when everything fits on one page', async () => {
    const { client } = makeBoeClient({ items: paidRows(20), listings: [] });
    const { els } = await build({ client, els: pagerEls() });
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(20);
    expect(els.guildBoeHistory.innerHTML).not.toContain('boeHistoryNext');
    expect(els.guildBoeHistory.innerHTML).not.toContain('boeHistoryPrev');
    expect(els.guildBoeHistoryCount.textContent).toBe('');
  });

  it('renders without the count element, as the guild page sandbox never had one', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { els } = await build({ client });
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(20);
  });

  it('clamps the page when an undo empties the last page', async () => {
    const { client } = makeBoeClient({
      items: paidRows(21),
      listings: [],
      rpc: managerRpc({ boe_revert: () => ({ data: 'sold', error: null }) })
    });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(1);
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 21 to 21 of 21');
    // The 21st row is the oldest, the one alone on page 2.
    sandbox.revertBoe(120, makeEl());
    await flush();
    expect(rowsIn(els.guildBoeHistory.innerHTML)).toBe(20);
    expect(els.guildBoeHistoryCount.textContent).toBe('');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Paid Item 21<');
  });

  it('keeps the page across a re-render caused by an action elsewhere', async () => {
    const { client } = makeBoeClient({
      items: paidRows(41).concat([SOLD()]),
      listings: [],
      rpc: managerRpc({ boe_mark_paid: () => ({ data: null, error: null }) })
    });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(1);
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 21 to 40 of 41');
    sandbox.markBoePaid(3, makeEl());
    await flush();
    // One more row in History, newest first, so page 2 still starts at 21.
    expect(els.guildBoeHistoryCount.textContent).toBe('Showing 21 to 40 of 42');
  });

  it('moves focus to the other button when the pressed one becomes disabled', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(1);
    // Next is now disabled, so focus lands on Previous rather than on body.
    expect(els.boeHistoryPrev.focused).toBe(1);
    expect(els.boeHistoryNext.focused).toBe(0);
    sandbox.boeHistoryPage(-1);
    expect(els.boeHistoryNext.focused).toBe(1);
  });

  it('keeps focus on the pressed button while it stays enabled', async () => {
    const { client } = makeBoeClient({ items: paidRows(41), listings: [] });
    const { sandbox, els } = await build({ client, els: pagerEls() });
    sandbox.boeHistoryPage(1);
    expect(els.boeHistoryNext.focused).toBe(1);
    expect(els.boeHistoryPrev.focused).toBe(0);
  });

  it('totals every row, not the visible page', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { els } = await build({ client, els: pagerEls() });
    expect(els.guildBoeSummary.innerHTML).toContain(gold(21 * 80000));
  });

  it('leaves the Open and Awaiting lists whole', async () => {
    const found = Array.from({ length: 25 }, (_, i) =>
      boeRow({ id: 300 + i, item_name: 'Open Item ' + (i + 1), found_at: '2026-08-2' + (i % 10) + 'T01:00:00Z' })
    );
    const { client } = makeBoeClient({ items: found, listings: [] });
    const { els } = await build({ client, els: pagerEls() });
    expect(rowsIn(els.guildBoeOpen.innerHTML)).toBe(25);
  });

  // #863 asked the browser harness to check the two buttons carry accessible
  // names, but History renders only signed in and the harness runs signed out
  // (Phase A), so the check lives here: the visible text is the name.
  it('names both buttons by their visible text', async () => {
    const { client } = makeBoeClient({ items: paidRows(21), listings: [] });
    const { els } = await build({ client, els: pagerEls() });
    expect(els.guildBoeHistory.innerHTML).toMatch(/<button[^>]*id="boeHistoryPrev"[^>]*>Previous<\/button>/);
    expect(els.guildBoeHistory.innerHTML).toMatch(/<button[^>]*id="boeHistoryNext"[^>]*>Next<\/button>/);
  });
});

// A manager can correct the item name, track and note from the page (#874).
// The trigger already admits exactly those columns on a plain UPDATE and the
// update policy is the manager grant, so this is wiring: what the form
// prefills, what one Save sends, what is refused before any write, and what
// the two silent failure shapes (zero rows, a server error) look like on the
// row. Elements the form reads are stubbed by id, like the price fields.
describe('manager edit (#874)', () => {
  const focusable = () =>
    makeEl({
      focused: 0,
      focus() {
        this.focused++;
      }
    });
  // The form span starts hidden, as the markup renders it: the stub default
  // style {} would read as open and the first toggle would close it.
  const editEls = (id) => ({
    ['boe-edit-form-' + id]: makeEl({ style: { display: 'none' } }),
    ['boe-edit-btn-' + id]: focusable(),
    ['boe-edit-name-' + id]: focusable(),
    ['boe-edit-track-' + id]: makeEl(),
    ['boe-edit-note-' + id]: makeEl(),
    ['boe-edit-rank-' + id]: makeEl(),
    ['boe-status-' + id]: makeEl()
  });
  const typeInto = (els, id, { name, track, note }) => {
    els['boe-edit-name-' + id].value = name;
    els['boe-edit-track-' + id].value = track;
    els['boe-edit-note-' + id].value = note;
  };
  const ZERO_ROWS = 'Nothing was saved. Your BoE manager grant may have been revoked; reload the page.';

  it('renders Edit in all three sections for a manager, after the lifecycle buttons and before the forms', async () => {
    const { client } = makeBoeClient({ items: ALL_ROWS(), listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    for (const id of ['guildBoeOpen', 'guildBoeAwaiting', 'guildBoeHistory']) {
      expect(els[id].innerHTML).toContain('>Edit</button>');
      expect(els[id].innerHTML).toContain('id="boe-edit-form-');
    }
    const open = els.guildBoeOpen.innerHTML;
    expect(open.indexOf('>Retire</button>')).toBeLessThan(open.indexOf('id="boe-edit-btn-1"'));
    expect(open.indexOf('id="boe-edit-btn-1"')).toBeLessThan(open.indexOf('id="boe-listing-form-1"'));
    expect(open.indexOf('id="boe-edit-form-1"')).toBeLessThan(open.indexOf('id="boe-status-1"'));
  });

  it('prefills the name, the stored track and the note, escaped', async () => {
    const rows = [
      boeRow({ id: 1, item_name: 'Girdle "of" <Night>', track: 'Hero', note: 'from trash before boss 2' }),
      boeRow({ id: 2, item_name: 'Sash of the Fallen Star', track: null, note: null })
    ];
    const { client } = makeBoeClient({ items: rows, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const open = els.guildBoeOpen.innerHTML;
    expect(open).toContain('value="' + realEsc('Girdle "of" <Night>') + '"');
    expect(open).not.toContain('<Night>');
    expect(open).toContain('<option value="Hero" selected>Hero</option>');
    expect(open).toContain('>from trash before boss 2</textarea>');
    expect(open).toContain('<option value="" selected>');
    expect(open).toContain('id="boe-edit-note-2" aria-label="Note"');
  });

  it('Save sends one update of the three columns for that id, re-renders the new name and returns focus to Edit', async () => {
    const els = editEls(1);
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: '  Slippers of the Hissing Cult ', track: 'Myth', note: 'Donate' });
    loaded.sandbox.saveBoeEdit(1, makeEl({ textContent: 'Save' }));
    await flush();
    await flush();
    expect(captured.updates).toEqual([
      {
        table: 'boe_items',
        values: {
          item_name: 'Slippers of the Hissing Cult',
          track: 'Myth',
          note: 'Donate',
          item_id: null,
          upgrade_rank: null
        },
        eq: [['id', 1]]
      }
    ]);
    expect(els.guildBoeOpen.innerHTML).toContain('Slippers of the Hissing Cult');
    expect(els.guildBoeOpen.innerHTML).not.toContain('Voidglass Cloak');
    expect(els.guildBoeOpen.innerHTML).toContain('Myth');
    // Still exactly one boe_items read: the row was patched in memory.
    expect(captured.byTable.boe_items.filter((c) => !c.update)).toHaveLength(1);
    expect(els['boe-edit-btn-1'].focused).toBe(1);
  });

  it('refuses an empty name on the row with no write and no audit entry', async () => {
    const els = editEls(1);
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: '   ', track: 'Hero', note: '' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    expect(els['boe-status-1'].textContent).toBe('Enter the item name.');
    expect(captured.updates).toEqual([]);
    expect(loaded.spies.audit).toEqual([]);
  });

  it('unchanged values write nothing, close the form and return focus to Edit', async () => {
    const els = editEls(1);
    els['boe-edit-form-1'].style.display = '';
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: 'Voidglass Cloak ', track: 'Hero', note: '  ' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    expect(captured.updates).toEqual([]);
    expect(loaded.spies.audit).toEqual([]);
    expect(els['boe-edit-form-1'].style.display).toBe('none');
    expect(els['boe-edit-btn-1'].focused).toBe(1);
  });

  it('the audit entry names the row team and keeps the old and new values', async () => {
    const els = editEls(2);
    const { client } = makeBoeClient({ items: [LISTED_OTHER_TEAM()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    typeInto(els, 2, { name: 'Slippers of the Hissing Cult', track: '', note: 'Donate' });
    loaded.sandbox.saveBoeEdit(2, makeEl());
    await flush();
    await flush();
    expect(loaded.spies.audit).toHaveLength(1);
    expect(loaded.spies.audit[0]).toMatchObject({
      action: 'BoE Find Edited',
      targetType: 'boe_items',
      targetId: 2,
      teamId: 4
    });
    const detail = loaded.spies.audit[0].detail;
    expect(detail).toContain('item renamed from "Wrathless Find" to "Slippers of the Hissing Cult"');
    expect(detail).toContain('track was "Hero", now (none)');
    expect(detail).toContain('note was (none), now "Donate"');
  });

  it('a zero-row result surfaces on the row, leaves the row alone and writes no audit entry', async () => {
    const els = editEls(1);
    const { client } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc(),
      updates: { boe_items: () => ({ data: [], error: null }) }
    });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: 'Slippers of the Hissing Cult', track: 'Hero', note: '' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    await flush();
    expect(els['boe-status-1'].textContent).toBe(ZERO_ROWS);
    expect(loaded.spies.audit).toEqual([]);
    expect(els.guildBoeOpen.innerHTML).toContain('Voidglass Cloak');
    expect(els.guildBoeOpen.innerHTML).not.toContain('Slippers of the Hissing Cult');
  });

  it('a server error surfaces verbatim, restores the button and writes no audit entry', async () => {
    const message =
      'Direct updates may only edit note, finder, item, track, or season; lifecycle changes go through the BoE RPCs';
    const els = editEls(1);
    const { client } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc(),
      updates: { boe_items: () => ({ data: null, error: { message } }) }
    });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: 'Slippers of the Hissing Cult', track: 'Hero', note: '' });
    const btn = makeEl({ textContent: 'Save' });
    loaded.sandbox.saveBoeEdit(1, btn);
    await flush();
    await flush();
    expect(els['boe-status-1'].textContent).toBe(message);
    expect(loaded.spies.audit).toEqual([]);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save');
  });

  it('opening the form closes the other forms and moves focus into the name field', async () => {
    const els = Object.assign(editEls(1), { 'boe-sale-form-1': makeEl({ style: { display: '' } }) });
    const { client } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const { sandbox } = await build({ client, els });
    sandbox.toggleBoeForm(1, 'edit');
    expect(els['boe-edit-form-1'].style.display).toBe('');
    expect(els['boe-sale-form-1'].style.display).toBe('none');
    expect(els['boe-edit-name-1'].focused).toBe(1);
    sandbox.toggleBoeForm(1, 'edit');
    expect(els['boe-edit-form-1'].style.display).toBe('none');
    expect(els['boe-edit-name-1'].focused).toBe(1);
    // And the edit form closes when a lifecycle form opens.
    sandbox.toggleBoeForm(1, 'edit');
    sandbox.toggleBoeForm(1, 'sale');
    expect(els['boe-edit-form-1'].style.display).toBe('none');
    expect(els['boe-sale-form-1'].style.display).toBe('');
  });

  it('Cancel restores the fields from the row and returns focus to Edit without a re-render', async () => {
    const els = editEls(1);
    els['boe-edit-form-1'].style.display = '';
    const { client } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const { sandbox } = await build({ client, els });
    typeInto(els, 1, { name: 'typo', track: 'Myth', note: 'scratch' });
    els.guildBoeOpen.innerHTML = 'untouched';
    sandbox.cancelBoeEdit(1);
    expect(els['boe-edit-name-1'].value).toBe('Voidglass Cloak');
    expect(els['boe-edit-track-1'].value).toBe('Hero');
    expect(els['boe-edit-note-1'].value).toBe('');
    expect(els['boe-edit-form-1'].style.display).toBe('none');
    expect(els['boe-edit-btn-1'].focused).toBe(1);
    expect(els.guildBoeOpen.innerHTML).toBe('untouched');
  });
});

// The catalog picker on the edit form (#875): boe.html reads the rows flagged
// is_boe, feeds the shared datalist, and Save resolves the typed name against
// that list so the stored spelling and item_id can never disagree.
describe('catalog picker on the edit form (#875)', () => {
  const CATALOG = () => [
    { id: 7, name: 'Crushing Coiler Coif' },
    { id: 8, name: 'Slitherscale Girdle' }
  ];
  const focusable = () =>
    makeEl({
      focused: 0,
      focus() {
        this.focused++;
      }
    });
  const editEls = (id) => ({
    ['boe-edit-form-' + id]: makeEl({ style: { display: 'none' } }),
    ['boe-edit-btn-' + id]: focusable(),
    ['boe-edit-name-' + id]: focusable(),
    ['boe-edit-track-' + id]: makeEl(),
    ['boe-edit-note-' + id]: makeEl(),
    ['boe-edit-rank-' + id]: makeEl(),
    ['boe-status-' + id]: makeEl()
  });
  const typeInto = (els, id, { name, track, note }) => {
    els['boe-edit-name-' + id].value = name;
    els['boe-edit-track-' + id].value = track;
    els['boe-edit-note-' + id].value = note;
  };

  it('reads the catalog once, fills the datalist with its names, and points the name field at it', async () => {
    const { client, captured } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc(),
      catalog: CATALOG()
    });
    const loaded = await build({ client });
    expect(captured.byTable.items).toHaveLength(1);
    expect(captured.byTable.items[0].select).toBe('id, name');
    expect(captured.byTable.items[0].eq).toEqual([['is_boe', true]]);
    expect(loaded.spies.datalists).toEqual([['Crushing Coiler Coif', 'Slitherscale Girdle']]);
    expect(loaded.els.guildBoeOpen.innerHTML).toContain('id="boe-edit-name-1" list="boeItemOptions"');
  });

  it('Save resolves a typed name against the catalog: the catalog spelling and item_id go in the payload and the audit', async () => {
    const els = editEls(1);
    const { client, captured } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc(),
      catalog: CATALOG()
    });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: ' crushing coiler coif ', track: 'Hero', note: '' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    await flush();
    expect(captured.updates).toEqual([
      {
        table: 'boe_items',
        values: { item_name: 'Crushing Coiler Coif', track: 'Hero', note: null, item_id: 7, upgrade_rank: null },
        eq: [['id', 1]]
      }
    ]);
    expect(loaded.spies.audit[0].detail).toContain('item renamed from "Voidglass Cloak" to "Crushing Coiler Coif"');
    expect(loaded.spies.audit[0].detail).toContain('catalog link was (none), now 7');
    expect(els.guildBoeOpen.innerHTML).toContain('Crushing Coiler Coif');
  });

  it('a name outside the catalog writes item_id null and the text as typed', async () => {
    const els = editEls(1);
    const { client, captured } = makeBoeClient({
      items: [boeRow({ id: 1, item_name: 'Crushing Coiler Coif', item_id: 7 })],
      listings: [],
      rpc: managerRpc(),
      catalog: CATALOG()
    });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: 'Feet - Heroic', track: 'Hero', note: '' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    await flush();
    expect(captured.updates[0].values).toEqual({
      item_name: 'Feet - Heroic',
      track: 'Hero',
      note: null,
      item_id: null
    });
    expect(loaded.spies.audit[0].detail).toContain('catalog link was 7, now (none)');
  });

  it('a Save whose only effect is the link still writes', async () => {
    const els = editEls(1);
    const { client, captured } = makeBoeClient({
      items: [boeRow({ id: 1, item_name: 'Crushing Coiler Coif', item_id: null })],
      listings: [],
      rpc: managerRpc(),
      catalog: CATALOG()
    });
    const loaded = await build({ client, els });
    typeInto(els, 1, { name: 'Crushing Coiler Coif', track: 'Hero', note: '' });
    loaded.sandbox.saveBoeEdit(1, makeEl());
    await flush();
    await flush();
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0].values.item_id).toBe(7);
    expect(loaded.spies.audit[0].detail).toBe('catalog link was (none), now 7');
  });

  it('a failed catalog read costs the picker and nothing else', async () => {
    const { client } = makeBoeClient({
      items: [FOUND()],
      listings: [],
      rpc: managerRpc(),
      catalog: () => ({ data: null, error: { message: 'boom' } })
    });
    const loaded = await build({ client });
    expect(loaded.spies.datalists).toEqual([[]]);
    expect(loaded.els.guildBoeOpen.innerHTML).toContain('Voidglass Cloak');
    expect(loaded.els.guildBoeSummary.innerHTML).not.toContain('Could not load');
  });
});

// Donate to Guild (#862): a second settle button, a Donating marker for the
// intent a raider recorded, a Donated badge in History, and guild income that
// counts a donated cut. The money columns never change; the flag is the whole
// recognition, and a plain Mark Paid clears it.
describe('Donate to Guild (#862)', () => {
  const DONATING_SOLD = () => SOLD();
  const flagged = (row) => Object.assign(row, { payout_donated: true });
  const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&middot;/g, '.');

  it('Awaiting rows offer Mark Paid, then Donate to Guild, then Undo Sale', async () => {
    const { client } = makeBoeClient({ items: [SOLD()], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = els.guildBoeAwaiting.innerHTML;
    expect(html).toContain('>Donate to Guild</button>');
    expect(html.indexOf('>Mark Paid</button>')).toBeLessThan(html.indexOf('>Donate to Guild</button>'));
    expect(html.indexOf('>Donate to Guild</button>')).toBeLessThan(html.indexOf('>Undo Sale</button>'));
  });

  it('Donate to Guild settles through boe_mark_paid with p_donated true, audits it, and History reads Donated', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client, captured } = makeBoeClient({ items: [DONATING_SOLD()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    loaded.sandbox.donateBoePayout(3, makeEl({ textContent: 'Donate to Guild' }));
    await flush();
    expect(captured.rpcCalls.find((c) => c.name === 'boe_mark_paid').args).toEqual({ p_id: 3, p_donated: true });
    expect(loaded.spies.audit[0]).toMatchObject({ action: 'BoE Payout Donated', targetId: 3, teamId: 1 });
    expect(loaded.spies.audit[0].detail).toContain('50,000');
    expect(loaded.spies.audit[0].detail).toContain('Ashveil-Tichondrius');
    expect(els.guildBoeHistory.innerHTML).toContain('>Donated</span>');
    expect(els.guildBoeHistory.innerHTML).not.toContain('>Paid</span>');
    expect(els.guildBoeAwaiting.innerHTML).toContain('Nothing awaiting payout');
  });

  it('Mark Paid on a flagged row clears the intent and says so in the audit', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client, captured } = makeBoeClient({ items: [flagged(SOLD())], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    loaded.sandbox.markBoePaid(3, makeEl({ textContent: 'Mark Paid' }));
    await flush();
    expect(captured.rpcCalls.find((c) => c.name === 'boe_mark_paid').args).toEqual({ p_id: 3, p_donated: false });
    expect(loaded.spies.audit[0].action).toBe('BoE Payout Paid');
    expect(loaded.spies.audit[0].detail).toContain('donate intent cleared');
    expect(loaded.sandbox.findBoeItem(3).payout_donated).toBe(false);
    expect(els.guildBoeHistory.innerHTML).toContain('>Paid</span>');
    expect(els.guildBoeHistory.innerHTML).not.toContain('Donating');
  });

  it('a Donating marker shows on found, listed and sold rows carrying the intent, and on no other row', async () => {
    const items = [
      flagged(boeRow({ id: 1, status: 'found' })),
      boeRow({ id: 2, item_name: 'Plain Find', status: 'found' }),
      flagged(boeRow({ id: 3, status: 'listed', item_name: 'Flagged Listing' })),
      flagged(SOLD()),
      flagged(PAID())
    ];
    const { client } = makeBoeClient({ items, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const open = els.guildBoeOpen.innerHTML;
    expect((open.match(/>Donating</g) || []).length).toBe(2);
    expect(open.indexOf('Plain Find')).toBeGreaterThan(-1);
    expect(els.guildBoeAwaiting.innerHTML).toContain('>Donating<');
    expect(els.guildBoeHistory.innerHTML).toContain('>Donated</span>');
    expect(els.guildBoeHistory.innerHTML).not.toContain('>Donating<');
  });

  it('guild income counts a donated cut, the strip shows the donated total, and the per-team line still sums to the headline', async () => {
    const items = [
      flagged(
        boeRow({
          id: 3,
          team_id: 1,
          status: 'paid',
          sold_at: '2026-08-18T00:00:00Z',
          payout_paid_at: '2026-08-19T00:00:00Z',
          sale_price: 100000,
          finder_payout: 20000,
          guild_cut: 80000
        })
      ),
      boeRow({
        id: 5,
        team_id: 4,
        status: 'sold',
        sold_at: '2026-08-20T00:00:00Z',
        sale_price: 250000,
        finder_payout: 50000,
        guild_cut: 200000
      })
    ];
    const { client } = makeBoeClient({ items, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = text(els.guildBoeSummary.innerHTML);
    expect(html).toContain('Guild income to date: 300,000g');
    expect(html).toContain('Donated by finders: 20,000g');
    expect(html).toContain('Outstanding payouts: 50,000g');
    expect(html).toMatch(/Phoenix Reborn 1 \(100,000g\)/);
    expect(html).toMatch(/Wrathless 1 \(200,000g\)/);
  });

  it('a sold row that is donating still counts as outstanding until a manager settles it, and the strip has no donated line without one', async () => {
    const { client } = makeBoeClient({ items: [flagged(SOLD())], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = text(els.guildBoeSummary.innerHTML);
    expect(html).toContain('Outstanding payouts: 50,000g');
    expect(html).toContain('Guild income to date: 200,000g');
    expect(html).not.toContain('Donated by finders');
  });

  it('Undo Payout leaves the intent, so the marker comes back in Awaiting', async () => {
    const { client } = makeBoeClient({
      items: [flagged(PAID())],
      listings: [],
      rpc: { boe_revert: () => ({ data: 'sold', error: null }) }
    });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(4, makeEl());
    await flush();
    expect(loaded.sandbox.findBoeItem(4).payout_donated).toBe(true);
    expect(loaded.els.guildBoeAwaiting.innerHTML).toContain('>Donating<');
    expect(loaded.els.guildBoeAwaiting.innerHTML).toContain('>Donate to Guild</button>');
  });
});

// A donated payout pays the finder nothing and the guild everything, and
// History has to read that way, not show the policy cut beside a Donated
// badge (Russell, 2026-09-02, on the first cut of #862). The stored split
// stays the policy record, which is what Undo Payout puts back, so this is a
// display rule shared by the row, the summary and the per-team line.
describe('donated rows in History read finder 0, guild whole (#862 follow-up)', () => {
  const flagged = (row) => Object.assign(row, { payout_donated: true });

  it('a donated paid row shows Finder payout 0g and the whole amount as guild cut', async () => {
    const { client } = makeBoeClient({ items: [flagged(PAID())], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = els.guildBoeHistory.innerHTML;
    expect(html).toContain('<td>0g</td>');
    expect(html).toContain('<td>100,000g</td>');
    expect(html).not.toContain('<td>20,000g</td>');
    expect(html).not.toContain('<td>80,000g</td>');
    expect(html).toContain('>Donated</span>');
  });

  it('a paid row without the flag keeps its split', async () => {
    const { client } = makeBoeClient({ items: [PAID()], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = els.guildBoeHistory.innerHTML;
    expect(html).toContain('<td>20,000g</td>');
    expect(html).toContain('<td>80,000g</td>');
    expect(html).not.toContain('<td>0g</td>');
  });

  it('a donating sold row in Awaiting keeps the policy split until a manager settles it', async () => {
    const { client } = makeBoeClient({ items: [flagged(SOLD())], listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const html = els.guildBoeAwaiting.innerHTML;
    expect(html).toContain('<td>50,000g</td>');
    expect(html).toContain('<td>200,000g</td>');
    expect(html).not.toContain('<td>0g</td>');
  });

  it('Donate to Guild lands the row in History reading 0g and the full sale as guild cut', async () => {
    const els = { 'boe-status-3': makeEl() };
    const { client } = makeBoeClient({ items: [SOLD()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    loaded.sandbox.donateBoePayout(3, makeEl());
    await flush();
    const html = els.guildBoeHistory.innerHTML;
    expect(html).toContain('<td>0g</td>');
    expect(html).toContain('<td>250,000g</td>');
    expect(html).not.toContain('<td>50,000g</td>');
  });

  it('Undo Payout puts the policy split back on the Awaiting row', async () => {
    const { client } = makeBoeClient({
      items: [flagged(PAID())],
      listings: [],
      rpc: { boe_revert: () => ({ data: 'sold', error: null }) }
    });
    const loaded = await build({ client });
    loaded.sandbox.revertBoe(4, makeEl());
    await flush();
    const html = loaded.els.guildBoeAwaiting.innerHTML;
    expect(html).toContain('<td>20,000g</td>');
    expect(html).toContain('<td>80,000g</td>');
  });
});

// The upgrade rank (#865): a required six-option select on the raider form,
// shown inside the Item cell's track badge, editable from the same six-option
// select on the edit form, and the key the Record Sale guard reads.
describe('upgrade rank (#865)', () => {
  it('shows the rank inside the track badge, alone without a track, and nothing after a bare name', async () => {
    const rows = [
      boeRow({ id: 1, item_name: 'Slitherscale Girdle', track: 'Champion', upgrade_rank: '2/6' }),
      boeRow({ id: 2, item_name: 'Rankless Find', track: null, upgrade_rank: '3/6', found_at: '2026-08-19T01:00:00Z' }),
      boeRow({ id: 3, item_name: 'Plain Find', track: null, upgrade_rank: null, found_at: '2026-08-18T01:00:00Z' })
    ];
    const { client } = makeBoeClient({ items: rows, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const open = els.guildBoeOpen.innerHTML;
    expect(open).toContain('Slitherscale Girdle <span class="badge" style="margin-left:0.35rem;">Champion 2/6</span>');
    expect(open).toContain('Rankless Find <span class="badge" style="margin-left:0.35rem;">3/6</span>');
    expect(open).toContain('Plain Find<');
  });

  it('the edit form offers the six ranks with the stored one selected, and a blank option for a row without one', async () => {
    const rows = [
      boeRow({ id: 1, upgrade_rank: '2/6' }),
      boeRow({ id: 2, upgrade_rank: null, found_at: '2026-08-19T01:00:00Z' })
    ];
    const { client } = makeBoeClient({ items: rows, listings: [], rpc: managerRpc() });
    const { els } = await build({ client });
    const open = els.guildBoeOpen.innerHTML;
    const first = open.slice(open.indexOf('id="boe-edit-rank-1"'), open.indexOf('id="boe-edit-rank-2"'));
    expect(first).toContain('aria-label="Upgrade rank"');
    expect(first).toContain('<option value="">No rank</option>');
    expect(first).toContain('<option value="1/6">1/6</option>');
    expect(first).toContain('<option value="2/6" selected>2/6</option>');
    expect(first).toContain('<option value="6/6">6/6</option>');
    const second = open.slice(open.indexOf('id="boe-edit-rank-2"'));
    expect(second).toContain('<option value="" selected>No rank</option>');
    expect(second).not.toContain('selected>2/6');
  });

  it('Save sends the selected rank with the other editable columns and audits the change', async () => {
    const els = {
      'boe-edit-form-1': makeEl({ style: { display: 'none' } }),
      'boe-edit-btn-1': makeEl({ focus() {} }),
      'boe-edit-name-1': makeEl({ focus() {} }),
      'boe-edit-track-1': makeEl(),
      'boe-edit-note-1': makeEl(),
      'boe-edit-rank-1': makeEl(),
      'boe-status-1': makeEl()
    };
    const { client, captured } = makeBoeClient({ items: [FOUND()], listings: [], rpc: managerRpc() });
    const loaded = await build({ client, els });
    els['boe-edit-name-1'].value = 'Voidglass Cloak';
    els['boe-edit-track-1'].value = 'Hero';
    els['boe-edit-note-1'].value = '';
    els['boe-edit-rank-1'].value = '4/6';
    loaded.sandbox.saveBoeEdit(1, makeEl({ textContent: 'Save' }));
    await flush();
    await flush();
    expect(captured.updates).toEqual([
      {
        table: 'boe_items',
        values: { item_name: 'Voidglass Cloak', track: 'Hero', note: null, item_id: null, upgrade_rank: '4/6' },
        eq: [['id', 1]]
      }
    ]);
    expect(loaded.spies.audit[0].detail).toContain('rank was (none), now "4/6"');
  });
});

// Two finds of the same item on the same track at the same rank are one queue,
// oldest first (#865). Record Sale on the newer one asks before recording; a
// different rank, track or item, a sold older row, or selling the older row
// itself never prompts. A row with no rank (the legacy import) counts as the
// same item.
describe('first come, first served at Record Sale (#865)', () => {
  const OLDER = (over) =>
    boeRow(
      Object.assign(
        {
          id: 1,
          team_id: 4,
          finder_name: 'Firstfinder-Dalaran',
          item_name: 'Slitherscale Girdle',
          track: 'Champion',
          upgrade_rank: '2/6',
          found_at: '2026-08-20T01:00:00Z'
        },
        over
      )
    );
  const NEWER = () =>
    boeRow({
      id: 2,
      team_id: 1,
      finder_name: 'Second-Illidan',
      item_name: 'slitherscale girdle',
      track: 'Champion',
      upgrade_rank: '2/6',
      found_at: '2026-08-21T01:00:00Z'
    });
  const SPLIT = {
    boe_record_sale: () => ({ data: [{ sale_price: 100000, finder_payout: 20000, guild_cut: 80000 }], error: null })
  };
  async function sell(rows, id, opts = {}) {
    const els = { ['boe-sale-price-' + id]: makeEl({ value: '100,000' }), ['boe-status-' + id]: makeEl() };
    const { client, captured } = makeBoeClient({ items: rows, listings: [], rpc: managerRpc(SPLIT) });
    const loaded = await build(Object.assign({ client, els }, opts));
    loaded.sandbox.confirmBoeSale(id, makeEl({ textContent: 'Confirm' }));
    await flush();
    await flush();
    return { confirms: loaded.spies.confirms, sold: captured.rpcCalls.filter((c) => c.name === 'boe_record_sale') };
  }

  it('names the older open finder at the same name, track and rank, then records on confirm', async () => {
    const { confirms, sold } = await sell([OLDER(), NEWER()], 2);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain('Firstfinder-Dalaran');
    expect(confirms[0]).toContain('Slitherscale Girdle');
    expect(confirms[0]).toContain('Champion');
    expect(sold).toHaveLength(1);
  });

  it('records nothing when the manager cancels', async () => {
    const { confirms, sold } = await sell([OLDER(), NEWER()], 2, { confirmResult: false });
    expect(confirms).toHaveLength(1);
    expect(sold).toEqual([]);
  });

  it('treats an older row with no rank as the same item', async () => {
    const { confirms } = await sell([OLDER({ upgrade_rank: null }), NEWER()], 2);
    expect(confirms).toHaveLength(1);
  });

  it.each([
    ['a different rank', { upgrade_rank: '3/6' }],
    ['a different track', { track: 'Hero' }],
    ['a different item', { item_name: 'Voidglass Cloak' }],
    [
      'an older row that is already sold',
      { status: 'sold', sold_at: '2026-08-21T02:00:00Z', sale_price: 100000, finder_payout: 20000, guild_cut: 80000 }
    ]
  ])('stays quiet for %s', async (_label, over) => {
    const { confirms, sold } = await sell([OLDER(over), NEWER()], 2);
    expect(confirms).toEqual([]);
    expect(sold).toHaveLength(1);
  });

  it('stays quiet when the row being sold is the older one', async () => {
    const { confirms, sold } = await sell([OLDER(), NEWER()], 1);
    expect(confirms).toEqual([]);
    expect(sold).toHaveLength(1);
  });
});
