// BoE Found submit card (#746) -- the raider-facing replacement for the BoE
// Google Form. Calls the anon-callable submit_boe_found RPC (the write of
// record, #745) and then pings the boe-webhook Edge Function fire-and-forget,
// the same side-channel shape as js/signup.js's discord-bot-webhook call.
// Zero login required by design: Immolation raiders reach it through a pinned
// per-team Discord link rather than the site nav.
//
// It was a view on index.html until #891 moved it onto boe.html, beside the
// rows it creates, so one page reports a find and shows what became of it.
// Almost everything below follows from that page having no team of its own
// (js/boe-page.js nulls the team globals the way js/guild.js does):
//
//   - the reporting team is chosen here rather than inherited from the page,
//     so there is a placeholder and the submit refuses without an answer;
//   - the item catalog and the raid zones its season filter needs are read
//     here, because there is no loadData() on this page to hang them off;
//   - the season the picker filters to is the reporting team's, looked up
//     from the same team_settings read that decides which teams to offer.
//
// Loaded before js/boe-page.js so the explicit ?team= is captured before that
// file nulls the globals it comes from.
//
// Depends on: common.js (supabaseClient, TEAMS, TEAM_SLUG and _hadExplicitTeam
// at parse time only, featureEnabledIn, fetchSupabaseRaidZones, _esc).

// The team a pinned per-team link asked for: boe.html?team=<slug>, and the
// index.html?team=<slug>#boe links that redirect to it. Read at parse time
// because js/boe-page.js nulls TEAM_SLUG immediately after this file loads.
var _boeReportTeam = typeof _hadExplicitTeam !== 'undefined' && _hadExplicitTeam ? TEAM_SLUG : null;

// What the card last filled in by itself. Anything the visitor types or picks
// makes the element's value diverge from these, which is how a late async
// refresh knows not to clobber a field somebody is already using. Cheaper and
// more testable than wiring input listeners, and it survives the card being
// re-rendered.
var _boeAutoTeam = null;
var _boeAutoChar = null;

// The teams currently offered, in the order rendered, and the season each one
// is playing. Both come from the team_settings read below.
var _boeVisibleSlugs = [];
var _boeTeamSeasons = {};

// The BoE catalog and the raid zones the season filter needs. index.html got
// both out of loadData()'s items read (#875); this page reads them itself.
// Named apart from js/boe-manage.js's own _boeCatalog, which is a different
// list for a different picker and shares this page's global scope.
var _boeFormCatalog = [];
var _boeFormZones = [];

// bootBoePage() runs again on every auth change, and re-picking the default
// team there would throw away a choice the visitor had already made in a tab
// where a session arrived from somewhere else.
var _boeCardBuilt = false;

/**
 * Builds the card and then fills in everything that needs the network: which
 * teams are offering BoE and what season each is on, the item catalog, and
 * the visitor's own claimed character. Safe to call again; only the first
 * call picks a default team.
 */
function initBoeCard() {
  if (!document.getElementById('boeTeamSelect')) return Promise.resolve();
  if (!_boeCardBuilt) {
    _boeCardBuilt = true;
    renderBoeTeamOptions(Object.keys(TEAMS));
    setBoeTeam(defaultBoeTeamSlug(null));
  }
  return Promise.all([refreshBoeTeamOptions(), refreshBoeCatalog()])
    .then(function () {
      return refreshBoeIdentity();
    })
    .then(function () {
      refreshBoeItemOptions();
    });
}

// Hidden teams are included on purpose: Wrathless submits finds and appears
// in no other picker, which is the whole reason this dropdown exists (#767).
// Built with innerHTML rather than createElement/appendChild so the card stays
// testable in the vm sandbox, which stubs createElement without appendChild.
// No escaping: slugs and names are hardcoded literals in common.js's TEAMS,
// not anything a visitor or the database supplies. If a team name ever starts
// coming from team_settings, this needs an escape helper (this bundle has
// none -- js/signup.js keeps its own local copy for the same reason).
//
// The placeholder leads because this page has no team to default to (#891).
// Reporting into whichever team happened to sort first would file finds where
// nobody is watching for them.
function renderBoeTeamOptions(slugs) {
  var sel = document.getElementById('boeTeamSelect');
  if (!sel) return;
  _boeVisibleSlugs = slugs.slice();
  sel.innerHTML =
    '<option value="">Select the team you raided with</option>' +
    slugs
      .map(function (slug) {
        return '<option value="' + slug + '">' + TEAMS[slug].name + '</option>';
      })
      .join('');
}

// A null slug selects the placeholder, which is a real answer here rather
// than a missing one.
function setBoeTeam(slug) {
  var sel = document.getElementById('boeTeamSelect');
  if (!sel) return;
  sel.value = slug || '';
  _boeAutoTeam = sel.value;
}

// Precedence, most specific first: an explicit ?team= wins so a pinned link
// always reports where it says it will; then a lone claimed character's team;
// then nothing, and the visitor answers.
//
// Exactly one claim is the only case where a guess is better than asking.
// Someone with alts on several teams could be raiding with any of them
// tonight, and before #891 the page they were on broke the tie. This page has
// no team, so the placeholder stands instead of picking one of their teams at
// random.
function defaultBoeTeamSlug(claimedSlugs) {
  if (_boeReportTeam) return _boeReportTeam;
  if (claimedSlugs && claimedSlugs.length === 1) return claimedSlugs[0];
  return null;
}

// Drops any team that has switched its own boe flag off, so finds cannot pile
// up somewhere nobody is watching, and records every team's season for the
// item picker. One public read of every team's settings; team_settings has a
// public read policy. Deliberately fails open: if the read errors, every team
// stays listed, because a raider who cannot report a find at all is the worse
// outcome.
function refreshBoeTeamOptions() {
  if (!supabaseClient) return Promise.resolve();
  return Promise.resolve(supabaseClient.from('team_settings').select('team_id, config'))
    .then(function (res) {
      if (!res || res.error || !res.data) return;
      var disabled = {};
      var seasonByTeamId = {};
      res.data.forEach(function (row) {
        var cfg = row.config || {};
        if (!featureEnabledIn(cfg.features, 'boe')) disabled[row.team_id] = true;
        // seasonView when a team has pinned one, else the live season name --
        // the same precedence resolveSeasonView() uses on the team pages.
        seasonByTeamId[row.team_id] = cfg.seasonView || cfg.seasonName || '';
      });
      Object.keys(TEAMS).forEach(function (slug) {
        _boeTeamSeasons[slug] = seasonByTeamId[TEAMS[slug].supabaseTeamId] || '';
      });

      var keep = Object.keys(TEAMS).filter(function (slug) {
        return !disabled[TEAMS[slug].supabaseTeamId];
      });
      if (!keep.length) return;
      var sel = document.getElementById('boeTeamSelect');
      var current = sel && sel.value;
      renderBoeTeamOptions(keep);
      if (!current) {
        // Still on the placeholder, which the re-render just restored.
        setBoeTeam(null);
      } else if (keep.indexOf(current) !== -1) {
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

// The BoE catalog and the raid zones, both of which index.html handed over
// through DATA (#875). Read together so the picker never filters against a
// half-loaded pair, and fails open to an unfiltered catalog: a raider who
// cannot find their item in the list cannot report it at all.
function refreshBoeCatalog() {
  if (!supabaseClient) return Promise.resolve();
  return Promise.all([
    // team-read-guard: the BoE catalog, one row per BoE the guild tracks.
    Promise.resolve(supabaseClient.from('items').select('id, name, wcl_zone_id').eq('is_boe', true)),
    typeof fetchSupabaseRaidZones === 'function' ? fetchSupabaseRaidZones() : Promise.resolve([])
  ])
    .then(function (r) {
      var res = r[0];
      if (res && !res.error && res.data) {
        _boeFormCatalog = res.data
          .map(function (row) {
            return {
              id: row.id,
              name: String(row.name || '').trim(),
              wclZoneId: row.wcl_zone_id == null ? null : row.wcl_zone_id
            };
          })
          .filter(function (it) {
            return it.name;
          })
          .sort(function (a, b) {
            return a.name.localeCompare(b.name);
          });
      }
      _boeFormZones = r[1] || [];
    })
    .catch(function () {});
}

// The card is built before any session is known, so this re-resolves once one
// exists. Called from initBoeCard(), which js/boe-page.js re-runs on every
// auth change.
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

// The team the submit will report against, or null while the placeholder is
// selected. There is no page team to fall back on any more (#891).
function selectedBoeTeamSlug() {
  var sel = document.getElementById('boeTeamSelect');
  var slug = sel && sel.value;
  return slug && TEAMS[slug] ? slug : null;
}

// The season whose BoEs the picker offers: the reporting team's, or the first
// listed team that has one when the reporting team has none. That second case
// is Wrathless, which raids with the guild and configures no season of its
// own -- without the borrow its picker would offer every BoE the guild has
// ever tracked, across every tier.
function boeSeasonForSelectedTeam() {
  var slug = selectedBoeTeamSlug();
  if (slug && _boeTeamSeasons[slug]) return _boeTeamSeasons[slug];
  for (var i = 0; i < _boeVisibleSlugs.length; i++) {
    if (_boeTeamSeasons[_boeVisibleSlugs[i]]) return _boeTeamSeasons[_boeVisibleSlugs[i]];
  }
  return '';
}

// The season's rows by wcl zone, plus any unscoped row. Fails open to the
// whole catalog when the season has no zones, the same rule
// isItemInSeasonScope() applies on the team pages: an incompletely onboarded
// season should not leave a raider with nothing to pick.
function boeSeasonCatalogEntries() {
  if (!_boeFormCatalog.length) return [];
  var season = boeSeasonForSelectedTeam();
  var zones = {};
  var scoped = false;
  if (season) {
    _boeFormZones.forEach(function (rz) {
      if (rz.season !== season) return;
      var id = parseInt(rz.wclZoneId, 10);
      if (id) {
        zones[id] = true;
        scoped = true;
      }
    });
  }
  return _boeFormCatalog.filter(function (it) {
    return it.wclZoneId == null || !scoped || zones[it.wclZoneId] === true;
  });
}

// The item picker (#875, select-only since #877): a select of the season's
// BoEs, submitted exactly as chosen. There is no free-text fallback, so an
// item the catalog does not carry cannot be reported until it gains one.
function refreshBoeItemOptions() {
  var select = document.getElementById('boeItemName');
  if (!select) return;
  var current = select.value;
  select.innerHTML =
    '<option value="">Select item</option>' +
    boeSeasonCatalogEntries()
      .map(function (it) {
        return '<option value="' + _esc(it.name) + '">' + _esc(it.name) + '</option>';
      })
      .join('');
  select.value = current;
}

// The season filter follows the reporting team, so the picker rebuilds when
// that changes. Wired from the select's onchange in boe.html.
function onBoeTeamChange() {
  refreshBoeItemOptions();
}

function submitBoeFound() {
  var charEl = document.getElementById('boeCharName');
  var itemEl = document.getElementById('boeItemName');
  var trackEl = document.getElementById('boeTrack');
  var rankEl = document.getElementById('boeUpgradeRank');
  var noteEl = document.getElementById('boeNote');
  var donateEl = document.getElementById('boeDonate');
  var btn = document.getElementById('boeSubmitBtn');
  var status = document.getElementById('boeStatus');

  var teamSlug = selectedBoeTeamSlug();
  var charName = charEl ? charEl.value.trim() : '';
  var itemName = itemEl ? itemEl.value.trim() : '';
  var track = trackEl && trackEl.value ? trackEl.value : null;
  var rank = rankEl && rankEl.value ? rankEl.value : null;
  var note = noteEl && noteEl.value.trim() ? noteEl.value.trim() : null;
  // Intent, not settlement (#862): the manager's settle button decides.
  var donate = !!(donateEl && donateEl.checked);

  // Validate before any network call, text feedback only -- the status span
  // is a role="status" live region, so this announces to screen readers too.
  // The team comes first because it is the first field, and because there is
  // no page team behind it to make a wrong guess from (#891).
  if (!teamSlug) {
    if (status) status.textContent = 'Please select the team you raided with.';
    return;
  }
  if (!charName) {
    if (status) status.textContent = 'Please enter your character name.';
    return;
  }
  if (!itemName) {
    if (status) status.textContent = 'Please select an item.';
    return;
  }
  // Track and rank are required (#865): together they are the identity of the
  // item in the payout queue. The RPC raises on both too, for a stale client.
  if (!track) {
    if (status) status.textContent = 'Please select the track.';
    return;
  }
  if (!rank) {
    if (status) status.textContent = 'Please select the upgrade rank.';
    return;
  }

  // The disabled button is the double-click duplicate guard -- there is no
  // server-side dedupe (a raider genuinely can find two of the same item).
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }
  if (status) status.textContent = '';

  var teamCfg = TEAMS[teamSlug];

  return supabaseClient
    .rpc('submit_boe_found', {
      p_team_id: teamCfg.supabaseTeamId,
      p_name_realm: charName,
      p_item_name: itemName,
      p_track: track,
      p_note: note,
      p_donate: donate,
      p_upgrade_rank: rank
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
        body: {
          team: teamCfg.name,
          finder: charName,
          item: itemName,
          track: track,
          note: note,
          donate: donate,
          upgradeRank: rank
        }
      });
      // The team stays: a raider reporting two finds from one night is
      // reporting them for the same team.
      if (itemEl) itemEl.value = '';
      if (noteEl) noteEl.value = '';
      if (trackEl) trackEl.value = '';
      if (rankEl) rankEl.value = '';
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
