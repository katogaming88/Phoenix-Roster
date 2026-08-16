import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Attendance has three states, not two: loaded, still loading, and failed
// (#694). DATA.rawAttendanceData is falsy for both of the last two, and until
// this change getDisplayAttendancePct() collapsed them into the string '0%'
// via a dead `player.attendance` field left behind when Apps Script was
// retired (#225). Every consumer then treated that 0% as a real measurement:
// the low-attendance filter matched the whole roster, the below-threshold
// list named everyone, the team average read 0, and the season archive froze
// a blank column into permanent history.
//
// These tests pin the replacement contract: unknown is null, null formats as
// a dash, and no aggregate silently reports an empty or zero result for it.
// Same load-common.js-then-the-tab-file sandbox pattern as
// tests/frontend/roster-score-cell.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-roster.js'), 'utf8');
const ATTENDANCE_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-attendance.js'), 'utf8');

function makeEl(value) {
  return { innerHTML: '', textContent: '', style: {}, value: value, className: '', disabled: false };
}

// tabFiles is a list of extra sources to run in the same context after
// common.js, so a test only pays for the tab it actually exercises.
function makeSandbox(opts) {
  const options = opts || {};
  const els = options.els || {};
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  (options.tabFiles || []).forEach(function (src) {
    vm.runInContext(src.code, sandbox, { filename: src.name });
  });
  sandbox.DATA = options.data || {};
  if (options.activeSeason !== undefined) sandbox.ACTIVE_SEASON = options.activeSeason;
  return sandbox;
}

// rawAttendanceData's shape, as mapSupabaseAttendanceRaw() emits it.
function rawAttendance(players, joinDates) {
  return { players: players, joinDates: joinDates || {} };
}

const SUPABASE_ROW = {
  id: 7,
  name_realm: 'Katorri-Stormrage',
  nickname: 'Kat',
  is_trial: false,
  is_bench: false,
  bis_link: '',
  join_date: '2026-03-17',
  classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
};

describe('mapSupabaseRoster no longer carries the retired GAS attendance field', () => {
  it('emits no attendance key at all', () => {
    const sandbox = makeSandbox({});
    const mapped = sandbox.mapSupabaseRoster([SUPABASE_ROW], {});
    expect(mapped).toHaveLength(1);
    expect('attendance' in mapped[0]).toBe(false);
  });

  it('takes the rejections map as its second argument', () => {
    const sandbox = makeSandbox({});
    const mapped = sandbox.mapSupabaseRoster([SUPABASE_ROW], { 7: 'declined the invite' });
    expect(mapped[0].mPlusRejected).toBe(true);
    expect(mapped[0].mPlusRejectionNote).toBe('declined the invite');
  });
});

describe('getDisplayAttendancePct distinguishes unknown from zero', () => {
  it('returns the computed percentage when rawAttendanceData is present', () => {
    const sandbox = makeSandbox({
      data: {
        rawAttendanceData: rawAttendance({
          Katorri: [
            { date: '2026-04-01', status: 'Present' },
            { date: '2026-04-02', status: 'No Show' }
          ]
        })
      }
    });
    expect(sandbox.getDisplayAttendancePct({ firstName: 'Katorri' })).toBe('50.0%');
  });

  it('returns null, not "0%", while attendance is still loading', () => {
    const sandbox = makeSandbox({ data: { rawAttendanceData: null } });
    expect(sandbox.getDisplayAttendancePct({ firstName: 'Katorri' })).toBe(null);
  });

  it('returns null, not "0%", when the attendance load failed', () => {
    const sandbox = makeSandbox({ data: { rawAttendanceData: null, _attendanceLoadFailed: true } });
    expect(sandbox.getDisplayAttendancePct({ firstName: 'Katorri' })).toBe(null);
  });

  it('still gives a brand-new roster add full credit rather than unknown', () => {
    const sandbox = makeSandbox({ data: { rawAttendanceData: rawAttendance({}) } });
    expect(sandbox.getDisplayAttendancePct({ firstName: 'Newbie' })).toBe('100.0%');
  });
});

describe('formatAttendancePct', () => {
  it('renders unknown as a dash', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.formatAttendancePct(null)).toBe('-');
  });

  it('passes a real percentage through untouched', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.formatAttendancePct('95.0%')).toBe('95.0%');
  });
});

describe('attendColor', () => {
  it('does not paint an unknown value red', () => {
    const sandbox = makeSandbox({});
    const red = sandbox.attendColor(10);
    expect(sandbox.attendColor(null)).not.toBe(red);
    expect(sandbox.attendColor(NaN)).not.toBe(red);
  });

  it('keeps the existing thresholds for known values', () => {
    const sandbox = makeSandbox({});
    expect(sandbox.attendColor(95)).toBe('var(--heal)');
    expect(sandbox.attendColor(75)).toBe('var(--gold)');
    expect(sandbox.attendColor(10)).toBe('var(--melee)');
  });
});

describe('getEligibleAttendanceRecs', () => {
  it('returns null when attendance is unknown, so callers can tell it apart from none', () => {
    const sandbox = makeSandbox({ data: { rawAttendanceData: null } });
    expect(sandbox.getEligibleAttendanceRecs('Katorri')).toBe(null);
  });

  it('returns an empty array for a player with no eligible nights', () => {
    const sandbox = makeSandbox({ data: { rawAttendanceData: rawAttendance({}) } });
    expect(sandbox.getEligibleAttendanceRecs('Newbie')).toEqual([]);
  });

  it('excludes Not on Roster rows and rows with no status yet', () => {
    const sandbox = makeSandbox({
      data: {
        rawAttendanceData: rawAttendance({
          Katorri: [
            { date: '2026-04-01', status: 'Present' },
            { date: '2026-04-02', status: 'Not on Roster' },
            { date: '2026-04-03', status: '' }
          ]
        })
      }
    });
    expect(sandbox.getEligibleAttendanceRecs('Katorri')).toHaveLength(1);
  });
});

describe('roster tab aggregates refuse to report unknown attendance as a number', () => {
  const tabFiles = [{ code: ROSTER_JS, name: 'tab-roster.js' }];

  it('the low-attendance filter matches nobody rather than everybody', () => {
    const els = { rosterTable: makeEl() };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: null,
        roster: [
          { firstName: 'Katorri', nameRealm: 'Katorri-Stormrage', role: 'Heal', joinDate: '2026-03-17' },
          { firstName: 'Second', nameRealm: 'Second-Stormrage', role: 'Melee', joinDate: '2026-03-17' }
        ]
      }
    });
    // activeFilters lives in js/officer.js, which the sandbox does not load.
    sandbox.activeFilters = { lowAttend: true, noBis: false, trial: false, bench: false, role: null };
    sandbox._fetchTeamScoringIfNeeded = () => {};
    sandbox.buildRosterTable();
    expect(els.rosterTable.innerHTML).not.toContain('Katorri');
    expect(els.rosterTable.innerHTML).not.toContain('Second');
  });

  it('a roster row renders a dash rather than a red 0% when attendance is unknown', () => {
    const els = { rosterTable: makeEl() };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: null,
        roster: [{ firstName: 'Katorri', nameRealm: 'Katorri-Stormrage', role: 'Heal', joinDate: '2026-03-17' }]
      }
    });
    sandbox.activeFilters = { lowAttend: false, noBis: false, trial: false, bench: false, role: null };
    sandbox._fetchTeamScoringIfNeeded = () => {};
    sandbox.buildRosterTable();
    expect(els.rosterTable.innerHTML).toContain('Katorri');
    expect(els.rosterTable.innerHTML).not.toContain('0.0%');
    expect(els.rosterTable.innerHTML).not.toContain('var(--melee)');
  });

  it('the stats bar shows a dash for the average rather than 0%', () => {
    const els = { officerStats: makeEl() };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: null,
        roster: [{ firstName: 'Katorri', nameRealm: 'Katorri-Stormrage', role: 'Heal', bisLink: '' }]
      }
    });
    sandbox.buildStatsBar();
    expect(els.officerStats.innerHTML).toContain('Avg Attendance');
    expect(els.officerStats.innerHTML).not.toContain('>0%<');
  });

  it('the trial promo alert banners instead of rendering empty', () => {
    const els = { trialPromoAlert: makeEl() };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: null,
        _attendanceLoadFailed: true,
        roster: [
          {
            firstName: 'Trialist',
            nameRealm: 'Trialist-Stormrage',
            role: 'Melee',
            isTrial: true,
            joinDate: '2026-01-01'
          }
        ]
      }
    });
    sandbox.buildTrialPromoAlert();
    expect(els.trialPromoAlert.innerHTML).not.toBe('');
    expect(els.trialPromoAlert.innerHTML).toContain('state-msg');
  });

  it('still lists a ready trial when attendance is known', () => {
    const els = { trialPromoAlert: makeEl() };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: rawAttendance({ Trialist: [{ date: '2026-04-01', status: 'Present' }] }),
        roster: [
          {
            firstName: 'Trialist',
            nameRealm: 'Trialist-Stormrage',
            role: 'Melee',
            isTrial: true,
            joinDate: '2026-01-01'
          }
        ]
      }
    });
    sandbox.buildTrialPromoAlert();
    expect(els.trialPromoAlert.innerHTML).toContain('Trial Promotions');
    expect(els.trialPromoAlert.innerHTML).toContain('100.0%');
  });
});

describe('attendance tab below-threshold list refuses to name everyone', () => {
  const tabFiles = [
    { code: ROSTER_JS, name: 'tab-roster.js' },
    { code: ATTENDANCE_JS, name: 'tab-attendance.js' }
  ];

  it('banners rather than listing the whole roster when attendance is unknown', () => {
    const els = { attendanceContent: makeEl(), attendThreshold: makeEl('95') };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: null,
        _attendanceLoadFailed: true,
        attendanceDetails: {},
        roster: [
          { firstName: 'Katorri', nameRealm: 'Katorri-Stormrage', role: 'Heal' },
          { firstName: 'Second', nameRealm: 'Second-Stormrage', role: 'Melee' }
        ]
      }
    });
    // Short-circuit ensureAttendanceGridLoaded(), which buildAttendanceTab()
    // calls last and which would otherwise reach for supabaseClient.
    sandbox._attendanceGrid = 'loaded';
    sandbox.buildAttendanceTab();
    expect(els.attendanceContent.innerHTML).toContain('state-msg');
    expect(els.attendanceContent.innerHTML).not.toContain('Katorri');
  });

  it('still lists a genuinely low raider when attendance is known', () => {
    const els = { attendanceContent: makeEl(), attendThreshold: makeEl('95') };
    const sandbox = makeSandbox({
      tabFiles,
      els,
      data: {
        rawAttendanceData: rawAttendance({ Katorri: [{ date: '2026-04-01', status: 'No Show' }] }),
        attendanceDetails: {},
        roster: [{ firstName: 'Katorri', nameRealm: 'Katorri-Stormrage', role: 'Heal' }]
      }
    });
    // Short-circuit ensureAttendanceGridLoaded(), which buildAttendanceTab()
    // calls last and which would otherwise reach for supabaseClient.
    sandbox._attendanceGrid = 'loaded';
    sandbox.buildAttendanceTab();
    expect(els.attendanceContent.innerHTML).toContain('Katorri');
    expect(els.attendanceContent.innerHTML).toContain('0.0%');
  });
});
