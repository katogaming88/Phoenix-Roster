// BoE Sales page (boe.html) -- #864.
//
// The lifecycle surface for found BoEs, moved off guild.html onto a page of
// its own: it was the longest thing on that page once history loaded, it is
// officer-facing where everything around it was raider-facing, and it had to
// hide itself until three access RPCs answered. Here the page IS the surface,
// so the only question is whether to render it or say whom it is for.
//
// Two things share the page since #891: the report form (js/boe.js, loaded
// before this file so it captures the explicit ?team= first) and the records
// below it. The form needs no session at all, so it is built on every visit,
// before and regardless of the access answer.
//
// Team-free like guild.html, and for the same reasons (js/guild.js:1-35):
// common.js resolved a team at parse time and hard-defaulted to Phoenix, so
// the team globals are nulled here, in the consumer, and a team-dependent
// helper called by mistake throws rather than rendering Phoenix's data. It
// does not load js/discord.js either; the one session read it needs is below.
//
// js/boe-manage.js does the rendering and resolves no identity of its own: it
// takes the access answer as a parameter (#774), and this file is the one
// place that decides it, from fetchBoeAccess() in js/common.js.
//
// Since #890 the page renders for anyone signed in rather than for officers
// and BoE managers only. The read policies were already doing the scoping, so
// there was nothing for a client-side gate to protect: a raider's own finds
// came back for them all along and the page refused to show them.

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
 * The page's one decision, and it is now just "signed in?" (#890). Signed out
 * gets a prompt that says what signing in is for; everyone else gets the
 * records the policies return for them, with whatever buttons their access
 * carries. The note is cleared on a render so a re-boot after sign-in never
 * leaves the prompt sitting above the tables.
 *
 * Read off the access answer rather than the session, so a signed-in visitor
 * whose grant reads failed still gets their rows instead of a sign-in prompt
 * they cannot act on.
 */
function renderBoePageAccess(access) {
  var note = document.getElementById('boeAccessNote');
  if (!access.signedIn) {
    if (note) {
      note.innerHTML =
        '<p class="guild-empty">Sign in with Discord to see the BoEs reported under your character. ' +
        'Officers and BoE managers see the finds they look after.</p>';
    }
    return;
  }
  if (note) note.innerHTML = '';
  buildBoeManage(access);
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
      // The report form works signed out, so it does not wait on the session
      // read below or on the access answer that follows it.
      if (typeof initBoeCard === 'function') initBoeCard();
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
          renderBoePageAccess(access);
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
