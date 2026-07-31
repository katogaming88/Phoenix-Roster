import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// renderAttendTrend()'s per-month tooltip used to show just this player's own
// recorded-night count (e.g. "88% (8 raids)"), which is this player's own
// row count, not necessarily every raid night the team actually held that
// month -- a player who joined mid-month, or who's missing a row for some
// other reason, would show a count lower than the team's real total with no
// way to tell the two apart. The tooltip now shows "attended/total raids",
// where total comes from _teamRaidNightsByMonth() (DATA.rawAttendanceData.
// raidDates -- the same distinct-dates list mapSupabaseAttendanceRaw()
// already builds, with report_excluded nights already left out of it), and
// attended counts only Present/Bench nights (Excused/Medical Leave/Extended
// Leave/No Show don't count as attended even though they still carry
// partial weight in the displayed percentage).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function loadCommonJs() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
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
  return sandbox;
}

// Extracts the tooltip text embedded in showAttendTip(event,'...') for the
// given month's <g> element, in render order.
function tooltipsFrom(svgHtml) {
  return [...svgHtml.matchAll(/showAttendTip\(event,'([^']+)'\)/g)].map((m) => m[1]);
}

describe('_teamRaidNightsByMonth', () => {
  it('counts distinct raid dates from rawAttendanceData.raidDates, grouped by month', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      rawAttendanceData: {
        raidDates: ['2026-06-01', '2026-07-01', '2026-07-08', '2026-07-15']
      }
    };
    expect(sandbox._teamRaidNightsByMonth()).toEqual({ '2026-06': 1, '2026-07': 3 });
  });

  it('a report_excluded night never reaches raidDates in the first place (mapSupabaseAttendanceRaw), so it is not counted here either', () => {
    const sandbox = loadCommonJs();
    // mapSupabaseAttendanceRaw() drops report_excluded rows before ever
    // adding their date to raidDateSet -- confirmed against live data where
    // an entire raid night had every row report_excluded and the resulting
    // raidDates simply never included that date. This test documents that
    // _teamRaidNightsByMonth() inherits that exclusion for free by reusing
    // raidDates rather than re-deriving its own date set.
    const roster = [{ id: 1, firstName: 'Fluffy', joinDate: '' }];
    const rows = [
      { player_id: 1, raid_date: '2026-07-02', status: 'Present', report_excluded: false },
      { player_id: 1, raid_date: '2026-07-13', status: 'Present', report_excluded: true }
    ];
    sandbox.DATA = { rawAttendanceData: sandbox.mapSupabaseAttendanceRaw(rows, roster) };
    expect(sandbox._teamRaidNightsByMonth()).toEqual({ '2026-07': 1 });
  });

  it('returns an empty object when rawAttendanceData has not loaded', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {};
    expect(sandbox._teamRaidNightsByMonth()).toEqual({});
  });
});

describe('renderAttendTrend month tooltip', () => {
  it('shows attended/total, where total is the team-wide raid count for the month', () => {
    const sandbox = loadCommonJs();
    // Two months of data forces the per-month aggregate branch (the
    // single-night fallback branch only fires when monthOrder.length <= 1).
    sandbox.DATA = {
      recentAttendanceTrend: {
        Fluffy: [
          // renderAttendTrend reverses this (newest-first input), so list
          // newest-to-oldest here.
          { date: '2026-07-15', status: 'Excused' },
          { date: '2026-07-08', status: 'Present' },
          { date: '2026-07-01', status: 'Present' },
          { date: '2026-06-01', status: 'Present' }
        ]
      },
      rawAttendanceData: {
        // Two more July raid nights nobody has Fluffy marked for at all --
        // still real team raid nights (some other player attended), so
        // July's total should be 5, not Fluffy's own 3 recorded July nights.
        raidDates: ['2026-06-01', '2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29']
      }
    };

    const html = sandbox.renderAttendTrend('Fluffy');
    const tips = tooltipsFrom(html);
    // June: 1 attended (Present) / 1 total team raid night that month.
    expect(tips).toContain('Jun 2026: 100% (1/1 raid)');
    // July: Fluffy attended 2 of her own recorded nights (Present, Present --
    // the Excused night doesn't count as attended), out of 5 total team
    // raid nights that month.
    expect(tips.some((t) => t.startsWith('Jul 2026:') && t.endsWith('(2/5 raids)'))).toBe(true);
  });

  it('falls back to this player’s own attended count as the total when rawAttendanceData is missing', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      recentAttendanceTrend: {
        Fluffy: [
          { date: '2026-07-08', status: 'Present' },
          { date: '2026-07-01', status: 'Present' },
          { date: '2026-06-01', status: 'Present' }
        ]
      }
    };

    const html = sandbox.renderAttendTrend('Fluffy');
    const tips = tooltipsFrom(html);
    expect(tips.some((t) => t.startsWith('Jul 2026:') && t.endsWith('(2/2 raids)'))).toBe(true);
  });
});
