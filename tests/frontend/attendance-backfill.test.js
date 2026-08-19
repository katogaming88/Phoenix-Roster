import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/tabs/tab-roster.js is a plain browser script (no exports); this test
// loads it into a vm sandbox to reach backfillNotOnRosterForPlayer (#241) --
// the bulk write that marks every pre-join raid night "Not on Roster" for a
// mid-season roster add, so the player detail panel's attendance history
// doesn't show every historical night as blank/editable.

const ROSTER_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/tabs/tab-roster.js'),
  'utf8'
);

// js/common.js owns fetchAllPaged (#694) and tab-roster.js calls it as a
// global. Load common.js in its own sandbox and hand the real function over,
// so this suite exercises the shipped helper rather than a stand-in that could
// drift from it. Same reason writeAuditLog is mirrored below rather than
// stubbed away.
const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');
function realFetchAllPaged() {
  const commonSandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  vm.createContext(commonSandbox);
  vm.runInContext(COMMON_JS, commonSandbox, { filename: 'common.js' });
  if (typeof commonSandbox.fetchAllPaged !== 'function') {
    throw new Error('js/common.js does not define fetchAllPaged');
  }
  return commonSandbox.fetchAllPaged;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Routes .from(table).select().eq()... / .insert() / .rpc() to per-test
// resolvers, keyed by table+kind so a test can distinguish the "all raid
// dates" read from the "this player's existing dates" read.
//
// The kind is resolved at then() time from the accumulated record rather than
// from call order (#694): once both reads page, each fires several selects, so
// "first select is the team-wide one" stopped holding. The team-wide read is
// the one carrying .lt('raid_date', joinDate); the per-player read is not.
function makeSupabase(config) {
  const calls = { selects: [], inserts: [], rpc: null };
  function builder(kind, record) {
    const b = {
      eq(col, val) {
        record.eq = record.eq || [];
        record.eq.push([col, val]);
        return b;
      },
      lt(col, val) {
        record.lt = [col, val];
        return b;
      },
      gt(col, val) {
        record.gt = [col, val];
        return b;
      },
      order(col, opts) {
        record.order = record.order || [];
        record.order.push([col, !opts || opts.ascending !== false]);
        return b;
      },
      limit(n) {
        record.limit = n;
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            const resolved = kind === 'select' ? (record.lt ? 'select_all' : 'select_existing') : kind;
            return config[resolved] ? config[resolved](record) : { data: null, error: null };
          })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  const client = {
    from(table) {
      return {
        select(cols, opts) {
          const record = { table, select: cols, countRequested: !!(opts && opts.count) };
          calls.selects.push(record);
          return builder('select', record);
        },
        insert(rows) {
          const record = { table, rows };
          calls.inserts.push(record);
          return builder('insert', record);
        }
      };
    },
    rpc(name, params) {
      calls.rpc = { name, params };
      return builder('rpc', { name, params });
    }
  };
  return { client, calls };
}

function loadSandbox(supabaseClient) {
  const sandbox = {
    console,
    document: { getElementById: () => null },
    window: {},
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'tab-roster.js' });
  sandbox.supabaseClient = supabaseClient;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  sandbox.fetchAllPaged = realFetchAllPaged();
  // js/common.js's real writeAuditLog(), reimplemented here rather than
  // loading that whole file just for this one function.
  sandbox.writeAuditLog = function (action, targetType, targetId, detail) {
    return supabaseClient
      .rpc('write_audit_log', {
        p_team_id: sandbox._teamCfg.supabaseTeamId,
        p_action: action,
        p_target_type: targetType || null,
        p_target_id: targetId == null ? null : targetId,
        p_detail: detail == null ? null : String(detail)
      })
      .then(function (result) {
        if (result.error) console.warn('Failed to write audit log entry.', result.error.message);
      });
  };
  return sandbox;
}

describe('backfillNotOnRosterForPlayer (#241)', () => {
  it('does nothing when no join date is given', async () => {
    const { client, calls } = makeSupabase({});
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, null);
    expect(calls.selects).toHaveLength(0);
  });

  it('does nothing when the team has no raid nights before the join date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.inserts).toHaveLength(0);
  });

  it('inserts Not on Roster only for dates the player has no row for yet', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({
        data: [
          { id: 1, raid_date: '2026-06-01' },
          { id: 2, raid_date: '2026-06-08' },
          { id: 3, raid_date: '2026-06-08' }
        ],
        error: null
      }),
      select_existing: () => ({ data: [{ id: 4, raid_date: '2026-06-01' }], error: null }),
      insert: () => ({ data: null, error: null }),
      rpc: () => ({ data: null, error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    await flush();

    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].table).toBe('attendance');
    expect(calls.inserts[0].rows).toEqual([
      { team_id: 1, player_id: 5, raid_date: '2026-06-08', status: 'Not on Roster', source: 'WCL' }
    ]);
  });

  it('never overwrites a date the player already has a real status for', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [{ id: 1, raid_date: '2026-06-01' }], error: null }),
      select_existing: () => ({ data: [{ id: 2, raid_date: '2026-06-01' }], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.inserts).toHaveLength(0);
  });

  it('writes a single summary audit log entry, not one per date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({
        data: [
          { id: 1, raid_date: '2026-06-01' },
          { id: 2, raid_date: '2026-06-08' }
        ],
        error: null
      }),
      select_existing: () => ({ data: [], error: null }),
      insert: () => ({ data: null, error: null }),
      rpc: () => ({ data: null, error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    await flush();

    expect(calls.rpc.name).toBe('write_audit_log');
    expect(calls.rpc.params.p_action).toBe('Attendance Backfilled');
    expect(calls.rpc.params.p_detail).toContain('2 pre-join night(s)');
  });

  it('only looks at dates before the join date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.selects[0].lt).toEqual(['raid_date', '2026-07-01']);
  });

  // #694: this read drives INSERTs, so a capped read doesn't just display
  // less -- it writes an incomplete backfill that then looks like real data.
  describe('paging past the 1000-row cap (#694)', () => {
    const dateAt = (i) => new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10);

    // Keyset source with real semantics: honours .gt('id', ...) and .limit(),
    // and reports the exact count on the first page. A mock that ignored
    // those would hand an unpaginated implementation a passing grade.
    function pagedTeamRead(total) {
      const rows = [];
      for (let i = 0; i < total; i++) rows.push({ id: i + 1, raid_date: dateAt(i) });
      return (record) => {
        const after = record.gt ? record.gt[1] : null;
        const limit = record.limit || 1000;
        const slice = rows.filter((r) => after === null || r.id > after).slice(0, limit);
        return {
          data: slice.map((r) => ({ id: r.id, raid_date: r.raid_date })),
          error: null,
          count: after === null ? rows.length : null
        };
      };
    }

    it('marks every pre-join night when they span more than one page', async () => {
      const { client, calls } = makeSupabase({
        select_all: pagedTeamRead(1160),
        select_existing: () => ({ data: [], error: null }),
        insert: () => ({ data: null, error: null }),
        rpc: () => ({ data: null, error: null })
      });
      const sandbox = loadSandbox(client);
      await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
      await flush();

      expect(calls.inserts).toHaveLength(1);
      // Unpaginated, this is 1000 and the oldest 160 nights stay blank.
      expect(calls.inserts[0].rows).toHaveLength(1160);
      expect(calls.inserts[0].rows[0]).toEqual({
        team_id: 1,
        player_id: 5,
        raid_date: dateAt(0),
        status: 'Not on Roster',
        source: 'WCL'
      });
    });

    it('orders the team-wide read so paging is deterministic', async () => {
      const { client, calls } = makeSupabase({
        select_all: pagedTeamRead(1160),
        select_existing: () => ({ data: [], error: null }),
        insert: () => ({ data: null, error: null }),
        rpc: () => ({ data: null, error: null })
      });
      const sandbox = loadSandbox(client);
      await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
      await flush();

      const teamReads = calls.selects.filter((s) => s.lt);
      expect(teamReads.length).toBeGreaterThan(1);
      // Without an explicit order Postgres gives no guarantee page N+1
      // resumes where N stopped, so unordered paging skips and duplicates.
      teamReads.forEach((r) => expect(r.order).toEqual([['id', true]]));
      expect(teamReads[0].countRequested).toBe(true);
    });

    it("pages the player's own existing rows too", async () => {
      const { client, calls } = makeSupabase({
        select_all: pagedTeamRead(1160),
        select_existing: pagedTeamRead(1100),
        insert: () => ({ data: null, error: null }),
        rpc: () => ({ data: null, error: null })
      });
      const sandbox = loadSandbox(client);
      await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
      await flush();

      // The player already has the first 1100 of those 1160 nights, so only
      // the last 60 need filling. A capped read of their existing rows would
      // see 1000 and re-insert 160 duplicates over real history.
      expect(calls.inserts).toHaveLength(1);
      expect(calls.inserts[0].rows).toHaveLength(60);
    });

    it('writes nothing when the team-wide read fails', async () => {
      const { client, calls } = makeSupabase({
        select_all: () => ({ data: null, error: { message: 'boom' } }),
        select_existing: () => ({ data: [], error: null })
      });
      const sandbox = loadSandbox(client);
      await expect(sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01')).rejects.toThrow();
      expect(calls.inserts).toHaveLength(0);
    });
  });
});
