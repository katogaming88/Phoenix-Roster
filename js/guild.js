// Guild landing page (guild.html) -- #777.
//
// The one page on this site that is not scoped to a raid team. Everything it
// shows is either guild-wide already (site_settings, the unfiltered streamers
// read from #286, the static news.json) or is a link down into a team page.
//
// Unlike js/admin.js, which is standalone for the same team-free reason, this
// file DOES load js/common.js: it needs TEAMS, visibleTeamSlugs(), GUILD_LINKS,
// VERSION, _esc(), checkMaintenanceMode() and fetchSupabaseGuildOfficerBios(),
// and TEAMS above all is a hand-maintained mirror of the teams table that must
// not gain a second copy.
//
// It deliberately does NOT load js/discord.js. resolveDiscordSession() there is
// hard-scoped to _teamCfg.supabaseTeamId, so on a team-free page a raider who
// is not on the fallback team resolves to nothing and gets a claim modal for a
// team they are not on. It also keys its session cache per team, and carries
// the onDiscord* global-shadowing collision behind #371. The only session read
// this page wants filters on auth_user_id alone, which is a few lines here.

// common.js resolved a team at parse time and hard-defaulted to Phoenix
// (js/common.js:82-96). Leaving that in place would mean any team-dependent
// helper called here by mistake silently renders Phoenix's data. Null them, so
// a mistaken call throws instead. Nothing on this page reads them, and
// TEAM_SLUG === null is also what makes js/streamers.js's "my team first"
// split collapse to "every team" with no change to that file (#780).
TEAM_SLUG = null;
TEAM_NAME = null;
_teamCfg = null;
IS_COLD_LANDING = false;

// js/streamers.js dereferences DATA.streamers and DATA.roster without guarding,
// and common.js initialises DATA to null rather than {} (js/common.js:448), so
// null.streamers throws rather than reading undefined. Seeding it is required,
// not tidiness.
DATA = { streamers: [], roster: [] };

// The team every cross-page link on this page points at. guild.html must never
// link to a bare index.html: a cold landing there redirects back here (#779),
// so a link with no ?team= is an infinite bounce rather than a cosmetic slip.
var _guildTeamSlug = null;

// The signed-in Supabase session, captured once by bootGuildPage() so the BoE
// access check (#774) does not have to ask auth for it a third time.
var _guildSession = null;
var _guildBoeAccess = { visible: false, canManage: false };
var _guildTeamSource = 'default';

// js/discord.js owns the shared withTimeout() but is deliberately not loaded
// here, so this is a local copy for the one read that needs it -- the same
// call this file makes rather than a dependency on an officer-side file, which
// is the js/signup.js escHtml precedent.
function _guildWithTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error('Timed out'));
    }, ms);
    promise.then(
      function (value) {
        clearTimeout(timer);
        resolve(value);
      },
      function (err) {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function guildDefaultTeam() {
  return visibleTeamSlugs()[0];
}

/** The resolved team, or the default before resolution has run. */
function guildTeamSlug() {
  return _guildTeamSlug || guildDefaultTeam();
}

/**
 * Where the resolved team came from: 'claim' when the signed-in account is
 * claimed on exactly one team, 'session' when it came from a previous visit,
 * 'default' otherwise. A "Your team" badge (#778) may only trust 'claim'.
 */
function guildTeamSource() {
  return _guildTeamSource;
}

function guildTeamHref(slug, hash) {
  return 'index.html?team=' + (slug || guildTeamSlug()) + (hash ? '#' + hash : '');
}

function _guildStoredTeam() {
  var stored = sessionStorage.getItem('wga_team');
  // Any real team, hidden ones included: ?team=wrathless is a valid unlisted
  // URL, so a visitor who reached it that way keeps it.
  return stored && Object.prototype.hasOwnProperty.call(TEAMS, stored) ? stored : null;
}

function _guildSlugForTeamId(teamId) {
  var found = null;
  Object.keys(TEAMS).forEach(function (slug) {
    if (!found && TEAMS[slug].supabaseTeamId === teamId) found = slug;
  });
  return found;
}

/**
 * Resolves the team this page links out to. Claimed team first, then whatever
 * team the visitor last looked at this session, then the first visible team.
 *
 * The claim read is the same "auth_user_id only, no team_id filter" query
 * js/roster.js's resolveColdLanding() uses: the RLS policy lets a member read
 * all their own team_members rows, so one query finds a claim on any team.
 * Unlike that one it does not pick the first of several -- a raider on two
 * teams has no single answer, and guessing would badge the wrong team.
 */
function resolveGuildTeam() {
  function settle(slug, source) {
    _guildTeamSlug = slug;
    _guildTeamSource = source;
    return slug;
  }
  function fallback() {
    var stored = _guildStoredTeam();
    return stored ? settle(stored, 'session') : settle(guildDefaultTeam(), 'default');
  }

  if (!supabaseClient) return Promise.resolve(fallback());

  return _guildWithTimeout(Promise.resolve(supabaseClient.auth.getSession()), 10000)
    .then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session) return fallback();

      return _guildWithTimeout(
        Promise.resolve(
          supabaseClient
            .from('team_members')
            .select('team_id, players!players_team_member_id_fkey(name_realm)')
            .eq('auth_user_id', session.user.id)
        ),
        10000
      ).then(function (res) {
        if (!res || res.error) return fallback();
        var slugs = [];
        ((res && res.data) || []).forEach(function (row) {
          var players = row.players || [];
          if (!players.length || !players[0].name_realm) return;
          var slug = _guildSlugForTeamId(row.team_id);
          if (slug && slugs.indexOf(slug) === -1) slugs.push(slug);
        });
        return slugs.length === 1 ? settle(slugs[0], 'claim') : fallback();
      });
    })
    .catch(function () {
      return fallback();
    });
}

function guildLoginWithDiscord() {
  if (!supabaseClient) return;
  // No location.search, unlike js/discord.js's loginWithDiscord(): that one
  // round-trips ?team= on purpose, and this page has no team to preserve.
  supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

function guildLogout() {
  if (!supabaseClient) return;
  Promise.resolve(supabaseClient.auth.signOut()).then(function () {
    window.location.reload();
  });
}

function renderGuildAuth(session) {
  var who = document.getElementById('guildWhoAmI');
  var btn = document.getElementById('guildAuthBtn');
  var meta = (session && session.user && session.user.user_metadata) || null;
  var name = meta ? meta.full_name || meta.name || 'Signed in' : '';
  if (who) who.textContent = session ? name : '';
  if (btn) {
    btn.textContent = session ? 'Sign out' : 'Sign in with Discord';
    btn.onclick = session ? guildLogout : guildLoginWithDiscord;
  }
}

/**
 * Every team's signups-open and BoE flags, keyed by slug (#778). One read of
 * four rows, shared with the BoE entry point (#781) rather than read twice:
 * two reads of the same rows is the shape that drifts.
 *
 * No `.eq('team_id', ...)`, so scripts/ci/team-wide-read-check.js does not
 * apply and fetchAllPaged() is not required. It cannot page past 1000 either
 * way, being one row per team.
 */
var _guildTeamSettings = null;

function _guildDefaultSettings() {
  var map = {};
  Object.keys(TEAMS).forEach(function (slug) {
    // The two failure directions differ on purpose. A missing BoE flag reads
    // as enabled, the rule featureEnabledIn() applies everywhere and the same
    // fail-open js/boe.js chose: a raider who cannot report a find is the
    // worse outcome. Signups fail closed, because a Sign up link into a closed
    // form is worse than no link, and the roster link works regardless.
    map[slug] = { signupsOpen: false, boeEnabled: true, warcraftLogsUrl: '' };
  });
  return map;
}

function guildTeamSettings() {
  return _guildTeamSettings || _guildDefaultSettings();
}

function fetchGuildTeamSettings() {
  var map = _guildDefaultSettings();
  if (!supabaseClient) {
    _guildTeamSettings = map;
    return Promise.resolve(map);
  }
  return Promise.resolve(supabaseClient.from('team_settings').select('team_id, config'))
    .then(function (res) {
      if (!res || res.error || !res.data) return map;
      res.data.forEach(function (row) {
        var slug = _guildSlugForTeamId(row.team_id);
        if (!slug) return;
        var config = row.config || {};
        map[slug] = {
          signupsOpen: !!config.signupsOpen,
          boeEnabled: featureEnabledIn(config.features, 'boe'),
          // Officer-edited per team (js/tabs/tab-season.js), and hidden rather
          // than shown broken when unset, same as renderExternalWclLink().
          warcraftLogsUrl: (config.externalLinks && config.externalLinks.warcraftLogsUrl) || ''
        };
      });
      return map;
    })
    .catch(function () {
      return map;
    })
    .then(function (resolved) {
      _guildTeamSettings = resolved;
      return resolved;
    });
}

function renderGuildTeams() {
  var mount = document.getElementById('guildTeams');
  if (!mount) return;
  var settings = guildTeamSettings();
  // Only a resolved claim earns the badge. A slug remembered from a previous
  // visit, or the fallback, is not evidence the visitor raids on that team.
  var mine = guildTeamSource() === 'claim' ? guildTeamSlug() : null;

  mount.innerHTML = visibleTeamSlugs()
    .map(function (slug) {
      var team = TEAMS[slug];
      var open = settings[slug] && settings[slug].signupsOpen;
      var logs = settings[slug] && settings[slug].warcraftLogsUrl;
      return (
        '<div class="guild-team-card">' +
        '<span class="guild-team-head">' +
        '<span class="guild-team-emblem" aria-hidden="true">' +
        _esc(team.emoji || '') +
        '</span>' +
        '<span class="guild-team-name">' +
        _esc(team.name) +
        '</span>' +
        '</span>' +
        (slug === mine ? '<span class="guild-team-badge">Your team</span>' : '') +
        '<span class="guild-team-links">' +
        '<a href="' +
        _esc(guildTeamHref(slug)) +
        '">View roster</a>' +
        (open ? '<a href="' + _esc(guildTeamHref(slug, 'signup')) + '">Sign up</a>' : '') +
        // WarcraftLogs is per team (#783), so it belongs on the card rather
        // than in a guild-level links row that would have to name a team per
        // link. Absent when that team has no URL set.
        (logs ? '<a href="' + _esc(logs) + '" target="_blank" rel="noopener">Logs</a>' : '') +
        '</span>' +
        '</div>'
      );
    })
    .join('');
}

/**
 * Streams (#780 for the read, #790 for the render).
 *
 * The read was already guild-wide by design (#286) and needs nothing here:
 * js/streamers.js splits on `s.team_slug === TEAM_SLUG`, which is null on this
 * page, so its "my team" group empties and its "everyone else" group becomes
 * every team. The profile link is gated on the same comparison and suppresses
 * itself, which is what it should do given DATA.roster is single-team and
 * empty here.
 *
 * guild_wide_opt_out means "hide me from other teams' pages". Every viewer
 * here is on some other team from the streamer's point of view, so this
 * honours it, treating the column as consent rather than a display rule.
 */
function fetchGuildStreamers() {
  return Promise.resolve(fetchSupabaseStreamers())
    .then(function (rows) {
      DATA.streamers = mapSupabaseStreamers(rows || []);
    })
    .catch(function () {
      DATA.streamers = [];
    });
}

/**
 * One offline streamer, as a row rather than a black Twitch player.
 *
 * display_name, twitch_channel and schedule_note are all raider-controlled via
 * the self-service editor in js/streamers.js, so every one of them is escaped.
 */
function guildStreamerRowHTML(s) {
  return (
    '<li class="guild-streamer-item">' +
    '<span class="guild-streamer-name">' +
    _esc(s.display_name) +
    '</span>' +
    '<a class="guild-streamer-link" href="https://twitch.tv/' +
    encodeURIComponent(s.twitch_channel) +
    '" target="_blank" rel="noopener">twitch.tv/' +
    _esc(s.twitch_channel) +
    '</a>' +
    (s.schedule_note ? '<span class="guild-streamer-note">' + _esc(s.schedule_note) + '</span>' : '') +
    '</li>'
  );
}

/**
 * Streams render (#790). #780 called buildStreamersTab() straight, which spends
 * a 16:9 embed on every streamer whether or not they are broadcasting. An
 * offline embed is a black player, and unlike index.html's Streams tab this
 * section is always in view rather than behind a nav click, so with nobody live
 * it was five black rectangles taller than the team cards above them.
 *
 * So the live ones are promoted to embeds and everyone else is a compact row.
 * The list is always present, which is the accessible half of this: who
 * streams, on what channel, on what schedule stays readable as text at any
 * hour, rather than only while someone happens to be broadcasting. It also
 * means the page loads exactly as many third-party iframes as there are live
 * streams, which is usually none.
 *
 * js/streamers.js is still not edited, keeping #780's property intact. Its
 * streamerCardHTML() and observeStreamEmbeds() are globals (guild.html loads it
 * before this file), so the live half is the shipped card rather than a second
 * copy of it that can drift.
 */
function renderGuildStreams() {
  var mount = document.getElementById('guildStreams');
  if (!mount) return;
  var visible = getVisibleStreamers();
  if (!visible.length) {
    mount.innerHTML = '<p class="guild-empty">No streamers linked yet.</p>';
    return;
  }

  var live = visible.filter(function (s) {
    return s.is_live;
  });
  var offline = visible.filter(function (s) {
    return !s.is_live;
  });
  // Alphabetical rather than whatever order the read came back in, so the list
  // reads the same way on every visit. getVisibleStreamers() returns a fresh
  // array, so this sorts a copy and not DATA.streamers.
  offline.sort(function (a, b) {
    return String(a.display_name).localeCompare(String(b.display_name));
  });

  var html = live.length
    ? '<h3 class="guild-streams-heading">Live now</h3>' +
      '<div class="stream-grid stream-grid-big">' +
      live
        .map(function (s) {
          return streamerCardHTML(s, { big: true });
        })
        .join('') +
      '</div>'
    : '<p class="guild-empty">No one is live right now.</p>';

  if (offline.length) {
    // The heading exists only to separate this group from the embeds above it.
    // With nothing above it, the section's own <h2> is label enough and a
    // second heading is noise.
    html +=
      (live.length ? '<h3 class="guild-streams-heading">Everyone who streams</h3>' : '') +
      '<ul class="guild-streamer-list">' +
      offline
        .map(function (s) {
          return guildStreamerRowHTML(s);
        })
        .join('') +
      '</ul>';
  }

  mount.innerHTML = html;
  observeStreamEmbeds(mount);
}

/**
 * News teaser (#781). Headlines only: the full view, with bodies and the
 * expand/collapse, stays on index.html and this links to it.
 *
 * loadNews() and NEWS_DATA come from js/news.js rather than a local fetch, so
 * the teaser's order IS the News view's order. Duplicating the pinned-first
 * rule here is exactly how the two would drift. renderNewsList() is
 * deliberately not reused: it renders bodies and owns the toggle state.
 */
var GUILD_NEWS_COUNT = 3;

function renderGuildNews() {
  var mount = document.getElementById('guildNews');
  if (!mount) return;
  var entries = (typeof NEWS_DATA !== 'undefined' ? NEWS_DATA : []).slice(0, GUILD_NEWS_COUNT);
  if (!entries.length) {
    mount.innerHTML = '<p class="guild-empty">No news yet.</p>';
    return;
  }
  mount.innerHTML =
    '<ul class="guild-news-list">' +
    entries
      .map(function (entry) {
        return (
          '<li class="guild-news-item">' +
          '<span class="guild-news-date">' +
          _esc(entry.date) +
          '</span>' +
          newsCategoryBadge(entry.category) +
          '<span class="guild-news-title">' +
          _esc(entry.title) +
          '</span>' +
          '</li>'
        );
      })
      .join('') +
    '</ul>' +
    '<a class="guild-news-more" href="' +
    _esc(guildTeamHref(null, 'news')) +
    '">All news</a>';
}

function fetchGuildNews() {
  return Promise.resolve(loadNews()).catch(function () {});
}

/**
 * BoE entry point (#781). The form stays on index.html; this is the single
 * guild-level link #750 wants in place of the per-team pinned links, now that
 * the form resolves its own team (#767).
 *
 * The team list comes from the same team_settings read the cards use. Hidden
 * teams are included, unlike the cards: js/boe.js:58-59 does the same, because
 * a Wrathless raider still has to be able to report a find even though the
 * team appears in no picker.
 */
function boeEnabledTeamSlugs() {
  var settings = guildTeamSettings();
  return Object.keys(TEAMS).filter(function (slug) {
    return settings[slug] && settings[slug].boeEnabled;
  });
}

function renderGuildBoe() {
  var section = document.getElementById('boe');
  var navItem = document.getElementById('guildNavBoe');
  var sel = document.getElementById('guildBoeTeam');
  var slugs = boeEnabledTeamSlugs();
  // One boolean drives both, so the nav cannot end up pointing at a section
  // that is not there. applyGuildHash() already refuses to scroll to a hidden
  // section, which left the nav item as the one way to land on nothing.
  if (section) section.style.display = slugs.length ? '' : 'none';
  if (navItem) navItem.style.display = slugs.length ? '' : 'none';
  if (!sel || !slugs.length) return;

  sel.innerHTML = slugs
    .map(function (slug) {
      return '<option value="' + _esc(slug) + '">' + _esc(TEAMS[slug].name) + '</option>';
    })
    .join('');
  // The resolved team when it can take a find, else the first that can.
  var resolved = guildTeamSlug();
  sel.value = slugs.indexOf(resolved) !== -1 ? resolved : slugs[0];
}

function goToBoeForm() {
  var sel = document.getElementById('guildBoeTeam');
  var slug = (sel && sel.value) || guildTeamSlug();
  window.location.href = guildTeamHref(slug, 'boe');
}

/**
 * Whether to reveal the BoE Sales link (#774, #864). The answer comes from
 * fetchBoeAccess() in js/common.js, the same one boe.html gates itself on, so
 * the link and the page cannot disagree about who may open it.
 */
function fetchGuildBoeAccess() {
  return fetchBoeAccess(_guildSession).then(function (access) {
    _guildBoeAccess = access;
    return access;
  });
}

/**
 * Reveals the BoE Sales nav item, or leaves it hidden. Hidden covers three
 * different people and says nothing to any of them: a signed-out visitor, a
 * raider, and an officer on a guild that has BoE turned off everywhere.
 *
 * The surface itself is boe.html since #864; this page only carries the way
 * there. The feature check is guild-wide rather than per-team, the same
 * question the finder card above already asks: there is no "this team" here,
 * and a manager's read spans every team.
 *
 * This page is public, so an item naming a surface the visitor cannot open
 * would advertise it to exactly the people the page hides itself from.
 */
function renderGuildBoeManage() {
  var navItem = document.getElementById('guildNavBoeManage');
  if (!navItem) return;
  var show = _guildBoeAccess.visible && boeEnabledTeamSlugs().length > 0;
  navItem.href = 'boe.html';
  navItem.style.display = show ? '' : 'none';
}

/**
 * About the Guild (#782). Guild officer bios live on site_settings' singleton
 * row, guild-wide since #586 moved them off team_settings.config, and have
 * only ever been reachable through the About tab of a team page.
 *
 * js/roster.js's buildGuildBios() renders the same shape but cannot be called
 * here: it depends on _escAttr(), which is declared in js/roster.js and
 * js/tabs/tab-season.js and in neither case ships in this page's bundle. This
 * is the js/boe.js escHtml trap, so the card markup is rebuilt rather than
 * borrowed. It needs no copy of that helper either: common.js's _esc() escapes
 * quotes as well as angle brackets and its own comment says it is meant for
 * attribute values, so it covers the photo path too.
 */
function renderGuildBios() {
  var section = document.getElementById('about');
  var mount = document.getElementById('guildBios');
  var bios = (DATA && DATA.guildOfficerBios) || [];
  // Nothing to say is better than an empty heading. Also covers the read
  // having failed, which resolves null rather than [].
  if (section) section.style.display = bios.length ? '' : 'none';
  if (!mount || !bios.length) return;

  mount.innerHTML =
    '<div class="bio-wrap">' +
    bios
      .map(function (entry) {
        var displayName = entry.name || 'Unnamed';
        var html = '<div class="bio-card">';
        html += entry.imagePath
          ? '<img class="bio-photo" src="' + _esc(entry.imagePath) + '" alt="">'
          : '<div class="bio-photo bio-photo-fallback">' + _esc(displayName.slice(0, 2).toUpperCase()) + '</div>';
        html +=
          '<div class="bio-name">' +
          _esc(displayName) +
          (entry.pronouns ? ' <span class="bio-pronouns">(' + _esc(entry.pronouns) + ')</span>' : '') +
          '</div>';
        if (entry.characterName) html += '<div class="bio-charname">' + _esc(entry.characterName) + '</div>';
        if (entry.title) html += '<div class="bio-title">' + _esc(entry.title) + '</div>';
        if (entry.classKey) {
          html +=
            '<span class="badge badge-class" style="' +
            classBadgeStyle(entry.classKey) +
            '">' +
            _esc(entry.spec || entry.classKey) +
            '</span>';
        }
        if (entry.bio) html += '<div class="bio-text">' + _esc(entry.bio) + '</div>';
        return html + '</div>';
      })
      .join('') +
    '</div>';
}

function fetchGuildBios() {
  return Promise.resolve(fetchSupabaseGuildOfficerBios())
    .then(function (bios) {
      DATA.guildOfficerBios = bios || [];
    })
    .catch(function () {
      DATA.guildOfficerBios = [];
    });
}

/**
 * Re-applies a #section deep link after the sections have content.
 *
 * Every section here renders from an async read, so the browser resolves the
 * hash while they are all still empty and lands at the top of the page. That
 * breaks the one link this arc exists to hand out (guild.html#boe, #750).
 *
 * Skips a section that hid itself: About with no bios is a zero-height
 * element, and scrolling to it is worse than not moving at all.
 */
function applyGuildHash() {
  var id = (window.location.hash || '').replace('#', '');
  if (!id) return;
  var el = document.getElementById(id);
  if (!el || el.style.display === 'none' || !el.scrollIntoView) return;
  el.scrollIntoView();
}

/**
 * The two guild-wide external links (#783), rendered from GUILD_LINKS rather
 * than written into the markup. They are constants in common.js exactly so
 * there is one copy; guild.html shipped with a second one in #777, and a
 * duplicate nothing reads is one nobody updates.
 *
 * No Discord invite: there is none in this repo, and Russell's call is not to
 * add one.
 */
function renderGuildHeaderLinks() {
  var mount = document.getElementById('guildHeaderLinks');
  if (!mount) return;
  var links = [
    { url: GUILD_LINKS.raiderIoUrl, label: 'Raider.IO', domain: 'raider.io' },
    { url: GUILD_LINKS.armoryUrl, label: 'Armory', domain: 'worldofwarcraft.com' }
  ];
  mount.innerHTML =
    '<span class="header-links-label">Links</span>' +
    links
      .map(function (link) {
        return (
          '<a class="header-link-icon" href="' +
          _esc(link.url) +
          '" target="_blank" rel="noopener" title="' +
          _esc(link.label) +
          '" aria-label="' +
          _esc(link.label) +
          '"><img src="https://www.google.com/s2/favicons?sz=64&domain=' +
          _esc(link.domain) +
          '" alt="" width="30" height="30" loading="lazy"></a>'
        );
      })
      .join('');
}

function renderGuildSections() {
  renderGuildTeams();
  renderGuildStreams();
  renderGuildNews();
  renderGuildBoe();
  renderGuildBoeManage();
  renderGuildBios();
  applyGuildHash();
}

function bootGuildPage() {
  var loading = document.getElementById('guildLoading');
  function done() {
    if (loading) loading.style.display = 'none';
  }

  // Constants, so they need no read and should not wait on one. Rendering them
  // here rather than with the sections also covers the two paths that never
  // reach renderGuildSections(): maintenance mode, which leaves the header
  // visible, and a failed supabase CDN load.
  renderGuildHeaderLinks();

  if (!supabaseClient) {
    // The CDN failed or is blocked. Everything on this page is a Supabase read
    // except the team links, so render those and stop.
    renderGuildTeams();
    done();
    return Promise.resolve();
  }

  return Promise.resolve(checkMaintenanceMode())
    .then(function (state) {
      if (state && state.enabled) {
        showMaintenanceBanner(state.message);
        done();
        return null;
      }
      return _guildWithTimeout(Promise.resolve(supabaseClient.auth.getSession()), 10000)
        .then(
          function (result) {
            return (result && result.data && result.data.session) || null;
          },
          function () {
            return null;
          }
        )
        .then(function (session) {
          _guildSession = session;
          renderGuildAuth(session);
          return resolveGuildTeam();
        })
        .then(function () {
          return Promise.all([
            fetchGuildTeamSettings(),
            fetchGuildStreamers(),
            fetchGuildNews(),
            fetchGuildBios(),
            fetchGuildBoeAccess()
          ]);
        })
        .then(function () {
          renderGuildSections();
          done();
        });
    })
    .catch(function (err) {
      // renderGuildSections() runs the sections in order, so a throw in any one
      // of them silently takes every section after it down too. Without this
      // line that failure mode leaves a half-rendered page and an empty
      // console, which is a bad thing to debug from a bug report.
      console.error('guild page failed to render', err);
      done();
    });
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') bootGuildPage();
  });
}

bootGuildPage();
