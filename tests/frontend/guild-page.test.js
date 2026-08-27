import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/guild.js is a plain browser script (no exports), so these tests run it in
// a vm sandbox on top of the real js/common.js -- same harness shape as
// tests/frontend/boe-submit.test.js.
//
// guild.html is the one page that is not scoped to a team (#777). common.js
// resolves a team at parse time and hard-defaults to Phoenix, so js/guild.js
// nulls those globals: a team-dependent helper called here by mistake has to
// throw rather than quietly render another team's data. Half of what is
// asserted below is that clearing, and the other half is the team the page
// resolves for its cross-page links, which is the only team it ever knows.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const GUILD_JS = readFileSync(path.join(HERE, '../../js/guild.js'), 'utf8');

const PAGE_ELS = [
  'main-content',
  'guildLoading',
  'maintenanceBanner',
  'maintenanceBannerMessage',
  'guildTeams',
  'guildWhoAmI',
  'guildAuthBtn',
  'guildVersion'
];

// A thenable that also carries the PostgREST builder methods, so a chain can be
// awaited at whatever depth the code under test stops at.
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

function makeSandbox({
  session = null,
  memberRows = [],
  memberError = null,
  maintenance = null,
  storedTeam = null
} = {}) {
  const els = {};
  const calls = [];
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
        focus() {}
      };
    }
    return els[id];
  }
  PAGE_ELS.forEach(el);

  const client = {
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
      if (table === 'site_settings') {
        return builder({ data: maintenance, error: null });
      }
      if (memberError) return builder({ data: null, error: memberError });
      return builder({ data: memberRows, error: null });
    }
  };

  const sandbox = {
    window: {},
    location: { search: '', pathname: '/guild.html', origin: 'https://example.test', href: '' },
    sessionStorage: {
      getItem: (k) => (k === 'wga_team' ? storedTeam : null),
      setItem: () => {},
      removeItem: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ style: {}, textContent: '', innerHTML: '', appendChild() {} }),
      // Selector-aware enough for showMaintenanceBanner's comma-separated list
      // of id and class selectors. A stub that returned [] would make the
      // maintenance assertions pass without the page ever being hidden.
      querySelectorAll: (sel) =>
        sel
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('#'))
          .map((s) => els[s.slice(1)])
          .filter(Boolean),
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
    Promise
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(GUILD_JS, sandbox, { filename: 'guild.js' });
  sandbox.supabaseClient = client;
  return { sandbox, els, calls, el };
}

const SESSION = { user: { id: 'auth-1', user_metadata: { full_name: 'Rex' } } };

function claim(teamId, nameRealm) {
  return { team_id: teamId, players: [{ name_realm: nameRealm }] };
}

describe('team-free globals (#777)', () => {
  it('clears the team common.js resolved at parse time', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.TEAM_SLUG).toBeNull();
    expect(sandbox.TEAM_NAME).toBeNull();
    expect(sandbox._teamCfg).toBeNull();
    expect(sandbox.IS_COLD_LANDING).toBe(false);
  });

  it('seeds DATA, which common.js initialises to null', () => {
    const { sandbox } = makeSandbox();
    // js/streamers.js dereferences DATA.streamers and DATA.roster unguarded,
    // and null.streamers throws rather than reading undefined.
    expect(sandbox.DATA).not.toBeNull();
    expect(sandbox.DATA.streamers).toEqual([]);
    expect(sandbox.DATA.roster).toEqual([]);
  });

  it('still has the guild-wide helpers it loaded common.js for', () => {
    const { sandbox } = makeSandbox();
    expect(typeof sandbox.visibleTeamSlugs).toBe('function');
    expect(typeof sandbox.checkMaintenanceMode).toBe('function');
    expect(sandbox.TEAMS.phoenix.supabaseTeamId).toBe(1);
    expect(typeof sandbox.VERSION).toBe('string');
  });
});

describe('guildTeamHref', () => {
  it('always carries a team param', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.guildTeamHref('hellfire')).toBe('index.html?team=hellfire');
  });

  it('appends a hash after the param', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.guildTeamHref('phoenix', 'signup')).toBe('index.html?team=phoenix#signup');
  });

  it('never emits a bare index.html, which would bounce back here', () => {
    // A cold landing on index.html redirects to guild.html (#779), so a link
    // out with no team is an infinite bounce, not a cosmetic slip.
    const { sandbox } = makeSandbox();
    for (const slug of Object.keys(sandbox.TEAMS)) {
      expect(sandbox.guildTeamHref(slug)).toMatch(/^index\.html\?team=/);
      expect(sandbox.guildTeamHref(slug, 'boe')).toMatch(/^index\.html\?team=/);
    }
  });

  it('falls back to the resolved team when given nothing', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.guildTeamHref()).toBe('index.html?team=' + sandbox.guildTeamSlug());
  });
});

describe('resolveGuildTeam precedence', () => {
  it('uses the single claimed team when signed in', async () => {
    const { sandbox } = makeSandbox({ session: SESSION, memberRows: [claim(2, 'Bravo-Tichondrius')] });
    expect(await sandbox.resolveGuildTeam()).toBe('hellfire');
    expect(sandbox.guildTeamSlug()).toBe('hellfire');
  });

  it('resolves a claim on a hidden team', async () => {
    // ?team=wrathless is a real unlisted URL, so a claim there has to resolve
    // even though the team never appears in a picker.
    const { sandbox } = makeSandbox({ session: SESSION, memberRows: [claim(4, 'Delta-Tichondrius')] });
    expect(await sandbox.resolveGuildTeam()).toBe('wrathless');
  });

  it('ignores a team_members row with no linked character', async () => {
    const { sandbox } = makeSandbox({
      session: SESSION,
      memberRows: [{ team_id: 2, players: [] }, claim(3, 'Charlie-Tichondrius')]
    });
    expect(await sandbox.resolveGuildTeam()).toBe('immolation');
  });

  it('falls through when claimed on two teams, rather than picking one', async () => {
    const { sandbox } = makeSandbox({
      session: SESSION,
      memberRows: [claim(1, 'Alpha-Tichondrius'), claim(2, 'Bravo-Tichondrius')],
      storedTeam: 'immolation'
    });
    expect(await sandbox.resolveGuildTeam()).toBe('immolation');
  });

  it('falls back to the session team when signed out', async () => {
    const { sandbox } = makeSandbox({ storedTeam: 'hellfire' });
    expect(await sandbox.resolveGuildTeam()).toBe('hellfire');
  });

  it('ignores a stored slug that is not a real team', async () => {
    const { sandbox } = makeSandbox({ storedTeam: 'nonsense' });
    expect(await sandbox.resolveGuildTeam()).toBe(sandbox.visibleTeamSlugs()[0]);
  });

  it('falls back to the first visible team when nothing is known', async () => {
    const { sandbox } = makeSandbox();
    const slug = await sandbox.resolveGuildTeam();
    expect(slug).toBe(sandbox.visibleTeamSlugs()[0]);
    expect(sandbox.TEAMS[slug].hidden).toBeUndefined();
  });

  it('falls back rather than rejecting when the claim read errors', async () => {
    const { sandbox } = makeSandbox({
      session: SESSION,
      memberError: { message: 'nope' },
      storedTeam: 'immolation'
    });
    expect(await sandbox.resolveGuildTeam()).toBe('immolation');
  });

  it('does not read team_members at all when signed out', async () => {
    const { sandbox, calls } = makeSandbox();
    await sandbox.resolveGuildTeam();
    expect(calls.filter((c) => c.table === 'team_members')).toEqual([]);
  });
});

describe('maintenance mode', () => {
  it('hides the page body, not just the nav', async () => {
    // showMaintenanceBanner hides .view/#loadingMsg/#officerPrompt/.site-nav,
    // none of which a single-scroll page has. Without #main-content in that
    // selector the banner renders over a fully visible page.
    const { sandbox, els } = makeSandbox({ maintenance: { maintenance_mode: true, maintenance_message: 'Back soon' } });
    await sandbox.bootGuildPage();
    expect(els['main-content'].style.display).toBe('none');
    expect(els.maintenanceBanner.style.display).toBe('');
    expect(els.maintenanceBannerMessage.textContent).toBe('Back soon');
  });

  it('renders normally when maintenance is off', async () => {
    const { sandbox, els } = makeSandbox({ maintenance: { maintenance_mode: false, maintenance_message: null } });
    await sandbox.bootGuildPage();
    expect(els['main-content'].style.display).not.toBe('none');
    // showMaintenanceBanner reveals the banner by setting display to ''. The
    // page's own markup keeps it hidden, so "not revealed" is the assertion.
    expect(els.maintenanceBanner.style.display).not.toBe('');
  });

  it('renders normally when the site_settings read fails', async () => {
    const { sandbox, els } = makeSandbox({ maintenance: null });
    await sandbox.bootGuildPage();
    expect(els['main-content'].style.display).not.toBe('none');
  });
});

describe('auth controls', () => {
  it('shows a sign-in control when signed out', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildWhoAmI.textContent).toBe('');
    expect(els.guildAuthBtn.textContent).toMatch(/sign in/i);
  });

  it('shows the display name when signed in', async () => {
    const { sandbox, els } = makeSandbox({ session: SESSION, memberRows: [claim(1, 'Alpha-Tichondrius')] });
    await sandbox.bootGuildPage();
    expect(els.guildWhoAmI.textContent).toBe('Rex');
    expect(els.guildAuthBtn.textContent).toMatch(/sign out/i);
  });

  it('signs in without round-tripping a team param', () => {
    // js/discord.js appends location.search to preserve ?team=. This page is
    // team-free, so carrying one back would pin a team it never had.
    const { sandbox, calls } = makeSandbox();
    sandbox.guildLoginWithDiscord();
    const signIn = calls.find((c) => c.kind === 'signIn');
    expect(signIn.opts.provider).toBe('discord');
    expect(signIn.opts.options.redirectTo).toBe('https://example.test/guild.html');
  });
});

describe('guildTeamSource', () => {
  // The badge in #778 has to mean "the team you are actually on", so a slug
  // that came from sessionStorage or the default must not read the same as one
  // that came from a claim.
  it('reports claim for a resolved claim', async () => {
    const { sandbox } = makeSandbox({ session: SESSION, memberRows: [claim(1, 'Alpha-Tichondrius')] });
    await sandbox.resolveGuildTeam();
    expect(sandbox.guildTeamSource()).toBe('claim');
  });

  it('reports session for a stored slug', async () => {
    const { sandbox } = makeSandbox({ storedTeam: 'hellfire' });
    await sandbox.resolveGuildTeam();
    expect(sandbox.guildTeamSource()).toBe('session');
  });

  it('reports default when nothing is known', async () => {
    const { sandbox } = makeSandbox();
    await sandbox.resolveGuildTeam();
    expect(sandbox.guildTeamSource()).toBe('default');
  });
});

describe('team list', () => {
  it('renders a link per visible team', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    const html = els.guildTeams.innerHTML;
    expect(html).toContain('index.html?team=phoenix');
    expect(html).toContain('index.html?team=hellfire');
    expect(html).toContain('Hellfire Rollers');
  });

  it('leaves hidden teams out', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).not.toContain('wrathless');
  });

  it('escapes what it interpolates', async () => {
    const { sandbox, els } = makeSandbox();
    sandbox.TEAMS.phoenix.name = '<img src=x onerror=alert(1)>';
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).not.toContain('<img');
  });
});

describe('boot with no supabase client', () => {
  it('does not throw when the CDN failed to load', async () => {
    const { sandbox, els } = makeSandbox();
    sandbox.supabaseClient = null;
    await expect(sandbox.bootGuildPage()).resolves.not.toThrow();
    expect(els.guildLoading.style.display).toBe('none');
  });
});
