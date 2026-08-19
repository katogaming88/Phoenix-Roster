import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/common.js is a plain browser script (no exports); these tests load it
// into a vm sandbox the same way tests/frontend/roster-supabase.test.js does,
// to reach renderAttendanceHistoryCard/renderAddAttendanceNightControl/
// addAttendanceNight (#241) -- the "add a missing raid night" feature added
// to the officer roster player-detail panel's Attendance history card.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '', disabled: false, value: '', dataset: {} }, extra);
}

// Chainable mock matching what these functions actually call:
// .from(table).select(cols).eq(col,val).then(...)  (reads)
// .from(table).upsert(payload, opts).then(...)      (addAttendanceNight)
// .from(table).insert(rows).then(...)               (backfill, not used here)
// .rpc(name, params).then(...)                      (writeAuditLog)
function makeSupabase(config) {
  const calls = { selects: [], upserts: [], rpc: null };
  function builder(kind, record) {
    const b = {
      select(cols) {
        record.select = cols;
        return b;
      },
      eq(col, val) {
        record.eq = record.eq || [];
        record.eq.push([col, val]);
        return b;
      },
      // The team-wide raid-date read pages by keyset through fetchAllPaged
      // since #707, so the builder has to carry the cursor chain too.
      order(col, opts) {
        record.order = record.order || [];
        record.order.push([col, opts]);
        return b;
      },
      gt(col, val) {
        record.gt = [col, val];
        return b;
      },
      limit(n) {
        record.limit = n;
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => (config[kind] ? config[kind](record) : { data: null, error: null }))
          .then((result) => {
            // The read selects id now; supply the ones the real query returns
            // so the cursor can advance, and report the count on page one.
            if (!Array.isArray(result.data)) return result;
            return {
              ...result,
              data: result.data.map((row, i) => (typeof row.id === 'number' ? row : { ...row, id: i + 1 })),
              count: record.gt ? null : result.data.length
            };
          })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  const client = {
    from(table) {
      return {
        select(cols) {
          const record = { table, select: cols };
          calls.selects.push(record);
          return builder('select', record);
        },
        upsert(payload, opts) {
          const record = { table, payload, opts };
          calls.upserts.push(record);
          return builder('upsert', record);
        },
        insert(rows) {
          const record = { table, rows };
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

function loadSandbox({ supabaseClient, els = {}, roster = [] } = {}) {
  const createdScripts = [];
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => {
        const el = {};
        createdScripts.push(el);
        return el;
      },
      head: { appendChild: () => {} }
    },
    console,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  sandbox.supabaseClient = supabaseClient;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  sandbox.DATA = { roster };
  sandbox._createdScripts = createdScripts;
  return sandbox;
}

function player(overrides) {
  return Object.assign({ id: 5, firstName: 'Kato', nameRealm: 'Kato-Illidan', joinDate: null }, overrides);
}

describe('renderAttendanceHistoryCard (#241)', () => {
  it('shows the empty-history message and still renders the add-night control container', () => {
    const container = makeEl();
    const { client } = makeSupabase({ select: () => ({ data: [], error: null }) });
    const sandbox = loadSandbox({ supabaseClient: client, roster: [player()] });

    sandbox.renderAttendanceHistoryCard('Kato', container, []);

    expect(container.innerHTML).toContain('No attendance records found');
    expect(container.innerHTML).toContain('attend-add-night-Kato');
  });
});

describe('loadAttendanceHistory (#241 follow-up)', () => {
  it("reads the player's attendance rows straight from Supabase, not GAS", async () => {
    const els = { 'attend-history-Kato': makeEl({ style: { display: 'none' } }) };
    const { client, calls } = makeSupabase({
      select: () => ({
        data: [
          { raid_date: '2026-07-01', status: 'Present' },
          { raid_date: '2026-06-25', status: 'No Show' }
        ],
        error: null
      })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.loadAttendanceHistory('Kato');
    await flush();

    expect(calls.selects[0].table).toBe('attendance');
    expect(calls.selects[0].eq).toEqual([
      ['team_id', 1],
      ['player_id', 5]
    ]);
    expect(sandbox._createdScripts).toHaveLength(0);
    expect(els['attend-history-Kato'].innerHTML).toContain('2026-07-01');
    expect(els['attend-history-Kato'].innerHTML).toContain('2026-06-25');
  });

  // #225: GAS is retired, so a query error (or an unresolvable player, below)
  // has nothing left to fall back to -- it surfaces an inline error instead
  // of silently substituting GAS data, same as fetchSupabaseRoster/BiS/
  // priority_order's own no-fallback convention.
  it('shows an inline error, not a GAS fallback, when the Supabase query errors', async () => {
    const els = { 'attend-history-Kato': makeEl({ style: { display: 'none' } }) };
    const { client } = makeSupabase({
      select: () => ({ data: null, error: { message: 'boom' } })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.loadAttendanceHistory('Kato');
    await flush();

    expect(sandbox._createdScripts).toHaveLength(0);
    expect(els['attend-history-Kato'].innerHTML).toContain('Failed to load. Try again.');
  });

  it('shows an inline error, not a GAS fallback, when no matching roster player is found', () => {
    const els = { 'attend-history-Kato': makeEl({ style: { display: 'none' } }) };
    const { client } = makeSupabase({});
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [] });

    sandbox.loadAttendanceHistory('Kato');

    expect(sandbox._createdScripts).toHaveLength(0);
    expect(els['attend-history-Kato'].innerHTML).toContain('Failed to load. Try again.');
  });
});

describe('renderAddAttendanceNightControl (#241)', () => {
  it('offers a distinct raid date the player has no row for yet', async () => {
    const els = { 'attend-add-night-Kato': makeEl() };
    const { client } = makeSupabase({
      select: () => ({
        data: [{ raid_date: '2026-07-01' }, { raid_date: '2026-07-08' }, { raid_date: '2026-07-08' }],
        error: null
      })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.renderAddAttendanceNightControl('Kato', []);
    await flush();

    const html = els['attend-add-night-Kato'].innerHTML;
    expect(html).toContain('2026-07-01');
    expect(html).toContain('2026-07-08');
    // deduped despite the duplicate row above -- one <option>, not two
    expect((html.match(/<option value="2026-07-08"/g) || []).length).toBe(1);
  });

  it('excludes a date the player already has a history row for', async () => {
    const els = { 'attend-add-night-Kato': makeEl() };
    const { client } = makeSupabase({
      select: () => ({ data: [{ raid_date: '2026-07-01' }, { raid_date: '2026-07-08' }], error: null })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.renderAddAttendanceNightControl('Kato', [{ date: '2026-07-01', status: 'Present' }]);
    await flush();

    const html = els['attend-add-night-Kato'].innerHTML;
    expect(html).not.toContain('2026-07-01');
    expect(html).toContain('2026-07-08');
  });

  it("excludes dates before the player's join date (backfilled automatically instead)", async () => {
    const els = { 'attend-add-night-Kato': makeEl() };
    const { client } = makeSupabase({
      select: () => ({ data: [{ raid_date: '2026-06-01' }, { raid_date: '2026-07-08' }], error: null })
    });
    const sandbox = loadSandbox({
      supabaseClient: client,
      els,
      roster: [player({ joinDate: '2026-07-01' })]
    });

    sandbox.renderAddAttendanceNightControl('Kato', []);
    await flush();

    const html = els['attend-add-night-Kato'].innerHTML;
    expect(html).not.toContain('2026-06-01');
    expect(html).toContain('2026-07-08');
  });

  it('leaves the container empty when there are no candidate dates', async () => {
    const els = { 'attend-add-night-Kato': makeEl({ innerHTML: 'stale' }) };
    const { client } = makeSupabase({ select: () => ({ data: [{ raid_date: '2026-07-01' }], error: null }) });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.renderAddAttendanceNightControl('Kato', [{ date: '2026-07-01', status: 'Present' }]);
    await flush();

    expect(els['attend-add-night-Kato'].innerHTML).toBe('stale');
  });
});

describe('addAttendanceNight (#241)', () => {
  function setup(rpcResult) {
    const els = {
      'attend-add-date-Kato': makeEl({ value: '2026-07-08' }),
      'attend-add-status-Kato': makeEl({ value: 'Present' }),
      'attend-add-ind-Kato': makeEl(),
      // applyNewAttendanceNight re-renders into this on success -- must exist
      // for the in-place update path (no GAS round-trip, see next describe).
      'attend-history-Kato': makeEl()
    };
    const { client, calls } = makeSupabase({
      upsert: () => ({ data: null, error: null }),
      rpc: () => rpcResult || { data: null, error: null },
      // renderAddAttendanceNightControl's re-render after the update queries
      // raid dates again; empty is fine, not the point of these tests.
      select: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });
    return { els, sandbox, calls };
  }

  it('upserts the new night and writes an audit log entry', async () => {
    const { sandbox, calls } = setup();
    sandbox.addAttendanceNight('Kato');
    await flush();

    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].table).toBe('attendance');
    expect(calls.upserts[0].payload).toEqual({
      team_id: 1,
      player_id: 5,
      raid_date: '2026-07-08',
      status: 'Present'
    });
    expect(calls.upserts[0].opts).toEqual({ onConflict: 'team_id,player_id,raid_date' });
  });

  it('calls writeAuditLog via the write_audit_log RPC on success', async () => {
    const { sandbox, calls } = setup();
    sandbox.addAttendanceNight('Kato');
    await flush();
    await flush();

    expect(calls.rpc.name).toBe('write_audit_log');
    expect(calls.rpc.params.p_action).toBe('Attendance Status Set');
    expect(calls.rpc.params.p_detail).toContain('2026-07-08');
  });

  it('updates the card in place with the new night, without a GAS re-fetch', async () => {
    const { els, sandbox } = setup();
    sandbox.addAttendanceNight('Kato');
    await flush();
    await flush();

    expect(els['attend-history-Kato'].innerHTML).toContain('2026-07-08');
  });

  it('does nothing when no date/status is selected', () => {
    const els = {
      'attend-add-date-Kato': makeEl({ value: '' }),
      'attend-add-status-Kato': makeEl({ value: 'Present' })
    };
    const { client, calls } = makeSupabase({});
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });
    sandbox.addAttendanceNight('Kato');
    expect(calls.upserts).toHaveLength(0);
  });

  it('re-enables the selects and shows Error on a failed upsert', async () => {
    const els = {
      'attend-add-date-Kato': makeEl({ value: '2026-07-08' }),
      'attend-add-status-Kato': makeEl({ value: 'Present' }),
      'attend-add-ind-Kato': makeEl()
    };
    const { client } = makeSupabase({
      upsert: () => ({ data: null, error: { message: 'boom' } })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els, roster: [player()] });

    sandbox.addAttendanceNight('Kato');
    await flush();
    await flush();

    expect(els['attend-add-date-Kato'].disabled).toBe(false);
    expect(els['attend-add-status-Kato'].disabled).toBe(false);
    expect(els['attend-add-ind-Kato'].textContent).toBe('Error');
  });
});
