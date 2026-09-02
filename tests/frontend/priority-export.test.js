import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tab-priority.js is a plain browser script; fetchExportString() (#335) now
// calls the build_rclc_export() RPC and base64-encodes the JSON client-side
// instead of reading a GAS-cached spreadsheet cell. This loads just enough
// of the real file (and stubs for what it depends on) into a vm sandbox to
// exercise the RPC call, season derivation, and UTF-8-safe base64 encoding.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl() {
  return { disabled: false, textContent: '', value: '', placeholder: '', style: {} };
}

function makeSandbox({ rpcResult, els = {} } = {}) {
  var rpcCalls = [];
  var supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return { then: (cb) => Promise.resolve(rpcResult).then(cb) };
    }
  };
  var defaultEls = {
    prioExportLoadBtn: makeEl(),
    prioExportBody: makeEl(),
    prioExportStr: makeEl(),
    prioExportDiffHeroic: Object.assign(makeEl(), { classList: { toggle() {} } }),
    prioExportDiffMythic: Object.assign(makeEl(), { classList: { toggle() {} } })
  };
  var allEls = Object.assign(defaultEls, els);

  var sandbox = {
    console,
    document: { getElementById: (id) => allEls[id] || null },
    window: { DATA: { seasonName: 'Season 1' } },
    DATA: { seasonName: 'Season 1' },
    seasonCodeForDisplay: (name) => (name === 'Season 1' ? 'S1' : name),
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    // _utf8ToBase64() moved to js/common.js (#408) so index.html's Quick
    // Actions export button can share it too; stubbed here rather than
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
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  return { sandbox, rpcCalls, els: allEls };
}

describe('fetchExportString (#335, split by track #859)', () => {
  it('calls build_rclc_export with the team id, current season code, and Hero track by default', async () => {
    const { sandbox, rpcCalls } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.fetchExportString();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: 'build_rclc_export',
      params: { p_team_id: 1, p_season: 'S1', p_track: 'Hero' }
    });
    await flush();
  });

  it('passes p_track: "Myth" after switching the track toggle to Mythic', async () => {
    const { sandbox, rpcCalls } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.switchPrioExportTrack('mythic');
    sandbox.fetchExportString();
    expect(rpcCalls[0].params).toEqual({ p_team_id: 1, p_season: 'S1', p_track: 'Myth' });
    await flush();
  });

  it('switching tracks hides the export body and resets the button to Generate', async () => {
    const { sandbox, els } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.fetchExportString();
    await flush();
    expect(els.prioExportBody.style.display).toBe('');

    sandbox.switchPrioExportTrack('mythic');
    expect(els.prioExportBody.style.display).toBe('none');
    expect(els.prioExportLoadBtn.textContent).toBe('Generate');
  });

  it('base64-encodes the JSON payload and shows it in the textarea', async () => {
    const payload = { players: { 'Kato-Illidan': { chest: { bis: [100002] } } }, priority: {} };
    const { sandbox, els } = makeSandbox({ rpcResult: { data: payload, error: null } });
    sandbox.fetchExportString();
    await flush();

    expect(els.prioExportBody.style.display).toBe('');
    expect(els.prioExportLoadBtn.disabled).toBe(false);
    expect(els.prioExportLoadBtn.textContent).toBe('Regenerate');
    const decoded = JSON.parse(Buffer.from(els.prioExportStr.value, 'base64').toString('utf8'));
    expect(decoded).toEqual(payload);
  });

  it('base64-encodes non-ASCII player names correctly (#360)', async () => {
    const payload = { players: { 'Zoë-Illidan': { chest: { bis: [1] } } }, priority: {} };
    const { sandbox, els } = makeSandbox({ rpcResult: { data: payload, error: null } });
    sandbox.fetchExportString();
    await flush();

    const decoded = JSON.parse(Buffer.from(els.prioExportStr.value, 'base64').toString('utf8'));
    expect(decoded).toEqual(payload);
  });

  it('shows the RPC error message and leaves the textarea empty on failure', async () => {
    const { sandbox, els } = makeSandbox({ rpcResult: { data: null, error: { message: 'Not authorized' } } });
    sandbox.fetchExportString();
    await flush();

    expect(els.prioExportStr.value).toBe('');
    expect(els.prioExportStr.placeholder).toBe('Not authorized');
  });
});
