// BoE Found submit card (#746) -- the raider-facing replacement for the BoE
// Google Form. Calls the anon-callable submit_boe_found RPC (the write of
// record, #745) and then pings the boe-webhook Edge Function fire-and-forget,
// the same side-channel shape as js/signup.js's discord-bot-webhook call.
// Zero login required by design: Immolation raiders reach this through a
// pinned per-team Discord link (index.html?team=<slug>#boe) instead of the
// site nav, so the card leans on common.js's existing ?team= resolution and
// shows which team it will report for. Own file since officer.html and
// index.html are separate script bundles -- same reasoning as js/bonusRoll.js.
//
// Depends on: common.js (supabaseClient, DATA, TEAM_NAME, _teamCfg,
// featureEnabled), js/roster.js (showView), js/discord.js (getDiscordSession,
// optional -- the card works logged out).

// Nav entry point (SITE_NAV_ITEMS onclick and the #boe hash route). Guarded
// here rather than in showView so a deep link with the flag off lands on the
// home view instead of a hidden card as a blank panel.
function showBoeView() {
  if (typeof featureEnabled === 'function' && !featureEnabled('boe')) {
    showView('landing');
    return;
  }
  showView('boe');
}

// Called from bootRosterApp()'s loadData success callback, once DATA (and so
// the team's feature flags) is real: hides the card and its nav button when
// the boe flag is off, names the reporting team, and prefills the character
// field from the claimed character when a session exists.
function initBoeCard() {
  var wrap = document.getElementById('boeViewWrap');
  var nav = document.getElementById('navBoE');
  if (typeof featureEnabled === 'function' && !featureEnabled('boe')) {
    if (wrap) wrap.style.display = 'none';
    if (nav) nav.style.display = 'none';
    return;
  }
  var teamEl = document.getElementById('boeTeamName');
  if (teamEl) teamEl.textContent = TEAM_NAME;
  var charEl = document.getElementById('boeCharName');
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (charEl && !charEl.value && session && session.nameRealm) {
    charEl.value = session.nameRealm;
  }
}

function submitBoeFound() {
  var charEl = document.getElementById('boeCharName');
  var itemEl = document.getElementById('boeItemName');
  var trackEl = document.getElementById('boeTrack');
  var noteEl = document.getElementById('boeNote');
  var btn = document.getElementById('boeSubmitBtn');
  var status = document.getElementById('boeStatus');

  var charName = charEl ? charEl.value.trim() : '';
  var itemName = itemEl ? itemEl.value.trim() : '';
  var track = trackEl && trackEl.value ? trackEl.value : null;
  var note = noteEl && noteEl.value.trim() ? noteEl.value.trim() : null;

  // Validate before any network call, text feedback only -- the status span
  // is a role="status" live region, so this announces to screen readers too.
  if (!charName) {
    if (status) status.textContent = 'Please enter your character name.';
    return;
  }
  if (!itemName) {
    if (status) status.textContent = 'Please enter the item name.';
    return;
  }

  // The disabled button is the double-click duplicate guard -- there is no
  // server-side dedupe (a raider genuinely can find two of the same item).
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }
  if (status) status.textContent = '';

  return supabaseClient
    .rpc('submit_boe_found', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: charName,
      p_item_name: itemName,
      p_track: track,
      p_note: note
    })
    .then(function (result) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit';
      }
      if (result.error) {
        // submit_boe_found's raises are purpose-written to be raider-safe
        // (required fields, unknown track), so show them verbatim.
        if (status) status.textContent = result.error.message;
        return;
      }
      // Best-effort Discord notification via the boe-webhook Edge Function.
      // Not gated on its result -- the RPC insert above is the write of
      // record, same stance as js/signup.js's signup notification.
      supabaseClient.functions.invoke('boe-webhook', {
        body: { team: TEAM_NAME, finder: charName, item: itemName, track: track, note: note }
      });
      if (itemEl) itemEl.value = '';
      if (noteEl) noteEl.value = '';
      if (trackEl) trackEl.value = '';
      if (status) status.textContent = 'Submitted! Officers will take it from here.';
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit';
      }
      if (status) status.textContent = (err && err.message) || 'Something went wrong. Please try again.';
    });
}
