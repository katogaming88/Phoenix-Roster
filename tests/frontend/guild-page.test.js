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
const STREAMERS_JS = readFileSync(path.join(HERE, '../../js/streamers.js'), 'utf8');

const PAGE_ELS = [
  'main-content',
  'guildLoading',
  'maintenanceBanner',
  'maintenanceBannerMessage',
  'guildTeams',
  'streamersView',
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

// Every team open for signups, matching prod's shape closely enough that a
// test which cares about one flag does not have to restate the rest.
const ALL_OPEN = [
  { team_id: 1, config: { signupsOpen: true } },
  { team_id: 2, config: { signupsOpen: true } },
  { team_id: 3, config: { signupsOpen: true } },
  { team_id: 4, config: {} }
];

function makeSandbox({
  session = null,
  memberRows = [],
  memberError = null,
  maintenance = null,
  storedTeam = null,
  teamSettings = ALL_OPEN,
  teamSettingsError = null,
  streamers = null
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
      if (table === 'streamers') {
        return builder({ data: streamers, error: null });
      }
      if (table === 'team_settings') {
        if (teamSettingsError) return builder({ data: null, error: teamSettingsError });
        return builder({ data: teamSettings, error: null });
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
  // Same order guild.html loads them in.
  vm.runInContext(STREAMERS_JS, sandbox, { filename: 'streamers.js' });
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

describe('team settings, read once and shared (#778)', () => {
  it('reads team_settings exactly once per boot', async () => {
    // #781's BoE team select needs the same rows. Two reads of the same four
    // rows is the shape that drifts, so the read is shared.
    const { sandbox, calls } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(calls.filter((c) => c.table === 'team_settings').length).toBe(1);
  });

  it('does not filter on team_id, so the paging guard does not apply', async () => {
    // Four rows, one per team. scripts/ci/team-wide-read-check.js only fires on
    // a .eq('team_id', ...) read; this one deliberately has none.
    const { sandbox } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(Object.keys(sandbox.guildTeamSettings()).length).toBe(4);
  });

  it('reads signupsOpen per team', async () => {
    const { sandbox } = makeSandbox({
      teamSettings: [
        { team_id: 1, config: { signupsOpen: true } },
        { team_id: 2, config: { signupsOpen: false } },
        { team_id: 3, config: {} }
      ]
    });
    await sandbox.bootGuildPage();
    const s = sandbox.guildTeamSettings();
    expect(s.phoenix.signupsOpen).toBe(true);
    expect(s.hellfire.signupsOpen).toBe(false);
    // Unset means closed. Unlike a feature flag, where unset means enabled.
    expect(s.immolation.signupsOpen).toBe(false);
  });

  it('reads the boe flag with the feature-flag rule, where unset means enabled', async () => {
    const { sandbox } = makeSandbox({
      teamSettings: [
        { team_id: 1, config: { features: { boe: false } } },
        { team_id: 4, config: {} }
      ]
    });
    await sandbox.bootGuildPage();
    const s = sandbox.guildTeamSettings();
    expect(s.phoenix.boeEnabled).toBe(false);
    // Wrathless carries config = '{}' on prod, so this is its real shape.
    expect(s.wrathless.boeEnabled).toBe(true);
  });

  it('splits the two failure directions when the read errors', async () => {
    // BoE fails open, matching js/boe.js: a raider who cannot report a find is
    // the worse outcome. Signups fail closed: a Sign up link into a closed form
    // is worse than no link, and the roster link still works either way.
    const { sandbox } = makeSandbox({ teamSettingsError: { message: 'nope' } });
    await sandbox.bootGuildPage();
    const s = sandbox.guildTeamSettings();
    expect(s.phoenix.signupsOpen).toBe(false);
    expect(s.phoenix.boeEnabled).toBe(true);
  });
});

describe('team cards (#778)', () => {
  it('links every visible team to its roster', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    const html = els.guildTeams.innerHTML;
    expect(html).toContain('index.html?team=phoenix"');
    expect(html).toContain('index.html?team=hellfire"');
    expect(html).toContain('index.html?team=immolation"');
    expect(html).not.toContain('team=wrathless');
  });

  it('shows Sign up only for a team with signups open', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [
        { team_id: 1, config: { signupsOpen: true } },
        { team_id: 2, config: { signupsOpen: false } },
        { team_id: 3, config: { signupsOpen: false } }
      ]
    });
    await sandbox.bootGuildPage();
    const html = els.guildTeams.innerHTML;
    expect(html).toContain('index.html?team=phoenix#signup');
    expect(html).not.toContain('index.html?team=hellfire#signup');
    expect(html).not.toContain('index.html?team=immolation#signup');
  });

  it('badges the claimed team', async () => {
    const { sandbox, els } = makeSandbox({ session: SESSION, memberRows: [claim(2, 'Bravo-Tichondrius')] });
    await sandbox.bootGuildPage();
    // Split per card, not per anchor: "the badge appears somewhere" and "the
    // badge appears on the right card" are different claims, and only the
    // second one is worth asserting.
    const cards = els.guildTeams.innerHTML.split('<div class="guild-team-card">');
    const hellfire = cards.find((c) => c.includes('team=hellfire'));
    const phoenix = cards.find((c) => c.includes('team=phoenix'));
    expect(hellfire).toContain('Your team');
    expect(phoenix).not.toContain('Your team');
    expect(cards.filter((c) => c.includes('Your team')).length).toBe(1);
  });

  it('badges nothing when the team came from sessionStorage', async () => {
    // guildTeamSource() is 'session' here. The badge claims the visitor is on
    // that team, which a remembered slug is not evidence of.
    const { sandbox, els } = makeSandbox({ storedTeam: 'hellfire' });
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).not.toContain('Your team');
  });

  it('badges nothing when claimed on two teams', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      memberRows: [claim(1, 'Alpha-Tichondrius'), claim(2, 'Bravo-Tichondrius')]
    });
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).not.toContain('Your team');
  });

  it('still renders the cards when the settings read fails', async () => {
    const { sandbox, els } = makeSandbox({ teamSettingsError: { message: 'nope' } });
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).toContain('index.html?team=phoenix');
    expect(els.guildTeams.innerHTML).not.toContain('#signup');
  });
});

describe('streams (#780)', () => {
  // The point of this block is that js/streamers.js needs no changes at all.
  // Its "my team first, then everyone else" split is written against
  // s.team_slug === TEAM_SLUG, and js/guild.js nulls TEAM_SLUG, so the first
  // group empties and the second becomes every team. If any of these start
  // failing, the fix belongs in js/guild.js rather than in a file index.html
  // also loads.
  const rows = (over) => [
    {
      id: 1,
      team_id: 1,
      player_id: 10,
      twitch_channel: 'alpha',
      schedule_note: null,
      guild_wide_opt_out: false,
      is_live: true,
      players: { name_realm: 'Alpha-Tichondrius', nickname: 'Al' }
    },
    {
      id: 2,
      team_id: 2,
      player_id: 11,
      twitch_channel: 'bravo',
      schedule_note: 'Tue nights',
      guild_wide_opt_out: false,
      is_live: false,
      players: { name_realm: 'Bravo-Tichondrius', nickname: null }
    },
    {
      id: 3,
      team_id: 3,
      player_id: 12,
      twitch_channel: 'charlie',
      schedule_note: null,
      guild_wide_opt_out: true,
      is_live: true,
      players: { name_realm: 'Charlie-Tichondrius', nickname: null }
    },
    ...(over || [])
  ];

  it('shows streamers from every team, not just one', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.streamersView.innerHTML;
    expect(html).toContain('twitch.tv/alpha');
    expect(html).toContain('twitch.tv/bravo');
  });

  it('honours guild_wide_opt_out', async () => {
    // The column means "hide me from other teams' pages". Every viewer of the
    // guild page is on some other team from the streamer's point of view, so
    // honouring it is the reading that treats the flag as consent rather than
    // as a per-page display rule. This falls out of the existing code with no
    // edit, which is also the argument for leaving it that way.
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.streamersView.innerHTML;
    // Anchored on a positive: an absence assertion over an empty container
    // passes for the wrong reason, and would keep passing if the section
    // stopped rendering entirely.
    expect(html).toContain('twitch.tv/alpha');
    expect(html).not.toContain('twitch.tv/charlie');
  });

  it('emits no View profile link', async () => {
    // That link needs DATA.roster, which is single-team and empty here.
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.streamersView.innerHTML;
    expect(html).toContain('twitch.tv/alpha');
    expect(html).not.toContain('View profile');
    expect(html).not.toContain('renderProfile');
  });

  it('keeps the live dot and the schedule note', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const cards = els.streamersView.innerHTML.split('<div class="stream-card');
    const alpha = cards.find((c) => c.includes('twitch.tv/alpha'));
    const bravo = cards.find((c) => c.includes('twitch.tv/bravo'));
    expect(alpha).toContain('stream-live-dot');
    expect(bravo).not.toContain('stream-live-dot');
    expect(bravo).toContain('Tue nights');
  });

  it('shows an empty state rather than a bare heading when nobody has linked Twitch', async () => {
    // fetchSupabaseStreamers() resolves null, not [], for an empty table.
    const { sandbox, els } = makeSandbox({ streamers: null });
    await sandbox.bootGuildPage();
    expect(els.streamersView.innerHTML).toContain('No streamers');
  });

  it('shows the empty state rather than throwing when the read fails', async () => {
    const { sandbox, els } = makeSandbox({ streamers: undefined });
    await expect(sandbox.bootGuildPage()).resolves.not.toThrow();
    expect(els.streamersView.innerHTML).toContain('No streamers');
  });

  it('leaves DATA.roster empty, so nothing infers a team from it', async () => {
    const { sandbox } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    expect(sandbox.DATA.roster).toEqual([]);
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
