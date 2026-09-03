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
  'boeTeamSelect',
  'boeViewWrap',
  'navBoE',
  'boeDonate'
];

function makeSandbox({ search = '' } = {}) {
  const els = {};
  const stored = [];
  function el(id) {
    if (!els[id]) els[id] = { value: '', innerHTML: '', textContent: '', style: {}, disabled: false };
    return els[id];
  }
  const sandbox = {
    window: {},
    location: { search, pathname: '/' },
    sessionStorage: {
      getItem: () => null,
      setItem: (k, v) => stored.push([k, v]),
      removeItem: () => {}
    },
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
  return { sandbox, els, el, stored };
}

// PostgREST builders are thenable and chain .eq(), so the mock has to be both.
function builder(rows) {
  const settled = Promise.resolve({ data: rows, error: null });
  const chain = {
    eq: () => chain,
    then: (onOk, onErr) => settled.then(onOk, onErr),
    catch: (onErr) => settled.catch(onErr)
  };
  return chain;
}

// Every team enabled, which is what prod looks like today: no team has ever
// set the boe key, and a missing key reads as enabled.
const ALL_ENABLED = [
  { team_id: 1, config: {} },
  { team_id: 2, config: {} },
  { team_id: 3, config: {} },
  { team_id: 4, config: {} }
];

// Records rpc and invoke calls in arrival order so tests can assert both the
// payloads and that the webhook only ever fires after the RPC settled green.
function recorderClient({ rpcResult = { data: 1, error: null }, teamSettings = ALL_ENABLED, memberRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc(name, params) {
        calls.push({ kind: 'rpc', name, params });
        return Promise.resolve(rpcResult);
      },
      from(table) {
        calls.push({ kind: 'from', table });
        return {
          select: () => builder(table === 'team_settings' ? teamSettings : memberRows)
        };
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'uid-1' } } } })
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
      p_note: 'from trash before boss 2',
      p_donate: false
    });
  });

  it('a ?team= deep link preselects that team for the submit', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('hellfire');
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'rpc').params.p_team_id).toBe(2);
  });

  it('submits the team picked in the dropdown, not the page team (#767)', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    el('boeTeamSelect').value = 'wrathless';
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'rpc').params.p_team_id).toBe(4);
  });

  it('the webhook body names the picked team, not the page team (#767)', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    el('boeTeamSelect').value = 'wrathless';
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'invoke').body.team).toBe('Wrathless');
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
      note: 'from trash before boss 2',
      donate: false
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

  it('blocks an unselected item with text feedback and no RPC call', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    el('boeCharName').value = 'Kae-Tichondrius';
    await sandbox.submitBoeFound();
    expect(calls).toEqual([]);
    expect(el('boeStatus').textContent).toBe('Please select an item.');
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

describe('visibleTeamSlugs (#767)', () => {
  // The two pickers (initTeamUI's selects, showTeamPickerButtons) call this;
  // neither has a test of its own, because both build options with
  // createElement/appendChild and the vm sandbox stubs createElement without
  // appendChild. This covers the decision they delegate.
  it('lists every team except the hidden ones, in config order', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.visibleTeamSlugs()).toEqual(['phoenix', 'hellfire', 'immolation']);
  });

  it('is a strict subset of TEAMS, so nothing is lost for id-to-slug lookups', () => {
    const { sandbox } = makeSandbox();
    const all = Object.keys(sandbox.TEAMS);
    expect(all).toContain('wrathless');
    expect(sandbox.visibleTeamSlugs().every((s) => all.includes(s))).toBe(true);
  });
});

describe('team dropdown (#767)', () => {
  it('offers every team including hidden Wrathless, which no other picker lists', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.initBoeCard();
    const html = el('boeTeamSelect').innerHTML;
    ['phoenix', 'hellfire', 'immolation', 'wrathless'].forEach((slug) => {
      expect(html).toContain('value="' + slug + '"');
    });
    expect(html).toContain('Wrathless');
    // The whole reason Wrathless exists as a row: it submits finds but is
    // absent from the switcher and the cold-landing picker.
    expect(sandbox.visibleTeamSlugs()).toEqual(['phoenix', 'hellfire', 'immolation']);
  });

  it('drops a team that turned its own boe flag off', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({
      teamSettings: [
        { team_id: 1, config: {} },
        { team_id: 2, config: { features: { boe: false } } },
        { team_id: 3, config: {} },
        { team_id: 4, config: {} }
      ]
    });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeTeamOptions();
    const html = el('boeTeamSelect').innerHTML;
    expect(html).not.toContain('value="hellfire"');
    expect(html).toContain('value="phoenix"');
    expect(html).toContain('value="wrathless"');
  });

  it('keeps every option when the settings read fails, so a find can still be reported', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = {
      from: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) })
    };
    sandbox.initBoeCard();
    await sandbox.refreshBoeTeamOptions();
    expect(el('boeTeamSelect').innerHTML).toContain('value="hellfire"');
  });

  it('changing the dropdown does not navigate or rewrite the stored team', () => {
    const { sandbox, el, stored } = makeSandbox();
    sandbox.initBoeCard();
    const sel = el('boeTeamSelect');
    sel.value = 'wrathless';
    if (typeof sel.onchange === 'function') sel.onchange();
    expect(sandbox.location.pathname).toBe('/');
    expect(sandbox.location.href).toBeUndefined();
    expect(stored.filter(([k]) => k === 'wga_team')).toEqual([]);
  });
});

describe('identity resolution (#767)', () => {
  const claim = (teamId, name, archived = null) => ({
    team_id: teamId,
    players: [{ name_realm: name, archived_at: archived }]
  });

  it('logged out leaves the page team selected and the character empty', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = {
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      from: () => ({ select: () => builder([]) })
    };
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('phoenix');
    expect(el('boeCharName').value).toBe('');
  });

  it('a single claim selects that team and prefills the character', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('immolation');
    expect(el('boeCharName').value).toBe('Kae-Tichondrius');
  });

  it('multiple claims including the page team stay on the page team', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({
      memberRows: [claim(3, 'Alt-Tichondrius'), claim(1, 'Main-Tichondrius')]
    });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('phoenix');
  });

  // The case that separates "one claim is a useful hint" from "any claim
  // wins": alts on two other teams say nothing about which one they are
  // raiding with tonight, so guessing one would be worse than leaving them
  // where they landed.
  it('multiple claims elsewhere still leave the page team selected', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({
      memberRows: [claim(2, 'Alt-Tichondrius'), claim(3, 'Other-Tichondrius')]
    });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('phoenix');
  });

  it('an explicit ?team= beats a claim elsewhere, so pinned links keep working', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    const { client } = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('hellfire');
  });

  it('ignores an archived alt, which the cold-landing query does not filter', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({
      memberRows: [claim(3, 'Retired-Tichondrius', '2026-01-01T00:00:00Z')]
    });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('phoenix');
    expect(el('boeCharName').value).toBe('');
  });

  it('skips a claim on a team the client config does not know', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({ memberRows: [claim(99, 'Ghost-Tichondrius')] });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('phoenix');
  });

  it('does not clobber a team or character the visitor already touched', async () => {
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] });
    sandbox.supabaseClient = client;
    sandbox.initBoeCard();
    el('boeTeamSelect').value = 'wrathless';
    el('boeCharName').value = 'Someone-Else';
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('wrathless');
    expect(el('boeCharName').value).toBe('Someone-Else');
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

// The item picker (#875, select-only since #877): a <select> filled from
// DATA.boeItems for the viewed season, submitted exactly as chosen -- there
// is no free-text fallback and nothing to reconcile against the catalog.
describe('item picker (#875)', () => {
  const S1 = { id: 10, name: 'Visage of Unseen Truths', slot: 'Head', armorType: 'Cloth', icon: null, wclZoneId: 46 };
  const S2 = { id: 11, name: 'Crushing Coiler Coif', slot: 'Head', armorType: 'Mail', icon: null, wclZoneId: 53 };
  const UNSCOPED = {
    id: 12,
    name: 'Seed Test BoE Belt',
    slot: 'Waist',
    armorType: 'Leather',
    icon: null,
    wclZoneId: null
  };
  const catalogData = (over) =>
    Object.assign(
      {
        features: {},
        boeItems: [S1, S2, UNSCOPED],
        raidZones: [
          { wclZoneId: 46, season: 'midnight-s1' },
          { wclZoneId: 53, season: 'midnight-s2' }
        ],
        seasonName: 'midnight-s2'
      },
      over
    );

  it("offers the viewed season's BoEs plus any unscoped one, escaped, and nothing from another season, after a placeholder option", () => {
    const { sandbox, el } = makeSandbox();
    sandbox.DATA = catalogData({
      boeItems: [S1, S2, UNSCOPED, { id: 13, name: 'Girdle "of" <Night>', slot: 'Waist', wclZoneId: 53 }]
    });
    sandbox.refreshBoeItemOptions();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('<option value="">Select item</option>');
    expect(html).toContain('<option value="Crushing Coiler Coif">Crushing Coiler Coif</option>');
    expect(html).toContain('<option value="Seed Test BoE Belt">Seed Test BoE Belt</option>');
    expect(html).toContain(
      '<option value="Girdle &quot;of&quot; &lt;Night&gt;">Girdle &quot;of&quot; &lt;Night&gt;</option>'
    );
    expect(html).not.toContain('Visage of Unseen Truths');
  });

  it('offers every BoE when the viewed season has no zones', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.DATA = catalogData({ seasonName: 'no-such-season' });
    sandbox.refreshBoeItemOptions();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('Visage of Unseen Truths');
    expect(html).toContain('Crushing Coiler Coif');
    expect(html).toContain('Seed Test BoE Belt');
  });

  it('renders no options while the boe flag is off', () => {
    const { sandbox, el } = makeSandbox();
    sandbox.DATA = catalogData({ features: { boe: false } });
    sandbox.refreshBoeItemOptions();
    expect(el('boeItemName').innerHTML).toBe('');
  });

  it('submits the exact catalog spelling chosen in the select, to the RPC and the webhook', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.DATA = catalogData();
    fillCard(el);
    el('boeItemName').value = 'Crushing Coiler Coif';
    await sandbox.submitBoeFound();
    expect(calls.map((c) => c.kind)).toEqual(['rpc', 'invoke']);
    expect(calls[0].params.p_item_name).toBe('Crushing Coiler Coif');
    expect(calls[1].body.item).toBe('Crushing Coiler Coif');
  });
});

// The donate checkbox (#862): intent, not settlement. It reaches the RPC as
// p_donate and the webhook as donate, and clears with the other fields.
describe('donate intent (#862)', () => {
  it('a checked box sends p_donate true to the RPC and donate true to the webhook, then clears', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    el('boeDonate').checked = true;
    await sandbox.submitBoeFound();
    expect(calls[0].params.p_donate).toBe(true);
    expect(calls[1].body.donate).toBe(true);
    expect(el('boeDonate').checked).toBe(false);
  });

  it('an unchecked box sends false and stays false after a failed submit', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient({
      rpcResult: { data: null, error: { message: 'Unknown track: Heroic' } }
    });
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls[0].params.p_donate).toBe(false);
    expect(calls.map((c) => c.kind)).toEqual(['rpc']);
  });
});
