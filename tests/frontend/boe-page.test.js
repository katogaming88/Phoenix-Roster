import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/boe-page.js boots boe.html, the BoE Sales page (#864). Same harness shape
// as tests/frontend/guild-page.test.js: the real js/common.js and
// js/boe-manage.js run in a vm sandbox under the page script, with the page's
// elements stubbed by id.
//
// The page is team-free like guild.html, so the first thing asserted is the
// same clearing of the team globals common.js resolved at parse time. The rest
// is the access ladder: signed out asks nothing, a signed-in raider is told
// whom the page is for, an officer gets the read-only view, a manager or site
// admin gets the actions.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const BOE_MANAGE_JS = readFileSync(path.join(HERE, '../../js/boe-manage.js'), 'utf8');
const BOE_PAGE_JS = readFileSync(path.join(HERE, '../../js/boe-page.js'), 'utf8');

const PAGE_ELS = [
  'main-content',
  'boeLoading',
  'maintenanceBanner',
  'maintenanceBannerMessage',
  'boeAccessNote',
  'guildBoeSummary',
  'guildBoeOpen',
  'guildBoeAwaiting',
  'guildBoeHistory',
  'boeWhoAmI',
  'boeAuthBtn',
  'boeVersion'
];

function builder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    gt: () => b,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return b;
}

function makeSandbox({ session = null, boeRpc = {}, boeItems = [], maintenance = null, rpcRejects = false } = {}) {
  const els = {};
  const calls = [];
  const errors = [];
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id,
        value: '',
        innerHTML: '',
        textContent: '',
        style: {},
        disabled: false,
        className: '',
        setAttribute() {},
        focus() {},
        querySelectorAll: () => []
      };
    }
    return els[id];
  }
  PAGE_ELS.forEach(el);

  const client = {
    rpc: (name) => {
      calls.push({ kind: 'rpc', name });
      if (rpcRejects) return Promise.reject(new Error('network'));
      return Promise.resolve({ data: boeRpc[name] === true, error: null });
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => {},
      signInWithOAuth: (opts) => {
        calls.push({ kind: 'signIn', opts });
        return Promise.resolve({});
      },
      signOut: () => {
        calls.push({ kind: 'signOut' });
        return Promise.resolve({});
      }
    },
    from: (table) => {
      calls.push({ kind: 'from', table });
      if (table === 'site_settings') return builder({ data: maintenance, error: null });
      if (table === 'boe_items' || table === 'boe_listings') {
        const rows = table === 'boe_items' ? boeItems : [];
        return builder({ data: rows, error: null, count: rows.length });
      }
      return builder({ data: [], error: null });
    }
  };

  const sandbox = {
    window: {},
    location: { search: '', pathname: '/boe.html', origin: 'https://example.test', href: '', hash: '' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ style: {}, textContent: '', innerHTML: '', appendChild() {} }),
      querySelectorAll: (sel) =>
        sel
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('#'))
          .map((s) => els[s.slice(1)])
          .filter(Boolean),
      head: { appendChild: () => {} }
    },
    console: {
      log: () => {},
      warn: () => {},
      error: (...args) => {
        errors.push(args);
      }
    },
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  // Same order boe.html loads them in.
  vm.runInContext(BOE_MANAGE_JS, sandbox, { filename: 'boe-manage.js' });
  vm.runInContext(BOE_PAGE_JS, sandbox, { filename: 'boe-page.js' });
  sandbox.supabaseClient = client;
  return { sandbox, els, calls, errors };
}

const SESSION = { user: { id: 'auth-1', user_metadata: { full_name: 'Rex' } } };

// The BoE read is kicked off without being awaited by the boot, so the rows
// land a few ticks after bootBoePage() resolves.
const flush = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

async function settle(sandbox) {
  await sandbox.bootBoePage();
  for (let i = 0; i < 8; i++) await flush();
}

describe('team-free globals, as on guild.html (#777)', () => {
  it('clears the team common.js resolved at parse time', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.TEAM_SLUG).toBeNull();
    expect(sandbox.TEAM_NAME).toBeNull();
    expect(sandbox._teamCfg).toBeNull();
    expect(sandbox.IS_COLD_LANDING).toBe(false);
  });
});

describe('boot states', () => {
  it('says it is loading before the session settles', () => {
    const { sandbox, els } = makeSandbox({ session: SESSION });
    // Not awaited: the loading line is the synchronous first write, so a
    // restored session can never flash the no-access message first.
    sandbox.bootBoePage();
    expect(els.boeAccessNote.innerHTML).toContain('Loading');
  });

  it('signed out, offers sign-in and asks nothing about the visitor', async () => {
    const { sandbox, els, calls } = makeSandbox();
    await settle(sandbox);
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
    expect(els.boeAccessNote.innerHTML).toContain('Sign in');
    expect(els.boeAccessNote.innerHTML).toContain('officers and BoE managers');
    expect(els.guildBoeSummary.innerHTML).toBe('');
    expect(els.boeAuthBtn.textContent).toBe('Sign in with Discord');
    expect(els.boeLoading.style.display).toBe('none');
  });

  it('signed in with none of the three grants, says whom the page is for and renders nothing', async () => {
    const { sandbox, els, calls } = makeSandbox({ session: SESSION });
    await settle(sandbox);
    expect(
      calls
        .filter((c) => c.kind === 'rpc')
        .map((c) => c.name)
        .sort()
    ).toEqual(['is_any_team_officer', 'is_boe_manager', 'is_site_admin']);
    expect(els.boeAccessNote.innerHTML).toContain('officers and BoE managers');
    expect(els.boeAccessNote.innerHTML).not.toContain('Sign in');
    expect(els.guildBoeSummary.innerHTML).toBe('');
    expect(els.boeWhoAmI.textContent).toBe('Rex');
    expect(els.boeAuthBtn.textContent).toBe('Sign out');
  });

  it('renders read-only for a plain team officer', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      boeRpc: { is_any_team_officer: true },
      boeItems: [{ id: 1, team_id: 1, item_name: 'Phoenix Find', status: 'found', found_at: '2026-08-20T01:00:00Z' }]
    });
    await settle(sandbox);
    expect(els.boeAccessNote.innerHTML).toBe('');
    expect(els.guildBoeSummary.innerHTML).toContain('assigned by a site admin');
    expect(els.guildBoeOpen.innerHTML).toContain('Phoenix Find');
    expect(els.guildBoeOpen.innerHTML).not.toContain('<button');
  });

  it('renders with actions for a BoE manager holding no officer role anywhere', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      boeItems: [{ id: 1, team_id: 4, item_name: 'Wrathless Find', status: 'found', found_at: '2026-08-20T01:00:00Z' }]
    });
    await settle(sandbox);
    expect(els.guildBoeOpen.innerHTML).toContain('Record Listing');
  });

  it('renders with actions for a site admin, whom is_boe_manager does not cover', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      boeRpc: { is_site_admin: true },
      boeItems: [{ id: 1, team_id: 1, item_name: 'Phoenix Find', status: 'found', found_at: '2026-08-20T01:00:00Z' }]
    });
    await settle(sandbox);
    expect(els.guildBoeOpen.innerHTML).toContain('Record Listing');
  });

  it('treats an access RPC that rejects as no access rather than a broken page', async () => {
    const { sandbox, els, errors } = makeSandbox({ session: SESSION, rpcRejects: true });
    await settle(sandbox);
    expect(els.boeAccessNote.innerHTML).toContain('officers and BoE managers');
    expect(els.boeLoading.style.display).toBe('none');
    expect(errors).toEqual([]);
  });

  // A throw anywhere in the chain is swallowed by the boot's catch, which is
  // what left guild.html half-rendered twice. The catch logs, so a healthy
  // render is one that hid the loading state, filled the summary, and logged
  // nothing at all.
  it('hides the loading state and logs nothing on a healthy manager render', async () => {
    const { sandbox, els, errors } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      boeItems: [{ id: 1, team_id: 1, item_name: 'Phoenix Find', status: 'found', found_at: '2026-08-20T01:00:00Z' }]
    });
    await settle(sandbox);
    expect(els.boeLoading.style.display).toBe('none');
    expect(els.guildBoeSummary.innerHTML).toContain('Guild income');
    expect(errors).toEqual([]);
  });

  it('shows the maintenance banner and stops before asking anything', async () => {
    const { sandbox, els, calls } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      maintenance: { maintenance_mode: true, maintenance_message: 'Back soon' }
    });
    await settle(sandbox);
    expect(els.maintenanceBanner.style.display).not.toBe('none');
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
    expect(els.boeLoading.style.display).toBe('none');
  });
});

describe('sign-in', () => {
  it('returns to this page, not to index.html', async () => {
    const { sandbox, calls } = makeSandbox();
    await settle(sandbox);
    sandbox.boePageLogin();
    const signIn = calls.find((c) => c.kind === 'signIn');
    expect(signIn).toBeDefined();
    expect(signIn.opts.provider).toBe('discord');
    expect(signIn.opts.options.redirectTo).toBe('https://example.test/boe.html');
  });

  it('wires the nav button to sign in when signed out and to sign out when signed in', async () => {
    const out = makeSandbox();
    await settle(out.sandbox);
    expect(out.els.boeAuthBtn.onclick).toBe(out.sandbox.boePageLogin);

    const inn = makeSandbox({ session: SESSION });
    await settle(inn.sandbox);
    expect(inn.els.boeAuthBtn.onclick).toBe(inn.sandbox.boePageLogout);
  });
});
