// Officer quick-actions bar + player selector gating (index.html only).
// Depends on: common.js (supabaseClient, _teamCfg), discord.js (getDiscordSession)

function _qaIsOfficer() {
  var s = typeof getDiscordSession === 'function' && getDiscordSession();
  return !!(s && s.isOfficer);
}

function _qaRender() {
  var bar = document.getElementById('officerQuickActions');
  if (!bar) return;
  bar.style.display = _qaIsOfficer() ? '' : 'none';
}

// Officer Access nav link: visible to officers/team leaders (isOfficer
// already folds in team_leader, see discord.js's session mapping) and site
// admins (who may need officer.html's Admin tab for a team they aren't
// directly staffed on). Hidden for a plain raider or no session at all --
// defaults to display:none in the markup itself so there's no flash of it
// before the first session check resolves.
function _renderOfficerNavLink() {
  var link = document.getElementById('navOfficer');
  if (!link) return;
  var s = typeof getDiscordSession === 'function' && getDiscordSession();
  link.style.display = s && (s.isOfficer || s.isAdmin) ? '' : 'none';
}

// ── Player selector gating ────────────────────────────────────────────────────
// No session                          -> hide card entirely
// Logged in, unclaimed, no officer/admin access -> hide (claim prompt owns this state)
// Logged in, unclaimed, officer/admin  -> dropdown only, no "View My Profile" (nothing to view)
// Logged in, claimed, non-officer      -> "View My Profile" button only
// Logged in, claimed, officer/admin    -> full dropdown + "View My Profile" link

function _renderPlayerSelector() {
  var card = document.getElementById('playerSelectorCard');
  var label = document.getElementById('playerSelectorLabel');
  var dropOuter = document.getElementById('playerDropdownOuter');
  var profileOuter = document.getElementById('myProfileOuter');
  var profileBtn = document.getElementById('myProfileBtn');
  if (!card) return;

  var session = typeof getDiscordSession === 'function' && getDiscordSession();
  var canLookUp = !!(session && (session.isOfficer || session.isAdmin));

  // A site admin (or officer) has no reason to have personally claimed a
  // character on every team -- they were previously locked out of this
  // card entirely on any team they hadn't, with no way to open another
  // raider's profile there at all (the claim-prompt card took over instead).
  // Gate on lookup access OR an actual claim, not just the claim.
  if (!session || !(session.nameRealm || canLookUp)) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  var firstName = session.nameRealm ? session.nameRealm.split('-')[0] : null;

  if (profileBtn && firstName) {
    profileBtn.onclick = function () {
      if (typeof showView === 'function') showView('profile');
      if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
      var sel = document.getElementById('playerSelect');
      if (sel) sel.value = firstName;
    };
  }

  if (canLookUp) {
    if (label) label.textContent = 'Look Up a Raider';
    if (dropOuter) dropOuter.style.display = '';
    if (profileOuter) profileOuter.style.display = firstName ? '' : 'none';
  } else {
    if (label) label.textContent = 'Your Profile';
    if (dropOuter) dropOuter.style.display = 'none';
    if (profileOuter) profileOuter.style.display = '';
  }
}

// Persistent "claim your character" prompt on the landing view, shown only when
// logged in with no claimed character -- the same session state where
// _renderPlayerSelector hides the profile card. display:none keeps it out of the
// accessibility tree. The box's dialog/focus a11y and the modal it opens are
// tracked in the Accessibility milestone; this is just the entry point.
function _renderClaimPrompt() {
  var card = document.getElementById('claimPromptCard');
  if (!card) return;
  var loadingEl = document.getElementById('claimPromptLoading');
  var descEl = document.getElementById('claimPromptDesc');
  var elsewhereEl = document.getElementById('claimPromptElsewhereDesc');
  var btnEl = document.getElementById('claimPromptBtn');
  var session = typeof getDiscordSession === 'function' && getDiscordSession();
  // #512: an account that explicitly said "I don't have a character yet"
  // (dismissNoCharacterClaim(), js/discord.js) never sees this card again --
  // the existing final `else` below already hides it, so no dismissedNoCharacter
  // branch of its own is needed.
  if (session && !session.nameRealm && !session.dismissedNoCharacter) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (btnEl) btnEl.style.display = '';
    card.style.display = '';

    // resolveDiscordSession() (js/discord.js) sets claimedElsewhere when this
    // team has no linked character but the raider already has one on another
    // team -- point them there instead of implying they've never claimed
    // anything (#368 follow-up to #212).
    if (session.claimedElsewhere) {
      var elsewhere = session.claimedElsewhere;
      var whoEl = document.getElementById('claimPromptElsewhereWho');
      var charEl = document.getElementById('claimPromptElsewhereChar');
      var teamEl = document.getElementById('claimPromptElsewhereTeam');
      if (whoEl) whoEl.textContent = session.username || '';
      if (charEl) charEl.textContent = elsewhere.nameRealm;
      if (teamEl) teamEl.textContent = elsewhere.teamName || 'your other team';
      if (descEl) descEl.style.display = 'none';
      if (elsewhereEl) elsewhereEl.style.display = '';
      if (btnEl) {
        btnEl.textContent = elsewhere.teamName ? 'Switch to ' + elsewhere.teamName : 'Switch teams';
        btnEl.onclick = elsewhere.teamSlug
          ? function () {
              switchTeam(elsewhere.teamSlug);
            }
          : function () {
              if (typeof goToTeamSwitcher === 'function') goToTeamSwitcher();
            };
      }
    } else {
      var nameEl = document.getElementById('claimPromptName');
      if (nameEl) nameEl.textContent = session.username || '';
      if (descEl) descEl.style.display = '';
      if (elsewhereEl) elsewhereEl.style.display = 'none';
      if (btnEl) {
        btnEl.textContent = 'Claim your character';
        btnEl.onclick = function () {
          showDiscordClaimModal(getDiscordSession());
        };
      }
    }
  } else {
    card.style.display = 'none';
  }
}

// Shown the instant a real auth session exists but resolveDiscordSession()
// (a team_members lookup, then a players lookup + is_site_admin in parallel)
// hasn't resolved yet, so a raider sees *something* immediately instead of the
// card staying invisible for however long that takes -- worse if the tab loses
// focus and the browser defers the pending requests (#371). Skipped when a
// cached session already answers whether the card should show at all, so a
// returning user with (or without) a claim doesn't see a pointless flash.
function _renderClaimPromptLoading() {
  var card = document.getElementById('claimPromptCard');
  if (!card || (typeof getDiscordSession === 'function' && getDiscordSession())) return;
  var loadingEl = document.getElementById('claimPromptLoading');
  var descEl = document.getElementById('claimPromptDesc');
  var btnEl = document.getElementById('claimPromptBtn');
  if (loadingEl) loadingEl.style.display = '';
  if (descEl) descEl.style.display = 'none';
  if (btnEl) btnEl.style.display = 'none';
  card.style.display = '';
}

// Officer bar + player selector + claim prompt + officer nav link all react
// to the Discord session; refresh them together on every transition.
function _qaRefresh() {
  _qaRender();
  _renderPlayerSelector();
  _renderClaimPrompt();
  _renderOfficerNavLink();
}

// Callbacks invoked by discord.js
// onDiscordSessionRestored is NOT defined here even though discord.js documents
// it as one of the four hooks -- js/roster.js (loaded after this file) already
// defines it for the profile deep-link feature, and a second same-named function
// declaration would silently win and shadow this one (#371). roster.js's version
// calls _qaRefresh() itself instead.
// The refreshBoeIdentity() calls belong here rather than in js/boe.js: that
// file loads last, so declaring these hooks there would shadow these (#371,
// the same collision the comment above describes). index.html only.
function onDiscordLoginComplete(session) {
  _qaRefresh();
  if (typeof refreshBoeIdentity === 'function') refreshBoeIdentity();
}
function onDiscordLogout() {
  _qaRefresh();
}
function onDiscordInitNoSession() {
  _qaRefresh();
}
function onDiscordClaimComplete(session) {
  _qaRefresh();
  if (typeof refreshBoeIdentity === 'function') refreshBoeIdentity();
}
function onDiscordSessionResolving() {
  _renderClaimPromptLoading();
}

function _qaSetStatus(msg, color) {
  var el = document.getElementById('oqaStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--text-muted)';
}

// ── Copy Priority Export ──────────────────────────────────────────────────────
// Calls the same build_rclc_export() RPC the Priority tab's Generate/Regenerate
// button uses (js/tabs/tab-priority.js), instead of the GAS getExportString
// action -- that recomputed from the Google Sheets "BiS List"/"Priority
// Order" tabs, which stopped being the live data source once the BiS List
// Editor (#391/#393) and priority generator (#220) migrated to Supabase, so
// this button and the Priority tab could disagree on which raiders were
// actually prioritized for what (#408).
//
// One button per track since #859: build_rclc_export() now requires
// p_track and returns half the data -- a combined export measured at ~91k
// base64 chars, large enough to stall the WoW client for several seconds on
// paste into the addon's import box, independent of how that box renders
// text (see the migration's comment for the measurement). The addon merges
// separate Hero/Myth imports into one dataset rather than one overwriting
// the other, so both buttons need to be used, but order doesn't matter.

function qaExportString(track) {
  var btnId = track === 'Myth' ? 'oqaExportMythicBtn' : 'oqaExportHeroicBtn';
  var label = track === 'Myth' ? 'Copy Priority Export (Mythic)' : 'Copy Priority Export (Heroic)';
  var btn = document.getElementById(btnId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }
  _qaSetStatus('Fetching export string...', 'var(--text-muted)');

  if (!supabaseClient) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
    _qaSetStatus('Not connected to Supabase.', 'var(--melee)');
    return;
  }

  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';

  supabaseClient
    .rpc('build_rclc_export', { p_team_id: _teamCfg.supabaseTeamId, p_season: season, p_track: track })
    .then(function (result) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
      var str = !result.error && result.data ? _utf8ToBase64(JSON.stringify(result.data)) : '';
      if (!str) {
        _qaSetStatus(result.error ? result.error.message : 'No export string found.', 'var(--melee)');
        return;
      }
      navigator.clipboard
        .writeText(str)
        .then(function () {
          _qaSetStatus('Copied!', 'var(--heal)');
          setTimeout(function () {
            _qaSetStatus('', '');
          }, 3000);
        })
        .catch(function () {
          _qaSetStatus('Copy failed -- check browser permissions.', 'var(--melee)');
        });
    });
}

// ── Refresh Attendance ────────────────────────────────────────────────────────

// Was still calling GAS's ?action=refreshAttendanceWCL directly (#225) --
// tab-attendance.js's refreshAttendanceWCL() already moved to the wcl-sync
// Edge Function's refreshAttendance action (#223), so this button and the
// real Attendance tab were two different paths that could disagree, the same
// shape of bug the priority-export inconsistency was before #335 fixed it.
// The Edge Function's response carries the same success/mainNights/excluded/
// error fields the GAS action did, so only the transport changes here.
function qaRefreshAttendance() {
  var btn = document.getElementById('oqaAttendBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }
  _qaSetStatus('This may take 30-60 seconds...', 'var(--text-muted)');

  supabaseClient.functions
    .invoke('wcl-sync', { body: { action: 'refreshAttendance', teamId: _teamCfg.supabaseTeamId } })
    .then(function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh Attendance';
      }
      var result = res.data;
      if (!res.error && result && result.success) {
        var msg =
          'Done: ' +
          result.mainNights +
          ' night' +
          (result.mainNights !== 1 ? 's' : '') +
          ' found, ' +
          result.excluded +
          ' excluded.';
        var officerBase =
          'officer.html' + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG + '&' : '?') + 'tab=attendance';
        var el = document.getElementById('oqaStatus');
        if (el) {
          el.style.color = 'var(--heal)';
          el.innerHTML =
            msg +
            ' <a href="' +
            officerBase +
            '" style="color:var(--gold-light);text-decoration:underline;">Review in Dashboard</a>';
        }
      } else {
        _qaSetStatus(
          res.error ? res.error.message : result && result.error ? result.error : 'Error refreshing.',
          'var(--melee)'
        );
      }
    });
}

// ── Paste Loot Import ─────────────────────────────────────────────────────────

function qaPasteLootToggle() {
  var panel = document.getElementById('oqaLootPanel');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  var btn = document.getElementById('oqaLootBtn');
  if (btn) btn.textContent = open ? 'Paste Loot' : 'Hide Loot Import';
  if (!open) _qaSetStatus('', '');
}

function qaSubmitLoot() {
  var pasteEl = document.getElementById('oqaLootPaste');
  var paste = pasteEl ? pasteEl.value.trim() : '';
  var statusEl = document.getElementById('oqaLootStatus');
  var importBtn = document.getElementById('oqaLootImportBtn');

  function setStatus(msg, color) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = color || 'var(--text-muted)';
  }

  if (!paste) {
    setStatus('Paste the RCLC JSON export first.', 'var(--melee)');
    return;
  }

  var entries;
  try {
    entries = JSON.parse(paste);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array.');
  } catch (e) {
    setStatus('Invalid JSON: ' + e.message, 'var(--melee)');
    return;
  }

  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var id = String(ent.id || '').trim();
    var player = String(ent.player || '').trim();
    var instance = String(ent.instance || '').trim();
    if (!id || !player || !instance) continue;
    rows.push({
      id: id,
      player: player,
      date: String(ent.date || '').trim(),
      time: String(ent.time || '').trim(),
      itemID: ent.itemID != null ? ent.itemID : null,
      itemName: String(ent.itemName || '').trim(),
      instance: instance,
      boss: String(ent.boss || '').trim()
    });
  }

  if (rows.length === 0) {
    setStatus('No valid entries found -- check that the JSON has id, player, and instance fields.', 'var(--melee)');
    return;
  }

  // rclc_loot.season stores the compact code ('MID1'), same convention as
  // priority_order.season/scoring.season -- see js/tabs/tab-loot-import.js's
  // matching call site for why this needs seasonCodeForDisplay().
  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
  if (importBtn) importBtn.disabled = true;
  setStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  supabaseClient
    .rpc('import_rclc_loot', { p_team_id: _teamCfg.supabaseTeamId, p_season: season, p_rows: rows })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (importBtn) importBtn.disabled = false;
      var counts = result.data || {};
      var inserted = counts.inserted || 0;
      var skipped = counts.skipped_duplicate || 0;
      var unresolved = counts.unresolved_item || 0;
      var msg = 'Done. ' + inserted + ' new entries added';
      if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
      if (unresolved > 0) msg += ', ' + unresolved + ' with an unresolved item (check Item Lookup)';
      setStatus(msg + '.', 'var(--heal)');
      if (pasteEl) pasteEl.value = '';
    })
    .catch(function (err) {
      if (importBtn) importBtn.disabled = false;
      setStatus('Import failed: ' + err.message, 'var(--melee)');
    });
}

// Eagerly render from the cached session without waiting for validation.
// The onDiscord* callbacks correct these once session validation completes.
_qaRefresh();
