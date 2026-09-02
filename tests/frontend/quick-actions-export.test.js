import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// officer-quick-actions.js is a plain browser script; qaExportString() (#408)
// now calls the same build_rclc_export() RPC the Priority tab uses instead
// of the GAS getExportString action, so the two "copy priority export"
// entry points can no longer disagree. This loads just enough of the real
// file (and stubs for what it depends on) into a vm sandbox to exercise the
// RPC call and clipboard write.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK_ACTIONS_JS = readFileSync(path.join(HERE, '../../js/officer-quick-actions.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl() {
  return { disabled: false, textContent: '', style: {} };
}

function makeSandbox({ rpcResult, writeText, invokeResult, teamSlug } = {}) {
  var rpcCalls = [];
  var invokeCalls = [];
  var supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return { then: (cb) => Promise.resolve(rpcResult).then(cb) };
    },
    functions: {
      invoke(name, opts) {
        invokeCalls.push({ name, opts });
        return Promise.resolve(invokeResult);
      }
    }
  };
  var els = {
    oqaExportHeroicBtn: makeEl(),
    oqaExportMythicBtn: makeEl(),
    oqaStatus: makeEl(),
    oqaAttendBtn: makeEl()
  };

  var sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    window: { DATA: { seasonName: 'Season 1' } },
    DATA: { seasonName: 'Season 1' },
    seasonCodeForDisplay: (name) => (name === 'Season 1' ? 'S1' : name),
    _teamCfg: { supabaseTeamId: 1 },
    TEAM_SLUG: teamSlug || 'phoenix',
    supabaseClient,
    navigator: { clipboard: { writeText: writeText || (() => Promise.resolve()) } },
    // _utf8ToBase64() lives in js/common.js (#408); stubbed here rather than
    // loading the whole of common.js just for this one helper.
    _utf8ToBase64(str) {
      var bytes = new TextEncoder().encode(str);
      var binary = '';
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    },
    btoa,
    TextEncoder,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(QUICK_ACTIONS_JS, sandbox, { filename: 'officer-quick-actions.js' });
  return { sandbox, rpcCalls, invokeCalls, els };
}

describe('qaExportString (#408, split by track #859)', () => {
  it('calls build_rclc_export with the team id, season code, and the requested track, not the GAS getExportString action', async () => {
    const { sandbox, rpcCalls } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.qaExportString('Hero');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: 'build_rclc_export',
      params: { p_team_id: 1, p_season: 'S1', p_track: 'Hero' }
    });
    await flush();
  });

  it('base64-encodes the JSON payload and copies it to the clipboard', async () => {
    const payload = { players: { 'Kato-Illidan': { chest: { bis: [100002] } } }, priority: {} };
    const writeText = vi.fn(() => Promise.resolve());
    const { sandbox, els } = makeSandbox({ rpcResult: { data: payload, error: null }, writeText });
    sandbox.qaExportString('Hero');
    await flush();
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    const decoded = JSON.parse(Buffer.from(writeText.mock.calls[0][0], 'base64').toString('utf8'));
    expect(decoded).toEqual(payload);
    expect(els.oqaStatus.textContent).toBe('Copied!');
    expect(els.oqaExportHeroicBtn.disabled).toBe(false);
  });

  it('uses the Mythic button/label and passes p_track: "Myth" when called with Myth', async () => {
    const { sandbox, rpcCalls, els } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.qaExportString('Myth');
    expect(rpcCalls[0].params.p_track).toBe('Myth');
    await flush();
    expect(els.oqaExportMythicBtn.textContent).toBe('Copy Priority Export (Mythic)');
    expect(els.oqaExportHeroicBtn.textContent).toBe('');
  });

  it('shows the RPC error message and does not touch the clipboard on failure', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { sandbox, els } = makeSandbox({
      rpcResult: { data: null, error: { message: 'Not authorized' } },
      writeText
    });
    sandbox.qaExportString('Hero');
    await flush();

    expect(writeText).not.toHaveBeenCalled();
    expect(els.oqaStatus.textContent).toBe('Not authorized');
  });
});

// #225: qaRefreshAttendance() was still calling GAS's ?action=refreshAttendanceWCL
// directly while the real Attendance tab (tab-attendance.js) already moved to the
// wcl-sync Edge Function (#223) -- the same two-different-paths shape #408 fixed
// for the priority export above. These pin that it now calls the Edge Function
// with the same body shape refreshAttendanceWCL() uses, and reads the same
// success/mainNights/excluded/error response fields the old GAS action returned.
describe('qaRefreshAttendance (#225)', () => {
  it('invokes wcl-sync refreshAttendance with the team id, not GAS', async () => {
    const { sandbox, invokeCalls } = makeSandbox({
      invokeResult: { data: { success: true, mainNights: 2, excluded: 1 }, error: null }
    });
    sandbox.qaRefreshAttendance();
    await flush();

    expect(invokeCalls).toEqual([{ name: 'wcl-sync', opts: { body: { action: 'refreshAttendance', teamId: 1 } } }]);
  });

  it('shows the night/excluded counts and a link to the officer dashboard on success', async () => {
    const { sandbox, els } = makeSandbox({
      invokeResult: { data: { success: true, mainNights: 3, excluded: 1 }, error: null },
      teamSlug: 'hellfire'
    });
    sandbox.qaRefreshAttendance();
    await flush();

    expect(els.oqaAttendBtn.disabled).toBe(false);
    expect(els.oqaAttendBtn.textContent).toBe('Refresh Attendance');
    expect(els.oqaStatus.innerHTML).toContain('Done: 3 nights found, 1 excluded.');
    expect(els.oqaStatus.innerHTML).toContain('officer.html?team=hellfire&tab=attendance');
  });

  it('singular "night" for a count of exactly 1', async () => {
    const { sandbox, els } = makeSandbox({
      invokeResult: { data: { success: true, mainNights: 1, excluded: 0 }, error: null }
    });
    sandbox.qaRefreshAttendance();
    await flush();

    expect(els.oqaStatus.innerHTML).toContain('Done: 1 night found, 0 excluded.');
  });

  it('shows the Edge Function error and re-enables the button on failure', async () => {
    const { sandbox, els } = makeSandbox({
      invokeResult: { data: null, error: { message: 'wcl-sync unavailable' } }
    });
    sandbox.qaRefreshAttendance();
    await flush();

    expect(els.oqaAttendBtn.disabled).toBe(false);
    expect(els.oqaStatus.textContent).toBe('wcl-sync unavailable');
  });
});
