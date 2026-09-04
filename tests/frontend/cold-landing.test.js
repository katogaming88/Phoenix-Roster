import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A "cold landing" is a visit to index.html with no ?team= and no team chosen
// this session. js/roster.js's bottom-of-file gate is the entire boot decision
// for that page, and nothing tested it. #779 changes half of it: the manual
// three-button modal is replaced by a redirect to guild.html, while the
// claim-based auto-redirect above it stays exactly as it was.
//
// That split is the point of these tests. A signed-in raider with one claimed
// team must still land on their own roster, or this change makes every raider's
// first visit of the day one click longer.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/roster.js'), 'utf8');

function builder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return b;
}

/**
 * Runs common.js then roster.js, which self-executes its boot gate on load.
 * `storedTeam` null plus no ?team= is what makes IS_COLD_LANDING true, so the
 * gate takes the resolveColdLanding() branch rather than booting the app.
 */
function coldLand({
  session = null,
  memberRows = [],
  memberThrows = false,
  hasClient = true,
  search = '',
  hash = ''
} = {}) {
  const nav = { replaced: [], hrefs: [] };
  const stored = {};

  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session } }) },
    from: () => {
      if (memberThrows) {
        return {
          select: () => ({ eq: () => ({ then: (_r, reject) => Promise.reject(new Error('boom')).then(_r, reject) }) })
        };
      }
      return builder({ data: memberRows, error: null });
    }
  };

  const location = {
    search,
    hash,
    pathname: '/index.html',
    get href() {
      return '/index.html';
    },
    set href(v) {
      nav.hrefs.push(v);
    },
    replace: (v) => nav.replaced.push(v)
  };

  const sandbox = {
    window: {},
    location,
    sessionStorage: {
      getItem: (k) => stored[k] || null,
      setItem: (k, v) => {
        stored[k] = v;
      },
      removeItem: (k) => delete stored[k]
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      // js/roster.js:382 attaches a change listener to #playerSelect at top
      // level, unguarded, so the element has to exist for the file to load.
      getElementById: () => ({
        style: {},
        innerHTML: '',
        textContent: '',
        value: '',
        addEventListener: () => {},
        appendChild: () => {}
      }),
      createElement: () => ({ style: {}, textContent: '', className: '', appendChild: () => {} }),
      querySelectorAll: () => [],
      head: { appendChild: () => {} }
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise,
    fetch: () => Promise.reject(new Error('no network in the sandbox'))
  };
  sandbox.window = sandbox;
  if (hasClient) sandbox.supabase = { createClient: () => client };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'roster.js' });
  return { sandbox, nav };
}

// The boot gate fires on load; give its promise chain a few ticks to settle.
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('cold landing (#779)', () => {
  it('is a cold landing at all: no ?team= and no stored team', () => {
    // If this ever reads false the suite below tests bootRosterApp() instead,
    // and every redirect assertion passes vacuously by never running.
    const { sandbox } = coldLand();
    expect(sandbox.IS_COLD_LANDING).toBe(true);
  });

  it('sends a signed-out visitor to the guild page', async () => {
    const { nav } = coldLand({ session: null });
    await settle();
    expect(nav.replaced).toEqual(['guild.html']);
    expect(nav.hrefs).toEqual([]);
  });

  it('still sends a raider with one claimed team straight to their roster', async () => {
    const { nav } = coldLand({
      session: { user: { id: 'auth-1' } },
      memberRows: [{ team_id: 2, players: [{ name_realm: 'Bravo-Tichondrius' }] }]
    });
    await settle();
    expect(nav.hrefs).toEqual(['/index.html?team=hellfire']);
    expect(nav.replaced).toEqual([]);
  });

  it('sends a signed-in account with no claim to the guild page', async () => {
    const { nav } = coldLand({
      session: { user: { id: 'auth-1' } },
      memberRows: [{ team_id: 2, players: [] }]
    });
    await settle();
    expect(nav.replaced).toEqual(['guild.html']);
  });

  it('sends the visitor to the guild page when the claim read throws', async () => {
    const { nav } = coldLand({ session: { user: { id: 'auth-1' } }, memberThrows: true });
    await settle();
    expect(nav.replaced).toEqual(['guild.html']);
  });

  it('sends the visitor to the guild page when the supabase CDN failed', async () => {
    const { nav } = coldLand({ hasClient: false });
    await settle();
    expect(nav.replaced).toEqual(['guild.html']);
  });

  it('uses replace, so Back does not bounce off the redirect', async () => {
    // location.href would leave index.html in history, and going Back from the
    // guild page would land on it and redirect forward again.
    const { nav } = coldLand({ session: null });
    await settle();
    expect(nav.replaced.length).toBe(1);
  });
});

// The BoE report form moved to boe.html (#891). index.html?team=<slug>#boe is
// the pinned per-team Discord link every Immolation raider uses, so it has to
// keep landing on the form rather than on a page that no longer has one.
describe('the #boe deep link follows the form (#891)', () => {
  it('replaces the page with boe.html, carrying the team', () => {
    const { nav } = coldLand({ search: '?team=hellfire', hash: '#boe' });
    expect(nav.replaced).toContain('boe.html?team=hellfire');
  });

  it('carries the resolved team even when the link named none', () => {
    const { nav } = coldLand({ search: '?team=phoenix', hash: '#boe' });
    expect(nav.replaced).toContain('boe.html?team=phoenix');
  });

  it('leaves every other hash alone', () => {
    const { nav } = coldLand({ search: '?team=phoenix', hash: '#roster' });
    expect(nav.replaced.filter((u) => String(u).indexOf('boe.html') === 0)).toEqual([]);
  });
});

describe('the team picker modal is gone (#779)', () => {
  const roster = readFileSync(path.join(HERE, '../../js/roster.js'), 'utf8');
  const index = readFileSync(path.join(HERE, '../../index.html'), 'utf8');
  const css = readFileSync(path.join(HERE, '../../css/styles.css'), 'utf8');

  it('leaves no reference behind in any of the three files it spanned', () => {
    // Markup, styles and the code that showed it were removed together. A
    // leftover in any one of them is dead weight that reads as live.
    expect(roster).not.toContain('teamPicker');
    expect(index).not.toContain('teamPicker');
    expect(css).not.toContain('team-picker');
  });
});
