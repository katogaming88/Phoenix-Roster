// Discord-derived officer session: _grantOfficerAccessViaDiscord
// (officer.html) is the only thing that ever sets this flag now that the
// shared officer password is gone. Kept as a sessionStorage flag rather than
// checking getDiscordSession() directly everywhere, since the rest of this
// file already gates on it and the 2-hour expiry is a deliberate re-auth nudge
// independent of how long the underlying Discord session stays valid.
var SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
var _SESSION_KEY = TEAM_SLUG + '_officer';
var _SESSION_TS_KEY = TEAM_SLUG + '_officer_ts';
var selectedOfficerPlayer = null;
// Tracks which players' Player Settings sub-panel is expanded, keyed by
// firstName, so it survives the buildRosterTable() rebuild triggered by
// saves inside that panel (#489).
var officerPlayerSettingsExpanded = {};
var activeFilters = {};
var activeSort = { key: null, dir: 1 };
// ACTIVE_SEASON is declared in common.js; officer.js updates it via setActiveSeason()
// toggleHelp() lives in common.js -- shared with index.html's raider Help tab.

function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  if (name === 'officer') document.getElementById('officerViewWrap').classList.add('active');
}

function openTab(name) {
  var btns = document.querySelectorAll('.nav-item');
  for (var i = 0; i < btns.length; i++) {
    var attr = btns[i].getAttribute('onclick') || '';
    if (attr.indexOf("'" + name + "'") !== -1) {
      btns[i].click();
      return;
    }
  }
}

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.classList.remove('active');
  });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'loot') {
    resetLootSubTab();
  }
  if (name === 'attendance') buildAttendanceTab();
  if (name === 'priority') {
    resetPrioritySubTab();
    buildPriorityTab();
  }
  if (name === 'signups') {
    resetSignupsSubTab();
    buildSignupsTab();
  }
  if (name === 'requests') buildRequestsTab();
  if (name === 'bis') {
    resetBisSubTab();
    buildBisTab();
  }
  if (name === 'mplus') buildMPlusTab();
  if (name === 'audit') buildAuditTab();
  if (name === 'reports') {
    resetReportsSubTab();
    buildReportsTab();
  }
  if (name === 'season') buildSeasonTab();
  if (name === 'bios') {
    buildBioCards();
    buildGuildBioCards();
  }
  if (name === 'admin') buildAdminTab();
}

function resetBisSubTab() {
  document.querySelectorAll('[id^="bis-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('bis-subtab-btn-submissions');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subSubmissions = document.getElementById('bis-sub-submissions');
  var subLists = document.getElementById('bis-sub-lists');
  if (subSubmissions) subSubmissions.style.display = '';
  if (subLists) subLists.style.display = 'none';
}

function switchBisSubTab(name, btnEl) {
  document.querySelectorAll('[id^="bis-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subSubmissions = document.getElementById('bis-sub-submissions');
  var subLists = document.getElementById('bis-sub-lists');
  if (subSubmissions) subSubmissions.style.display = name === 'submissions' ? '' : 'none';
  if (subLists) subLists.style.display = name === 'lists' ? '' : 'none';
  if (name === 'submissions') buildBisTab();
  if (name === 'lists') buildBisListsTab();
}

function resetSignupsSubTab() {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('signups-subtab-btn-signups');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subSignups = document.getElementById('signups-sub-signups');
  var subPending = document.getElementById('signups-sub-pendingRoster');
  var subHistory = document.getElementById('signups-sub-history');
  if (subSignups) subSignups.style.display = '';
  if (subPending) subPending.style.display = 'none';
  if (subHistory) subHistory.style.display = 'none';
}

function switchSignupsSubTab(name, btnEl) {
  document.querySelectorAll('[id^="signups-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subSignups = document.getElementById('signups-sub-signups');
  var subPending = document.getElementById('signups-sub-pendingRoster');
  var subHistory = document.getElementById('signups-sub-history');
  if (subSignups) subSignups.style.display = name === 'signups' ? '' : 'none';
  if (subPending) subPending.style.display = name === 'pendingRoster' ? '' : 'none';
  if (subHistory) subHistory.style.display = name === 'history' ? '' : 'none';
  if (name === 'signups') buildSignupsTab();
  if (name === 'pendingRoster') buildPendingRosterTab();
  if (name === 'history') buildSignupHistoryTab();
}

function resetPrioritySubTab() {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('prio-subtab-btn-list');
  if (defaultBtn) defaultBtn.classList.add('active');
  var subList = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subList) subList.style.display = '';
  if (subUnmanaged) subUnmanaged.style.display = 'none';
  if (subConflicts) subConflicts.style.display = 'none';
}

function switchPrioritySubTab(name, btnEl) {
  document.querySelectorAll('[id^="prio-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subList = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subList) subList.style.display = name === 'list' ? '' : 'none';
  if (subUnmanaged) subUnmanaged.style.display = name === 'unmanaged' ? '' : 'none';
  if (subConflicts) subConflicts.style.display = name === 'conflicts' ? '' : 'none';
  if (name === 'list') buildPriorityTab();
  if (name === 'unmanaged') buildUnmanagedTab();
  if (name === 'conflicts') buildConflicts();
}

function resetReportsSubTab() {
  document.querySelectorAll('[id^="reports-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  var defaultBtn = document.getElementById('reports-subtab-btn-rnlsi');
  if (defaultBtn) defaultBtn.classList.add('active');
  ['rnlsi', 'bisDemand', 'priorityHealth', 'lootPace'].forEach(function (name) {
    var sub = document.getElementById('reports-sub-' + name);
    if (sub) sub.style.display = name === 'rnlsi' ? '' : 'none';
  });
}

function switchReportsSubTab(name, btnEl) {
  document.querySelectorAll('[id^="reports-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['rnlsi', 'bisDemand', 'priorityHealth', 'lootPace'].forEach(function (subName) {
    var sub = document.getElementById('reports-sub-' + subName);
    if (sub) sub.style.display = subName === name ? '' : 'none';
  });
  if (name === 'rnlsi') loadRnlsiReport();
  if (name === 'bisDemand') loadBisDemandReport();
  if (name === 'priorityHealth') loadPriorityHealthReport();
  if (name === 'lootPace') loadLootPaceReport();
}

// Defaults to Import, unless #231's loot flag is off and fairness isn't --
// the Loot tab can be reached with only its Fairness sub-tab enabled (see
// applyFeatureFlagVisibility), so defaulting to a hidden Import chip would
// land on a blank panel behind an invisible tab.
function resetLootSubTab() {
  var defaultName = featureEnabled('loot') || !featureEnabled('fairness') ? 'import' : 'fairness';
  switchLootSubTab(defaultName, document.getElementById('loot-subtab-btn-' + defaultName));
}

function switchLootSubTab(name, btnEl) {
  document.querySelectorAll('[id^="loot-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  var subFairness = document.getElementById('loot-sub-fairness');
  var subImport = document.getElementById('loot-sub-import');
  var subHistory = document.getElementById('loot-sub-history');
  if (subFairness) subFairness.style.display = name === 'fairness' ? '' : 'none';
  if (subImport) subImport.style.display = name === 'import' ? '' : 'none';
  if (subHistory) subHistory.style.display = name === 'history' ? '' : 'none';
  if (name === 'fairness') buildFairness();
  if (name === 'import') buildLootImportForm();
  if (name === 'history') buildLootHistoryTab();
}

// Resets the modal to its default state (plain "Login with Discord", no
// reauth hint, no error) before showing it. showDiscordReauthPrompt()
// (officer.html) calls this first, then layers its own reauth-specific
// overrides on top -- keeping the "reset to default" logic in one place
// instead of duplicating it at every call site.
function showOfficerPrompt() {
  document.getElementById('officerError').style.display = 'none';
  var reauth = document.getElementById('officerDiscordReauth');
  var loginBtn = document.getElementById('officerLoginBtn');
  if (reauth) reauth.style.display = 'none';
  if (loginBtn) loginBtn.style.display = '';
  document.getElementById('officerPrompt').classList.add('active');
}

function hideOfficerPrompt() {
  document.getElementById('officerPrompt').classList.remove('active');
}

function officerLogout() {
  sessionStorage.removeItem(_SESSION_KEY);
  sessionStorage.removeItem(_SESSION_TS_KEY);
  window.location.href = 'index.html';
}

function isOfficerSessionValid() {
  if (sessionStorage.getItem(_SESSION_KEY) !== '1') return false;
  var ts = parseInt(sessionStorage.getItem(_SESSION_TS_KEY) || '0', 10);
  return ts > 0 && Date.now() - ts < SESSION_DURATION_MS;
}

function setNavBadge(id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

function updateNavBadges() {
  fetchSupabaseSignupCounts(function (err, counts) {
    if (err || !counts) return;
    setNavBadge('signupsNavBadge', counts.signups + counts.pendingRoster);
    setNavBadge('pendingRosterSubBadge', counts.pendingRoster);
  });
  fetchSupabasePendingCount('bis_requests', function (err, count) {
    if (err) return;
    setNavBadge('bisNavBadge', count);
  });
  fetchSupabasePendingCount('mplus_exclusion_requests', function (err, count) {
    if (err) return;
    setNavBadge('mplusNavBadge', count);
  });
  fetchSupabasePendingCount('self_received_requests', function (err, count) {
    if (err) return;
    setNavBadge('requestsNavBadge', count);
  });
}

function fetchSupabasePendingCount(table, callback) {
  if (!supabaseClient) {
    callback(new Error('Not connected to Supabase.'));
    return;
  }
  supabaseClient
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .then(function (result) {
      if (result.error) {
        callback(result.error);
        return;
      }
      callback(null, result.count || 0);
    });
}

// signups/pendingRoster/bis/mplus/requests nav badge counts, read from
// Supabase now that every officer request tab is Supabase-only (#328, #403,
// #404, #405, #406) -- the GAS getPendingCounts equivalents counted rows in
// sheets none of these tabs read anymore.
function fetchSupabaseSignupCounts(callback) {
  if (!supabaseClient) {
    callback(new Error('Not connected to Supabase.'));
    return;
  }
  Promise.all([
    supabaseClient
      .from('season_signups')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', _teamCfg.supabaseTeamId)
      .eq('status', 'pending'),
    supabaseClient
      .from('pending_roster')
      .select('signup_id', { count: 'exact', head: true })
      .eq('team_id', _teamCfg.supabaseTeamId)
  ]).then(function (results) {
    if (results[0].error || results[1].error) {
      callback(results[0].error || results[1].error);
      return;
    }
    callback(null, { signups: results[0].count || 0, pendingRoster: results[1].count || 0 });
  });
}

function buildOfficerDashboard() {
  buildStatsBar();
  buildRosterTable();
  buildRosterBuffCoverage();
  buildTrialPromoAlert();
  renderSignupToggle();
  renderBisToggle();
  renderWishlistToggle();
  renderMPlusToggle();
  updatePriorityBadges();
  renderWishlistIncompleteBanner();
  updateNavBadges();
  populateSeasonSelector();
  if (DATA._loadedAt) {
    var t = DATA._loadedAt;
    var h = t.getHours(),
      m = t.getMinutes();
    var ts = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var el = document.getElementById('dataTimestamp');
    if (el) el.textContent = 'Data as of ' + ts;
  }
  var tabParam = (location.search.match(/[?&]tab=([^&]+)/) || [])[1];
  if (tabParam) openTab(tabParam);
  applyFeatureFlagVisibility();
}

// Per-team feature flags (#231). Hides nav-items/sub-tab chips this team has
// turned off; called once after DATA (and DATA.features) loads, and again
// after a toggle on the Admin tab's Feature Flags sub-tab so the change is
// visible without a reload. loot and fairness both live partly inside the
// Loot tab (Loot Fairness is a fairness sub-tab, not a loot one, #231's own
// split) -- the Loot nav-item itself only disappears if both are off.
function applyFeatureFlagVisibility() {
  function setVisible(id, visible) {
    var el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }

  var lootOn = featureEnabled('loot');
  var priorityOn = featureEnabled('priority');
  var bisOn = featureEnabled('bis');
  var scoringOn = featureEnabled('scoring');
  var mplusOn = featureEnabled('mplus');
  var fairnessOn = featureEnabled('fairness');
  var attendanceOn = featureEnabled('attendance');
  var requestsOn = featureEnabled('requests');

  setVisible('navTab-priority', priorityOn);
  setVisible('navTab-bis', bisOn);
  setVisible('navTab-scoring', scoringOn);
  setVisible('navTab-mplus', mplusOn);
  setVisible('navTab-attendance', attendanceOn);
  // Own flag, not lootOn -- these are raider self-mark-received requests, a
  // distinct workflow from loot import/tracking even though both deal with
  // items.
  setVisible('navTab-requests', requestsOn);
  setVisible('navTab-loot', lootOn || fairnessOn);

  setVisible('loot-subtab-btn-import', lootOn);
  setVisible('loot-subtab-btn-history', lootOn);
  setVisible('loot-subtab-btn-fairness', fairnessOn);
  setVisible('attend-subtab-btn-bench', fairnessOn);

  // If a tab the user is currently sitting on just got hidden, bounce to
  // Roster (always visible) instead of leaving a blank panel.
  var activeNav = document.querySelector('.nav-item.active');
  if (activeNav && activeNav.style.display === 'none') {
    openTab('roster');
  }
}

// -- Season selector ----------------------------------------------------------

// ATTENDANCE_WEIGHTS_JS/getSeasonDateRange/computeSeasonAttendancePct/
// getDisplayAttendancePct moved to js/common.js -- the officer-only player
// profile card (js/common.js's buildProfileCard-equivalent) needs them too,
// and common.js is the only file both index.html and officer.html load.

function populateSeasonSelector() {
  var sel = document.getElementById('seasonSelector');
  var wrap = document.getElementById('seasonSelectorWrap');
  if (!sel) return;

  var history = (DATA && DATA.seasonHistory) || [];
  var current = (DATA && DATA.seasonName) || '';
  var hasSeasons = history.length > 0 || current;

  if (wrap) wrap.style.display = hasSeasons ? '' : 'none';

  var options = [{ label: 'All Seasons', value: '' }];
  for (var i = 0; i < history.length; i++) {
    options.push({ label: history[i].name, value: history[i].name });
  }
  if (current) options.push({ label: current + ' (current)', value: current });

  sel.innerHTML = options
    .map(function (o) {
      return '<option value="' + o.value + '">' + o.label + '</option>';
    })
    .join('');

  // Default to current season if set, otherwise All Seasons
  var defaultVal = current || '';
  sel.value = defaultVal;
  ACTIVE_SEASON = defaultVal || null;
}

function setActiveSeason(value) {
  ACTIVE_SEASON = value || null;
  rebuildSeasonFilteredViews();
}

function rebuildSeasonFilteredViews() {
  // Always rebuild the roster table (attendance % may change)
  buildRosterTable();
  reopenSelectedPlayer();
  // Rebuild whichever loot sub-tab is currently visible
  var subFairness = document.getElementById('loot-sub-fairness');
  if (subFairness && subFairness.style.display !== 'none') buildFairness();
  // Rebuild contested items if visible on the priority tab
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subConflicts && subConflicts.style.display !== 'none') buildConflicts();
  // Rebuild attendance sub-tabs if visible
  var tabAttend = document.getElementById('tab-attendance');
  if (tabAttend && tabAttend.classList.contains('active')) {
    var subScores = document.getElementById('attend-sub-scores');
    var subBench = document.getElementById('attend-sub-bench');
    if (!subScores || subScores.style.display !== 'none') buildAttendanceTab();
    if (subBench && subBench.style.display !== 'none' && Array.isArray(_attendanceGrid)) buildBenchFairness();
  }
}

// -- Boot: maintenance mode gates everything below (#245) -- checked before
//    the officer session check, before any data loads. Discord session
//    validation happens via onDiscordSessionRestored() in officer.html once
//    discord.js calls initDiscordLogin().
checkMaintenanceMode().then(function (maint) {
  if (maint.enabled) {
    showMaintenanceBanner(maint.message);
    return;
  }
  if (!isOfficerSessionValid()) {
    sessionStorage.removeItem(_SESSION_KEY);
    sessionStorage.removeItem(_SESSION_TS_KEY);
    document.getElementById('loadingMsg').style.display = 'none';
    // initDiscordLogin() (discord.js) calls onDiscordSessionRestored() which will call
    // _grantOfficerAccessViaDiscord() if the session is valid and the user is an officer,
    // or onDiscordInitNoSession() (officer.html) to prompt a Discord login otherwise.
    // Defer by one tick so the inline script callbacks (onDiscordInitNoSession etc.)
    // defined at the bottom of officer.html are available before initDiscordLogin fires.
    setTimeout(function () {
      if (typeof initDiscordLogin === 'function') {
        initDiscordLogin();
      } else {
        showOfficerPrompt();
      }
    }, 0);
  } else {
    // Session restored from sessionStorage (page reload) -- update Discord nav from cached session
    // without waiting for server validation, so the button reflects the logged-in state immediately.
    if (typeof renderDiscordNav === 'function' && typeof getDiscordSession === 'function') {
      renderDiscordNav(getDiscordSession());
    }
    loadData(
      function () {
        buildOfficerDashboard();
        renderExternalWclLink();
        // Check Discord session for isAdmin
        if (typeof showAdminTab === 'function') {
          var ds = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
          // An officer session with no Discord session backing it shouldn't
          // happen anymore (Discord login is the only way to set it), but
          // fail closed rather than granting Admin tab access if it does.
          showAdminTab(ds ? adminAccessLevel(ds) : false);
        }
        document.getElementById('officerViewWrap').classList.add('active');
        document.getElementById('loadingMsg').style.display = 'none';
      },
      function () {
        buildStatsBar();
        buildRosterTable();
        updatePriorityBadges();
        reopenSelectedPlayer();
      }
    );
  }
});
