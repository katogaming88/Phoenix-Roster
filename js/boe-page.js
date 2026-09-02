// BoE Sales page (boe.html) -- #864.
//
// The lifecycle surface for found BoEs, moved off guild.html onto a page of
// its own: it was the longest thing on that page once history loaded, it is
// officer-facing where everything around it was raider-facing, and it had to
// hide itself until three access RPCs answered. Here the page IS the surface,
// so the only question is whether to render it or say whom it is for.
//
// Team-free like guild.html, and for the same reasons (js/guild.js:1-35):
// common.js resolved a team at parse time and hard-defaulted to Phoenix, so
// the team globals are nulled here, in the consumer, and a team-dependent
// helper called by mistake throws rather than rendering Phoenix's data. It
// does not load js/discord.js either; the one session read it needs is below.
//
// js/boe-manage.js does the rendering and resolves no identity of its own: it
// takes canManage as a parameter (#774), and this file is the one place that
// decides it, from fetchBoeAccess() in js/common.js.

TEAM_SLUG = null;
TEAM_NAME = null;
_teamCfg = null;
IS_COLD_LANDING = false;

var _boePageSession = null;

function boePageLogin() {
  if (!supabaseClient) return;
  // No location.search: this page has no team to preserve. The return path is
  // this page, not index.html, so a manager who signed in to get here lands
  // back on the records rather than on a team roster.
  supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

function boePageLogout() {
  if (!supabaseClient) return;
  Promise.resolve(supabaseClient.auth.signOut()).then(function () {
    window.location.reload();
  });
}

function renderBoePageAuth(session) {
  var who = document.getElementById('boeWhoAmI');
  var btn = document.getElementById('boeAuthBtn');
  var meta = (session && session.user && session.user.user_metadata) || null;
  var name = meta ? meta.full_name || meta.name || 'Signed in' : '';
  if (who) who.textContent = session ? name : '';
  if (btn) {
    btn.textContent = session ? 'Sign out' : 'Sign in with Discord';
    btn.onclick = session ? boePageLogout : boePageLogin;
  }
}

/**
 * The page's one decision. Signed out gets a sign-in prompt, signed in
 * without any of the three grants gets told whom the page is for, anyone
 * else gets the records with or without the action buttons. The note is
 * cleared on a render so a re-boot after sign-in never leaves the prompt
 * sitting above the tables.
 */
function renderBoePageAccess(session, access) {
  var note = document.getElementById('boeAccessNote');
  if (!session) {
    if (note) {
      note.innerHTML =
        '<p class="guild-empty">Sign in with Discord to see BoE Sales. This page is for officers and BoE managers.</p>';
    }
    return;
  }
  if (!access.visible) {
    if (note) {
      note.innerHTML =
        '<p class="guild-empty">This page is for officers and BoE managers. Your account holds neither role; ask a site admin if it should.</p>';
    }
    return;
  }
  if (note) note.innerHTML = '';
  buildBoeManage(access.canManage);
}

function bootBoePage() {
  var loading = document.getElementById('boeLoading');
  var note = document.getElementById('boeAccessNote');
  function done() {
    if (loading) loading.style.display = 'none';
  }

  // Written synchronously, before any read, so a session restored a moment
  // later never sees the no-access message flash first.
  if (note) note.innerHTML = '<p class="guild-empty">Loading...</p>';

  if (!supabaseClient) {
    if (note) note.innerHTML = '<p class="guild-empty">Database connection is not configured.</p>';
    done();
    return Promise.resolve();
  }

  return Promise.resolve(checkMaintenanceMode())
    .then(function (state) {
      if (state && state.enabled) {
        showMaintenanceBanner(state.message);
        if (note) note.innerHTML = '';
        done();
        return null;
      }
      return withTimeoutMs(Promise.resolve(supabaseClient.auth.getSession()), 10000)
        .then(
          function (result) {
            return (result && result.data && result.data.session) || null;
          },
          function () {
            return null;
          }
        )
        .then(function (session) {
          _boePageSession = session;
          renderBoePageAuth(session);
          return fetchBoeAccess(session);
        })
        .then(function (access) {
          renderBoePageAccess(_boePageSession, access);
          done();
        });
    })
    .catch(function (err) {
      // A throw anywhere above would otherwise leave the loading line up and
      // an empty console, which is a bad thing to debug from a bug report.
      console.error('BoE Sales page failed to render', err);
      if (note) note.innerHTML = '<p class="guild-empty">Could not load BoE Sales. Try again in a minute.</p>';
      done();
    });
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') bootBoePage();
  });
}

bootBoePage();
