import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tab-season.js is a plain browser script (no exports); this loads the real
// file into a vm sandbox to reach the season-config write path now that it
// calls Supabase directly instead of GAS jsonpRequest actions (#221):
// saveTeamSetting()/writeAuditLog() are stubbed here rather than loading the
// whole of common.js, same as tests/frontend/priority-export.test.js does
// for tab-priority.js. toggleSeasonSnapshot() no longer calls out to
// anything at all -- the roster snapshot is embedded on the history entry.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-season.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '', disabled: false, value: '', dataset: {} }, extra);
}

// `attendance` models what js/common.js would report for the roster:
// null means the attendance load has not resolved (or failed), so the
// archive must refuse rather than freeze a guess; otherwise it is a
// firstName -> eligible-record-array map, where an empty array is a real
// "this player has no eligible nights" answer. The two helpers below are
// stubs for the common.js originals, whose own behavior is covered in
// tests/frontend/attendance-unknown.test.js -- what matters here is the
// wiring, i.e. that the snapshot asks for records instead of reading the
// retired p.attendance field.
function makeSandbox({ saveTeamSettingImpl, rpcResult, els = {}, data = {}, attendance = {} } = {}) {
  var saveTeamSettingCalls = [];
  var auditLogCalls = [];
  var rpcCalls = [];

  var sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null, querySelectorAll: () => [] },
    DATA: Object.assign({ rawAttendanceData: attendance === null ? null : { players: attendance } }, data),
    getEligibleAttendanceRecs: (firstName) => (attendance === null ? null : attendance[firstName] || []),
    averageAttendancePct: (recs) => {
      var sum = recs.reduce((acc, r) => acc + (r.weight != null ? r.weight : 1), 0);
      return (Math.round((sum / recs.length) * 1000) / 10).toFixed(1) + '%';
    },
    PROMO_THRESHOLDS: { weeks: 4, attend: 75 },
    populateSeasonSelector: () => {},
    renderRaidProgressionCards: () => {},
    renderSeasonHistory: () => {},
    // archive_current_season() also resets bis_items/m_plus_excluded
    // server-side, so executeArchiveSeason() reloads via loadData() rather
    // than only patching season fields -- stubbed no-op here since that
    // reload path isn't what this describe block is testing.
    loadData: (onCoreReady, onHeavyReady) => {
      if (onCoreReady) onCoreReady();
      if (onHeavyReady) onHeavyReady();
    },
    buildOfficerDashboard: () => {},
    buildStatsBar: () => {},
    buildRosterTable: () => {},
    buildTrialPromoAlert: () => {},
    saveTeamSetting: function (updates) {
      saveTeamSettingCalls.push(updates);
      return (
        saveTeamSettingImpl ||
        function () {
          return Promise.resolve(Object.assign({}, sandbox.DATA, updates));
        }
      )(updates);
    },
    writeAuditLog: function (action, targetType, targetId, detail) {
      auditLogCalls.push({ action, targetType, targetId, detail });
      return Promise.resolve();
    },
    supabaseClient: {
      rpc: function (name, params) {
        rpcCalls.push({ name, params });
        return Promise.resolve(rpcResult);
      }
    },
    _teamCfg: { supabaseTeamId: 1 },
    // Normally defined in js/common.js (#537/#341); stubbed here since this
    // sandbox loads only tab-season.js.
    CURRENT_SEASON: { code: 'MID2', displayName: 'Midnight Season 2' },
    _seasonDisplayPrefix: () => 'Midnight Season',
    _escapeRegExp: (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(SEASON_JS, sandbox, { filename: 'tab-season.js' });
  return { sandbox, saveTeamSettingCalls, auditLogCalls, rpcCalls, els };
}

describe('saveSeasonName (#221, number-only input as of #341)', () => {
  it('composes the number with the display prefix, saves via saveTeamSetting, updates DATA/audit log', async () => {
    const els = {
      seasonNameInput: makeEl({ value: '3' }),
      seasonNameSaveBtn: makeEl(),
      seasonNameStatus: makeEl()
    };
    const { sandbox, saveTeamSettingCalls, auditLogCalls } = makeSandbox({ els, data: { seasonName: 'Old' } });

    sandbox.saveSeasonName();
    await flush();

    expect(saveTeamSettingCalls).toEqual([{ seasonName: 'Midnight Season 3' }]);
    expect(sandbox.DATA.seasonName).toBe('Midnight Season 3');
    expect(auditLogCalls).toEqual([
      { action: 'Season Name Set', targetType: null, targetId: null, detail: 'Midnight Season 3' }
    ]);
    // The input keeps showing the bare number, not the composed name.
    expect(els.seasonNameInput.value).toBe('3');
    expect(els.seasonNameStatus.textContent).toBe('Saved!');
    expect(els.seasonNameSaveBtn.disabled).toBe(false);
  });

  it('shows the error message and re-enables the button on failure', async () => {
    const els = {
      seasonNameInput: makeEl({ value: '3' }),
      seasonNameSaveBtn: makeEl(),
      seasonNameStatus: makeEl()
    };
    const { sandbox } = makeSandbox({
      els,
      saveTeamSettingImpl: () => Promise.reject(new Error('Not authorized'))
    });

    sandbox.saveSeasonName();
    await flush();

    expect(els.seasonNameStatus.textContent).toBe('Not authorized');
    expect(els.seasonNameSaveBtn.disabled).toBe(false);
  });
});

describe('saveSignupSeason (#221, number-only input as of #341)', () => {
  it('composes the number with the display prefix and saves via activeSignupSeason', async () => {
    const els = {
      signupSeasonInput: makeEl({ value: '2' }),
      signupSeasonSaveBtn: makeEl(),
      signupSeasonStatus: makeEl()
    };
    const { sandbox, saveTeamSettingCalls } = makeSandbox({ els });

    sandbox.saveSignupSeason();
    await flush();

    expect(saveTeamSettingCalls).toEqual([{ activeSignupSeason: 'Midnight Season 2' }]);
    expect(sandbox.DATA.signupSeason).toBe('Midnight Season 2');
    expect(els.signupSeasonInput.value).toBe('2');
    expect(els.signupSeasonStatus.textContent).toBe('Saved!');
  });

  it('refuses to save a blank number', async () => {
    const els = {
      signupSeasonInput: makeEl({ value: '' }),
      signupSeasonSaveBtn: makeEl(),
      signupSeasonStatus: makeEl()
    };
    const { sandbox, saveTeamSettingCalls } = makeSandbox({ els });

    sandbox.saveSignupSeason();

    expect(saveTeamSettingCalls).toEqual([]);
    expect(els.signupSeasonStatus.textContent).toBe('Season number cannot be blank.');
  });
});

describe('saveTrialThresholds (#221)', () => {
  it('clamps and saves both keys in one call', async () => {
    const els = {
      trialWeeksInput: makeEl({ value: '999' }),
      trialAttendInput: makeEl({ value: '-5' }),
      trialThresholdsSaveBtn: makeEl(),
      trialThresholdsStatus: makeEl()
    };
    const { sandbox, saveTeamSettingCalls, auditLogCalls } = makeSandbox({ els });

    sandbox.saveTrialThresholds();
    await flush();

    expect(saveTeamSettingCalls).toEqual([{ trialWeeks: 52, trialAttend: 0 }]);
    expect(sandbox.PROMO_THRESHOLDS).toEqual({ weeks: 52, attend: 0 });
    expect(auditLogCalls[0].detail).toBe('52 wk / 0%');
  });
});

describe('executeArchiveSeason (#221)', () => {
  it('builds a roster snapshot from DATA.roster and applies the returned config', async () => {
    const els = {
      seasonArchiveConfirm: makeEl(),
      seasonArchiveStatus: makeEl(),
      seasonArchiveExecBtn: makeEl()
    };
    const newConfig = {
      seasonName: '',
      seasonStart: '',
      seasonEnd: '',
      raidProgression: [],
      seasonHistory: [
        { name: 'Archived', start: '2026-01-01', end: '', raids: [], roster: [{ nameRealm: 'Kato-Illidan' }] }
      ]
    };
    const { sandbox, rpcCalls, saveTeamSettingCalls } = makeSandbox({
      els,
      rpcResult: { data: newConfig, error: null },
      // Two eligible nights at full weight and one at half -> 83.3%. The
      // snapshot computes this at archive time rather than copying a field,
      // which is what used to freeze a blank column into history (#702).
      attendance: { Kato: [{ weight: 1 }, { weight: 1 }, { weight: 0.5 }] },
      data: {
        seasonName: 'Archived',
        roster: [
          {
            id: 42,
            nameRealm: 'Kato-Illidan',
            firstName: 'Kato',
            role: 'Melee',
            isTrial: false,
            isBench: false,
            joinDate: '2026-01-01'
          }
        ]
      }
    });

    sandbox.executeArchiveSeason();
    await flush();

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('archive_current_season');
    expect(rpcCalls[0].params.p_team_id).toBe(1);
    expect(rpcCalls[0].params.p_roster_snapshot).toEqual([
      {
        playerId: 42,
        nameRealm: 'Kato-Illidan',
        role: 'Melee',
        isTrial: false,
        isBench: false,
        joinDate: '2026-01-01',
        attendance: '83.3%'
      }
    ]);
    expect(sandbox.DATA.seasonHistory).toEqual(newConfig.seasonHistory);
    // #537: archiving now chains a second saveTeamSetting() call that
    // immediately fills in the next season's name from CURRENT_SEASON and
    // resets seasonView, instead of leaving seasonName blank.
    expect(rpcCalls[0]).toBeTruthy();
    expect(saveTeamSettingCalls).toEqual([{ seasonName: 'Midnight Season 2', seasonView: null }]);
    expect(sandbox.DATA.seasonName).toBe('Midnight Season 2');
    expect(sandbox.DATA.seasonView).toBe(null);
    expect(els.seasonArchiveStatus.textContent).toBe('Season archived.');
  });

  // A player with no eligible nights must not inherit the live roster's
  // optimistic default. computeSeasonAttendancePct() answers '100.0%' there,
  // which is right on screen (a new add has not missed anything yet) and
  // wrong frozen into a permanent record, where it makes someone who never
  // raided indistinguishable from a perfect season.
  it('stores an empty attendance rather than 100% for a player with no eligible nights', async () => {
    const els = {
      seasonArchiveConfirm: makeEl(),
      seasonArchiveStatus: makeEl(),
      seasonArchiveExecBtn: makeEl()
    };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      rpcResult: { data: { seasonHistory: [] }, error: null },
      attendance: { Kato: [] },
      data: {
        seasonName: 'Archived',
        roster: [{ id: 42, nameRealm: 'Kato-Illidan', firstName: 'Kato', role: 'Melee', joinDate: '2026-01-01' }]
      }
    });

    sandbox.executeArchiveSeason();
    await flush();

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].params.p_roster_snapshot[0].attendance).toBe('');
  });

  // The snapshot's only player key used to be nameRealm, so a rename after
  // the archive was written broke the link back to the roster and #702 had
  // to reconstruct it from audit_log. playerId makes every future archive
  // rename-proof; nameRealm stays because renderSeasonHistory() displays it.
  it('carries playerId through so a later rename cannot orphan the snapshot', async () => {
    const els = {
      seasonArchiveConfirm: makeEl(),
      seasonArchiveStatus: makeEl(),
      seasonArchiveExecBtn: makeEl()
    };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      rpcResult: { data: { seasonHistory: [] }, error: null },
      attendance: { Kato: [{ weight: 1 }] },
      data: {
        seasonName: 'Archived',
        roster: [{ id: 42, nameRealm: 'Kato-Illidan', firstName: 'Kato', role: 'Melee', joinDate: '2026-01-01' }]
      }
    });

    sandbox.executeArchiveSeason();
    await flush();

    expect(rpcCalls[0].params.p_roster_snapshot[0].playerId).toBe(42);
    expect(rpcCalls[0].params.p_roster_snapshot[0].nameRealm).toBe('Kato-Illidan');
  });

  // Archiving is one-way, so an unknown attendance value must stop it rather
  // than be frozen as a plausible-looking guess (#694).
  it('refuses to archive, and calls no RPC, while attendance is unknown', async () => {
    const els = {
      seasonArchiveConfirm: makeEl(),
      seasonArchiveStatus: makeEl(),
      seasonArchiveExecBtn: makeEl()
    };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      rpcResult: { data: { seasonHistory: [] }, error: null },
      attendance: null,
      data: {
        seasonName: 'Archived',
        roster: [{ id: 42, nameRealm: 'Kato-Illidan', firstName: 'Kato', role: 'Melee', joinDate: '2026-01-01' }]
      }
    });

    sandbox.executeArchiveSeason();
    await flush();

    expect(rpcCalls).toEqual([]);
    expect(els.seasonArchiveStatus.textContent).toMatch(/attendance/i);
    expect(els.seasonArchiveExecBtn.disabled).toBe(false);
  });

  it('shows the RPC error message on failure', async () => {
    const els = {
      seasonArchiveConfirm: makeEl(),
      seasonArchiveStatus: makeEl(),
      seasonArchiveExecBtn: makeEl()
    };
    const { sandbox } = makeSandbox({
      els,
      rpcResult: { data: null, error: { message: 'No active season to archive' } },
      data: { seasonName: '', roster: [] }
    });

    sandbox.executeArchiveSeason();
    await flush();

    expect(els.seasonArchiveStatus.textContent).toBe('No active season to archive');
  });
});

describe('executeUnarchiveSeason (#221)', () => {
  it('restores the returned season onto DATA and clears the history entry', async () => {
    const els = {
      seasonUnarchiveConfirm: makeEl(),
      seasonUnarchiveStatus: makeEl(),
      seasonUnarchiveExecBtn: makeEl()
    };
    const rpcData = {
      season: { name: 'Restored', start: '2025-01-01', end: '2025-06-01', raids: [{ name: 'Old Raid' }] },
      config: { seasonName: 'Restored', seasonHistory: [] }
    };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      rpcResult: { data: rpcData, error: null },
      data: { seasonHistory: [{ name: 'Restored' }] }
    });
    sandbox._unarchiveIndex = 0;

    sandbox.executeUnarchiveSeason();
    await flush();

    expect(rpcCalls[0]).toEqual({ name: 'unarchive_season', params: { p_team_id: 1, p_index: 0 } });
    expect(sandbox.DATA.seasonName).toBe('Restored');
    expect(sandbox.DATA.raidProgression).toEqual([{ name: 'Old Raid' }]);
    expect(sandbox.DATA.seasonHistory).toEqual([]);
    expect(els.seasonUnarchiveStatus.textContent).toBe('Season restored.');
  });
});

describe('toggleSeasonSnapshot (#221 follow-up)', () => {
  it('renders the roster embedded on the history entry, with no external call', () => {
    const panel = makeEl({ style: { display: 'none' } });
    const els = { 'snapshot-0': panel };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      data: {
        seasonHistory: [
          {
            name: 'Old Season',
            roster: [
              {
                nameRealm: 'Tank-Illidan',
                role: 'Tank',
                isBench: false,
                isTrial: false,
                joinDate: '2026-01-01',
                attendance: '80%'
              },
              {
                nameRealm: 'Bench-Illidan',
                role: 'Melee',
                isBench: true,
                isTrial: false,
                joinDate: '2026-02-01',
                attendance: '50%'
              }
            ]
          }
        ]
      }
    });
    const btn = makeEl({ textContent: 'View Roster' });

    sandbox.toggleSeasonSnapshot(0, btn);

    expect(rpcCalls).toHaveLength(0);
    expect(panel.innerHTML).toContain('Tank-Illidan');
    expect(panel.innerHTML).toContain('Bench');
    expect(panel.style.display).toBe('');
    expect(btn.textContent).toBe('Hide Roster');
  });

  it('shows a no-data message when the entry has an empty roster', () => {
    const panel = makeEl({ style: { display: 'none' } });
    const els = { 'snapshot-0': panel };
    const { sandbox } = makeSandbox({
      els,
      data: { seasonHistory: [{ name: 'Old Season', roster: [] }] }
    });

    sandbox.toggleSeasonSnapshot(0, makeEl());

    expect(panel.innerHTML).toContain('No roster data captured');
  });
});

describe('toggleSeasonBisSnapshot (#498)', () => {
  it('renders the BiS snapshot embedded on the history entry, placeholders included', () => {
    const panel = makeEl({ style: { display: 'none' } });
    const els = { 'bis-snapshot-0': panel };
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      data: {
        seasonHistory: [
          {
            name: 'Old Season',
            bis: [
              {
                nameRealm: 'Kato-Illidan',
                item: 'Seed Test Staff',
                slot: 'Weapon',
                obtained: false,
                isPlaceholder: false
              },
              { nameRealm: 'Kato-Illidan', item: 'M+', slot: 'ring1', obtained: true, isPlaceholder: true }
            ]
          }
        ]
      }
    });
    const btn = makeEl({ textContent: 'View BiS' });

    sandbox.toggleSeasonBisSnapshot(0, btn);

    expect(rpcCalls).toHaveLength(0);
    expect(panel.innerHTML).toContain('Seed Test Staff');
    expect(panel.innerHTML).toContain('M+');
    expect(panel.style.display).toBe('');
    expect(btn.textContent).toBe('Hide BiS');
  });

  it('shows a no-data message when the entry has no captured BiS', () => {
    const panel = makeEl({ style: { display: 'none' } });
    const els = { 'bis-snapshot-0': panel };
    const { sandbox } = makeSandbox({
      els,
      data: { seasonHistory: [{ name: 'Old Season', bis: [] }] }
    });

    sandbox.toggleSeasonBisSnapshot(0, makeEl());

    expect(panel.innerHTML).toContain('No BiS data captured');
  });
});
