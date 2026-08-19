import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same vm-sandbox harness as roster-supabase.test.js: js/common.js is a plain
// browser script, so it loads into a context with the browser globals stubbed
// and its var/function declarations land on the sandbox.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs(supabase, consoleObj, search = '') {
  const windowObj = {};
  if (supabase) windowObj.supabase = supabase;
  const sandbox = {
    window: windowObj,
    location: { search, pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console: consoleObj || console,
    Intl,
    // Unref'd so the 10s fallback timers never hold the test process open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

// Table-aware stand-in for the supabase-js builder. Loot pages come from a
// queue (one entry per rclc_loot query); the players query gets rosterResult
// (loadData always fires both).
function mockSupabase({ lootPages = [], rosterResult } = {}) {
  const calls = { selects: [], eq: [], orders: [], ranges: [], gts: [], limits: [] };
  let page = 0;
  function makeBuilder(table) {
    const builder = {
      select(cols) {
        if (table === 'rclc_loot') calls.selects.push(cols);
        return builder;
      },
      eq(col, val) {
        if (table === 'rclc_loot') calls.eq.push([col, val]);
        return builder;
      },
      is() {
        return builder;
      },
      order(col) {
        if (table === 'rclc_loot') calls.orders.push(col);
        return builder;
      },
      range(from, to) {
        calls.ranges.push([from, to]);
        return builder;
      },
      gt(col, val) {
        if (table === 'rclc_loot') calls.gts.push([col, val]);
        return builder;
      },
      limit(n) {
        if (table === 'rclc_loot') calls.limits.push(n);
        return builder;
      },
      maybeSingle() {
        // team_settings (#221) fires alongside the roster query; this suite
        // isn't exercising it, so fall back to whatever the Apps Script core
        // payload already set, same as the other untested tables below.
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            if (table === 'players') {
              return rosterResult ? rosterResult() : { data: null, error: { message: 'roster not mocked' } };
            }
            if (table === 'team_settings') {
              return { data: null, error: { message: 'team_settings not mocked' } };
            }
            // bis_items, items, item_bosses, and priority_order are separate
            // queries loadData() fires alongside the loot pages (#217 item
            // search fix, #220 priority generator); this suite is only
            // exercising lootCounts wiring, so none of them are mocked and
            // all should fall back to the heavy payload's
            // bisList/itemSlots/itemBosses/priorityOrder untouched, same as
            // the 'players' default above. Without an explicit branch here,
            // these would fall through to the loot-page queue below and get
            // mistaken for real rows, since lootRow()'s fields
            // (items.name/players.name_realm/track/season) happen to overlap
            // what mapSupabasePriorityOrder() reads.
            if (table === 'bis_items') {
              return { data: null, error: { message: 'bis_items not mocked' } };
            }
            if (table === 'items') {
              return { data: null, error: { message: 'items not mocked' } };
            }
            if (table === 'item_bosses') {
              return { data: null, error: { message: 'item_bosses not mocked' } };
            }
            if (table === 'priority_order') {
              return { data: null, error: { message: 'priority_order not mocked' } };
            }
            const result = lootPages[Math.min(page, lootPages.length - 1)];
            page++;
            return typeof result === 'function' ? result() : result;
          })
          .then(onFulfilled, onRejected);
      }
    };
    return builder;
  }
  const client = { from: (table) => makeBuilder(table) };
  return { calls, supabase: { createClient: () => client } };
}

function lootRow(overrides) {
  return {
    // Keyset paging (#707) needs a numeric id on every row, and the query
    // selects one now; a row without it is not a shape production can produce.
    id: 1,
    track: 'Hero',
    season: 'MID1',
    awarded_at: '2026-03-25T04:07:00+00:00',
    items: { name: 'Signet of the Starved Beast' },
    players: { name_realm: 'Katorri-Stormrage' },
    ...overrides
  };
}

describe('mapSupabaseLoot', () => {
  const sandbox = loadCommonJs();

  it('rebuilds the getLootCounts() shape with GAS difficulty labels', () => {
    const rows = [
      lootRow(),
      lootRow({ track: 'Myth', items: { name: 'Frenzy’s Rebuke' } }),
      lootRow({ track: 'Champion', items: { name: 'Bond of Light' } })
    ];
    const map = sandbox.mapSupabaseLoot(rows);
    expect(Object.keys(map)).toEqual(['katorri-stormrage']);
    expect(map['katorri-stormrage'].count).toBe(3);
    expect(map['katorri-stormrage'].heroicCount).toBe(1);
    expect(map['katorri-stormrage'].mythicCount).toBe(1);
    expect(map['katorri-stormrage'].items.map((i) => i.difficulty)).toEqual(['Heroic', 'Mythic', 'Normal']);
    expect(map['katorri-stormrage'].items[0]).toEqual({
      name: 'Signet of the Starved Beast',
      difficulty: 'Heroic',
      date: 'Mar 25, 2026',
      season: 'Midnight Season 1'
    });
  });

  it('falls back to Other for an unrecognized track value', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ track: 'Unknown' })]);
    expect(map['katorri-stormrage'].items[0].difficulty).toBe('Other');
  });

  it('strips diacritics from the key exactly like the GAS normName', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ players: { name_realm: 'Katorrí-Stormrage' } })]);
    expect(Object.keys(map)).toEqual(['katorri-stormrage']);
  });

  it('formats award dates in the sheet timezone, not the viewer timezone', () => {
    // 01:30 UTC on Mar 18 is still Mar 17 in America/New_York.
    const map = sandbox.mapSupabaseLoot([lootRow({ awarded_at: '2026-03-18T01:30:00+00:00' })]);
    expect(map['katorri-stormrage'].items[0].date).toBe('Mar 17, 2026');
  });

  it('translates a season code that has never been hardcoded (#341 pattern match)', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ season: 'MID2' })]);
    expect(map['katorri-stormrage'].items[0].season).toBe('Midnight Season 2');
  });

  it('passes a season code matching neither an override nor the pattern through unchanged', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ season: 'DF3' })]);
    expect(map['katorri-stormrage'].items[0].season).toBe('DF3');
  });

  it('skips rows without a linked player and defaults missing item names', () => {
    const rows = [lootRow({ players: null }), lootRow({ items: null })];
    const map = sandbox.mapSupabaseLoot(rows);
    expect(map['katorri-stormrage'].count).toBe(1);
    expect(map['katorri-stormrage'].items[0].name).toBe('Unknown Item');
  });

  // #359: two characters sharing a first name no longer collapse into one
  // entry, since the key is the full name_realm identity, not first name
  // alone -- the opposite of the old GAS-parity behavior this replaced.
  it('keeps two characters sharing a first name as separate entries', () => {
    const warn = vi.fn();
    const warnSandbox = loadCommonJs(undefined, { ...console, warn });
    const rows = [lootRow(), lootRow({ players: { name_realm: 'Katorrí-Illidan' } })];
    const map = warnSandbox.mapSupabaseLoot(rows);
    expect(Object.keys(map).sort()).toEqual(['katorri-illidan', 'katorri-stormrage']);
    expect(map['katorri-stormrage'].count).toBe(1);
    expect(map['katorri-illidan'].count).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('fetchSupabaseLoot', () => {
  it('resolves null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs();
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  it('queries the team loot newest first', async () => {
    const rows = [lootRow()];
    const { calls, supabase } = mockSupabase({ lootPages: [{ data: rows, error: null }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toEqual(rows);
    expect(calls.selects[0]).toContain('items(name)');
    expect(calls.selects[0]).toContain('players(name_realm)');
    expect(calls.eq).toEqual([['team_id', 1]]);
    // Keyset paging orders by id ascending (#707); the newest-first order the
    // callers want is applied to the collected rows, not by the query.
    expect(calls.orders).toEqual(['id']);
    expect(calls.limits).toEqual([1000]);
    expect(calls.ranges).toEqual([]);
  });

  it('sorts the collected rows newest first, whatever order they were read in', async () => {
    const oldest = lootRow({ id: 1, awarded_at: '2026-01-01T00:00:00Z' });
    const newest = lootRow({ id: 2, awarded_at: '2026-03-01T00:00:00Z' });
    const middle = lootRow({ id: 3, awarded_at: '2026-02-01T00:00:00Z' });
    const { supabase } = mockSupabase({ lootPages: [{ data: [oldest, newest, middle], error: null }] });
    const sandbox = loadCommonJs(supabase);
    const rows = await sandbox.fetchSupabaseLoot();
    expect(rows.map((r) => r.awarded_at)).toEqual([
      '2026-03-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-01-01T00:00:00Z'
    ]);
  });

  it('breaks an awarded_at tie by id descending, the order the query used to ask for', async () => {
    const a = lootRow({ id: 5, awarded_at: '2026-01-01T00:00:00Z' });
    const b = lootRow({ id: 9, awarded_at: '2026-01-01T00:00:00Z' });
    const { supabase } = mockSupabase({ lootPages: [{ data: [a, b], error: null }] });
    const sandbox = loadCommonJs(supabase);
    const rows = await sandbox.fetchSupabaseLoot();
    expect(rows.map((r) => r.id)).toEqual([9, 5]);
  });

  it('sorts rows with no awarded_at last rather than dropping them', async () => {
    const dated = lootRow({ id: 1, awarded_at: '2026-01-01T00:00:00Z' });
    const undated = lootRow({ id: 2, awarded_at: null });
    const { supabase } = mockSupabase({ lootPages: [{ data: [undated, dated], error: null }] });
    const sandbox = loadCommonJs(supabase);
    const rows = await sandbox.fetchSupabaseLoot();
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it('pages past the PostgREST row cap, advancing the cursor by the last row id', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => lootRow({ id: i + 1 }));
    const shortPage = [lootRow({ id: 1001 }), lootRow({ id: 1002 })];
    const { calls, supabase } = mockSupabase({
      lootPages: [
        { data: fullPage, error: null },
        { data: shortPage, error: null }
      ]
    });
    const sandbox = loadCommonJs(supabase);
    const rows = await sandbox.fetchSupabaseLoot();
    expect(rows).toHaveLength(1002);
    // First page carries no cursor; the second resumes after the last id seen.
    expect(calls.gts).toEqual([['id', 1000]]);
  });

  it('resolves null on a query error result', async () => {
    const { supabase } = mockSupabase({ lootPages: [{ data: null, error: { message: 'nope' } }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  it('resolves null on a rejected query', async () => {
    const { supabase } = mockSupabase({
      lootPages: [
        () => {
          throw new Error('network down');
        }
      ]
    });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  // Was "resolves null on an empty result so the fallback applies". The
  // fallback it named was the GAS payload, retired in #225, and conflating an
  // empty table with a failed read is the thing #707 is removing: null now
  // means only that the read failed.
  it('resolves an empty array on an empty result, distinct from a failed read', async () => {
    const { supabase } = mockSupabase({ lootPages: [{ data: [], error: null }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toEqual([]);
  });
});

// GAS is retired (#225): loadData() no longer injects any core/heavy JSONP
// <script>, waits on window._rosterCoreCallback/_rosterHeavyCallback, or falls
// back to a GAS payload on a Supabase failure. It always builds DATA straight
// from the Supabase reads, seeding an empty roster/containers where a query
// has nothing -- the same path #426 originally built just for a gasUrl-less
// team (Immolation) and #225 now makes universal.
describe('loadData builds DATA from Supabase only', () => {
  async function runLoadData(mock) {
    const sandbox = loadCommonJs(mock.supabase);
    await new Promise((resolve) => {
      sandbox.loadData(
        () => {},
        () => resolve()
      );
    });
    return sandbox;
  }

  it('replaces lootCounts with the mapped Supabase feed', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [lootRow()], error: null }] });
    const sandbox = await runLoadData(mock);
    expect(Object.keys(sandbox.DATA.lootCounts)).toEqual(['katorri-stormrage']);
    expect(sandbox.DATA.lootCounts['katorri-stormrage'].heroicCount).toBe(1);
  });

  it('resolves to an empty loot feed when the query fails', async () => {
    const mock = mockSupabase({ lootPages: [{ data: null, error: { message: 'nope' } }] });
    const sandbox = await runLoadData(mock);
    expect(sandbox.DATA.lootCounts).toEqual({});
  });

  it('never installs the retired JSONP callback globals', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [lootRow()], error: null }] });
    const sandbox = await runLoadData(mock);
    expect(sandbox.window._rosterCoreCallback).toBeUndefined();
    expect(sandbox.window._rosterHeavyCallback).toBeUndefined();
  });

  it('seeds an empty array roster and empty containers when nothing is mocked', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [], error: null }] });
    const sandbox = await runLoadData(mock);
    // Empty, not undefined -- the write paths in tab-bis.js/tab-priority.js
    // index bisList/priorityOrder/selfReceived without their own guard, and
    // there is no GAS payload left to have supplied a non-empty fallback.
    expect(Array.isArray(sandbox.DATA.roster)).toBe(true);
    expect(sandbox.DATA.roster).toEqual([]);
    expect(sandbox.DATA.lootCounts).toEqual({});
    expect(sandbox.DATA.bisList).toEqual({});
    expect(sandbox.DATA.priorityOrder).toEqual({});
    expect(sandbox.DATA.selfReceived).toEqual({});
  });
});
