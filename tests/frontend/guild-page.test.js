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
const NEWS_JS = readFileSync(path.join(HERE, '../../js/news.js'), 'utf8');

const PAGE_ELS = [
  'main-content',
  'guildLoading',
  'maintenanceBanner',
  'maintenanceBannerMessage',
  'guildTeams',
  'guildHeaderLinks',
  'guildStreams',
  'guildNews',
  'guildBios',
  'about',
  'guildBoeTeam',
  'guildBoeGo',
  'boe',
  // The two nav items that hide with what they point at. getElementById
  // returns null for anything absent here, and both call sites guard, so
  // leaving them out would make every assertion below throw rather than fail.
  // guildNavBoeManage now points at boe.html rather than a section here (#864).
  'guildNavBoe',
  'guildNavBoeManage',
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
    // fetchAllPaged() walks pages by keyset; without this the BoE read throws.
    gt: () => b,
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
  streamers = null,
  // Which of the three access RPCs answer true (#774).
  boeRpc = {},
  boeItems = [],
  news = [],
  newsFails = false,
  bios = null,
  hash = ''
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
        focus() {},
        // observeStreamEmbeds() calls this on whatever container it is handed
        // (js/streamers.js). Without it the streams render throws a TypeError
        // that bootGuildPage()'s catch swallows, silently skipping every
        // section after streams. tests/frontend/streamers-supabase.test.js
        // stubs it for the same reason.
        querySelectorAll: () => [],
        scrolledIntoView: false,
        scrollIntoView() {
          this.scrolledIntoView = true;
        }
      };
    }
    return els[id];
  }
  PAGE_ELS.forEach(el);

  const client = {
    rpc: (name) => {
      calls.push({ kind: 'rpc', name });
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
      if (table === 'site_settings') {
        // maintenance_mode and guild_officer_bios are columns on the same
        // singleton row, and the builder ignores .select(), so one object
        // stands in for both reads.
        const row = maintenance === null && bios === null ? null : { ...(maintenance || {}), guild_officer_bios: bios };
        return builder({ data: row, error: null });
      }
      if (table === 'streamers') {
        return builder({ data: streamers, error: null });
      }
      if (table === 'boe_items' || table === 'boe_listings') {
        const rows = table === 'boe_items' ? boeItems : [];
        return builder({ data: rows, error: null, count: rows.length });
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
    location: { search: '', pathname: '/guild.html', origin: 'https://example.test', href: '', hash },
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
    Promise,
    fetch: () =>
      newsFails
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve(news) })
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  // Same order guild.html loads them in.
  vm.runInContext(STREAMERS_JS, sandbox, { filename: 'streamers.js' });
  vm.runInContext(NEWS_JS, sandbox, { filename: 'news.js' });
  vm.runInContext(GUILD_JS, sandbox, { filename: 'guild.js' });
  sandbox.supabaseClient = client;
  return { sandbox, els, calls, el };
}

const SESSION = { user: { id: 'auth-1', user_metadata: { full_name: 'Rex' } } };

// renderGuildSections() kicks off the BoE read without awaiting it, so
// bootGuildPage() resolves before those rows land.
const flush = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

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

describe('streams (#790)', () => {
  // #780 reused buildStreamersTab() verbatim, which spends a 16:9 Twitch embed
  // on every streamer whether or not they are broadcasting. An offline embed is
  // a black player, and on this page the section is always in view rather than
  // behind a nav click, so with nobody live it was five black rectangles taller
  // than the team cards above them.
  //
  // So live streams are promoted to embeds and everyone else is a compact row.
  // The list is always present: who streams, on what channel, on what schedule
  // is then readable as text at any hour instead of only while someone happens
  // to be broadcasting, and an offline streamer never costs an embed.
  //
  // #780's real property survives -- js/streamers.js is still not edited. This
  // page composes its own layout out of that file's globals, so the live half
  // is the shipped card rather than a second copy of it.
  const rows = (live) => {
    const isLive = (c) => (live || []).indexOf(c) !== -1;
    return [
      {
        id: 1,
        team_id: 1,
        player_id: 10,
        twitch_channel: 'alpha',
        schedule_note: null,
        guild_wide_opt_out: false,
        is_live: isLive('alpha'),
        players: { name_realm: 'Alpha-Tichondrius', nickname: 'Al' }
      },
      {
        id: 2,
        team_id: 2,
        player_id: 11,
        twitch_channel: 'bravo',
        schedule_note: 'Tue nights',
        guild_wide_opt_out: false,
        is_live: isLive('bravo'),
        players: { name_realm: 'Bravo-Tichondrius', nickname: null }
      },
      {
        id: 3,
        team_id: 3,
        player_id: 12,
        twitch_channel: 'charlie',
        schedule_note: null,
        guild_wide_opt_out: true,
        is_live: isLive('charlie'),
        players: { name_realm: 'Charlie-Tichondrius', nickname: null }
      },
      // Inserted last, sorts first. Nothing else here would tell an alphabetical
      // list apart from the order PostgREST happened to return.
      {
        id: 4,
        team_id: 1,
        player_id: 13,
        twitch_channel: 'delta',
        schedule_note: null,
        guild_wide_opt_out: false,
        is_live: isLive('delta'),
        players: { name_realm: 'Delta-Tichondrius', nickname: 'Aardvark' }
      }
    ];
  };

  const embeds = (html) => (html.match(/<iframe/g) || []).length;
  const listRows = (html) => (html.match(/class="guild-streamer-item"/g) || []).length;
  // The embed card carries a twitch.tv link of its own, so "is this streamer in
  // the list" has to be asked of the list rather than of the whole section.
  const listHtml = (html) => html.split('<ul class="guild-streamer-list">')[1] || '';

  it('spends no embed on anyone when nobody is live', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    // Anchored on a positive: an absence assertion over an empty container
    // passes for the wrong reason, and would keep passing if the section
    // stopped rendering entirely.
    expect(listRows(html)).toBe(3);
    expect(embeds(html)).toBe(0);
  });

  it('says nobody is live rather than leaving it to be inferred', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    expect(els.guildStreams.innerHTML).toContain('No one is live right now');
  });

  it('still lists everyone who streams when nobody is live', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(html).toContain('twitch.tv/alpha');
    expect(html).toContain('twitch.tv/bravo');
    expect(html).toContain('twitch.tv/delta');
  });

  it('embeds the live streamer and nobody else', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows(['alpha']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(embeds(html)).toBe(1);
    expect(html).toContain('channel=alpha');
  });

  it('does not repeat a live streamer in the list below', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows(['alpha']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(listRows(html)).toBe(2);
    expect(listHtml(html)).toContain('twitch.tv/bravo');
    expect(listHtml(html)).not.toContain('twitch.tv/alpha');
  });

  it('labels the two groups so the split is readable, not just visual', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows(['alpha']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(html).toContain('Live now');
    expect(html).toContain('Everyone who streams');
    expect(html.indexOf('Live now')).toBeLessThan(html.indexOf('Everyone who streams'));
  });

  it('drops both headings when nobody is live, since the section h2 is label enough', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(listRows(html)).toBe(3);
    expect(html).not.toContain('<h3');
  });

  it('leaves no bare list heading when everyone is live', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows(['alpha', 'bravo', 'delta']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(embeds(html)).toBe(3);
    expect(html).not.toContain('Everyone who streams');
  });

  it('honours guild_wide_opt_out in both halves', async () => {
    // The column means "hide me from other teams' pages". Every viewer of the
    // guild page is on some other team from the streamer's point of view, so
    // honouring it is the reading that treats the flag as consent rather than
    // as a per-page display rule.
    const { sandbox, els } = makeSandbox({ streamers: rows(['charlie']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(html).toContain('twitch.tv/alpha');
    expect(html).not.toContain('charlie');
    expect(embeds(html)).toBe(0);
  });

  it('emits no View profile link', async () => {
    // That link needs DATA.roster, which is single-team and empty here.
    const { sandbox, els } = makeSandbox({ streamers: rows(['alpha']) });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(embeds(html)).toBe(1);
    expect(html).not.toContain('View profile');
    expect(html).not.toContain('renderProfile');
  });

  it('renders a schedule note, and no empty element for a streamer without one', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(html).toContain('Tue nights');
    // Only bravo has a note, so exactly one row carries the element.
    expect((html.match(/class="guild-streamer-note"/g) || []).length).toBe(1);
  });

  it('escapes raider-controlled fields in the compact row', async () => {
    const hostile = rows();
    hostile[0].players.nickname = '"><img src=x onerror=alert(1)>';
    hostile[1].schedule_note = '</li><script>alert(2)</script>';
    const { sandbox, els } = makeSandbox({ streamers: hostile });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    expect(listRows(html)).toBe(3);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('sorts the list by display name, not by whatever order the read returned', async () => {
    const { sandbox, els } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    const html = els.guildStreams.innerHTML;
    // Aardvark is delta, inserted last. Al is alpha, inserted first.
    expect(html.indexOf('Aardvark')).toBeLessThan(html.indexOf('>Al<'));
    expect(html.indexOf('>Al<')).toBeLessThan(html.indexOf('Bravo'));
  });

  it('shows an empty state rather than a bare heading when nobody has linked Twitch', async () => {
    // fetchSupabaseStreamers() resolves null, not [], for an empty table.
    const { sandbox, els } = makeSandbox({ streamers: null });
    await sandbox.bootGuildPage();
    expect(els.guildStreams.innerHTML).toContain('No streamers');
  });

  it('shows the empty state rather than throwing when the read fails', async () => {
    const { sandbox, els } = makeSandbox({ streamers: undefined });
    await expect(sandbox.bootGuildPage()).resolves.not.toThrow();
    expect(els.guildStreams.innerHTML).toContain('No streamers');
  });

  it('leaves DATA.roster empty, so nothing infers a team from it', async () => {
    const { sandbox } = makeSandbox({ streamers: rows() });
    await sandbox.bootGuildPage();
    expect(sandbox.DATA.roster).toEqual([]);
  });

  it('does not abort the sections rendered after it', async () => {
    // renderGuildSections() runs the sections in order and bootGuildPage()
    // catches everything, so a throw anywhere in the streams render silently
    // takes news, BoE, bios and applyGuildHash() down with it and leaves every
    // streams assertion above still passing, because innerHTML is assigned
    // before the throw. Every other block in this file happens to use the
    // default `streamers: null`, which returns early, so nothing else here can
    // notice. Render both and assert the later one landed.
    const { sandbox, els } = makeSandbox({
      streamers: rows(['alpha']),
      news: [{ date: '2026-08-20', category: 'Feature', version: '3.5.0', title: 'Newest feature', body: 'x' }]
    });
    await sandbox.bootGuildPage();
    expect(els.guildStreams.innerHTML).toContain('channel=alpha');
    expect(els.guildNews.innerHTML).toContain('Newest feature');
  });
});

describe('news teaser (#781)', () => {
  // The full News view stays on index.html. This is headlines plus a link, so
  // it reuses loadNews() and sortNewsNewestFirst() rather than lifting
  // renderNewsList(): the teaser's order has to be the News view's order, and
  // duplicating the pinned-first rule is how the two drift apart.
  const ENTRIES = [
    { date: '2026-08-01', category: 'Fix', version: '3.1.0', title: 'Older fix', body: 'Body one' },
    { date: '2026-08-20', category: 'Feature', version: '3.5.0', title: 'Newest feature', body: 'Body two' },
    { date: '2026-08-10', category: 'Change', version: '3.3.0', title: 'Middle change', body: 'Body three' },
    {
      date: '2026-07-01',
      category: 'Feature',
      version: '3.0.0',
      title: 'Pinned welcome',
      body: 'Body four',
      pinned: true
    },
    { date: '2026-08-05', category: 'Fix', version: '3.2.0', title: 'Fourth newest', body: 'Body five' }
  ];

  it('shows three entries, pinned first then newest, matching the News view order', async () => {
    const { sandbox, els } = makeSandbox({ news: ENTRIES });
    await sandbox.bootGuildPage();
    const html = els.guildNews.innerHTML;
    expect(html).toContain('Pinned welcome');
    expect(html).toContain('Newest feature');
    expect(html).toContain('Middle change');
    expect(html).not.toContain('Fourth newest');
    expect(html).not.toContain('Older fix');
    expect(html.indexOf('Pinned welcome')).toBeLessThan(html.indexOf('Newest feature'));
  });

  it('shows the date and category but not the body', async () => {
    const { sandbox, els } = makeSandbox({ news: ENTRIES });
    await sandbox.bootGuildPage();
    const html = els.guildNews.innerHTML;
    expect(html).toContain('2026-08-20');
    expect(html).toContain('Feature');
    expect(html).not.toContain('Body two');
  });

  it('links to the full view on the resolved team', async () => {
    const { sandbox, els } = makeSandbox({ news: ENTRIES, storedTeam: 'immolation' });
    await sandbox.bootGuildPage();
    expect(els.guildNews.innerHTML).toContain('index.html?team=immolation#news');
  });

  it('shows an empty state rather than a bare heading when there is no news', async () => {
    const { sandbox, els } = makeSandbox({ news: [] });
    await sandbox.bootGuildPage();
    expect(els.guildNews.innerHTML).toContain('No news');
  });

  it('shows the empty state rather than throwing when news.json cannot be fetched', async () => {
    const { sandbox, els } = makeSandbox({ newsFails: true });
    await expect(sandbox.bootGuildPage()).resolves.not.toThrow();
    expect(els.guildNews.innerHTML).toContain('No news');
  });

  it('escapes what it interpolates', async () => {
    const { sandbox, els } = makeSandbox({
      news: [
        { date: '2026-08-20', category: 'Fix', version: '3.5.0', title: '<img src=x onerror=alert(1)>', body: 'b' }
      ]
    });
    await sandbox.bootGuildPage();
    expect(els.guildNews.innerHTML).not.toContain('<img');
  });
});

describe('BoE entry point (#781)', () => {
  // The form itself stays on index.html; this is the single guild-level link
  // #750 wants in place of the per-team pinned links, now that the form
  // resolves its own team (#767).
  const options = (el) => (el.innerHTML.match(/value="([^"]+)"/g) || []).map((m) => m.slice(7, -1));

  it('lists every team with the BoE flag on', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(options(els.guildBoeTeam)).toEqual(['phoenix', 'hellfire', 'immolation', 'wrathless']);
  });

  it('includes hidden teams, unlike the team cards', async () => {
    // js/boe.js:58-59 does the same: a Wrathless raider still has to be able
    // to report a find even though the team is not in any picker.
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(options(els.guildBoeTeam)).toContain('wrathless');
  });

  it('drops a team that turned the feature off', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [
        { team_id: 1, config: { features: { boe: false } } },
        { team_id: 2, config: {} },
        { team_id: 3, config: {} },
        { team_id: 4, config: {} }
      ]
    });
    await sandbox.bootGuildPage();
    const opts = options(els.guildBoeTeam);
    expect(opts).not.toContain('phoenix');
    expect(opts).toContain('hellfire');
  });

  it('defaults to the resolved team', async () => {
    const { sandbox, els } = makeSandbox({ session: SESSION, memberRows: [claim(3, 'Charlie-Tichondrius')] });
    await sandbox.bootGuildPage();
    expect(els.guildBoeTeam.value).toBe('immolation');
  });

  it('falls back to the first enabled team when the resolved one has BoE off', async () => {
    const { sandbox, els } = makeSandbox({
      storedTeam: 'phoenix',
      teamSettings: [
        { team_id: 1, config: { features: { boe: false } } },
        { team_id: 2, config: {} },
        { team_id: 3, config: {} },
        { team_id: 4, config: {} }
      ]
    });
    await sandbox.bootGuildPage();
    expect(els.guildBoeTeam.value).toBe('hellfire');
  });

  it('sends the visitor to the form on the selected team', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    els.guildBoeTeam.value = 'hellfire';
    sandbox.goToBoeForm();
    expect(sandbox.location.href).toBe('index.html?team=hellfire#boe');
  });

  it('hides the whole card when no team has BoE enabled', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [1, 2, 3, 4].map((id) => ({ team_id: id, config: { features: { boe: false } } }))
    });
    await sandbox.bootGuildPage();
    expect(els.boe.style.display).toBe('none');
  });

  // A nav item pointing at a hidden section scrolls nowhere, and the hidden
  // section is a zero-height target applyGuildHash() already refuses. The item
  // reads the same boolean the card does so the two cannot drift apart.
  it('hides the nav item along with the card', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [1, 2, 3, 4].map((id) => ({ team_id: id, config: { features: { boe: false } } }))
    });
    await sandbox.bootGuildPage();
    expect(els.guildNavBoe.style.display).toBe('none');
    expect(els.guildNavBoe.style.display).toBe(els.boe.style.display);
  });

  it('keeps the nav item while any team runs BoE', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildNavBoe.style.display).toBe('');
    expect(els.guildNavBoe.style.display).toBe(els.boe.style.display);
  });
});

describe('About the Guild (#782)', () => {
  // Guild officer bios were moved onto site_settings after #586 shipped them
  // into team_settings.config, which is per team. They have only ever been
  // reachable through the About tab of a team page, which is the wrong home
  // for the one bio list that is genuinely guild-wide.
  const BIOS = [
    {
      name: 'Kat',
      pronouns: 'she/her',
      characterName: 'Katorri',
      title: 'Guild Master',
      classKey: 'Priest',
      spec: 'Discipline',
      bio: 'Runs the place.',
      imagePath: 'assets/officers/kat.jpg'
    },
    { name: 'Rex', title: 'Officer' }
  ];

  it('renders a card per bio', async () => {
    const { sandbox, els } = makeSandbox({ bios: BIOS });
    await sandbox.bootGuildPage();
    const html = els.guildBios.innerHTML;
    expect(html).toContain('Kat');
    expect(html).toContain('she/her');
    expect(html).toContain('Katorri');
    expect(html).toContain('Guild Master');
    expect(html).toContain('Runs the place.');
  });

  it('uses the photo when there is one', async () => {
    const { sandbox, els } = makeSandbox({ bios: BIOS });
    await sandbox.bootGuildPage();
    expect(els.guildBios.innerHTML).toContain('assets/officers/kat.jpg');
  });

  it('falls back to initials rather than a broken image', async () => {
    const { sandbox, els } = makeSandbox({ bios: BIOS });
    await sandbox.bootGuildPage();
    const cards = els.guildBios.innerHTML.split('<div class="bio-card">');
    const rex = cards.find((c) => c.includes('Rex'));
    expect(rex).toContain('RE');
    expect(rex).not.toContain('<img');
  });

  it('renders no empty rows for the fields a bio omits', async () => {
    const { sandbox, els } = makeSandbox({ bios: [{ name: 'Rex', title: 'Officer' }] });
    await sandbox.bootGuildPage();
    const html = els.guildBios.innerHTML;
    expect(html).toContain('Rex');
    expect(html).not.toContain('bio-pronouns');
    expect(html).not.toContain('bio-charname');
    expect(html).not.toContain('bio-text');
    expect(html).not.toContain('badge-class');
  });

  it('hides the section when there are no bios', async () => {
    const { sandbox, els } = makeSandbox({ bios: [] });
    await sandbox.bootGuildPage();
    expect(els.about.style.display).toBe('none');
  });

  it('hides the section when the read fails', async () => {
    const { sandbox, els } = makeSandbox({ bios: null });
    await sandbox.bootGuildPage();
    expect(els.about.style.display).toBe('none');
  });

  it('shows the section when there are bios', async () => {
    // The hide assertions above would both pass on a section that never
    // showed, so pin the positive too.
    const { sandbox, els } = makeSandbox({ bios: BIOS });
    await sandbox.bootGuildPage();
    expect(els.about.style.display).not.toBe('none');
  });

  it('escapes what it interpolates, including the photo path', async () => {
    const { sandbox, els } = makeSandbox({
      bios: [{ name: '<img src=x onerror=alert(1)>', imagePath: 'a.jpg" onerror="alert(1)' }]
    });
    await sandbox.bootGuildPage();
    const html = els.guildBios.innerHTML;
    // "onerror=alert" survives as inert text once the angle brackets are
    // escaped, so its presence proves nothing either way. What must not
    // survive is a second <img element, or a quote closing the src attribute.
    expect((html.match(/<img/g) || []).length).toBe(1);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('" onerror="');
  });
});

describe('external links (#783)', () => {
  it('renders the guild links from GUILD_LINKS, not a second copy', async () => {
    // #777 hardcoded these two URLs into guild.html's header markup. They are
    // constants in common.js precisely so there is one copy, and a duplicate
    // that nothing reads is one nobody updates.
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildHeaderLinks.innerHTML).toContain(sandbox.GUILD_LINKS.raiderIoUrl);
    expect(els.guildHeaderLinks.innerHTML).toContain(sandbox.GUILD_LINKS.armoryUrl);
  });

  it('gives each guild link an accessible name', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    const html = els.guildHeaderLinks.innerHTML;
    expect(html).toContain('aria-label="Raider.IO"');
    expect(html).toContain('aria-label="Armory"');
  });

  it('puts a Logs link on a team that has a WarcraftLogs URL', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [
        { team_id: 1, config: { externalLinks: { warcraftLogsUrl: 'https://warcraftlogs.com/guild/1' } } },
        { team_id: 2, config: {} },
        { team_id: 3, config: {} }
      ]
    });
    await sandbox.bootGuildPage();
    const cards = els.guildTeams.innerHTML.split('<div class="guild-team-card">');
    const phoenix = cards.find((c) => c.includes('team=phoenix'));
    const hellfire = cards.find((c) => c.includes('team=hellfire'));
    expect(phoenix).toContain('https://warcraftlogs.com/guild/1');
    expect(phoenix).toContain('Logs');
    expect(hellfire).not.toContain('Logs');
  });

  it('omits Logs everywhere when no team has one set', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).toContain('View roster');
    expect(els.guildTeams.innerHTML).not.toContain('Logs');
  });

  it('escapes the WarcraftLogs URL', async () => {
    const { sandbox, els } = makeSandbox({
      teamSettings: [{ team_id: 1, config: { externalLinks: { warcraftLogsUrl: 'x" onclick="alert(1)' } } }]
    });
    await sandbox.bootGuildPage();
    expect(els.guildTeams.innerHTML).not.toContain('" onclick="');
  });

  it('still renders the guild links when the team_settings read fails', async () => {
    const { sandbox, els } = makeSandbox({ teamSettingsError: { message: 'nope' } });
    await sandbox.bootGuildPage();
    expect(els.guildHeaderLinks.innerHTML).toContain(sandbox.GUILD_LINKS.raiderIoUrl);
    expect(els.guildTeams.innerHTML).not.toContain('Logs');
  });

  it('renders them during maintenance, which leaves the header visible', async () => {
    const { sandbox, els } = makeSandbox({ maintenance: { maintenance_mode: true, maintenance_message: 'Back soon' } });
    await sandbox.bootGuildPage();
    expect(els.guildHeaderLinks.innerHTML).toContain(sandbox.GUILD_LINKS.armoryUrl);
  });

  it('renders them with no supabase client at all', async () => {
    const { sandbox, els } = makeSandbox();
    sandbox.supabaseClient = null;
    await sandbox.bootGuildPage();
    expect(els.guildHeaderLinks.innerHTML).toContain(sandbox.GUILD_LINKS.armoryUrl);
  });
});

describe('deep links to a section (#782)', () => {
  // Every section renders from an async read, so the browser resolves the hash
  // against a page whose sections are still empty and lands at the top. That
  // breaks exactly the link #750 wants to hand out (guild.html#boe), and it is
  // invisible in a test that only checks the markup.
  it('scrolls to the named section once its content exists', async () => {
    const { sandbox, els } = makeSandbox({ hash: '#boe' });
    await sandbox.bootGuildPage();
    expect(els.boe.scrolledIntoView).toBe(true);
  });

  it('scrolls to About too', async () => {
    const { sandbox, els } = makeSandbox({ hash: '#about', bios: [{ name: 'Kat' }] });
    await sandbox.bootGuildPage();
    expect(els.about.scrolledIntoView).toBe(true);
  });

  it('does nothing without a hash', async () => {
    const { sandbox, els } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.boe.scrolledIntoView).toBe(false);
    expect(els.about.scrolledIntoView).toBe(false);
  });

  it('ignores a hash naming nothing on the page', async () => {
    const { sandbox } = makeSandbox({ hash: '#nonsense' });
    await expect(sandbox.bootGuildPage()).resolves.not.toThrow();
  });

  it('does not scroll to a section it just hid', async () => {
    // About hides itself when there are no bios, so scrolling to it would
    // land on a zero-height element.
    const { sandbox, els } = makeSandbox({ hash: '#about', bios: [] });
    await sandbox.bootGuildPage();
    expect(els.about.style.display).toBe('none');
    expect(els.about.scrolledIntoView).toBe(false);
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

// Who gets the BoE Sales link. The lifecycle surface itself lives on boe.html
// since #864, and since #890 it is open to anyone signed in, so this page
// stops asking who the visitor is and shows the link whenever the guild runs
// BoE at all. The page behind it does the rest: signed out it offers sign-in,
// signed in it renders whatever the read policies return.
describe('BoE Sales link (#774, #864, #890)', () => {
  it('is shown to a signed-out visitor, and asks nothing about them', async () => {
    // The revealed value, not just "not none": the markup ships display:none
    // for the no-flash reason, so a not.toBe('none') would pass on a page
    // that never touched the item.
    const { sandbox, els, calls } = makeSandbox();
    await sandbox.bootGuildPage();
    expect(els.guildNavBoeManage.style.display).toBe('');
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
  });

  it('is shown to a signed-in raider, and still asks nothing', async () => {
    const { sandbox, els, calls } = makeSandbox({ session: SESSION });
    await sandbox.bootGuildPage();
    expect(els.guildNavBoeManage.style.display).toBe('');
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([]);
  });

  it('is shown to a BoE manager, on the same rule as everyone else', async () => {
    const { sandbox, els } = makeSandbox({ session: SESSION, boeRpc: { is_boe_manager: true } });
    await sandbox.bootGuildPage();
    expect(els.guildNavBoeManage.style.display).toBe('');
  });

  it('points at boe.html, never at a section of this page', async () => {
    const { sandbox, els } = makeSandbox({ session: SESSION, boeRpc: { is_boe_manager: true } });
    await sandbox.bootGuildPage();
    expect(els.guildNavBoeManage.href).toBe('boe.html');
  });

  it('stays hidden when no team runs BoE, even for a manager', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      teamSettings: [1, 2, 3, 4].map((id) => ({ team_id: id, config: { features: { boe: false } } }))
    });
    await sandbox.bootGuildPage();
    expect(els.guildNavBoeManage.style.display).toBe('none');
  });

  it('renders no lifecycle rows on this page any more', async () => {
    // The containers left with the section. If js/guild.js still called
    // buildBoeManage() it would throw on the missing elements, and the catch
    // would take About down with it, which the next test also guards.
    const { sandbox, calls } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      boeItems: [{ id: 1, team_id: 4, item_name: 'Wrathless Find', status: 'found', found_at: '2026-08-20T01:00:00Z' }]
    });
    await sandbox.bootGuildPage();
    for (let i = 0; i < 8; i++) await flush();
    expect(calls.filter((c) => c.kind === 'from' && c.table === 'boe_items')).toEqual([]);
  });

  // Every section after the link's reveal has to still render, which is what
  // the swallowed-error shape broke last time.
  it('does not stop the sections after it', async () => {
    const { sandbox, els } = makeSandbox({
      session: SESSION,
      boeRpc: { is_boe_manager: true },
      bios: [{ name: 'Kat', bio: 'Guild lead' }]
    });
    await sandbox.bootGuildPage();
    expect(els.guildBios.innerHTML).toContain('Kat');
  });
});
