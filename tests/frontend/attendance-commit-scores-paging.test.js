import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

// executeCommitScores reads the whole team's attendance and writes a score per
// player from it (#707).
//
// This is the worst shape in the #694 family: a truncated read driving a
// write. Unpaged it stopped at the 1000-row cap with no error, and team 1 was
// at 1160 rows when this was found, so committing scores averaged over part of
// the season and stored the result as fact. Same shape as the "Not on Roster"
// backfill #696 fixed, except the wrong numbers here are the ones officers
// rank players by.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATTENDANCE_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-attendance.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// One player, `nights` raid nights, where everything past the first page is a
// No Show. A complete read scores them well below full marks; a read that
// stops at the cap sees nothing but Present and scores them 100%. The two
// answers differ, which is what makes this a test of the read rather than of
// the arithmetic.
function attendanceRows(nights, playerId = 7) {
  const rows = [];
  for (let i = 0; i < nights; i++) {
    rows.push({
      id: i + 1,
      player_id: playerId,
      raid_date: '2026-01-' + String((i % 28) + 1).padStart(2, '0'),
      status: i < 1000 ? 'Present' : 'No Show',
      report_excluded: false
    });
  }
  return rows;
}

function loadSandbox(client) {
  // Both the success and failure paths write style.color and set a timer, so
  // the stubs carry style objects; without them the chain rejects after the
  // assertions have already passed, which surfaces as an unhandled rejection
  // rather than a failing test.
  const els = {
    commitScoresBtn: { disabled: false, textContent: '', style: {} },
    commitScoresStatus: { textContent: '', style: {} }
  };
  const upserts = [];
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: { getElementById: (id) => els[id] || null },
    window: { DATA: { seasonName: 'Midnight Season 2' } },
    DATA: { seasonName: 'Midnight Season 2' },
    _teamCfg: { supabaseTeamId: 1 },
    ATTENDANCE_WEIGHTS_JS: { Present: 1, Bench: 1, 'No Show': 0 },
    seasonCodeForDisplay: () => 'MID2',
    writeAuditLog: () => Promise.resolve(),
    // Unref'd so the success path's 6s status-reset timer never holds the
    // test process open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(ATTENDANCE_JS, sandbox, { filename: 'tab-attendance.js' });
  sandbox.fetchAllPaged = realFetchAllPaged();
  // Wrap the client so the scoring upsert is observable while the attendance
  // read still comes from the keyset mock.
  sandbox.supabaseClient = {
    from(table) {
      if (table === 'scoring') {
        return {
          upsert(rows) {
            upserts.push(rows);
            return Promise.resolve({ data: null, error: null });
          }
        };
      }
      return client.from(table);
    }
  };
  return { sandbox, els, upserts };
}

describe('executeCommitScores pages the attendance it scores from (#707)', () => {
  it('counts every raid night past the 1000-row cap, not just the first page', async () => {
    const { client } = keysetClient(attendanceRows(1160));
    const { sandbox, upserts } = loadSandbox(client);

    sandbox.executeCommitScores();
    for (let i = 0; i < 12; i++) await flush();

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toHaveLength(1);
    expect(upserts[0][0].player_id).toBe(7);
    // 1000 Present out of 1160 nights. Truncated at the cap this reads 100.
    expect(upserts[0][0].attendance_pct).toBeCloseTo(86.2, 1);
  });

  it('reads every page rather than stopping at the first', async () => {
    const { client, calls } = keysetClient(attendanceRows(1160));
    const { sandbox } = loadSandbox(client);

    sandbox.executeCommitScores();
    for (let i = 0; i < 12; i++) await flush();

    expect(calls.selects.length).toBeGreaterThan(1);
    expect(calls.gts).toEqual([['id', 1000]]);
  });

  it('writes nothing at all when the read fails, rather than scoring off partial rows', async () => {
    const { client } = failingClient('attendance boom');
    const { sandbox, upserts, els } = loadSandbox(client);

    sandbox.executeCommitScores();
    for (let i = 0; i < 12; i++) await flush();

    expect(upserts).toEqual([]);
    expect(els.commitScoresStatus.textContent).toMatch(/could not|failed/i);
  });
});
