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

// The plain list. #778 enriches this with the signups-open and BoE flags from
// one team_settings read, plus a "Your team" badge for a resolved claim.
function renderGuildTeams() {
  var mount = document.getElementById('guildTeams');
  if (!mount) return;
  mount.innerHTML = visibleTeamSlugs()
    .map(function (slug) {
      var team = TEAMS[slug];
      return (
        '<a class="guild-team-card" href="' +
        _esc(guildTeamHref(slug)) +
        '"><span class="guild-team-emblem" aria-hidden="true">' +
        _esc(team.emoji || '') +
        '</span><span class="guild-team-name">' +
        _esc(team.name) +
        '</span></a>'
      );
    })
    .join('');
}

function renderGuildSections() {
  renderGuildTeams();
}

function bootGuildPage() {
  var loading = document.getElementById('guildLoading');
  function done() {
    if (loading) loading.style.display = 'none';
  }

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
          renderGuildAuth(session);
          return resolveGuildTeam();
        })
        .then(function () {
          renderGuildSections();
          done();
        });
    })
    .catch(function () {
      done();
    });
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') bootGuildPage();
  });
}

bootGuildPage();
