// Discord OAuth session management and login flow.
// Depends on: common.js (supabaseClient, _teamCfg)

var DISCORD_SESSION_KEY = 'wga_discord_' + TEAM_SLUG; // one key per team
var _mappedDiscordSession = null; // cache of the {username, nameRealm, isOfficer, isAdmin} shape

// ── Session cache ─────────────────────────────────────────────────────────────
// Supabase's SDK persists the raw auth session itself, but that alone can't
// answer isOfficer/nameRealm synchronously (that's a DB round-trip). Persist the
// *mapped* shape to localStorage too so synchronous readers (renderDiscordNav,
// and officer.js's reload path which renders from cache before initDiscordLogin
// re-validates) have something to show immediately after a page reload, before
// resolveDiscordSession() has had a chance to run again.

function getDiscordSession() {
  if (_mappedDiscordSession) return _mappedDiscordSession;
  try {
    var raw = localStorage.getItem(DISCORD_SESSION_KEY);
    if (raw) _mappedDiscordSession = JSON.parse(raw);
  } catch (_) {}
  return _mappedDiscordSession;
}

function setDiscordSession(data) {
  _mappedDiscordSession = data;
  try {
    localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(data));
  } catch (_) {}
}

function clearDiscordSession() {
  _mappedDiscordSession = null;
  try {
    localStorage.removeItem(DISCORD_SESSION_KEY);
  } catch (_) {}
}

// ── Nav rendering ─────────────────────────────────────────────────────────────

function renderDiscordNav(session) {
  var btn = document.getElementById('navDiscord');
  if (!btn) return;
  if (!session) {
    btn.textContent = 'Login with Discord';
    btn.disabled = false;
    btn.onclick = loginWithDiscord;
    btn.title = 'Sign in with Discord to view your priority standing and mark loot received';
    btn.classList.remove('discord-logged-in');
    // Remove any logout dropdown if present
    var existing = document.getElementById('discordNavDropdown');
    if (existing) existing.parentNode.removeChild(existing);
    if (typeof renderNotifBell === 'function') renderNotifBell(null);
    return;
  }

  var displayName = session.nameRealm ? session.nameRealm.split('-')[0] : session.username;
  btn.textContent = displayName;
  btn.disabled = false;
  btn.title = 'Logged in as ' + session.username + (session.nameRealm ? ' (' + session.nameRealm + ')' : '');
  btn.classList.add('discord-logged-in');
  if (typeof renderNotifBell === 'function') renderNotifBell(session);

  // Wire click to show a tiny logout dropdown
  btn.onclick = function (ev) {
    ev.stopPropagation();
    var dd = document.getElementById('discordNavDropdown');
    if (dd) {
      dd.parentNode.removeChild(dd);
      return;
    }
    dd = document.createElement('div');
    dd.id = 'discordNavDropdown';
    dd.className = 'discord-nav-dropdown';
    var currentSession = getDiscordSession();
    if (currentSession && currentSession.nameRealm) {
      var profileBtn = document.createElement('button');
      profileBtn.textContent = 'My Profile';
      profileBtn.onclick = function () {
        var firstName = currentSession.nameRealm.split('-')[0].trim();
        var d = document.getElementById('discordNavDropdown');
        if (d) d.parentNode.removeChild(d);
        if (!document.getElementById('profileView')) {
          // On officer.html -- navigate to the public page and auto-open the profile there
          sessionStorage.setItem('wga_open_profile', '1');
          var base = window.location.pathname.replace('officer.html', 'index.html');
          window.location.href = base + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG : '');
          return;
        }
        if (typeof showView === 'function') showView('profile');
        if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
        var sel = document.getElementById('playerSelect');
        if (sel) sel.value = firstName;
      };
      dd.appendChild(profileBtn);
    } else if (currentSession && !currentSession.nameRealm) {
      var claimBtn = document.createElement('button');
      claimBtn.textContent = 'Claim your character';
      claimBtn.onclick = function () {
        showDiscordClaimModal(currentSession);
      };
      dd.appendChild(claimBtn);
    }
    var logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.onclick = discordLogout;
    dd.appendChild(logoutBtn);
    btn.style.position = 'relative';
    btn.appendChild(dd);
    document.addEventListener('click', function closeDD() {
      var d = document.getElementById('discordNavDropdown');
      if (d) d.parentNode.removeChild(d);
      document.removeEventListener('click', closeDD);
    });
  };
}

// Transient state while a real auth session exists but resolveDiscordSession()
// hasn't resolved the mapped shape yet (a team_members lookup, then a players
// lookup and an is_site_admin call). Only shown when there's no cached session
// to render optimistically instead -- otherwise a returning user would see a
// pointless flash on every page load. Without this, the gap between login
// completing and the mapped session resolving looks like nothing happened,
// especially if the tab loses focus and the browser defers the pending
// requests (#371).
function renderDiscordNavLoading() {
  var btn = document.getElementById('navDiscord');
  if (!btn) return;
  btn.textContent = 'Signing in...';
  btn.disabled = true;
  btn.onclick = null;
}

// ── Login (full-page redirect) ──────────────────────────────────────────────

function loginWithDiscord() {
  if (!supabaseClient) return;
  supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname + window.location.search }
  });
}

// Bounds a promise chain that would otherwise hang forever if the underlying
// request stalls (accepted but never answered -- fetch() has no default
// timeout) rather than erroring quickly. Without this, a stalled request would
// leave the "Signing in..."/"Checking your account..." loading state (#371) on
// screen indefinitely instead of falling back to a retryable logged-out state.
function withTimeout(promise, ms) {
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

// ── Session mapping ──────────────────────────────────────────────────────────

// "Members read own team_members" (#212) filters only on auth_user_id, with no
// team_id restriction, so a raider's other-team row is readable from here too.
// Used to tell "never claimed anywhere" apart from "claimed, just not on this
// team" so the landing claim prompt can point at the right team instead of
// implying a claim has to start from scratch (#368 follow-up).
function findClaimElsewhere(userId) {
  return supabaseClient
    .from('team_members')
    .select('team_id, players!players_team_member_id_fkey(name_realm)')
    .eq('auth_user_id', userId)
    .neq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      var rows = result.data || [];
      for (var i = 0; i < rows.length; i++) {
        var players = rows[i].players || [];
        var nameRealm = players.length ? players[0].name_realm : null;
        if (!nameRealm) continue;
        var teamSlug = null;
        Object.keys(TEAMS).forEach(function (slug) {
          if (TEAMS[slug].supabaseTeamId === rows[i].team_id) teamSlug = slug;
        });
        return { teamSlug: teamSlug, teamName: teamSlug ? TEAMS[teamSlug].name : null, nameRealm: nameRealm };
      }
      return null;
    })
    .catch(function () {
      return null;
    });
}

function resolveDiscordSession(session) {
  return supabaseClient
    .from('team_members')
    .select('id, role, name_realm')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('auth_user_id', session.user.id)
    .maybeSingle()
    .then(function (memberResult) {
      var member = memberResult.data;
      // nameRealm comes from the linked character (players.team_member_id): a
      // claim sets that link but never writes team_members.name_realm, so the
      // player lookup is the canonical source. team_members.name_realm stays only
      // as the transitional bridge column (#338) for any row not yet backfilled.
      // One person can link several characters (alts); take the first by name.
      var linkedPromise = member
        ? supabaseClient
            .from('players')
            .select('name_realm')
            .eq('team_member_id', member.id)
            .is('archived_at', null)
            .order('name_realm')
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null });
      return Promise.all([
        linkedPromise,
        supabaseClient.rpc('is_site_admin'),
        supabaseClient.rpc('is_guild_officer')
      ]).then(function (results) {
        var linked = results[0].data;
        var adminResult = results[1];
        var guildOfficerResult = results[2];
        var nameRealm = (linked && linked.name_realm) || (member && member.name_realm) || null;
        var mapped = {
          authUserId: session.user.id,
          teamMemberId: member ? member.id : null,
          username: session.user.user_metadata.full_name || session.user.user_metadata.name,
          // Discord snowflake ID (same raw_user_meta_data.provider_id the
          // claim_character/admin-grant RPCs match on server-side) -- lets
          // the Contact form tag the submitter as a clickable/pingable
          // mention instead of asking for an email address (#577 follow-up).
          discordId: session.user.user_metadata.provider_id || null,
          nameRealm: nameRealm,
          isOfficer: !!member && (member.role === 'officer' || member.role === 'team_leader'),
          isTeamLeader: !!member && member.role === 'team_leader',
          isAdmin: !!adminResult.data,
          // Guild-wide tier (#607): a standalone grant (guild_officers table),
          // not derived from team_members.role -- true for someone with
          // guild-wide authority (e.g. a Guild Master) even with no officer
          // role on any team's own roster.
          isGuildOfficer: !!guildOfficerResult.data
        };
        if (nameRealm) return mapped;
        // Both only matter once nameRealm is already known to be empty --
        // claimedElsewhere (#368) and dismissedNoCharacter (#512) each
        // suppress the claim prompt for a different reason (claimed on a
        // different team vs. explicitly said "no character"), so both are
        // checked together in one parallel round-trip rather than two
        // sequential ones.
        return Promise.all([
          findClaimElsewhere(session.user.id),
          supabaseClient.from('no_character_dismissals').select('id').eq('auth_user_id', session.user.id).maybeSingle()
        ]).then(function (results) {
          mapped.claimedElsewhere = results[0];
          mapped.dismissedNoCharacter = !!results[1].data;
          return mapped;
        });
      });
    });
}

// ── Session validation on page load ──────────────────────────────────────────

function initDiscordLogin() {
  if (!supabaseClient) {
    renderDiscordNav(null);
    if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
    return;
  }

  function fallBackToNoSession() {
    clearDiscordSession();
    renderDiscordNav(null);
    if (typeof onDiscordInitNoSession === 'function') onDiscordInitNoSession();
  }

  function markResolving() {
    if (getDiscordSession()) return;
    renderDiscordNavLoading();
    if (typeof onDiscordSessionResolving === 'function') onDiscordSessionResolving();
  }

  supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result.data.session;
      if (!session) {
        fallBackToNoSession();
        return;
      }
      // The cache is keyed per-team, not per-Discord-account, so a browser
      // that previously had a *different* account's mapped session (e.g. an
      // officer's) cached here would otherwise render that stale isOfficer
      // flag for this account until resolveDiscordSession() corrects it a
      // moment later. Drop it immediately whenever the signed-in user
      // doesn't match who the cache belongs to.
      var cached = getDiscordSession();
      if (cached && cached.authUserId && cached.authUserId !== session.user.id) {
        clearDiscordSession();
      }
      markResolving();
      withTimeout(resolveDiscordSession(session), 15000)
        .then(function (mapped) {
          setDiscordSession(mapped);
          renderDiscordNav(mapped);
          if (typeof onDiscordSessionRestored === 'function') onDiscordSessionRestored(mapped);
        })
        .catch(fallBackToNoSession);
    })
    .catch(fallBackToNoSession);

  // supabase-js re-validates the session (and re-fires SIGNED_IN, not just
  // TOKEN_REFRESHED) whenever the tab regains focus/visibility, even though
  // nothing about the session actually changed. Without this guard, tabbing
  // back to officer.html reran the entire login-complete pipeline -- showing
  // the loading overlay and rebuilding the dashboard -- which is what made an
  // open player-settings panel appear to close on its own.
  var _lastSignedInUserId = null;

  supabaseClient.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_IN' && session) {
      if (_lastSignedInUserId === session.user.id) return;
      _lastSignedInUserId = session.user.id;

      // Same stale-cache guard as the initial getSession() check above --
      // this is the path that actually fires right after a fresh Discord
      // login, so it's the one most likely to render a previous account's
      // cached officer status against the newly-signed-in account.
      var cachedOnSignIn = getDiscordSession();
      if (cachedOnSignIn && cachedOnSignIn.authUserId && cachedOnSignIn.authUserId !== session.user.id) {
        clearDiscordSession();
      }
      markResolving();
      withTimeout(resolveDiscordSession(session), 15000)
        .then(function (mapped) {
          setDiscordSession(mapped);
          renderDiscordNav(mapped);
          if (typeof onDiscordLoginComplete === 'function') onDiscordLoginComplete(mapped);
          // No unclaimed-character popup when the account is already claimed
          // on a different team (claimedElsewhere -- the inline landing card
          // already handles that case by pointing them to switch teams) or
          // has explicitly dismissed the prompt (dismissedNoCharacter, #512).
          if (!mapped.nameRealm && !mapped.claimedElsewhere && !mapped.dismissedNoCharacter) {
            showDiscordClaimModal(mapped);
          }
        })
        .catch(fallBackToNoSession);
    }
    if (event === 'SIGNED_OUT') {
      _lastSignedInUserId = null;
      clearDiscordSession();
      renderDiscordNav(null);
      if (typeof onDiscordLogout === 'function') onDiscordLogout();
    }
  });
}

// ── Claiming modal ────────────────────────────────────────────────────────────

function showDiscordClaimModal(session) {
  var modal = document.getElementById('discordClaimModal');
  if (!modal) return;
  document.getElementById('claimDiscordName').textContent = session.username || '';
  document.getElementById('claimError').style.display = 'none';

  // Show the modal immediately; the character list fills in when the query
  // resolves (one round-trip). Blocking on the read would make the button that
  // opened the modal feel unresponsive.
  modal.style.display = '';

  var sel = document.getElementById('claimCharacterSelect');
  if (!sel || !supabaseClient) return;
  sel.innerHTML = '<option value="">Loading characters...</option>';
  // Unclaimed active characters on this team (team_member_id is null). The DB is
  // the source of truth for claimed-ness now, replacing the old DATA.discordClaims
  // diff. Skip rows without a role the way the roster read does (js/common.js);
  // #357 departed-loot stubs are archived and/or carry no class_spec, so they
  // never surface here.
  // team-read-guard: one row per roster member, 80 on the largest team.
  supabaseClient
    .from('players')
    .select('name_realm, classes_specs(class, role)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .is('team_member_id', null)
    .is('archived_at', null)
    .order('name_realm')
    .then(function (result) {
      sel.innerHTML = '<option value="">-- Select your character --</option>';
      if (result.error) return;
      (result.data || []).forEach(function (row) {
        var cs = row.classes_specs || {};
        if (!cs.role) return;
        var opt = document.createElement('option');
        opt.value = row.name_realm;
        opt.textContent = row.name_realm + (cs.class ? ' (' + cs.class + ')' : '');
        sel.appendChild(opt);
      });
    });
}

function closeDiscordClaimModal() {
  var modal = document.getElementById('discordClaimModal');
  if (modal) modal.style.display = 'none';
}

// Closes the claim modal and hands off to the public team switcher (#368) so the
// "wrong team" hint (#212) is actionable, not just informational.
function goToTeamSwitcher() {
  closeDiscordClaimModal();
  var sel = document.getElementById('teamSwitcherSelect');
  if (!sel) return;
  sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  sel.focus();
  if (typeof sel.showPicker === 'function') {
    try {
      sel.showPicker();
    } catch (_) {}
  }
}

function submitCharacterClaim() {
  var sel = document.getElementById('claimCharacterSelect');
  var errEl = document.getElementById('claimError');
  var nameRealm = sel ? sel.value : '';
  if (!nameRealm) {
    if (errEl) {
      errEl.textContent = 'Please select a character.';
      errEl.style.display = '';
    }
    return;
  }

  var session = getDiscordSession();
  if (!session) return;

  var submitBtn = document.querySelector('#discordClaimModal .claim-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Claiming...';
  }

  function claimFailed(msg) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm claim';
    }
    if (errEl) {
      errEl.textContent = msg || 'Something went wrong. Please try again.';
      errEl.style.display = '';
    }
  }

  // claim_character (SECURITY DEFINER, #212) links the chosen character to the
  // caller's team_members row and returns the claimed name_realm + role. A
  // rejected claim (already claimed, not on roster) comes back as result.error
  // carrying the raised message.
  supabaseClient
    .rpc('claim_character', { p_team_id: _teamCfg.supabaseTeamId, p_name_realm: nameRealm })
    .then(function (result) {
      var row = result.data && result.data[0];
      if (result.error || !row) {
        claimFailed(result.error && result.error.message);
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm claim';
      }
      var updated = Object.assign({}, session, {
        nameRealm: row.name_realm,
        isOfficer: row.role === 'officer' || row.role === 'team_leader',
        isTeamLeader: row.role === 'team_leader'
      });
      setDiscordSession(updated);
      renderDiscordNav(updated);
      closeDiscordClaimModal();
      if (typeof onDiscordClaimComplete === 'function') onDiscordClaimComplete(updated);
    })
    .catch(function () {
      claimFailed();
    });
}

// #512: permanent "no character, stop asking" opt-out -- inserts one row
// into no_character_dismissals for this account (global, not per-team; RLS
// only lets a caller write their own auth_user_id) and patches the cached
// session so both the modal's auto-popup and the landing-page inline card
// (_renderClaimPrompt, js/officer-quick-actions.js) stop showing immediately,
// not just after the next login. ignoreDuplicates makes a double-click race
// a harmless no-op instead of a unique-violation error.
function dismissNoCharacterClaim() {
  var session = getDiscordSession();
  if (!session || !session.authUserId || !supabaseClient) return;

  var btn = document.querySelector('#discordClaimModal .claim-dismiss-btn');
  if (btn) btn.disabled = true;

  supabaseClient
    .from('no_character_dismissals')
    .upsert({ auth_user_id: session.authUserId }, { onConflict: 'auth_user_id', ignoreDuplicates: true })
    .then(function (result) {
      if (btn) btn.disabled = false;
      if (result.error) return;
      var updated = Object.assign({}, session, { dismissedNoCharacter: true });
      setDiscordSession(updated);
      closeDiscordClaimModal();
      if (typeof onDiscordClaimComplete === 'function') onDiscordClaimComplete(updated);
    })
    .catch(function () {
      if (btn) btn.disabled = false;
    });
}

// Admin tab access level for a resolved session: true grants the full tab
// (site admins), 'team_leader' grants the team-leader surfaces (#317: the
// Properties and Officers sub-tabs plus Clear Season History in the Danger
// Zone -- the sub-tab map lives in adminSubTabVisibility in tab-admin.js),
// false hides the tab entirely.
function adminAccessLevel(session) {
  if (!session) return false;
  if (session.isAdmin) return true;
  if (session.isTeamLeader) return 'team_leader';
  return false;
}

// Guild-officer access level for the currently viewed team (#607): 'full'
// when the session already has native officer/team_leader/admin access here
// (no extra gating needed -- callers should keep using isOfficer/isAdmin as
// before), 'guild' when the session only reaches this team through the
// guild-wide grant, false otherwise (raider or logged out). Deliberately
// separate from adminAccessLevel() -- the Admin tab must stay hidden for
// 'guild', unlike the true/'team_leader' values that function returns.
function guildOfficerAccessLevel(session) {
  if (!session) return false;
  if (session.isOfficer || session.isAdmin) return 'full';
  if (session.isGuildOfficer) return 'guild';
  return false;
}

// ── Officer claim management (#365) ──────────────────────────────────────────

// Claimed characters on this team: players with a linked team_members row,
// joined for the discord id and role. Supabase is the source of truth now
// (replacing DATA.discordClaims / DATA.officerDiscordIds), so both the roster
// tab's claims table and the admin tab's promotion picker share this fetch.
function fetchTeamClaims() {
  if (!supabaseClient) return Promise.resolve([]);
  var teamId = _teamCfg.supabaseTeamId;
  // team-read-guard: one row per roster member, 80 on the largest team.
  return supabaseClient
    .from('players')
    .select('name_realm, team_members(id, discord_id, auth_user_id, role)')
    .eq('team_id', teamId)
    .not('team_member_id', 'is', null)
    .is('archived_at', null)
    .order('name_realm')
    .then(function (result) {
      if (result.error) return [];
      var claims = (result.data || []).map(function (row) {
        var tm = row.team_members || {};
        return {
          nameRealm: row.name_realm,
          teamMemberId: tm.id,
          discordId: tm.discord_id,
          authUserId: tm.auth_user_id,
          role: tm.role
        };
      });
      // Discord display name: resolved separately, not joined --
      // it's auth.users PII behind a SECURITY DEFINER function, not a plain
      // FK select. Only worth resolving for a claim that's actually linked
      // (a pre-listed officer awaiting their first login has no
      // auth_user_id yet).
      var withAuth = claims.filter(function (c) {
        return c.authUserId;
      });
      if (!withAuth.length) return claims;
      return Promise.all(
        withAuth.map(function (c) {
          return supabaseClient
            .rpc('resolve_discord_display_name', { p_actor_id: c.authUserId, p_team_id: teamId })
            .then(function (nameResult) {
              c.discordName = nameResult.error ? '' : nameResult.data || '';
            });
        })
      ).then(function () {
        return claims;
      });
    });
}

// ── Logout ────────────────────────────────────────────────────────────────────

function discordLogout() {
  if (!supabaseClient) return;
  // Don't rely solely on the onAuthStateChange SIGNED_OUT branch -- it's only wired up
  // when initDiscordLogin() has run on this page load, which officer.js's reload path
  // skips once the officer session flag is already valid. Clear state directly so logout
  // works regardless of whether that listener is attached.
  supabaseClient.auth.signOut().then(function () {
    clearDiscordSession();
    renderDiscordNav(null);
    if (typeof onDiscordLogout === 'function') onDiscordLogout();
  });
}
