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

// What the card last filled in by itself. Anything the visitor types or picks
// makes the element's value diverge from these, which is how a late async
// refresh knows not to clobber a field somebody is already using. Cheaper and
// more testable than wiring input listeners, and it survives the card being
// re-rendered.
var _boeAutoTeam = null;
var _boeAutoChar = null;

// Called from bootRosterApp()'s loadData success callback, once DATA (and so
// the team's feature flags) is real: hides the card and its nav button when
// the boe flag is off, builds the reporting-team dropdown, and prefills from
// whatever identity is known synchronously (the localStorage session cache).
// The two refresh functions below finish the job once the network answers.
function initBoeCard() {
  var wrap = document.getElementById('boeViewWrap');
  var nav = document.getElementById('navBoE');
  if (typeof featureEnabled === 'function' && !featureEnabled('boe')) {
    if (wrap) wrap.style.display = 'none';
    if (nav) nav.style.display = 'none';
    return;
  }
  renderBoeTeamOptions(Object.keys(TEAMS));
  setBoeTeam(defaultBoeTeamSlug(null));
  var charEl = document.getElementById('boeCharName');
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (charEl && !charEl.value && session && session.nameRealm) {
    charEl.value = session.nameRealm;
    _boeAutoChar = session.nameRealm;
  }
  refreshBoeTeamOptions();
}

// Hidden teams are included on purpose: Wrathless submits finds and appears
// in no other picker, which is the whole reason this dropdown exists (#767).
// Built with innerHTML rather than createElement/appendChild so the card stays
// testable in the vm sandbox, which stubs createElement without appendChild.
// No escaping: slugs and names are hardcoded literals in common.js's TEAMS,
// not anything a visitor or the database supplies. If a team name ever starts
// coming from team_settings, this needs an escape helper (this bundle has
// none -- js/signup.js keeps its own local copy for the same reason).
function renderBoeTeamOptions(slugs) {
  var sel = document.getElementById('boeTeamSelect');
  if (!sel) return;
  sel.innerHTML = slugs
    .map(function (slug) {
      return '<option value="' + slug + '">' + TEAMS[slug].name + '</option>';
    })
    .join('');
}

function setBoeTeam(slug) {
  var sel = document.getElementById('boeTeamSelect');
  if (!sel || !slug) return;
  sel.value = slug;
  _boeAutoTeam = slug;
}

// Precedence, most specific first: an explicit ?team= wins so a pinned link
// always reports where it says it will; then a lone claimed character's team;
// then the page team.
//
// Exactly one claim is the only case where we can improve on the page's team.
// Someone with alts on several teams could be raiding with any of them
// tonight, so leave them where they landed instead of guessing, which is also
// what happens when they have no claim at all.
function defaultBoeTeamSlug(claimedSlugs) {
  if (_hadExplicitTeam) return TEAM_SLUG;
  if (claimedSlugs && claimedSlugs.length === 1) return claimedSlugs[0];
  return TEAM_SLUG;
}

// Drops any team that has switched its own boe flag off, so finds cannot pile
// up somewhere nobody is watching the officer tab. One public read of every
// team's settings; team_settings has a public read policy. Deliberately fails
// open: if the read errors, every team stays listed, because a raider who
// cannot report a find at all is the worse outcome.
function refreshBoeTeamOptions() {
  if (!supabaseClient) return Promise.resolve();
  return Promise.resolve(supabaseClient.from('team_settings').select('team_id, config'))
    .then(function (res) {
      if (!res || res.error || !res.data) return;
      var disabled = {};
      res.data.forEach(function (row) {
        if (!featureEnabledIn(row.config && row.config.features, 'boe')) disabled[row.team_id] = true;
      });
      var keep = Object.keys(TEAMS).filter(function (slug) {
        return !disabled[TEAMS[slug].supabaseTeamId];
      });
      if (!keep.length) return;
      var sel = document.getElementById('boeTeamSelect');
      var current = sel && sel.value;
      renderBoeTeamOptions(keep);
      if (keep.indexOf(current) !== -1) {
        // Re-select what was already there without recording it as our own
        // choice. Stamping _boeAutoTeam here would erase the difference
        // between a value the visitor picked and one the card filled in,
        // and the identity refresh below would then overwrite their pick.
        if (sel) sel.value = current;
      } else {
        // Their team turned the feature off, so the choice is gone and the
        // replacement genuinely is ours.
        setBoeTeam(keep[0]);
      }
    })
    .catch(function () {});
}

// The card is built before initDiscordLogin() runs (js/roster.js boot order),
// so it only ever sees the TTL-less localStorage cache. This re-resolves once
// a real session exists, and is called from the onDiscord* hooks in the files
// that already own them -- never from here, since js/boe.js loads last and a
// same-named function would shadow theirs (the #371 bug, js/roster.js:874).
//
// Same "auth_user_id only, no team_id filter" read as resolveColdLanding(),
// which the RLS policy allows and which returns nothing for anon. Two
// differences: every claim is collected rather than stopping at the first,
// and archived characters are skipped, which that call site does not do.
function refreshBoeIdentity() {
  if (!supabaseClient || !document.getElementById('boeTeamSelect')) return Promise.resolve();
  return supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session) return null;
      return supabaseClient
        .from('team_members')
        .select('team_id, players!players_team_member_id_fkey(name_realm, archived_at)')
        .eq('auth_user_id', session.user.id);
    })
    .then(function (res) {
      if (!res || res.error || !res.data) return;
      var slugs = [];
      var nameRealm = null;
      res.data.forEach(function (row) {
        var live = (row.players || []).filter(function (p) {
          return p && p.name_realm && !p.archived_at;
        });
        if (!live.length) return;
        Object.keys(TEAMS).forEach(function (slug) {
          if (TEAMS[slug].supabaseTeamId === row.team_id && slugs.indexOf(slug) === -1) {
            slugs.push(slug);
            if (!nameRealm) nameRealm = live[0].name_realm;
          }
        });
      });
      if (!slugs.length) return;

      var sel = document.getElementById('boeTeamSelect');
      if (sel && sel.value === _boeAutoTeam) setBoeTeam(defaultBoeTeamSlug(slugs));
      var charEl = document.getElementById('boeCharName');
      if (charEl && nameRealm && (!charEl.value || charEl.value === _boeAutoChar)) {
        charEl.value = nameRealm;
        _boeAutoChar = nameRealm;
      }
    })
    .catch(function () {});
}

// The team the submit will report against. Falls back to the page team if the
// select is missing or holds something TEAMS does not know.
function selectedBoeTeamSlug() {
  var sel = document.getElementById('boeTeamSelect');
  var slug = sel && sel.value;
  return slug && TEAMS[slug] ? slug : TEAM_SLUG;
}

// The item picker (#875). DATA.boeItems is the season catalog common.js
// collects out of the items read. The datalist offers the viewed season's
// rows (by wcl zone, through the helper the season filter uses, which fails
// open to every BoE when the season has no zones) plus any unscoped row.
// Filled from the heavy-load callback in js/roster.js, since the items read
// resolves after initBoeCard() has run; until then the field is the plain
// text input it always was.
function boeCatalogEntries() {
  return (typeof DATA !== 'undefined' && DATA && DATA.boeItems) || [];
}

function boeSeasonCatalogEntries() {
  var all = boeCatalogEntries();
  if (!all.length) return [];
  var zones = typeof currentZoneIdsForSeason === 'function' ? currentZoneIdsForSeason(resolveSeasonView()) : {};
  var scoped = Object.keys(zones).length > 0;
  return all.filter(function (it) {
    return it.wclZoneId == null || !scoped || zones[it.wclZoneId] === true;
  });
}

function refreshBoeItemOptions() {
  if (typeof featureEnabled === 'function' && !featureEnabled('boe')) return;
  if (typeof renderBoeItemDatalist !== 'function') return;
  renderBoeItemDatalist(
    boeSeasonCatalogEntries().map(function (it) {
      return it.name;
    })
  );
}

// A typed name that matches the catalog case-insensitively submits with the
// catalog's spelling. Against the whole catalog, not the viewed season's: a
// find from last season is still a real item. Anything else goes as typed
// and submit_boe_found links it if it can.
function boeCatalogName(typed) {
  var key = String(typed || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  var hit = null;
  boeCatalogEntries().forEach(function (it) {
    if (!hit && String(it.name).toLowerCase() === key) hit = it.name;
  });
  return hit;
}

function submitBoeFound() {
  var charEl = document.getElementById('boeCharName');
  var itemEl = document.getElementById('boeItemName');
  var trackEl = document.getElementById('boeTrack');
  var noteEl = document.getElementById('boeNote');
  var donateEl = document.getElementById('boeDonate');
  var btn = document.getElementById('boeSubmitBtn');
  var status = document.getElementById('boeStatus');

  var charName = charEl ? charEl.value.trim() : '';
  var itemName = itemEl ? itemEl.value.trim() : '';
  var track = trackEl && trackEl.value ? trackEl.value : null;
  var note = noteEl && noteEl.value.trim() ? noteEl.value.trim() : null;
  // Intent, not settlement (#862): the manager's settle button decides.
  var donate = !!(donateEl && donateEl.checked);

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
  itemName = boeCatalogName(itemName) || itemName;

  // The disabled button is the double-click duplicate guard -- there is no
  // server-side dedupe (a raider genuinely can find two of the same item).
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }
  if (status) status.textContent = '';

  // The picked team, not the page's: a raider on another team's page (or on
  // Wrathless, which has no page anyone visits) must be able to file the find
  // where it actually belongs (#767).
  var teamCfg = TEAMS[selectedBoeTeamSlug()];

  return supabaseClient
    .rpc('submit_boe_found', {
      p_team_id: teamCfg.supabaseTeamId,
      p_name_realm: charName,
      p_item_name: itemName,
      p_track: track,
      p_note: note,
      p_donate: donate
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
        body: { team: teamCfg.name, finder: charName, item: itemName, track: track, note: note, donate: donate }
      });
      if (itemEl) itemEl.value = '';
      if (noteEl) noteEl.value = '';
      if (trackEl) trackEl.value = '';
      if (donateEl) donateEl.checked = false;
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
