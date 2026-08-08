// Public page: view switching, player dropdown, boot
function showView(name) {
  document.getElementById('loadingMsg').style.display = 'none';
  [
    'landingView',
    'profileViewWrap',
    'signupViewWrap',
    'rosterViewWrap',
    'streamersViewWrap',
    'historyViewWrap',
    'aboutViewWrap',
    'newsViewWrap',
    'helpViewWrap'
  ].forEach(function (id) {
    document.getElementById(id).classList.remove('active');
  });
  if (name === 'landing') {
    document.getElementById('landingView').classList.add('active');
    updateSignupNavItem();
    updateHistoryNavItem();
    updateAboutNavItem();
  }
  if (name === 'profile') document.getElementById('profileViewWrap').classList.add('active');
  if (name === 'signup') document.getElementById('signupViewWrap').classList.add('active');
  if (name === 'roster') {
    document.getElementById('rosterViewWrap').classList.add('active');
    buildPublicRosterTab();
    buildIncomingRosterSection();
    showRosterSubTab('current');
  }
  if (name === 'streamers') {
    document.getElementById('streamersViewWrap').classList.add('active');
    buildStreamersTab();
  }
  if (name === 'history') {
    document.getElementById('historyViewWrap').classList.add('active');
    buildSeasonRecap();
  }
  if (name === 'about') {
    document.getElementById('aboutViewWrap').classList.add('active');
    buildBios();
    buildGuildBios();
    showAboutSubTab('team');
  }
  if (name === 'news') {
    document.getElementById('newsViewWrap').classList.add('active');
    buildNewsTab();
    markNewsSeen();
  }
  if (name === 'help') document.getElementById('helpViewWrap').classList.add('active');
  ['navHome', 'navSignup', 'navRoster', 'navStreamers', 'navHistory', 'navAbout', 'navNews', 'navHelp'].forEach(
    function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('active');
    }
  );
  var activeNav = {
    landing: 'navHome',
    profile: 'navHome',
    signup: 'navSignup',
    roster: 'navRoster',
    streamers: 'navStreamers',
    history: 'navHistory',
    about: 'navAbout',
    news: 'navNews',
    help: 'navHelp'
  }[name];
  if (activeNav) {
    var el = document.getElementById(activeNav);
    if (el) el.classList.add('active');
  }

  // Hide the floating stream widget where it's redundant (Streams tab itself)
  // or just noisy (mid-signup) -- shown everywhere else (landing, roster, profile).
  var widget = document.getElementById('streamWidget');
  if (widget) widget.classList.toggle('stream-widget-hidden', name === 'streamers' || name === 'signup');

  // Reflect into the URL hash so a reload can restore the view (#517). Only
  // these three are in scope -- 'profile' sets its own hash (with the player)
  // from renderProfile() instead, right after this runs. Every other view
  // (signup, history, about, news, help) is out of scope for now; clear the
  // hash for them so a stale '#roster'/'#profile/...' from before doesn't win
  // on the next reload and land the wrong view.
  var hashByView = { landing: '', roster: 'roster', streamers: 'streams' };
  if (name !== 'profile') setViewHash(Object.prototype.hasOwnProperty.call(hashByView, name) ? hashByView[name] : '');
}

function populateDropdown() {
  var sel = document.getElementById('playerSelect');
  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (groups[p.role]) groups[p.role].push(p);
  }
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    var group = document.createElement('optgroup');
    group.label = labels[role];
    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var opt = document.createElement('option');
      opt.value = player.firstName;
      opt.textContent = player.nick ? player.nick + ' (' + player.firstName + ')' : player.firstName;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

function buildPublicRosterTab() {
  var container = document.getElementById('rosterView');
  if (!container || !window.DATA || !DATA.roster) return;

  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (groups[p.role]) groups[p.role].push(p);
  }

  var html = '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html += '<tr class="group-header"><td colspan="2">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var roleColor =
        player.role === 'Tank'
          ? 'var(--tank)'
          : player.role === 'Heal'
            ? 'var(--heal)'
            : player.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var dispName = player.nick || player.firstName;
      html +=
        '<tr>' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        dispName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<span style="font-weight:600;color:var(--text);">' +
        dispName +
        '</span>' +
        (player.firstName !== dispName
          ? '<span style="font-size:1.02rem;color:var(--text-muted);">(' + player.firstName + ')</span>'
          : '') +
        '</div></td>' +
        '<td>' +
        (player.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(player.class) +
            ';">' +
            (player.spec || player.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Raider-facing preview of approved-but-unpromoted signups for the current
// signup season (#499) -- same grouped table as buildPublicRosterTab(), but
// reading DATA.incomingRoster (from the incoming_roster view) instead of
// DATA.roster. Visibility (and whether the Incoming sub-tab even exists) is
// handled by showRosterSubTab(), not here -- this only builds the table markup.
function buildIncomingRosterSection() {
  var container = document.getElementById('incomingRosterSection');
  if (!container) return;
  var rows = (window.DATA && DATA.incomingRoster) || [];
  if (!rows.length) {
    container.innerHTML = '';
    return;
  }

  var order = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };

  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    if (groups[p.role]) groups[p.role].push(p);
  }

  var html =
    '<div class="pub-loot-title">' + rows.length + ' Pending Raider' + (rows.length === 1 ? '' : 's') + '</div>';
  html += '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return a.firstName.localeCompare(b.firstName);
    });
    html += '<tr class="group-header"><td colspan="2">' + labels[role] + ' (' + players.length + ')</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var roleColor =
        player.role === 'Tank'
          ? 'var(--tank)'
          : player.role === 'Heal'
            ? 'var(--heal)'
            : player.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      html +=
        '<tr>' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        player.firstName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<span style="font-weight:600;color:var(--text);">' +
        player.firstName +
        '</span>' +
        '</div></td>' +
        '<td>' +
        (player.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(player.class) +
            ';">' +
            (player.spec || player.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// Which of the Roster tab's two sub-tabs is showing -- reset to 'current'
// whenever a raider navigates into the Roster tab fresh (showView), but left
// alone when heavy data re-renders while they're already looking at it, so a
// late-arriving incoming-roster fetch doesn't yank them off what they're
// reading (#499).
var _rosterSubTab = 'current';

function showRosterSubTab(tab) {
  var hasIncoming = ((window.DATA && DATA.incomingRoster) || []).length > 0;
  _rosterSubTab = hasIncoming && tab === 'incoming' ? 'incoming' : 'current';

  var subNav = document.getElementById('rosterSubNav');
  var tabCurrentBtn = document.getElementById('rosterSubTabCurrent');
  var tabIncomingBtn = document.getElementById('rosterSubTabIncoming');
  var rosterEl = document.getElementById('rosterView');
  var incomingEl = document.getElementById('incomingRosterSection');

  if (subNav) subNav.style.display = hasIncoming ? 'flex' : 'none';
  if (tabIncomingBtn) {
    tabIncomingBtn.style.display = hasIncoming ? '' : 'none';
    // Labeled from the officer-set signup season (DATA.signupSeason, e.g.
    // "MN Season 2") rather than hardcoded, so the tab name stays correct
    // without a code change once a new season's signups open (#499
    // follow-up). Falls back to a season-agnostic label on the rare load
    // where signupSeason hasn't been set yet.
    var incomingSeason = (window.DATA && DATA.signupSeason) || '';
    tabIncomingBtn.textContent = incomingSeason
      ? incomingSeason + ' Roster (Tentative)'
      : 'Next Season Roster (Tentative)';
  }
  if (tabCurrentBtn) tabCurrentBtn.classList.toggle('active', _rosterSubTab === 'current');
  if (tabIncomingBtn) tabIncomingBtn.classList.toggle('active', _rosterSubTab === 'incoming');
  if (rosterEl) rosterEl.style.display = _rosterSubTab === 'current' ? '' : 'none';
  if (incomingEl) incomingEl.style.display = _rosterSubTab === 'incoming' ? '' : 'none';
}

function updateSignupNavItem() {
  var el = document.getElementById('navSignup');
  if (el) el.style.display = DATA && DATA.signupsOpen ? '' : 'none';
}

// Hidden until this team has actually archived a season (#477) -- a brand
// new team, or one before its first rollover, has nothing to show here.
function updateHistoryNavItem() {
  var el = document.getElementById('navHistory');
  if (el) el.style.display = DATA && DATA.seasonHistory && DATA.seasonHistory.length ? '' : 'none';
}

// Always visible (#577, third slice) -- the About sub-tab's static "what is
// this site" copy means there's always something to show now, even for a
// brand new team with no Team/Guild bios yet.
function updateAboutNavItem() {
  var el = document.getElementById('navAbout');
  if (el) el.style.display = '';
}

// Which of the About tab's Team/Guild/About/Contact sub-tabs is showing.
// Same "collapse to a single section with no pill bar" rule as
// showRosterSubTab() when only one side has content -- the pill bar only
// appears once 2+ of the four sections are actually populated. About and
// Contact are always populated (static copy / a form, not data-driven), so
// the pill bar is effectively always shown once this exists -- that's
// expected, not a bug to special-case around. Contact is never a fallback
// default (unlike Guild/About) -- it's only reached by an explicit click.
var _aboutSubTab = 'team';

function showAboutSubTab(tab) {
  var hasTeam = !!(DATA && DATA.teamOfficerBios && DATA.teamOfficerBios.length);
  var hasGuild = !!(DATA && DATA.guildOfficerBios && DATA.guildOfficerBios.length);
  var hasAbout = true;
  var hasContact = true;
  if (tab === 'team' && !hasTeam) tab = hasGuild ? 'guild' : 'about';
  if (tab === 'guild' && !hasGuild) tab = hasTeam ? 'team' : 'about';
  _aboutSubTab = tab === 'guild' || tab === 'about' || tab === 'contact' ? tab : 'team';

  var subNav = document.getElementById('aboutSubNav');
  var tabTeamBtn = document.getElementById('aboutSubTabTeam');
  var tabGuildBtn = document.getElementById('aboutSubTabGuild');
  var tabAboutBtn = document.getElementById('aboutSubTabAbout');
  var tabContactBtn = document.getElementById('aboutSubTabContact');
  var teamEl = document.getElementById('aboutTeamSection');
  var guildEl = document.getElementById('aboutGuildSection');
  var infoEl = document.getElementById('aboutInfoSection');
  var contactEl = document.getElementById('aboutContactSection');

  var populatedCount = (hasTeam ? 1 : 0) + (hasGuild ? 1 : 0) + (hasAbout ? 1 : 0) + (hasContact ? 1 : 0);
  if (subNav) subNav.style.display = populatedCount > 1 ? 'flex' : 'none';
  if (tabTeamBtn) {
    tabTeamBtn.style.display = hasTeam ? '' : 'none';
    tabTeamBtn.classList.toggle('active', _aboutSubTab === 'team');
  }
  if (tabGuildBtn) {
    tabGuildBtn.style.display = hasGuild ? '' : 'none';
    tabGuildBtn.classList.toggle('active', _aboutSubTab === 'guild');
  }
  if (tabAboutBtn) tabAboutBtn.classList.toggle('active', _aboutSubTab === 'about');
  if (tabContactBtn) tabContactBtn.classList.toggle('active', _aboutSubTab === 'contact');
  // display:contents (not '') on these wrappers so they drop out of the box
  // model entirely when shown -- their pub-loot/bio-wrap children become
  // direct centered flex children of .landing-body again, matching every
  // other tab. A plain block wrapper would stretch full-width and left-align
  // its children instead of centering them (#577 follow-up fix).
  if (teamEl) teamEl.style.display = hasTeam && _aboutSubTab === 'team' ? 'contents' : 'none';
  if (guildEl) guildEl.style.display = hasGuild && _aboutSubTab === 'guild' ? 'contents' : 'none';
  if (infoEl) infoEl.style.display = _aboutSubTab === 'about' ? 'contents' : 'none';
  if (contactEl) contactEl.style.display = _aboutSubTab === 'contact' ? 'contents' : 'none';
}

document.getElementById('playerSelect').addEventListener('change', function (e) {
  if (e.target.value) {
    showView('profile');
    renderProfile(e.target.value, 'landing');
  }
});

function buildPublicStats() {
  // DATA.lootCounts carries every season for the team (see buildRecentLoot()
  // below) -- "Items This Tier" needs the same per-item season filter, not
  // the entry's all-time count.
  var loot = DATA.lootCounts || {};
  var totalItems = 0;
  var keys = Object.keys(loot);
  var currentSeason = (DATA && DATA.seasonName) || '';
  for (var i = 0; i < keys.length; i++) {
    var items = loot[keys[i]].items || [];
    for (var j = 0; j < items.length; j++) {
      if (currentSeason && items[j].season !== currentSeason) continue;
      totalItems++;
    }
  }

  var el = document.getElementById('landingStats');
  if (!el) return;
  el.innerHTML =
    '<div class="pub-stat"><span class="pub-stat-num">' +
    (DATA.roster || []).length +
    '</span><span class="pub-stat-label">Raiders</span></div>' +
    '<div class="pub-stat"><span class="pub-stat-num">' +
    totalItems +
    '</span><span class="pub-stat-label">Items This Tier</span></div>';
}

// Flat, current-season loot log backing buildRecentLoot()/renderLootFeed() (#279).
// Cached at build time so the search box can re-filter on every keystroke
// without re-walking DATA.lootCounts.
var _lootFeedAll = [];

function buildRecentLoot() {
  var loot = DATA.lootCounts || {};
  var roster = DATA.roster || [];
  var currentSeason = (DATA && DATA.seasonName) || '';

  var nameMap = {};
  for (var i = 0; i < roster.length; i++) {
    nameMap[normalise(roster[i].nameRealm)] = roster[i].nick || roster[i].firstName;
  }

  var all = [];
  var keys = Object.keys(loot);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var items = loot[key].items || [];
    var fallbackName = key.split('-')[0];
    var display = nameMap[key] || fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
    for (var j = 0; j < items.length; j++) {
      // DATA.lootCounts on the public page carries every season (ACTIVE_SEASON
      // is officer.js-only, see js/common.js) -- scope to the current tier
      // ourselves, same as the rest of the app (#279).
      if (currentSeason && items[j].season !== currentSeason) continue;
      all.push({
        player: display,
        item: items[j].name,
        difficulty: items[j].difficulty,
        date: items[j].date,
        _d: new Date(items[j].date)
      });
    }
  }

  all.sort(function (a, b) {
    return b._d - a._d;
  });
  _lootFeedAll = all;

  var el = document.getElementById('landingLoot');
  if (!el || !all.length) return;

  el.innerHTML =
    '<div class="pub-loot-title">Recent Loot</div>' +
    '<input type="text" id="lootSearchInput" class="roster-search-input pub-loot-search" ' +
    'placeholder="Search item name..." oninput="renderLootFeed()">' +
    '<div id="lootFeedRows"></div>';

  renderLootFeed();
}

// Renders _lootFeedAll into #lootFeedRows, filtered by the item-name search box.
// No player-name filter here on purpose -- see #279's proposed fix for why
// (individual loot history isn't meant to be publicly browsable, #99).
function renderLootFeed() {
  var rowsEl = document.getElementById('lootFeedRows');
  if (!rowsEl) return;

  var input = document.getElementById('lootSearchInput');
  var query = input ? normalise(input.value.trim()) : '';
  var rows;
  if (query) {
    rows = _lootFeedAll.filter(function (e) {
      return normalise(e.item).indexOf(query) !== -1;
    });
  } else {
    // No search yet: same 10-item preview as before search existed.
    rows = _lootFeedAll.slice(0, 10);
  }

  if (!rows.length) {
    rowsEl.innerHTML = '<div class="pub-loot-empty">No matching items.</div>';
    return;
  }

  var html = '';
  for (var m = 0; m < rows.length; m++) {
    var e = rows[m];
    var diffClass =
      e.difficulty === 'Mythic' ? 'diff-mythic' : e.difficulty === 'Heroic' ? 'diff-heroic' : 'diff-other';
    html +=
      '<div class="pub-loot-row">' +
      '<span class="pub-loot-player">' +
      e.player +
      '</span>' +
      '<span class="pub-loot-item">' +
      e.item +
      '</span>' +
      '<span class="pub-loot-diff ' +
      diffClass +
      '">' +
      e.difficulty +
      '</span>' +
      '<span class="pub-loot-date">' +
      e.date +
      '</span>' +
      '</div>';
  }
  rowsEl.innerHTML = html;
}

function buildProgression() {
  var raids = (DATA && DATA.raidProgression) || [];
  var el = document.getElementById('landingProgression');
  if (!el || !raids.length) return;

  var html = '<div class="prog-wrap">';
  for (var i = 0; i < raids.length; i++) {
    var raid = raids[i];
    var bosses = raid.bosses || [];
    var killed = bosses.filter(function (b) {
      return !!b.mythicDate;
    }).length;
    var total = bosses.length;
    var pct = total ? Math.round((killed / total) * 100) : 0;
    html += '<div class="prog-card">';
    html += '<div class="prog-header">';
    html += '<span class="prog-score">' + killed + '/' + total + ' M</span>';
    html += '<span class="prog-raid-name">' + _esc(raid.name || 'Unnamed Raid') + '</span>';
    html += '</div>';
    if (total) {
      html += '<div class="prog-bar-wrap"><div class="prog-bar" style="width:' + pct + '%"></div></div>';
    }
    var lastProgress = null;
    if (bosses.length) {
      html += '<div class="prog-bosses">';
      for (var j = 0; j < bosses.length; j++) {
        var boss = bosses[j];
        var killed_ = !!boss.mythicDate;
        var progress = _raidProgressFor(raid, boss);
        if (j === bosses.length - 1) lastProgress = progress;
        html += '<div class="prog-boss-item">';
        html += '<div class="prog-boss' + (killed_ ? ' prog-boss-killed' : '') + '">';
        html += '<span class="prog-boss-num">' + (j + 1) + '</span>';
        html += '<span class="prog-boss-name">' + _esc(boss.name || 'Unknown') + '</span>';
        if (killed_) html += '<span class="prog-boss-date">' + boss.mythicDate + '</span>';
        html += _renderPullsBadge(progress, killed_);
        html += '</div>';
        html += _renderHeroicRow(progress);
        html += '</div>';
      }
      html += '</div>';
    }
    // Prefers the live-synced Heroic kill date on the last boss (#629) over
    // the officer-typed raid.aotcDate -- once wcl-progression-sync sees the
    // Heroic kill, AOTC updates on its own with no manual "Fetch from WCL" +
    // Save round trip. Falls back to raid.aotcDate when the sync hasn't
    // caught up yet (or for seasons/raids synced before this existed).
    var aotcDate = (lastProgress && lastProgress.heroicDate) || raid.aotcDate;
    if (!raid.isMiniRaid && aotcDate) {
      html += '<div class="prog-aotc">AOTC <span class="prog-aotc-date">' + aotcDate + '</span></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// MM/DD/YYYY -- the format requested for this list specifically (differs
// from formatJoinDate()'s "Jul 12, 2026" style used elsewhere).
function _formatMDY(iso) {
  var parts = String(iso || '').split('-');
  if (parts.length !== 3) return iso || '';
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

// Plain-text progression history (#477), one line per archived season,
// newest first -- aggregated across every raid in that season (a season can
// have more than one raid tier) rather than broken out per raid. Every
// field here already lives on DATA.seasonHistory (written by
// archive_current_season()) -- no new table/column needed. Lives on its own
// History tab (js/roster.js showView()), built lazily when that tab opens,
// same as buildPublicRosterTab()/buildStreamersTab().
//
// mythicPulls/mythicBestPct (added to archive_current_season()'s per-boss
// snapshot) let this show where the team left off on an unkilled boss --
// a season-end snapshot, not a running history, so it only ever reflects
// progress as of whenever wcl-progression-sync last ran before archiving.
function buildSeasonRecap() {
  var history = (DATA && DATA.seasonHistory) || [];
  var el = document.getElementById('historyView');
  if (!el || !history.length) return;

  var html = '<div class="recap-title">Progression History</div><div class="recap-list">';
  for (var i = history.length - 1; i >= 0; i--) {
    var season = history[i];
    var raids = season.raids || [];
    var killed = 0;
    var total = 0;
    var lastKillDate = '';
    // Last unkilled boss with recorded pulls, in raid/boss order -- guilds
    // progress roughly in order, so this is what the team was actually
    // working on when the season ended, not just whichever boss happens to
    // sort last.
    var currentBoss = null;
    for (var j = 0; j < raids.length; j++) {
      var bosses = raids[j].bosses || [];
      for (var k = 0; k < bosses.length; k++) {
        total++;
        if (bosses[k].mythicDate) {
          killed++;
          if (bosses[k].mythicDate > lastKillDate) lastKillDate = bosses[k].mythicDate;
        } else if (bosses[k].mythicPulls) {
          currentBoss = bosses[k];
        }
      }
    }

    html += '<div class="recap-season-block">';
    html += '<div class="recap-season-name">' + _esc(season.name || 'Unnamed Season') + '</div>';
    html += '<div class="recap-season-score">' + killed + '/' + total + ' Mythic';
    if (lastKillDate) html += ' -- Last boss kill ' + _formatMDY(lastKillDate);
    html += '</div>';
    if (currentBoss) {
      html +=
        '<div class="recap-season-progress">Working on ' +
        _esc(currentBoss.name || '') +
        ' -- ' +
        currentBoss.mythicPulls +
        ' pull' +
        (currentBoss.mythicPulls === 1 ? '' : 's') +
        (currentBoss.mythicBestPct != null ? ', best ' + currentBoss.mythicBestPct + '%' : '') +
        '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// Public "Bios" tab (#477, second slice) -- team officer bio cards,
// officer-authored via officer.html's Officer Bios tab (js/tabs/tab-bios.js)
// and saved into team_settings.config.teamOfficerBios. Display order is
// array order (officers reorder with move up/down in the editor, not
// alphabetical/sorted here). Fields are self-contained on each entry (not
// looked up from DATA.roster) -- see tab-bios.js's header comment for why.
function buildBios() {
  var bios = (DATA && DATA.teamOfficerBios) || [];
  var el = document.getElementById('bioView');
  if (!el || !bios.length) return;

  var html = '<div class="bio-wrap">';
  for (var i = 0; i < bios.length; i++) {
    var entry = bios[i];
    var displayName = entry.name || 'Unnamed';
    html += '<div class="bio-card">';
    if (entry.imagePath) {
      html += '<img class="bio-photo" src="' + _escAttr(entry.imagePath) + '" alt="">';
    } else {
      html += '<div class="bio-photo bio-photo-fallback">' + _esc(displayName.slice(0, 2).toUpperCase()) + '</div>';
    }
    html +=
      '<div class="bio-name">' +
      _esc(displayName) +
      (entry.pronouns ? ' <span class="bio-pronouns">(' + _esc(entry.pronouns) + ')</span>' : '') +
      '</div>';
    if (entry.characterName) {
      html += '<div class="bio-charname">' + _esc(entry.characterName) + '</div>';
    }
    if (entry.title) {
      html += '<div class="bio-title">' + _esc(entry.title) + '</div>';
    }
    if (entry.classKey) {
      html +=
        '<span class="badge badge-class" style="' +
        classBadgeStyle(entry.classKey) +
        '">' +
        _esc(entry.spec || entry.classKey) +
        '</span>';
    }
    if (entry.bio) {
      html += '<div class="bio-text">' + _esc(entry.bio) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// Public About tab's Guild sub-tab (#577) -- guild officer bio cards, same
// shape/editor pattern as buildBios() above but a separate list
// (team_settings.config.guildOfficerBios) since guild officers aren't
// necessarily this team's own officers.
function buildGuildBios() {
  var bios = (DATA && DATA.guildOfficerBios) || [];
  var el = document.getElementById('guildBioView');
  if (!el || !bios.length) return;

  var html = '<div class="bio-wrap">';
  for (var i = 0; i < bios.length; i++) {
    var entry = bios[i];
    var displayName = entry.name || 'Unnamed';
    html += '<div class="bio-card">';
    if (entry.imagePath) {
      html += '<img class="bio-photo" src="' + _escAttr(entry.imagePath) + '" alt="">';
    } else {
      html += '<div class="bio-photo bio-photo-fallback">' + _esc(displayName.slice(0, 2).toUpperCase()) + '</div>';
    }
    html +=
      '<div class="bio-name">' +
      _esc(displayName) +
      (entry.pronouns ? ' <span class="bio-pronouns">(' + _esc(entry.pronouns) + ')</span>' : '') +
      '</div>';
    if (entry.characterName) {
      html += '<div class="bio-charname">' + _esc(entry.characterName) + '</div>';
    }
    if (entry.title) {
      html += '<div class="bio-title">' + _esc(entry.title) + '</div>';
    }
    if (entry.classKey) {
      html +=
        '<span class="badge badge-class" style="' +
        classBadgeStyle(entry.classKey) +
        '">' +
        _esc(entry.spec || entry.classKey) +
        '</span>';
    }
    if (entry.bio) {
      html += '<div class="bio-text">' + _esc(entry.bio) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// _escAttr mirrors js/tabs/tab-season.js's helper (not loaded on index.html)
// -- HTML-attribute-safe escaping for the imagePath src.
function _escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// Prefers the id key when this boss carries a wclEncounterId (Season
// Settings' "Fetch from WCL" button sets one) -- immune to
// the boss's display name later being edited. Falls back to the
// zone+normalised-name key for manually-added bosses and rows saved before
// that field existed, same lookup this used exclusively before.
function _raidProgressFor(raid, boss) {
  var map = (DATA && DATA.raidProgress) || {};
  var zoneId = raid.wclZoneId;
  if (!zoneId || !boss) return null;
  if (boss.wclEncounterId != null) {
    var byId = map[zoneId + '|id|' + boss.wclEncounterId];
    if (byId) return byId;
  }
  if (!boss.name) return null;
  return map[zoneId + '|' + normalise(boss.name)] || null;
}

function _wclReportUrl(reportCode, fightId) {
  if (!reportCode) return '';
  var url = 'https://www.warcraftlogs.com/reports/' + encodeURIComponent(reportCode);
  if (fightId) url += '#fight=' + encodeURIComponent(fightId);
  return url;
}

// killed bosses: total pulls next to the existing kill date (matching WCL's
// own reports view, e.g. "Belo'ren, Child of Al'ar -- Pulls: 81"). Still
// in-progress: pulls plus best % remaining on the current best attempt.
// Either way, a report link (when the sync found one) jumps straight to
// that pull/kill on WCL.
function _renderPullsBadge(progress, killed) {
  if (!progress || progress.pulls == null) return '';
  var text = progress.pulls + (progress.pulls === 1 ? ' pull' : ' pulls');
  if (!killed && progress.bestPct != null) {
    text += ' -- best ' + progress.bestPct + '%';
  }
  var url = _wclReportUrl(progress.reportCode, progress.fightId);
  if (url) {
    return '<a class="prog-boss-pulls" href="' + url + '" target="_blank" rel="noopener">' + _esc(text) + '</a>';
  }
  return '<span class="prog-boss-pulls">' + _esc(text) + '</span>';
}

// Heroic counterpart to _renderPullsBadge() (#629) -- same pulls/best-%/
// report-link shape, plus its own kill date (Heroic isn't gated behind the
// officer-confirmed boss.mythicDate the Mythic row uses; it's shown purely
// from the live sync since there's no equivalent manually-saved field to
// prefer). Renders as its own line below the Mythic row rather than inside
// it -- see the .prog-boss-item wrapper in buildProgression().
function _renderHeroicRow(progress) {
  if (!progress || (progress.heroicPulls == null && !progress.heroicDate)) return '';
  var killed = !!progress.heroicDate;
  var text = '';
  if (progress.heroicPulls != null) {
    text = progress.heroicPulls + (progress.heroicPulls === 1 ? ' pull' : ' pulls');
    if (!killed && progress.heroicBestPct != null) {
      text += ' -- best ' + progress.heroicBestPct + '%';
    }
  }
  var url = _wclReportUrl(progress.heroicReportCode, progress.heroicFightId);
  var html = '<div class="prog-boss-heroic' + (killed ? ' prog-boss-heroic-killed' : '') + '">';
  html += '<span class="prog-boss-heroic-label">H</span>';
  if (killed) html += '<span class="prog-boss-heroic-date">' + _esc(progress.heroicDate) + '</span>';
  if (text) {
    html += url
      ? '<a class="prog-boss-heroic-pulls" href="' + url + '" target="_blank" rel="noopener">' + _esc(text) + '</a>'
      : '<span class="prog-boss-heroic-pulls">' + _esc(text) + '</span>';
  }
  html += '</div>';
  return html;
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Called by discord.js when a stored session is successfully validated on page load.
// officer-quick-actions.js (loaded before this file) also wants this hook -- only
// one function named onDiscordSessionRestored can exist in the global scope, and
// this file's declaration is the one that wins since it loads last, so it has to
// call _qaRefresh() itself (#371) or the officer bar/player selector/claim prompt
// silently never react to a restored session.
function onDiscordSessionRestored(session) {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  if (session && session.nameRealm && sessionStorage.getItem('wga_open_profile')) {
    sessionStorage.removeItem('wga_open_profile');
    autoOpenClaimedProfile(session.nameRealm);
  }
  _resolveHashProfile(session);
}

// Same last-loaded-wins collision as onDiscordSessionRestored above, this time
// with officer-quick-actions.js's onDiscordInitNoSession -- shadow it here and
// call _qaRefresh() ourselves so anonymous visitors still get its officer
// bar/player selector/claim prompt reset, then reject any pending #profile/<name>
// deep-link since there's no session to own it (#517).
function onDiscordInitNoSession() {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  _resolveHashProfile(null);
}

// URL-hash profile deep-link target (#517), set by bootRosterApp() when the
// page loads on '#profile/<name>' -- can't be rendered until the Discord
// session resolves, since only the profile's owner or an officer may view it
// via URL (unlike the "View My Profile" button, a hand-edited URL is reachable
// by anyone, so this can't reuse renderProfile()'s no-ownership-check default).
var _pendingHashProfile = null;

function _resolveHashProfile(session) {
  if (!_pendingHashProfile) return;
  var target = _pendingHashProfile;
  _pendingHashProfile = null;
  var isOwnProfile = session && session.nameRealm && normalise(session.nameRealm.split('-')[0]) === normalise(target);
  var isOfficerViewer = session && (session.isOfficer || session.isAdmin);
  if (!isOwnProfile && !isOfficerViewer) {
    setViewHash('');
    return;
  }
  var sel = document.getElementById('playerSelect');
  if (sel) sel.value = target;
  showView('profile');
  renderProfile(target, 'landing');
}

// Auto-open the claimed character's profile after Discord login / session restore.
function autoOpenClaimedProfile(nameRealm) {
  if (!nameRealm || !window.DATA) return;
  var firstName = nameRealm.split('-')[0].trim();
  var sel = document.getElementById('playerSelect');
  if (!sel) return;
  // Confirm the character is actually in the current roster dropdown
  var found = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === firstName) {
      found = true;
      break;
    }
  }
  if (!found) return;
  sel.value = firstName;
  showView('profile');
  renderProfile(firstName, 'landing');
}

// Boot -- maintenance mode gates loadData() entirely, before any data loads.
// News is a plain static file fetch (news.json), unrelated to team data, so it
// loads independently and isn't gated by maintenance mode.
function bootRosterApp() {
  if (typeof loadNews === 'function') loadNews();
  checkMaintenanceMode().then(function (maint) {
    if (maint.enabled) {
      showMaintenanceBanner(maint.message);
      return;
    }
    loadData(
      function () {
        // officer.html's ACTIVE_SEASON (js/common.js) is kept in sync with the
        // live season by officer.js's populateSeasonSelector() -- this page
        // never loads officer.js (no season dropdown here), so without this
        // it stays stuck at its null ("All Seasons") default forever, and
        // every player's profile card silently shows career totals mislabeled
        // "this tier" for Items Received/attendance instead of the current
        // season's.
        ACTIVE_SEASON = (DATA && DATA.seasonName) || null;
        populateDropdown();
        buildPublicStats();
        buildProgression();
        buildStreamWidget();
        renderExternalWclLink();
        // Deep-link support for officer.html's nav (#354) -- its Roster/Streams/Sign
        // Up/Help links point back at index.html since those views only exist here.
        // '#profile/<name>' (#517) is handled separately below since it can't be
        // shown until the Discord session resolves (self-or-officer check).
        var hashRaw = (location.hash || '').replace('#', '');
        var hashParts = hashRaw.split('/');
        var hashKey = hashParts[0];
        if (hashKey === 'profile' && hashParts[1]) {
          _pendingHashProfile = decodeURIComponent(hashParts[1]);
          showView('landing');
        } else {
          var hashView = {
            roster: 'roster',
            streams: 'streamers',
            signup: 'signup',
            history: 'history',
            about: 'about',
            news: 'news',
            help: 'help'
          }[hashKey];
          if (hashView === 'signup') showSignupView();
          else if (hashView) showView(hashView);
          else showView('landing');
        }
        // Init Discord session after core data is ready so the profile deep-link can
        // find the claimed character in the now-populated player dropdown.
        if (typeof initDiscordLogin === 'function') initDiscordLogin();
      },
      function () {
        buildPublicStats();
        buildProgression();
        buildRecentLoot();
        buildStreamWidget();
        var sel = document.getElementById('playerSelect');
        var profileWrap = document.getElementById('profileViewWrap');
        if (sel && sel.value && profileWrap && profileWrap.classList.contains('active')) {
          renderProfile(sel.value, 'landing');
        }
        var rosterWrap = document.getElementById('rosterViewWrap');
        if (rosterWrap && rosterWrap.classList.contains('active')) {
          buildIncomingRosterSection();
          showRosterSubTab(_rosterSubTab);
        }
        // guildOfficerBios is heavy-loaded (guild-wide, from site_settings) --
        // a raider who deep-links straight to #about could hit showView('about')
        // before it resolves, same risk buildIncomingRosterSection() above
        // handles for the Roster tab.
        var aboutWrap = document.getElementById('aboutViewWrap');
        if (aboutWrap && aboutWrap.classList.contains('active')) {
          buildGuildBios();
          showAboutSubTab(_aboutSubTab);
        }
      }
    );
  });
}

// Cold-landing team picker (see IS_COLD_LANDING, js/common.js). Shown instead of
// booting the app for whichever team happens to be the fallback default -- tries
// a claim-based auto-redirect first, falling back to manual team buttons so a
// raider on another team never silently lands on Phoenix's roster.
function showTeamPickerButtons() {
  var spinner = document.getElementById('teamPickerSpinner');
  var status = document.getElementById('teamPickerStatus');
  var list = document.getElementById('teamPickerList');
  if (spinner) spinner.style.display = 'none';
  if (status) status.style.display = 'none';
  if (!list) return;
  list.innerHTML = '';
  Object.keys(TEAMS).forEach(function (slug) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-gold team-picker-btn';
    btn.textContent = TEAMS[slug].name;
    btn.onclick = function () {
      sessionStorage.setItem('wga_team', slug);
      location.href = location.pathname + '?team=' + slug;
    };
    list.appendChild(btn);
  });
  list.style.display = 'flex';
}

function resolveColdLanding() {
  var screen = document.getElementById('teamPickerScreen');
  if (screen) screen.style.display = 'flex';
  if (!supabaseClient) {
    showTeamPickerButtons();
    return;
  }
  supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session) {
        showTeamPickerButtons();
        return;
      }
      // Same "auth_user_id only, no team_id filter" query as findClaimElsewhere
      // (js/discord.js) -- the RLS policy allows a member to read all their own
      // team_members rows, letting us find a claim on any team in one query.
      return supabaseClient
        .from('team_members')
        .select('team_id, players!players_team_member_id_fkey(name_realm)')
        .eq('auth_user_id', session.user.id)
        .then(function (res) {
          var rows = (res && res.data) || [];
          var claimedSlug = null;
          for (var i = 0; i < rows.length && !claimedSlug; i++) {
            var players = rows[i].players || [];
            if (!players.length || !players[0].name_realm) continue;
            Object.keys(TEAMS).forEach(function (slug) {
              if (!claimedSlug && TEAMS[slug].supabaseTeamId === rows[i].team_id) claimedSlug = slug;
            });
          }
          if (claimedSlug) {
            sessionStorage.setItem('wga_team', claimedSlug);
            location.href = location.pathname + '?team=' + claimedSlug;
          } else {
            showTeamPickerButtons();
          }
        });
    })
    .catch(function () {
      showTeamPickerButtons();
    });
}

if (typeof IS_COLD_LANDING !== 'undefined' && IS_COLD_LANDING) {
  resolveColdLanding();
} else {
  bootRosterApp();
}
