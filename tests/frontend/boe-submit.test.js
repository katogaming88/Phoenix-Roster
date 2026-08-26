import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/boe.js is a plain browser script (no exports), so these tests run it in a
// vm sandbox on top of the real js/common.js -- same harness shape as
// tests/frontend/bonus-roll-target.test.js, element stubs and recorder mocks
// per tests/frontend/self-received-placeholder-slot-collision.test.js. The
// submit_boe_found RPC itself is covered by tests/rls/boe.test.js; here we
// assert the card's wiring (#746): what reaches the RPC, when the boe-webhook
// invoke fires, and how the status region, button state, prefill, and the boe
// feature flag behave.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const BOE_JS = readFileSync(path.join(HERE, '../../js/boe.js'), 'utf8');

const CARD_ELS = [
  'boeCharName',
  'boeItemName',
  'boeTrack',
  'boeNote',
  'boeSubmitBtn',
  'boeStatus',
  'boeTeamName',
  'boeViewWrap',
  'navBoE'
];

function makeSandbox({ search = '' } = {}) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { value: '', innerHTML: '', textContent: '', style: {}, disabled: false };
    return els[id];
  }
  const sandbox = {
    window: {},
    location: { search, pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(BOE_JS, sandbox, { filename: 'boe.js' });
  CARD_ELS.forEach(el);
  return { sandbox, els, el };
}

// Records rpc and invoke calls in arrival order so tests can assert both the
// payloads and that the webhook only ever fires after the RPC settled green.
function recorderClient({ rpcResult = { data: 1, error: null } } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc(name, params) {
        calls.push({ kind: 'rpc', name, params });
        return Promise.resolve(rpcResult);
      },
      functions: {
        invoke(name, opts) {
          calls.push({ kind: 'invoke', name, body: opts && opts.body });
          return Promise.resolve({});
        }
      }
    }
  };
}

function fillCard(el) {
  el('boeCharName').value = '  Kae-Tichondrius  ';
  el('boeItemName').value = '  Voidglass Cloak  ';
  el('boeTrack').value = 'Hero';
  el('boeNote').value = '  from trash before boss 2  ';
}

describe('submitBoeFound RPC payload', () => {
  it('calls submit_boe_found with the page team id and trimmed inputs', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    const rpc = calls.find((c) => c.kind === 'rpc');
    expect(rpc.name).toBe('submit_boe_found');
    expect(rpc.params).toEqual({
      p_team_id: 1,
      p_name_realm: 'Kae-Tichondrius',
      p_item_name: 'Voidglass Cloak',
      p_track: 'Hero',
      p_note: 'from trash before boss 2'
    });
  });

  it('a ?team= deep link preselects that team for the submit', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    expect(el('boeTeamName').textContent).toBe('Hellfire Rollers');
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'rpc').params.p_team_id).toBe(2);
  });

  it('sends null for an unselected track and an empty note', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    el('boeTrack').value = '';
    el('boeNote').value = '   ';
    await sandbox.submitBoeFound();
    const rpc = calls.find((c) => c.kind === 'rpc');
    expect(rpc.params.p_track).toBe(null);
    expect(rpc.params.p_note).toBe(null);
  });
});

describe('boe-webhook invoke', () => {
  it('fires exactly once, only after RPC success, with the submit payload', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.map((c) => c.kind)).toEqual(['rpc', 'invoke']);
    const invoke = calls[1];
    expect(invoke.name).toBe('boe-webhook');
    expect(invoke.body).toEqual({
      team: 'Phoenix',
      finder: 'Kae-Tichondrius',
      item: 'Voidglass Cloak',
      track: 'Hero',
      note: 'from trash before boss 2'
    });
  });

  it('does not fire when the RPC errors, and the error text reaches the status region', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient({
      rpcResult: { data: null, error: { message: 'Unknown track: Heroic' } }
    });
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.filter((c) => c.kind === 'invoke')).toEqual([]);
    expect(el('boeStatus').textContent).toBe('Unknown track: Heroic');
    expect(el('boeSubmitBtn').disabled).toBe(false);
  });
});

describe('client-side validation', () => {
  it('blocks an empty character name with text feedback and no RPC call', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('boeItemName').value = 'Voidglass Cloak';
    await sandbox.submitBoeFound();
    expect(calls).toEqual([]);
    expect(el('boeStatus').textContent).toBe('Please enter your character name.');
  });

  it('blocks an empty item name with text feedback and no RPC call', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('boeCharName').value = 'Kae-Tichondrius';
    await sandbox.submitBoeFound();
    expect(calls).toEqual([]);
    expect(el('boeStatus').textContent).toBe('Please enter the item name.');
  });
});

describe('submit button in-flight guard', () => {
  it('disables the button while the RPC is in flight and re-enables on success', async () => {
    const { sandbox, el } = makeSandbox();
    let resolveRpc;
    sandbox.supabaseClient = {
      rpc: () => new Promise((resolve) => (resolveRpc = resolve)),
      functions: { invoke: () => Promise.resolve({}) }
    };
    fillCard(el);
    const settled = sandbox.submitBoeFound();
    expect(el('boeSubmitBtn').disabled).toBe(true);
    resolveRpc({ data: 1, error: null });
    await settled;
    expect(el('boeSubmitBtn').disabled).toBe(false);
  });

  it('re-enables the button after an RPC error', async () => {
    const { sandbox, el } = makeSandbox();
    let resolveRpc;
    sandbox.supabaseClient = {
      rpc: () => new Promise((resolve) => (resolveRpc = resolve)),
      functions: { invoke: () => Promise.resolve({}) }
    };
    fillCard(el);
    const settled = sandbox.submitBoeFound();
    expect(el('boeSubmitBtn').disabled).toBe(true);
    resolveRpc({ data: null, error: { message: 'nope' } });
    await settled;
    expect(el('boeSubmitBtn').disabled).toBe(false);
  });
});

describe('prefill and success reset', () => {
  it('prefills the character field from the claimed character when logged in', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.getDiscordSession = () => ({ nameRealm: 'Kae-Tichondrius' });
    sandbox.initBoeCard();
    expect(el('boeCharName').value).toBe('Kae-Tichondrius');
  });

  it('leaves the character field empty when logged out', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.initBoeCard();
    expect(el('boeCharName').value).toBe('');
  });

  it('on success clears item and note, keeps the character, and announces', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(el('boeItemName').value).toBe('');
    expect(el('boeNote').value).toBe('');
    expect(el('boeCharName').value).toBe('  Kae-Tichondrius  ');
    expect(el('boeStatus').textContent).toBe('Submitted! Officers will take it from here.');
  });
});

describe('boe feature flag', () => {
  it('initBoeCard hides the card and nav item when the flag is off', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.DATA = { features: { boe: false } };
    sandbox.initBoeCard();
    expect(el('boeViewWrap').style.display).toBe('none');
    expect(el('navBoE').style.display).toBe('none');
  });

  it('initBoeCard leaves the card visible when the flag is unset (missing key reads enabled)', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.DATA = { features: {} };
    sandbox.initBoeCard();
    expect(el('boeViewWrap').style.display).not.toBe('none');
    expect(el('navBoE').style.display).not.toBe('none');
  });

  it('showBoeView falls back to landing when the flag is off (no blank panel)', () => {
    const { sandbox } = makeSandbox();
    const shown = [];
    sandbox.showView = (name) => shown.push(name);
    sandbox.DATA = { features: { boe: false } };
    sandbox.showBoeView();
    expect(shown).toEqual(['landing']);
    sandbox.DATA = { features: { boe: true } };
    sandbox.showBoeView();
    expect(shown).toEqual(['landing', 'boe']);
  });
});
