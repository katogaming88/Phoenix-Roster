import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #317: the Admin tab honors the officer/team_leader split the RLS policies
// already enforce. adminSubTabVisibility() is the single source of truth for
// which sub-tabs each access level sees, and visibleDangerOps() scopes the
// Danger Zone down to Clear Season History for team leaders. This loads the
// real tab-admin.js into a vm sandbox (same pattern as priority-export
// .test.js) and checks the visibility map, the danger-op filter, and the
// landing sub-tab for each access level.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-admin.js'), 'utf8');

function makeEl() {
  return {
    disabled: false,
    textContent: '',
    value: '',
    innerHTML: '',
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() }
  };
}

// Records every .rpc()/.from().delete().eq() call so tests can assert exactly
// what each clear*Supabase() handler sent, without a real Supabase client.
function makeSupabaseClient({ rpcResult, deleteResult } = {}) {
  const rpcCalls = [];
  const deleteCalls = [];
  const client = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve(rpcResult !== undefined ? rpcResult : { data: 1, error: null });
    },
    from(table) {
      return {
        delete() {
          return {
            eq(col, val) {
              deleteCalls.push({ table, col, val });
              return Promise.resolve(deleteResult !== undefined ? deleteResult : { error: null });
            }
          };
        }
      };
    }
  };
  return { client, rpcCalls, deleteCalls };
}

function makeSandbox({ access, els = {}, saveTeamSettingResult, rpcResult, deleteResult } = {}) {
  const allEls = { ...els };
  // clearSeasonHistorySupabase() (#423) goes through saveTeamSetting()/
  // writeAuditLog()/buildSeasonTab(); the other six clear*Supabase()
  // handlers (#225) go through supabaseClient.rpc()/from().delete() plus
  // writeAuditLog() and their own tab's build*Tab() -- common.js/
  // tab-season.js/tab-bis.js/etc helpers this sandbox doesn't load (same
  // pattern as priority-export.test.js stubbing _utf8ToBase64 rather than
  // pulling in all of common.js).
  const saveTeamSetting = vi.fn(() => saveTeamSettingResult || Promise.resolve({ seasonHistory: [] }));
  const writeAuditLog = vi.fn(() => Promise.resolve());
  const buildSeasonTab = vi.fn();
  const buildBisTab = vi.fn();
  const buildSignupsTab = vi.fn();
  const buildPendingRosterTab = vi.fn();
  const buildMPlusTab = vi.fn();
  const buildRequestsTab = vi.fn();
  const { client: supabaseClient, rpcCalls, deleteCalls } = makeSupabaseClient({ rpcResult, deleteResult });
  const reload = vi.fn();
  const sandbox = {
    console,
    window: { _adminAccessLevel: access },
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      },
      querySelectorAll: () => []
    },
    location: { reload },
    saveTeamSetting,
    writeAuditLog,
    buildSeasonTab,
    buildBisTab,
    buildSignupsTab,
    buildPendingRosterTab,
    buildMPlusTab,
    buildRequestsTab,
    TEAM_NAME: 'Phoenix Reborn',
    DATA: { seasonHistory: [{ name: 'Old Season' }] },
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(ADMIN_JS, sandbox, { filename: 'tab-admin.js' });
  return {
    sandbox,
    els: allEls,
    saveTeamSetting,
    writeAuditLog,
    buildSeasonTab,
    buildBisTab,
    buildSignupsTab,
    buildPendingRosterTab,
    buildMPlusTab,
    buildRequestsTab,
    rpcCalls,
    deleteCalls,
    reload
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('adminSubTabVisibility (#317)', () => {
  it('shows all five sub-tabs at full access', () => {
    const { sandbox } = makeSandbox({ access: true });
    expect(sandbox.adminSubTabVisibility(true)).toEqual({
      properties: true,
      export: true,
      officers: true,
      features: true,
      danger: true
    });
  });

  it('shows everything except Data Export to a team leader', () => {
    const { sandbox } = makeSandbox({ access: 'team_leader' });
    expect(sandbox.adminSubTabVisibility('team_leader')).toEqual({
      properties: true,
      export: false,
      officers: true,
      features: true,
      danger: true
    });
  });

  it('shows nothing for falsy access', () => {
    const { sandbox } = makeSandbox({ access: false });
    expect(sandbox.adminSubTabVisibility(false)).toEqual({
      properties: false,
      export: false,
      officers: false,
      features: false,
      danger: false
    });
  });
});

describe('visibleDangerOps (#317)', () => {
  it('returns all ops in order at full access', () => {
    const { sandbox } = makeSandbox({ access: true });
    const keys = sandbox.visibleDangerOps(true).map((op) => op.key);
    expect(keys).toEqual(sandbox.DANGER_OPS.map((op) => op.key));
    // 7, not 8: Clear Pasted Loot Sheet was retired outright (#225) -- #219
    // replaced the paste-to-sheet-then-import flow with a direct paste-to-RPC
    // import with no staging table, so there is nothing left for it to clear.
    expect(keys.length).toBe(7);
  });

  it('returns only Clear Season History for a team leader', () => {
    const { sandbox } = makeSandbox({ access: 'team_leader' });
    const keys = sandbox.visibleDangerOps('team_leader').map((op) => op.key);
    expect(keys).toEqual(['clearSeasonHistory']);
  });
});

describe('renderDangerZone (#317)', () => {
  it('renders every op card at full access', () => {
    const { sandbox, els } = makeSandbox({ access: true });
    sandbox.renderDangerZone();
    const html = els.adminDangerContent.innerHTML;
    sandbox.DANGER_OPS.forEach((op) => {
      expect(html).toContain('danger-btn-' + op.key);
    });
  });

  it('renders only the Clear Season History card for a team leader', () => {
    const { sandbox, els } = makeSandbox({ access: 'team_leader' });
    sandbox.renderDangerZone();
    const html = els.adminDangerContent.innerHTML;
    expect(html).toContain('danger-btn-clearSeasonHistory');
    expect(html).not.toContain('danger-btn-clearLootData');
    expect(html).not.toContain('danger-btn-clearSignups');
  });
});

describe('executeDangerOp guard (#317)', () => {
  it('refuses an op hidden from the current access level even with a valid confirm', () => {
    const els = { 'danger-confirm-clearLootData': makeEl() };
    els['danger-confirm-clearLootData'].value = 'Phoenix Reborn';
    const { sandbox, rpcCalls, deleteCalls } = makeSandbox({ access: 'team_leader', els });
    sandbox.executeDangerOp('clearLootData');
    expect(rpcCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it('still runs the loot clear at full access', async () => {
    const els = { 'danger-confirm-clearLootData': makeEl() };
    els['danger-confirm-clearLootData'].value = 'Phoenix Reborn';
    const { sandbox, deleteCalls } = makeSandbox({ access: true, els });
    sandbox.executeDangerOp('clearLootData');
    await flush();
    expect(deleteCalls).toEqual([{ table: 'rclc_loot', col: 'team_id', val: 1 }]);
  });
});

// #225: the seven Danger Zone ops were still calling GAS's dangerClearSheet
// action (clearLootData) or had no Supabase equivalent at all (the retired
// clearPastedLoot). Each remaining op now goes through its own
// clear*Supabase() handler -- a SECURITY DEFINER RPC for the four request
// tables and pending_roster's narrower subset, a direct client delete for
// rclc_loot (officers already hold a direct grant on it). These pin the
// RPC/table each handler hits, the tab it refreshes, and the audit log entry
// it writes.
describe('the six non-season-history clear*Supabase handlers (#225)', () => {
  function confirmedEls(key) {
    const els = {};
    els['danger-confirm-' + key] = makeEl();
    els['danger-confirm-' + key].value = 'Phoenix Reborn';
    return els;
  }

  it('clearLootDataSupabase deletes rclc_loot for the team, audits, and reloads', async () => {
    const { sandbox, deleteCalls, writeAuditLog, reload } = makeSandbox({
      access: true,
      els: confirmedEls('clearLootData')
    });
    sandbox.executeDangerOp('clearLootData');
    await flush();

    expect(deleteCalls).toEqual([{ table: 'rclc_loot', col: 'team_id', val: 1 }]);
    expect(writeAuditLog).toHaveBeenCalledWith('Loot Data Cleared', null, null, null);
    // The reload is deliberately delayed (1200ms) so the "Done."/count
    // message is visible before the page goes out from under it -- not
    // fired yet on this tick.
    expect(reload).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 1250));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clearBisRequestsSupabase calls danger_clear_bis_requests and refreshes the BiS tab', async () => {
    const { sandbox, rpcCalls, buildBisTab, writeAuditLog } = makeSandbox({
      access: true,
      els: confirmedEls('clearBisSubs'),
      rpcResult: { data: 3, error: null }
    });
    sandbox.executeDangerOp('clearBisSubs');
    await flush();

    expect(rpcCalls).toEqual([{ name: 'danger_clear_bis_requests', params: { p_team_id: 1 } }]);
    expect(buildBisTab).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith('BiS Submissions Cleared', null, null, null);
  });

  it('clearSeasonSignupsSupabase calls danger_clear_season_signups and refreshes both Signups and Pending Roster', async () => {
    const { sandbox, rpcCalls, buildSignupsTab, buildPendingRosterTab } = makeSandbox({
      access: true,
      els: confirmedEls('clearSignups')
    });
    sandbox.executeDangerOp('clearSignups');
    await flush();

    expect(rpcCalls).toEqual([{ name: 'danger_clear_season_signups', params: { p_team_id: 1 } }]);
    expect(buildSignupsTab).toHaveBeenCalledTimes(1);
    expect(buildPendingRosterTab).toHaveBeenCalledTimes(1);
  });

  it('clearPendingRosterSupabase calls danger_clear_pending_roster (the narrower op), not danger_clear_season_signups', async () => {
    const { sandbox, rpcCalls } = makeSandbox({ access: true, els: confirmedEls('clearPending') });
    sandbox.executeDangerOp('clearPending');
    await flush();

    expect(rpcCalls).toEqual([{ name: 'danger_clear_pending_roster', params: { p_team_id: 1 } }]);
  });

  it('clearMplusExclusionRequestsSupabase calls danger_clear_mplus_exclusion_requests and refreshes the M+ tab', async () => {
    const { sandbox, rpcCalls, buildMPlusTab } = makeSandbox({ access: true, els: confirmedEls('clearMplus') });
    sandbox.executeDangerOp('clearMplus');
    await flush();

    expect(rpcCalls).toEqual([{ name: 'danger_clear_mplus_exclusion_requests', params: { p_team_id: 1 } }]);
    expect(buildMPlusTab).toHaveBeenCalledTimes(1);
  });

  it('clearSelfReceivedRequestsSupabase calls danger_clear_self_received_requests and refreshes the Requests tab', async () => {
    const { sandbox, rpcCalls, buildRequestsTab } = makeSandbox({
      access: true,
      els: confirmedEls('clearSelfReceived')
    });
    sandbox.executeDangerOp('clearSelfReceived');
    await flush();

    expect(rpcCalls).toEqual([{ name: 'danger_clear_self_received_requests', params: { p_team_id: 1 } }]);
    expect(buildRequestsTab).toHaveBeenCalledTimes(1);
  });

  it('shows the row count in the status message when the RPC returns one', async () => {
    const els = confirmedEls('clearMplus');
    els['danger-status-clearMplus'] = makeEl();
    const { sandbox } = makeSandbox({ access: true, els, rpcResult: { data: 4, error: null } });
    sandbox.executeDangerOp('clearMplus');
    await flush();
    expect(els['danger-status-clearMplus'].textContent).toBe('Cleared 4 rows.');
  });

  it('singular "row" for a count of exactly 1', async () => {
    const els = confirmedEls('clearMplus');
    els['danger-status-clearMplus'] = makeEl();
    const { sandbox } = makeSandbox({ access: true, els, rpcResult: { data: 1, error: null } });
    sandbox.executeDangerOp('clearMplus');
    await flush();
    expect(els['danger-status-clearMplus'].textContent).toBe('Cleared 1 row.');
  });

  it('surfaces an RPC error and re-enables the button without touching any tab', async () => {
    const els = confirmedEls('clearSelfReceived');
    els['danger-btn-clearSelfReceived'] = makeEl();
    els['danger-status-clearSelfReceived'] = makeEl();
    const { sandbox, buildRequestsTab } = makeSandbox({
      access: true,
      els,
      rpcResult: { data: null, error: { message: 'permission denied' } }
    });
    sandbox.executeDangerOp('clearSelfReceived');
    await flush();

    expect(els['danger-btn-clearSelfReceived'].disabled).toBe(false);
    expect(els['danger-status-clearSelfReceived'].textContent).toBe('permission denied');
    expect(buildRequestsTab).not.toHaveBeenCalled();
  });

  it('surfaces a delete error for the loot clear and never reloads', async () => {
    const els = confirmedEls('clearLootData');
    els['danger-status-clearLootData'] = makeEl();
    const { sandbox, reload } = makeSandbox({
      access: true,
      els,
      deleteResult: { error: { message: 'network error' } }
    });
    sandbox.executeDangerOp('clearLootData');
    await flush();

    expect(els['danger-status-clearLootData'].textContent).toBe('network error');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Clear Season History goes through Supabase, not GAS (#423)', () => {
  function confirmedEls() {
    const els = { 'danger-confirm-clearSeasonHistory': makeEl() };
    els['danger-confirm-clearSeasonHistory'].value = 'Phoenix Reborn';
    return els;
  }

  it('clears team_settings.config.seasonHistory via saveTeamSetting, never GAS', async () => {
    // The old GAS action ("dangerClearSeasonHistory") is never called -- this
    // was the actual bug: it cleared Script Properties while the archived
    // seasons in team_settings.config survived (#423). By #225, tab-admin.js
    // has no GAS call path left at all for any Danger Zone op, this one
    // included -- there is no jsonpRequest to assert against anymore.
    const { sandbox, saveTeamSetting, writeAuditLog } = makeSandbox({
      access: 'team_leader',
      els: confirmedEls()
    });
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(saveTeamSetting).toHaveBeenCalledTimes(1);
    expect(saveTeamSetting).toHaveBeenCalledWith({ seasonHistory: [] });
    expect(writeAuditLog).toHaveBeenCalledWith('Season History Cleared', null, null, null);
  });

  it('updates DATA.seasonHistory and re-renders the Season tab', async () => {
    const { sandbox, buildSeasonTab } = makeSandbox({
      access: 'team_leader',
      els: confirmedEls(),
      saveTeamSettingResult: Promise.resolve({ seasonHistory: [] })
    });
    expect(sandbox.DATA.seasonHistory).toEqual([{ name: 'Old Season' }]);
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(sandbox.DATA.seasonHistory).toEqual([]);
    expect(buildSeasonTab).toHaveBeenCalledTimes(1);
  });

  it('shows an error and leaves the button re-enabled if the RPC fails', async () => {
    const els = confirmedEls();
    els['danger-btn-clearSeasonHistory'] = makeEl();
    els['danger-status-clearSeasonHistory'] = makeEl();
    const { sandbox } = makeSandbox({
      access: 'team_leader',
      els,
      saveTeamSettingResult: Promise.reject(new Error('RLS denied'))
    });
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(els['danger-btn-clearSeasonHistory'].disabled).toBe(false);
    expect(els['danger-status-clearSeasonHistory'].textContent).toBe('RLS denied');
  });

  it('still refuses without a matching team-name confirm', () => {
    const { sandbox, saveTeamSetting } = makeSandbox({ access: 'team_leader', els: {} });
    sandbox.executeDangerOp('clearSeasonHistory');
    expect(saveTeamSetting).not.toHaveBeenCalled();
  });
});

describe('buildAdminTab landing (#317)', () => {
  it('lands a site admin on Properties', () => {
    const { sandbox, els } = makeSandbox({ access: true });
    sandbox.buildAdminTab();
    expect(els['admin-sub-properties'].style.display).toBe('');
    expect(els['admin-sub-danger'].style.display).toBe('none');
  });

  it('lands a team leader on Properties too', () => {
    const { sandbox, els } = makeSandbox({ access: 'team_leader' });
    sandbox.buildAdminTab();
    expect(els['admin-sub-properties'].style.display).toBe('');
    expect(els['admin-sub-officers'].style.display).toBe('none');
  });
});
