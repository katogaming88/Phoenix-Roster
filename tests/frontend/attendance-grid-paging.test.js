import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged } from './helpers/common-sandbox.js';
import { keysetClient } from './helpers/supabase-mock.js';

// loadAttendanceGrid (#694): the officer Attendance grid read the whole team's
// attendance with no paging, so past 1000 rows PostgREST truncated the result
// and returned it as a normal 200. Ordered raid_date descending, what fell off
// was the oldest nights -- the start of the season silently missing from the
// grid and from the night dropdown, with no error anywhere.

const ATTENDANCE_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/tabs/tab-attendance.js'),
  'utf8'
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const dateAt = (i) => new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10);

function loadSandbox(client, roster) {
  const elements = {};
  const makeEl = () => ({
    textContent: '',
    innerHTML: '',
    style: { display: '', color: '' },
    selectedIndex: 0,
    appendChild() {},
    options: []
  });
  ['attendGridStatus', 'attendGridNightRow', 'attendGridTable', 'attendNightSelect'].forEach((id) => {
    elements[id] = makeEl();
  });
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => makeEl()
    },
    window: {},
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(ATTENDANCE_JS, sandbox, { filename: 'tab-attendance.js' });
  sandbox.supabaseClient = client;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  sandbox.DATA = { roster: roster };
  // Rendering is exercised by its own suites; this one is about what the
  // fetch collects.
  sandbox.renderAttendanceGrid = () => {};
  sandbox.buildBenchFairness = () => {};
  sandbox.fetchAllPaged = null; // replaced below once common.js's helper loads
  return { sandbox, elements };
}

// js/common.js owns fetchAllPaged and tab-attendance.js calls it as a global.
// realFetchAllPaged (./helpers/common-sandbox.js) loads the shipped helper out
// of common.js and hands it over, so this suite exercises the real function
// rather than a copy that could drift from it.
function attachFetchAllPaged(sandbox) {
  sandbox.fetchAllPaged = realFetchAllPaged();
}

function makeRows(nights, playersPerNight) {
  const rows = [];
  let id = 1;
  for (let n = 0; n < nights; n++) {
    for (let p = 0; p < playersPerNight; p++) {
      rows.push({
        id: id++,
        raid_date: dateAt(n),
        report_title: 'Night ' + n,
        report_excluded: false,
        player_id: p + 1,
        status: 'Present',
        source: 'WCL'
      });
    }
  }
  return rows;
}

describe('loadAttendanceGrid paging (#694)', () => {
  const roster = [
    { id: 1, firstName: 'Aaa' },
    { id: 2, firstName: 'Bbb' }
  ];

  it('keeps the oldest raid nights when the team is past the 1000-row cap', async () => {
    // 580 nights x 2 players = 1160 rows, matching Phoenix at the time this
    // was found. Unpaginated, the last 80 nights never arrive.
    const { client } = keysetClient(makeRows(580, 2));
    const { sandbox } = loadSandbox(client, roster);
    attachFetchAllPaged(sandbox);

    sandbox.loadAttendanceGrid();
    await flush();
    await flush();
    await flush();

    expect(sandbox._attendanceGrid).not.toBeNull();
    expect(sandbox._attendanceGrid).toHaveLength(580);
    const dates = sandbox._attendanceGrid.map((n) => n.date);
    expect(dates).toContain(dateAt(0));
    expect(dates).toContain(dateAt(579));
  });

  it('still lists nights newest first after paging by id', async () => {
    const { client } = keysetClient(makeRows(580, 2));
    const { sandbox } = loadSandbox(client, roster);
    attachFetchAllPaged(sandbox);

    sandbox.loadAttendanceGrid();
    await flush();
    await flush();
    await flush();

    const dates = sandbox._attendanceGrid.map((n) => n.date);
    // Keyset paging orders by id, but the grid and its night dropdown are
    // newest-first, so the display order has to be restored after collecting.
    expect(dates[0]).toBe(dateAt(579));
    expect(dates[dates.length - 1]).toBe(dateAt(0));
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('orders and counts the read so paging is deterministic', async () => {
    const { client, calls } = keysetClient(makeRows(580, 2));
    const { sandbox } = loadSandbox(client, roster);
    attachFetchAllPaged(sandbox);

    sandbox.loadAttendanceGrid();
    await flush();
    await flush();
    await flush();

    expect(calls.selects.length).toBeGreaterThan(1);
    expect(calls.selects[0].countRequested).toBe(true);
    calls.selects.forEach((s) => expect(s.order).toEqual([['id', true]]));
    expect(calls.gts.length).toBe(calls.selects.length - 1);
  });

  it('leaves the grid unloaded and shows an error when the read fails', async () => {
    const client = {
      from: () => ({
        select: () => {
          const b = {
            eq: () => b,
            gt: () => b,
            order: () => b,
            limit: () => b,
            then: (onFulfilled, onRejected) =>
              Promise.resolve({ data: null, error: { message: 'boom' }, count: null }).then(onFulfilled, onRejected)
          };
          return b;
        }
      })
    };
    const { sandbox, elements } = loadSandbox(client, roster);
    attachFetchAllPaged(sandbox);

    sandbox.loadAttendanceGrid();
    await flush();
    await flush();

    // null, not [] -- an empty grid renders as "no raid nights recorded yet",
    // which is a different claim from "this failed to load".
    expect(sandbox._attendanceGrid).toBeNull();
    expect(elements.attendGridStatus.textContent).toMatch(/error|failed/i);
  });
});
