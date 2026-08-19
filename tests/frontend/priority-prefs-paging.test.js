import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

// fetchTeamItemPreferences pages through the shared helper (#707 item 3).
//
// It was the third hand-rolled loop: OFFSET paging, advancing by page size and
// stopping on a short page, with a single 20s budget raced against the whole
// read rather than against each page. A budget spanning N sequential round
// trips becomes a truncation mechanism as N grows, which is the failure #691
// already hit once by raising 10s to 20s in the same diff that added paging.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function prefRows(total, startId = 1) {
  const rows = [];
  for (let i = 0; i < total; i++) {
    rows.push({
      id: startId + i,
      player_id: (i % 25) + 1,
      item_id: 1000 + i,
      status: 'bis',
      slot: null,
      season: 'Midnight Season 2',
      note: null
    });
  }
  return rows;
}

function load(client) {
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: { getElementById: () => null },
    DATA: {},
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  // js/common.js owns fetchAllPaged; tab-priority.js calls it as a global.
  sandbox.fetchAllPaged = realFetchAllPaged();
  return sandbox;
}

describe('fetchTeamItemPreferences (#707)', () => {
  it('collects every row across pages, each exactly once', async () => {
    const { client } = keysetClient(prefRows(2562));
    const rows = await load(client).fetchTeamItemPreferences();
    expect(rows).toHaveLength(2562);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2562);
  });

  it('still selects season, which the officer view needs to scope rows', async () => {
    const { client, calls } = keysetClient(prefRows(3));
    await load(client).fetchTeamItemPreferences();
    expect(calls.selects[0].select).toContain('season');
    expect(calls.selects[0].select).toContain('id');
    expect(calls.selects[0].select).toContain('note');
  });

  it('does not spend a request past the end when the total is an exact multiple of the page size', async () => {
    const { client, calls } = keysetClient(prefRows(2000));
    const rows = await load(client).fetchTeamItemPreferences();
    expect(rows).toHaveLength(2000);
    expect(calls.selects).toHaveLength(2);
  });

  it('resolves an empty array for a team whose wishlists are untouched', async () => {
    const { client } = keysetClient([]);
    await expect(load(client).fetchTeamItemPreferences()).resolves.toEqual([]);
  });

  it('resolves null on a failed read rather than the rows it managed to collect', async () => {
    const { client } = failingClient('prefs boom');
    await expect(load(client).fetchTeamItemPreferences()).resolves.toBeNull();
  });

  it('budgets each page rather than the whole read', async () => {
    // Every page is slow but none is stuck. A single budget across the read
    // would fail this as the row count grows; a per-page one does not.
    const rows = prefRows(2500);
    const client = {
      from() {
        const record = {};
        const b = {
          select() {
            return b;
          },
          eq() {
            return b;
          },
          order() {
            return b;
          },
          gt(col, val) {
            record.after = val;
            return b;
          },
          limit(n) {
            record.limit = n;
            return b;
          },
          then(onFulfilled, onRejected) {
            return new Promise((resolve) => setTimeout(resolve, 30))
              .then(() => {
                const after = record.after === undefined ? null : record.after;
                const slice = rows.filter((r) => after === null || r.id > after).slice(0, record.limit || 1000);
                return { data: slice, error: null, count: after === null ? rows.length : null };
              })
              .then(onFulfilled, onRejected);
          }
        };
        return b;
      }
    };
    const sandbox = load(client);
    sandbox.fetchAllPaged = realFetchAllPaged();
    const result = await sandbox.fetchTeamItemPreferences();
    expect(result).toHaveLength(2500);
  });
});
