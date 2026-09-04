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
// invoke fires, and how the status region, button state and prefill behave.
//
// The card moved off index.html onto boe.html in #891, which is what most of
// the new cases below are about. That page carries no team, so there is no
// page team to fall back on: the reporting team comes from an explicit
// ?team=, else a lone claimed character, else a placeholder the submit
// refuses. The item catalog and the raid zones its season filter needs used to
// ride index.html's loadData(); this file reads them itself now.

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
  'boeDonate',
  'boeUpgradeRank'
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
    location: { search, pathname: '/boe.html' },
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
  // js/boe.js reads the explicit ?team= at parse time, before js/boe-page.js
  // nulls the team globals, so the elements are created first and the file
  // runs against a sandbox that looks like the real load order.
  CARD_ELS.forEach(el);
  vm.runInContext(BOE_JS, sandbox, { filename: 'boe.js' });
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

const S1 = { id: 10, name: 'Visage of Unseen Truths', wcl_zone_id: 46 };
const S2 = { id: 11, name: 'Crushing Coiler Coif', wcl_zone_id: 53 };
const UNSCOPED = { id: 12, name: 'Seed Test BoE Belt', wcl_zone_id: null };
const ZONES = [
  { wcl_zone_id: 46, season: 'midnight-s1' },
  { wcl_zone_id: 53, season: 'midnight-s2' }
];

// Records rpc and invoke calls in arrival order so tests can assert both the
// payloads and that the webhook only ever fires after the RPC settled green.
function recorderClient({
  rpcResult = { data: 1, error: null },
  teamSettings = ALL_ENABLED,
  memberRows = [],
  items = [],
  raidZones = ZONES
} = {}) {
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
        const rows =
          table === 'team_settings'
            ? teamSettings
            : table === 'items'
              ? items
              : table === 'raid_zones'
                ? raidZones
                : memberRows;
        return { select: () => builder(rows) };
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

function fillCard(el, teamSlug) {
  el('boeTeamSelect').value = teamSlug || 'phoenix';
  el('boeCharName').value = '  Kae-Tichondrius  ';
  el('boeItemName').value = '  Voidglass Cloak  ';
  el('boeTrack').value = 'Hero';
  el('boeUpgradeRank').value = '2/6';
  el('boeNote').value = '  from trash before boss 2  ';
}

describe('submitBoeFound RPC payload', () => {
  it('trims every text field and sends the selected team', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el, 'hellfire');
    await sandbox.submitBoeFound();
    const rpc = calls.find((c) => c.kind === 'rpc');
    expect(rpc.name).toBe('submit_boe_found');
    expect(rpc.params).toEqual({
      p_team_id: 2,
      p_name_realm: 'Kae-Tichondrius',
      p_item_name: 'Voidglass Cloak',
      p_track: 'Hero',
      p_note: 'from trash before boss 2',
      p_donate: false,
      p_upgrade_rank: '2/6'
    });
  });

  it('sends a null note when the field is blank', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el);
    el('boeNote').value = '   ';
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'rpc').params.p_note).toBeNull();
  });

  it('reports for a team the visitor picked, not one the page chose', async () => {
    // The whole point of the dropdown (#767), and the only way to file a
    // Wrathless find at all: it has no page of its own.
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el, 'wrathless');
    await sandbox.submitBoeFound();
    expect(calls.find((c) => c.kind === 'rpc').params.p_team_id).toBe(4);
  });
});

describe('boe-webhook invoke', () => {
  it('fires after a green RPC with the team name and the find', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el, 'hellfire');
    await sandbox.submitBoeFound();
    const kinds = calls.filter((c) => c.kind === 'rpc' || c.kind === 'invoke').map((c) => c.kind);
    expect(kinds).toEqual(['rpc', 'invoke']);
    const invoke = calls.find((c) => c.kind === 'invoke');
    expect(invoke.name).toBe('boe-webhook');
    expect(invoke.body).toEqual({
      team: 'Hellfire Rollers',
      finder: 'Kae-Tichondrius',
      item: 'Voidglass Cloak',
      track: 'Hero',
      note: 'from trash before boss 2',
      donate: false,
      upgradeRank: '2/6'
    });
  });

  it('never fires when the RPC returned an error', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient({ rpcResult: { data: null, error: { message: 'Unknown track' } } });
    sandbox.supabaseClient = client;
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(calls.filter((c) => c.kind === 'invoke')).toEqual([]);
    expect(el('boeStatus').textContent).toBe('Unknown track');
  });
});

describe('client-side validation', () => {
  const cases = [
    ['boeTeamSelect', 'Please select the team you raided with.'],
    ['boeCharName', 'Please enter your character name.'],
    ['boeItemName', 'Please select an item.'],
    ['boeTrack', 'Please select the track.'],
    ['boeUpgradeRank', 'Please select the upgrade rank.']
  ];

  cases.forEach(([field, message]) => {
    it('refuses a missing ' + field + ' before any network call', async () => {
      const { sandbox, el } = makeSandbox();
      const { calls, client } = recorderClient();
      sandbox.supabaseClient = client;
      fillCard(el);
      el(field).value = '';
      await sandbox.submitBoeFound();
      expect(el('boeStatus').textContent).toBe(message);
      expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
    });
  });

  // The placeholder is the no-team state on boe.html, which has no page team
  // to fall back on (#891). Reporting into whichever team happened to be
  // first would file finds where nobody is watching for them.
  it('names the team first, since it is the first field', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    await sandbox.submitBoeFound();
    expect(el('boeStatus').textContent).toBe('Please select the team you raided with.');
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
  });
});

describe('submit button in-flight guard', () => {
  it('disables the button during the call and restores it after', async () => {
    const { sandbox, el } = makeSandbox();
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    sandbox.supabaseClient = {
      rpc: () => gate,
      functions: { invoke: () => Promise.resolve({}) }
    };
    fillCard(el);
    const pending = sandbox.submitBoeFound();
    expect(el('boeSubmitBtn').disabled).toBe(true);
    expect(el('boeSubmitBtn').textContent).toBe('Submitting...');
    release({ data: 1, error: null });
    await pending;
    expect(el('boeSubmitBtn').disabled).toBe(false);
    expect(el('boeSubmitBtn').textContent).toBe('Submit');
  });

  it('restores the button when the call throws', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = { rpc: () => Promise.reject(new Error('offline')) };
    fillCard(el);
    await sandbox.submitBoeFound();
    expect(el('boeSubmitBtn').disabled).toBe(false);
    expect(el('boeStatus').textContent).toBe('offline');
  });
});

describe('success reset', () => {
  it('clears item and note, keeps the character and the team, and announces', async () => {
    // The team stays because a raider reporting two finds from one night is
    // reporting them for the same team.
    const { sandbox, el } = makeSandbox();
    const { client } = recorderClient();
    sandbox.supabaseClient = client;
    fillCard(el, 'hellfire');
    await sandbox.submitBoeFound();
    expect(el('boeItemName').value).toBe('');
    expect(el('boeNote').value).toBe('');
    expect(el('boeCharName').value).toBe('  Kae-Tichondrius  ');
    expect(el('boeTeamSelect').value).toBe('hellfire');
    expect(el('boeStatus').textContent).toBe('Submitted! Officers will take it from here.');
  });
});

describe('visibleTeamSlugs (#767)', () => {
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

describe('the reporting team on a page with none (#891)', () => {
  it('opens on a placeholder that names what to do', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient().client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').innerHTML).toContain('<option value="">Select the team you raided with</option>');
    expect(el('boeTeamSelect').value).toBe('');
  });

  it('offers every team including hidden Wrathless, which no other picker lists', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient().client;
    await sandbox.initBoeCard();
    const html = el('boeTeamSelect').innerHTML;
    ['phoenix', 'hellfire', 'immolation', 'wrathless'].forEach((slug) => {
      expect(html).toContain('value="' + slug + '"');
    });
    expect(html).toContain('Wrathless');
    expect(sandbox.visibleTeamSlugs()).toEqual(['phoenix', 'hellfire', 'immolation']);
  });

  it('an explicit ?team= selects that team, so pinned links keep reporting where they say', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    sandbox.supabaseClient = recorderClient().client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('hellfire');
  });

  it('drops a team that turned its own boe flag off, and keeps the placeholder', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({
      teamSettings: [
        { team_id: 1, config: {} },
        { team_id: 2, config: { features: { boe: false } } },
        { team_id: 3, config: {} },
        { team_id: 4, config: {} }
      ]
    }).client;
    await sandbox.initBoeCard();
    const html = el('boeTeamSelect').innerHTML;
    expect(html).not.toContain('value="hellfire"');
    expect(html).toContain('value="phoenix"');
    expect(el('boeTeamSelect').value).toBe('');
  });

  it('moves an explicit team off a team that turned the flag off', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    sandbox.supabaseClient = recorderClient({
      teamSettings: [
        { team_id: 1, config: {} },
        { team_id: 2, config: { features: { boe: false } } },
        { team_id: 3, config: {} },
        { team_id: 4, config: {} }
      ]
    }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('phoenix');
  });

  it('keeps every option when the settings read fails, so a find can still be reported', async () => {
    const { sandbox, el } = makeSandbox();
    const failed = { then: (ok, err) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, err) };
    failed.eq = () => failed;
    sandbox.supabaseClient = {
      from: () => ({ select: () => failed }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) }
    };
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').innerHTML).toContain('value="hellfire"');
  });

  it('changing the dropdown does not navigate or rewrite the stored team', async () => {
    const { sandbox, el, stored } = makeSandbox();
    sandbox.supabaseClient = recorderClient().client;
    await sandbox.initBoeCard();
    el('boeTeamSelect').value = 'wrathless';
    sandbox.onBoeTeamChange();
    expect(sandbox.location.pathname).toBe('/boe.html');
    expect(sandbox.location.href).toBeUndefined();
    expect(stored.filter(([k]) => k === 'wga_team')).toEqual([]);
  });
});

describe('identity resolution (#767, #891)', () => {
  const claim = (teamId, name, archived = null) => ({
    team_id: teamId,
    players: [{ name_realm: name, archived_at: archived }]
  });

  it('logged out leaves the placeholder and the character empty', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = {
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      from: () => ({ select: () => builder([]) })
    };
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('');
    expect(el('boeCharName').value).toBe('');
  });

  it('a single claim selects that team and prefills the character', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('immolation');
    expect(el('boeCharName').value).toBe('Kae-Tichondrius');
  });

  // Alts on two teams say nothing about which one they raided with tonight,
  // and there is no page team to fall back on any more, so the placeholder
  // stands and the visitor answers.
  it('multiple claims leave the placeholder, and still prefill the character', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({
      memberRows: [claim(2, 'Alt-Tichondrius'), claim(3, 'Other-Tichondrius')]
    }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('');
    expect(el('boeCharName').value).toBe('Alt-Tichondrius');
  });

  it('an explicit ?team= beats a lone claim elsewhere', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=hellfire' });
    sandbox.supabaseClient = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('hellfire');
  });

  it('ignores an archived alt, which the cold-landing query does not filter', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({
      memberRows: [claim(3, 'Retired-Tichondrius', '2026-01-01T00:00:00Z')]
    }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('');
    expect(el('boeCharName').value).toBe('');
  });

  it('skips a claim on a team the client config does not know', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({ memberRows: [claim(99, 'Ghost-Tichondrius')] }).client;
    await sandbox.initBoeCard();
    expect(el('boeTeamSelect').value).toBe('');
  });

  it('does not clobber a team or character the visitor already touched', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = recorderClient({ memberRows: [claim(3, 'Kae-Tichondrius')] }).client;
    el('boeTeamSelect').value = 'wrathless';
    el('boeCharName').value = 'Someone-Else';
    await sandbox.refreshBoeIdentity();
    expect(el('boeTeamSelect').value).toBe('wrathless');
    expect(el('boeCharName').value).toBe('Someone-Else');
  });
});

// The item picker (#875, select-only since #877): a <select> filled from the
// BoE catalog for the reporting team's season, submitted exactly as chosen --
// there is no free-text fallback and nothing to reconcile against the catalog.
// #891 moved the catalog read here, since boe.html has no loadData().
describe('item picker (#875, #891)', () => {
  const withCatalog = (over) =>
    recorderClient(
      Object.assign(
        {
          items: [S1, S2, UNSCOPED],
          teamSettings: [
            { team_id: 1, config: { seasonView: 'midnight-s2' } },
            { team_id: 2, config: { seasonView: 'midnight-s1' } },
            { team_id: 3, config: {} },
            { team_id: 4, config: {} }
          ]
        },
        over
      )
    );

  it('reads the BoE catalog and the raid zones itself', async () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = withCatalog();
    sandbox.supabaseClient = client;
    await sandbox.initBoeCard();
    const tables = calls.filter((c) => c.kind === 'from').map((c) => c.table);
    expect(tables).toContain('items');
    expect(tables).toContain('raid_zones');
  });

  it("offers the reporting team's season plus any unscoped BoE, after a placeholder", async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=phoenix' });
    sandbox.supabaseClient = withCatalog().client;
    await sandbox.initBoeCard();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('<option value="">Select item</option>');
    expect(html).toContain('<option value="Crushing Coiler Coif">Crushing Coiler Coif</option>');
    expect(html).toContain('<option value="Seed Test BoE Belt">Seed Test BoE Belt</option>');
    expect(html).not.toContain('Visage of Unseen Truths');
  });

  it('follows the team the visitor picks', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=phoenix' });
    sandbox.supabaseClient = withCatalog().client;
    await sandbox.initBoeCard();
    expect(el('boeItemName').innerHTML).not.toContain('Visage of Unseen Truths');
    el('boeTeamSelect').value = 'hellfire';
    sandbox.onBoeTeamChange();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('Visage of Unseen Truths');
    expect(html).not.toContain('Crushing Coiler Coif');
  });

  // Wrathless raids with the guild and configures no season of its own, so
  // its picker borrows the first listed team that has one rather than
  // offering every BoE the guild has ever tracked.
  it('borrows a season for a team that has none configured', async () => {
    const { sandbox, el } = makeSandbox({ search: '?team=wrathless' });
    sandbox.supabaseClient = withCatalog().client;
    await sandbox.initBoeCard();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('Crushing Coiler Coif');
    expect(html).not.toContain('Visage of Unseen Truths');
  });

  it('offers every BoE when no team has a season with zones', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = withCatalog({ teamSettings: ALL_ENABLED }).client;
    await sandbox.initBoeCard();
    const html = el('boeItemName').innerHTML;
    expect(html).toContain('Visage of Unseen Truths');
    expect(html).toContain('Crushing Coiler Coif');
    expect(html).toContain('Seed Test BoE Belt');
  });

  it('escapes an item name with quotes and angle brackets', async () => {
    const { sandbox, el } = makeSandbox();
    sandbox.supabaseClient = withCatalog({
      items: [{ id: 13, name: 'Girdle "of" <Night>', wcl_zone_id: null }],
      teamSettings: ALL_ENABLED
    }).client;
    await sandbox.initBoeCard();
    expect(el('boeItemName').innerHTML).toContain(
      '<option value="Girdle &quot;of&quot; &lt;Night&gt;">Girdle &quot;of&quot; &lt;Night&gt;</option>'
    );
  });

  it('leaves the placeholder alone when the catalog read fails', async () => {
    const { sandbox, el } = makeSandbox();
    const failed = { then: (ok, err) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, err) };
    failed.eq = () => failed;
    sandbox.supabaseClient = {
      from: (table) => ({ select: () => (table === 'items' ? failed : builder(ALL_ENABLED)) }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) }
    };
    await sandbox.initBoeCard();
    expect(el('boeItemName').innerHTML).toBe('<option value="">Select item</option>');
  });

  it('submits the exact catalog spelling chosen in the select, to the RPC and the webhook', async () => {
    const { sandbox, el } = makeSandbox();
    const { calls, client } = withCatalog();
    sandbox.supabaseClient = client;
    fillCard(el);
    el('boeItemName').value = 'Crushing Coiler Coif';
    await sandbox.submitBoeFound();
    const acts = calls.filter((c) => c.kind === 'rpc' || c.kind === 'invoke');
    expect(acts.map((c) => c.kind)).toEqual(['rpc', 'invoke']);
    expect(acts[0].params.p_item_name).toBe('Crushing Coiler Coif');
    expect(acts[1].body.item).toBe('Crushing Coiler Coif');
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
    const acts = calls.filter((c) => c.kind === 'rpc' || c.kind === 'invoke');
    expect(acts[0].params.p_donate).toBe(true);
    expect(acts[1].body.donate).toBe(true);
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
    const acts = calls.filter((c) => c.kind === 'rpc' || c.kind === 'invoke');
    expect(acts[0].params.p_donate).toBe(false);
    expect(acts.map((c) => c.kind)).toEqual(['rpc']);
  });
});

// The form left index.html entirely (#891). Nothing in the bundle may still
// reach for the view it lived in, or a stale call throws on a page that no
// longer has the element.
describe('nothing left behind on index.html (#891)', () => {
  it('defines no view switcher of its own any more', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.showBoeView).toBeUndefined();
  });

  it('names neither the old view wrapper nor showView', () => {
    expect(BOE_JS).not.toContain('boeViewWrap');
    expect(BOE_JS).not.toContain('showView(');
  });
});
