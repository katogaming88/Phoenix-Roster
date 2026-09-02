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
    'helpViewWrap',
    'boeViewWrap'
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
  if (name === 'boe') document.getElementById('boeViewWrap').classList.add('active');
  [
    'navHome',
    'navSignup',
    'navRoster',
    'navStreamers',
    'navHistory',
    'navAbout',
    'navNews',
    'navHelp',
    'navBoE'
  ].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeNav = {
    landing: 'navHome',
    profile: 'navHome',
    signup: 'navSignup',
    roster: 'navRoster',
    streamers: 'navStreamers',
    history: 'navHistory',
    about: 'navAbout',
    news: 'navNews',
    help: 'navHelp',
    boe: 'navBoE'
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

var ROSTER_ROLE_ORDER = ['Tank', 'Heal', 'Melee', 'Ranged'];
var ROSTER_ROLE_LABELS = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };

function roleColorVar(role) {
  return role === 'Tank'
    ? 'var(--tank)'
    : role === 'Heal'
      ? 'var(--heal)'
      : role === 'Ranged'
        ? 'var(--ranged)'
        : 'var(--melee)';
}

// Averages the 16 real gear slots (EQUIPMENT_SLOT_LABELS, js/common.js) out
// of whatever player_equipped_gear has synced for this player (#845's sync
// doesn't guarantee all 16 -- an empty/partial slot just isn't in the map).
// Deliberately NOT every key in the map: blizzard-gear-sync/index.ts writes
// a row for every item Blizzard's equipment endpoint returns, including
// SHIRT/TABARD -- averaging those in against the 16 real slots dragged the
// result well below a raider's actual equipped item level. Null (not 0) when
// nothing has synced yet, so callers can tell "no data" apart from a real
// average.
function averageItemLevel(playerId) {
  var gear = (window.DATA && DATA.equippedGearByPlayerId && DATA.equippedGearByPlayerId[playerId]) || null;
  if (!gear) return null;
  var total = 0;
  var count = 0;
  EQUIPMENT_SLOT_LABELS.forEach(function (pair) {
    var slot = pair[0];
    var lvl = gear[slot] && gear[slot].itemLevel;
    if (typeof lvl !== 'number' || lvl <= 0) return;
    total += lvl;
    count++;
    // A two-handed weapon leaves OFF_HAND empty (nothing equipped there, so
    // it's simply absent from the map) -- Blizzard's own average item level
    // still counts the 2H weapon twice rather than averaging over 15 slots,
    // so this matches the character panel/Armory number instead of running
    // low for anyone dual-wielding a big stick.
    if (slot === 'MAIN_HAND' && !(gear.OFF_HAND && typeof gear.OFF_HAND.itemLevel === 'number')) {
      total += lvl;
      count++;
    }
  });
  return count ? Math.round(total / count) : null;
}

// Roster rows are now the raider-lookup UI (#864) -- the Home page's
// separate "Look up a raider" dropdown card is gone, replaced by clicking a
// row here. #playerSelect stays in the DOM (hidden) purely as the existing
// selected-player state store this also keeps in sync.
function openRosterProfile(firstName) {
  var sel = document.getElementById('playerSelect');
  if (sel) sel.value = firstName;
  showView('profile');
  renderProfile(firstName, 'landing');
}

// targetId/summaryId default to the Roster tab's #rosterView/#rosterSummary
// -- kept as parameters (rather than hardcoded ids) so this can be mounted
// elsewhere without duplicating the function, as it briefly was on Home (#864).
function buildPublicRosterTab(targetId, summaryId) {
  var container = document.getElementById(targetId || 'rosterView');
  if (!container || !window.DATA || !DATA.roster) return;

  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [] };
  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    if (groups[p.role]) groups[p.role].push(p);
  }

  var html =
    '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th><th>Item Level</th></tr></thead><tbody>';

  for (var r = 0; r < ROSTER_ROLE_ORDER.length; r++) {
    var role = ROSTER_ROLE_ORDER[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html +=
      '<tr class="group-header"><td colspan="3">' + ROSTER_ROLE_LABELS[role] + ' (' + players.length + ')</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var player = players[j];
      var roleColor = roleColorVar(player.role);
      var dispName = player.nick || player.firstName;
      var ilvl = averageItemLevel(player.id);
      html +=
        '<tr class="player-row" tabindex="0" role="button" onclick="openRosterProfile(\'' +
        _esc(player.firstName) +
        "')\" onkeydown=\"if(event.key==='Enter'||event.key===' '){event.preventDefault();openRosterProfile('" +
        _esc(player.firstName) +
        '\');}">' +
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
        '<td>' +
        (ilvl != null
          ? '<span class="roster-ilvl">' + ilvl + '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
  buildRosterSummaryPanel(DATA.roster, summaryId);
}

// Right-rail composition summary (#864, inspired by Viserio's Group Hub
// roster panel) -- role counts, class breakdown and average/lowest item
// level across the current roster. Only rendered from the "Current Roster"
// sub-tab (buildPublicRosterTab); the Incoming/tentative list is a much
// smaller, still-forming group where a composition summary isn't useful.
function buildRosterSummaryPanel(players, summaryId) {
  var el = document.getElementById(summaryId || 'rosterSummary');
  if (!el) return;
  players = players || [];

  var roleCounts = { Tank: 0, Heal: 0, Melee: 0, Ranged: 0 };
  var classCounts = {};
  var ilvls = [];
  players.forEach(function (p) {
    if (roleCounts[p.role] != null) roleCounts[p.role]++;
    if (p.class) classCounts[p.class] = (classCounts[p.class] || 0) + 1;
    var lvl = averageItemLevel(p.id);
    if (lvl != null) ilvls.push(lvl);
  });

  var roleRows = ROSTER_ROLE_ORDER.map(function (role) {
    return (
      '<div class="roster-summary-row">' +
      '<span class="roster-summary-role-dot" style="background:' +
      roleColorVar(role) +
      ';"></span>' +
      '<span class="roster-summary-role-label">' +
      ROSTER_ROLE_LABELS[role] +
      '</span>' +
      '<span class="roster-summary-role-count">' +
      roleCounts[role] +
      '</span>' +
      '</div>'
    );
  }).join('');

  var classRows = Object.keys(classCounts)
    .sort(function (a, b) {
      return classCounts[b] - classCounts[a];
    })
    .map(function (cls) {
      return (
        '<div class="roster-summary-row">' +
        '<span class="roster-summary-role-dot" style="background:' +
        classColor(cls) +
        ';"></span>' +
        '<span class="roster-summary-role-label">' +
        cls +
        '</span>' +
        '<span class="roster-summary-role-count">' +
        classCounts[cls] +
        '</span>' +
        '</div>'
      );
    })
    .join('');

  var avgIlvl = ilvls.length
    ? Math.round(
        ilvls.reduce(function (a, b) {
          return a + b;
        }, 0) / ilvls.length
      )
    : null;
  var lowIlvl = ilvls.length ? Math.min.apply(null, ilvls) : null;

  el.innerHTML =
    '<div class="roster-summary-title">Roster Summary</div>' +
    '<div class="roster-summary-total">' +
    players.length +
    ' <span class="roster-summary-total-label">Raiders</span></div>' +
    '<div class="roster-summary-section">' +
    roleRows +
    '</div>' +
    (avgIlvl != null
      ? '<div class="roster-summary-section roster-summary-ilvl">' +
        '<div class="roster-summary-row"><span class="roster-summary-role-label">Average Item Level</span><span class="roster-summary-role-count roster-ilvl">' +
        avgIlvl +
        '</span></div>' +
        '<div class="roster-summary-row"><span class="roster-summary-role-label">Lowest</span><span class="roster-summary-role-count">' +
        lowIlvl +
        '</span></div>' +
        '</div>'
      : '') +
    '<div class="roster-summary-section-label">Classes</div>' +
    '<div class="roster-summary-section">' +
    classRows +
    '</div>';
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

// Compact "N/M H" (or "M" once AOTC'd) summary of the first/current raid in
// DATA.raidProgression, for the Home stat row (#864) -- same
// heroic-vs-mythic-focus rule as buildProgression()'s per-raid header, just
// condensed to one tile instead of the full boss-by-boss card. Available
// from the core payload (no equipped-gear/heavy-batch wait), unlike the Avg
// Item Level tile next to it.
function _currentProgressSummary() {
  var raids = (DATA && DATA.raidProgression) || [];
  if (!raids.length) return null;
  var raid = raids[0];
  var bosses = raid.bosses || [];
  var total = bosses.length;
  if (!total) return null;

  var heroicKilled = 0;
  var mythicKilled = 0;
  var lastProgress = null;
  for (var h = 0; h < bosses.length; h++) {
    var p = _raidProgressFor(raid, bosses[h]);
    if (p && p.heroicDate) heroicKilled++;
    if (bosses[h].mythicDate) mythicKilled++;
    if (h === bosses.length - 1) lastProgress = p;
  }
  var aotcDate = (lastProgress && lastProgress.heroicDate) || raid.aotcDate;
  var showHeroic = !raid.isMiniRaid && !aotcDate;
  var barKilled = showHeroic ? heroicKilled : mythicKilled;
  return { value: barKilled + '/' + total + (showHeroic ? ' H' : ' M'), label: _esc(raid.name || 'Progress') };
}

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

  var ilvls = (DATA.roster || [])
    .map(function (p) {
      return averageItemLevel(p.id);
    })
    .filter(function (v) {
      return v != null;
    });
  var avgIlvl = ilvls.length
    ? Math.round(
        ilvls.reduce(function (a, b) {
          return a + b;
        }, 0) / ilvls.length
      )
    : null;
  var progress = _currentProgressSummary();

  var html =
    '<div class="pub-stat"><span class="pub-stat-num">' +
    (DATA.roster || []).length +
    '</span><span class="pub-stat-label">Raiders</span></div>' +
    '<div class="pub-stat"><span class="pub-stat-num">' +
    totalItems +
    '</span><span class="pub-stat-label">Items This Tier</span></div>';
  if (avgIlvl != null) {
    html +=
      '<div class="pub-stat"><span class="pub-stat-num">' +
      avgIlvl +
      '</span><span class="pub-stat-label">Avg Item Level</span></div>';
  }
  if (progress) {
    html +=
      '<div class="pub-stat"><span class="pub-stat-num">' +
      progress.value +
      '</span><span class="pub-stat-label">' +
      progress.label +
      '</span></div>';
  }
  el.innerHTML = html;
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

// Placeholder-only (#864): visual test of a calendar/attendance-status
// widget on Home, above raid progression. There is no calendar module or
// real attendance-by-night data source behind this yet -- raid nights are
// hardcoded (this team's usual Tue/Thu/Sun) and each one's status is a
// deterministic (not random, so it doesn't reshuffle on every re-render)
// fake value standing in for the signed-in viewer's own reply -- one status
// per raid night, not the whole roster's, since that's what a real "your
// attendance" calendar would show. A real calendar would obviously be far
// more detailed than this (multi-month, everyone's status, editable RSVPs,
// clicking a date opens that day's detail, etc.) -- this is only sized for
// a Home-page glance. Delete this and its #landingCalendar mount once a
// real calendar exists, or wire it up to that instead.
var _MOCK_RAID_WEEKDAYS = [2, 4, 0]; // Tue, Thu, Sun (Date#getDay(): Sun=0)
var _MOCK_STATUS_LABELS = { present: 'Present', absent: 'Absent', tentative: 'No Response' };
var _MOCK_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function _mockStatusFor(seed) {
  var m = seed % 9;
  if (m === 0 || m === 4) return 'absent';
  if (m === 7) return 'tentative';
  return 'present';
}

function buildCalendarPreview() {
  var el = document.getElementById('landingCalendar');
  if (!el) return;

  var today = new Date();
  var year = today.getFullYear();
  var month = today.getMonth();
  var monthLabel = today.toLocaleString('en-US', { month: 'long' }) + ' ' + year;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var firstWeekday = new Date(year, month, 1).getDay();

  var weekdayHtml = _MOCK_WEEKDAY_LABELS
    .map(function (d) {
      return '<span class="mini-cal-weekday">' + d + '</span>';
    })
    .join('');

  var cellsHtml = '';
  for (var pad = 0; pad < firstWeekday; pad++) {
    cellsHtml += '<div class="mini-cal-day mini-cal-day-pad"></div>';
  }
  var rosterCount = (window.DATA && DATA.roster && DATA.roster.length) || 0;
  for (var day = 1; day <= daysInMonth; day++) {
    var weekday = new Date(year, month, day).getDay();
    var isRaidDay = _MOCK_RAID_WEEKDAYS.indexOf(weekday) !== -1;
    var isToday = day === today.getDate();
    var statusHtml = '';
    var countHtml = '';
    if (isRaidDay) {
      var status = _mockStatusFor(day);
      // aria-label (not just title): status is conveyed by color alone
      // otherwise, and title's hover-only reveal doesn't reach keyboard or
      // touch users. role="img" so it's announced as one thing with that
      // name instead of being skipped as an empty, presentational span.
      statusHtml =
        '<span class="calendar-status calendar-status-' +
        status +
        '" role="img" aria-label="' +
        _MOCK_STATUS_LABELS[status] +
        '" title="' +
        _MOCK_STATUS_LABELS[status] +
        '"></span>';
      // Attending/rostered, like the "30/30" a real calendar shows per raid
      // night -- rosterCount is real (DATA.roster.length), the attending
      // side is still mocked (deterministic, not random) same as status.
      if (rosterCount) {
        var attending = Math.max(0, rosterCount - (day % 4));
        countHtml = '<span class="mini-cal-daycount">' + attending + '/' + rosterCount + '</span>';
      }
    }
    cellsHtml +=
      '<div class="mini-cal-day' +
      (isRaidDay ? ' mini-cal-day-raid' : '') +
      (isToday ? ' mini-cal-day-today' : '') +
      '"><span class="mini-cal-daynum">' +
      day +
      '</span>' +
      countHtml +
      statusHtml +
      '</div>';
  }

  var legendHtml = Object.keys(_MOCK_STATUS_LABELS)
    .map(function (status) {
      return (
        '<span class="calendar-legend-item"><span class="calendar-status calendar-status-' +
        status +
        '" aria-hidden="true"></span>' +
        _MOCK_STATUS_LABELS[status] +
        '</span>'
      );
    })
    .join('');

  el.innerHTML =
    '<div class="pub-loot-title">Calendar <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;">(mock -- no calendar data yet)</span></div>' +
    '<div class="mini-cal">' +
    '<div class="mini-cal-header">' +
    monthLabel +
    '</div>' +
    '<div class="mini-cal-weekdays">' +
    weekdayHtml +
    '</div>' +
    '<div class="mini-cal-grid">' +
    cellsHtml +
    '</div>' +
    '</div>' +
    '<div class="calendar-legend">' +
    legendHtml +
    '</div>';
}

function _renderProgBossRow(raid, boss, num) {
  var killed_ = !!boss.mythicDate;
  var progress = _raidProgressFor(raid, boss);
  var html = '<div class="prog-boss-item">';
  html += '<div class="prog-boss' + (killed_ ? ' prog-boss-killed' : '') + '">';
  html += '<span class="prog-boss-num">' + num + '</span>';
  // title: the 2-column boss-list layout (_renderProgBosses()) truncates a
  // long name with an ellipsis at half-card width -- this is how the full
  // name stays reachable there without widening the column.
  html +=
    '<span class="prog-boss-name" title="' +
    _esc(boss.name || 'Unknown') +
    '">' +
    _esc(boss.name || 'Unknown') +
    '</span>';
  if (killed_) html += '<span class="prog-boss-date">' + boss.mythicDate + '</span>';
  html += _renderPullsBadge(progress, killed_);
  html += '</div>';
  html += _renderHeroicRow(progress);
  html += '</div>';
  return html;
}

// 4 (or 5+ bosses/tier) short-tier raid, one column. Once a raid is bigger
// than that it splits into 2 columns -- 4 bosses each up to 8 total, 5 each
// beyond that -- filled top-to-bottom left column first (1-4/1-5), then the
// right column (5-8/6-10+), rather than zigzagging left/right in kill order.
function _renderProgBosses(raid, bosses) {
  var colSize = bosses.length > 8 ? 5 : 4;
  if (bosses.length <= 4) {
    var rows = bosses
      .map(function (boss, j) {
        return _renderProgBossRow(raid, boss, j + 1);
      })
      .join('');
    return '<div class="prog-bosses">' + rows + '</div>';
  }

  var col1 = bosses.slice(0, colSize);
  var col2 = bosses.slice(colSize);
  var col1Html = col1
    .map(function (boss, j) {
      return _renderProgBossRow(raid, boss, j + 1);
    })
    .join('');
  var col2Html = col2
    .map(function (boss, j) {
      return _renderProgBossRow(raid, boss, colSize + j + 1);
    })
    .join('');
  return (
    '<div class="prog-bosses-grid">' +
    '<div class="prog-bosses">' +
    col1Html +
    '</div>' +
    '<div class="prog-bosses">' +
    col2Html +
    '</div>' +
    '</div>'
  );
}

function buildProgression() {
  var raids = (DATA && DATA.raidProgression) || [];
  var el = document.getElementById('landingProgression');
  if (!el || !raids.length) return;

  var html = '<div class="prog-wrap">';
  for (var i = 0; i < raids.length; i++) {
    var raid = raids[i];
    var bosses = raid.bosses || [];
    var total = bosses.length;
    var mythicKilled = bosses.filter(function (b) {
      return !!b.mythicDate;
    }).length;

    // A first pass purely to know each boss's live progress before the
    // header renders (heroicKilled count, and the last boss's heroic date
    // for AOTC) -- the per-boss loop below looks each of these up again,
    // which is a cheap map read, not worth threading through as state.
    var heroicKilled = 0;
    var lastProgress = null;
    for (var h = 0; h < bosses.length; h++) {
      var p = _raidProgressFor(raid, bosses[h]);
      if (p && p.heroicDate) heroicKilled++;
      if (h === bosses.length - 1) lastProgress = p;
    }
    // Prefers the live-synced Heroic kill date on the last boss (#629) over
    // the officer-typed raid.aotcDate -- once wcl-progression-sync sees the
    // Heroic kill, AOTC updates on its own with no manual "Fetch from WCL" +
    // Save round trip. Falls back to raid.aotcDate when the sync hasn't
    // caught up yet (or for seasons/raids synced before this existed).
    var aotcDate = (lastProgress && lastProgress.heroicDate) || raid.aotcDate;

    // Before AOTC, the header/bar track Heroic progress (what the team is
    // actually working on, including a brand-new raid with zero kills in
    // either difficulty -- it's still a Heroic clear waiting to happen, not
    // a Mythic one) instead of a static "0/x M" that never moves until the
    // guild starts pulling Mythic weeks later. Shows Mythic alongside it
    // once mythic pulls exist, since guilds commonly start Mythic on farmed
    // Heroic bosses before finishing the Heroic clear. Once AOTC is
    // achieved, switches to Mythic-only, permanently (mirrors the AOTC
    // badge's own !raid.isMiniRaid gate -- mini-raids have no AOTC concept,
    // so they always show Mythic-only).
    var showHeroic = !raid.isMiniRaid && !aotcDate;
    var barKilled = showHeroic ? heroicKilled : mythicKilled;
    var pct = total ? Math.round((barKilled / total) * 100) : 0;

    html += '<div class="prog-card">';
    html += '<div class="prog-header">';
    if (showHeroic) {
      html += '<span class="prog-score-combo">';
      html += '<span class="prog-score prog-score-heroic">' + heroicKilled + '/' + total + ' H</span>';
      if (mythicKilled > 0) {
        html += '<span class="prog-score">' + mythicKilled + '/' + total + ' M</span>';
      }
      html += '</span>';
    } else {
      html += '<span class="prog-score">' + mythicKilled + '/' + total + ' M</span>';
    }
    html += '<span class="prog-raid-name">' + _esc(raid.name || 'Unnamed Raid') + '</span>';
    html += '</div>';
    if (total) {
      html +=
        '<div class="prog-bar-wrap"><div class="prog-bar' +
        (showHeroic ? ' prog-bar-heroic' : '') +
        '" style="width:' +
        pct +
        '%"></div></div>';
    }
    if (bosses.length) {
      html += _renderProgBosses(raid, bosses);
    }
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
  // A boss with 0 Mythic pulls and no kill has nothing to say here -- showing
  // "0 pulls" reads as a bare duplicate of the real Heroic pull count on the
  // row right below it (_renderHeroicRow) while the team is still working
  // Heroic and hasn't touched Mythic at all yet.
  if (!killed && progress.pulls === 0) return '';
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
  // The BoE card is built before initDiscordLogin() runs, so it only ever saw
  // the localStorage cache; re-resolve now that the session is real (#767).
  // Called from here, not js/boe.js, for the same shadowing reason as above.
  if (typeof refreshBoeIdentity === 'function') refreshBoeIdentity();
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

// Optional 3rd hash segment, '#profile/<name>/<subtab>' -- e.g. the bot's
// missing-setup DM links straight to '.../wishlist' (wga-raid-bot#8) instead
// of landing on Overview and making the raider click again. Applied after
// renderProfile() below rather than folded into it, since renderProfile()
// itself has no subtab parameter and always defaults new views to Overview.
var _pendingHashProfileSubTab = null;

function _resolveHashProfile(session) {
  if (!_pendingHashProfile) return;
  var target = _pendingHashProfile;
  var subTab = _pendingHashProfileSubTab;
  _pendingHashProfile = null;
  _pendingHashProfileSubTab = null;
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
  // Only switch if the target tab's button actually rendered -- renderProfile()
  // (js/common.js) omits Bis/Wishlist entirely when the team's 'bis' feature
  // flag is off, and showProfileSubTab() has no feature-flag awareness of its
  // own, it just toggles elements by id. Without this check a stale deep link
  // to '.../wishlist' on such a team would hide Overview for a tab that was
  // never rendered, leaving the profile body blank.
  var subTabId = subTab && 'profileTab' + subTab.charAt(0).toUpperCase() + subTab.slice(1);
  if (subTab && PROFILE_SUB_TABS.indexOf(subTab) !== -1 && document.getElementById(subTabId)) {
    showProfileSubTab(subTab);
  }
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
        buildCalendarPreview();
        buildProgression();
        buildStreamWidget();
        renderExternalWclLink();
        // Before the hash routing below, so a #boe deep link on a team with
        // the flag off finds the card (and its nav button) already hidden.
        initBoeCard();
        // Deep-link support for officer.html's nav (#354) -- its Roster/Streams/Sign
        // Up/Help links point back at index.html since those views only exist here.
        // '#profile/<name>' (#517) is handled separately below since it can't be
        // shown until the Discord session resolves (self-or-officer check).
        var hashRaw = (location.hash || '').replace('#', '');
        var hashParts = hashRaw.split('/');
        var hashKey = hashParts[0];
        if (hashKey === 'profile' && hashParts[1]) {
          _pendingHashProfile = decodeURIComponent(hashParts[1]);
          _pendingHashProfileSubTab = hashParts[2] ? decodeURIComponent(hashParts[2]) : null;
          showView('landing');
        } else {
          var hashView = {
            roster: 'roster',
            streams: 'streamers',
            signup: 'signup',
            history: 'history',
            about: 'about',
            news: 'news',
            help: 'help',
            boe: 'boe'
          }[hashKey];
          if (hashView === 'signup') showSignupView();
          else if (hashView === 'boe') showBoeView();
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
          // Re-render (not just re-show): equippedGearPromise -- the item
          // levels in the roster table/summary panel -- only resolves in
          // this heavy batch, so a raider already sitting on the Roster tab
          // when it lands needs the table rebuilt, not just its sub-tab
          // visibility re-applied.
          buildPublicRosterTab();
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

// Cold-landing handling (see IS_COLD_LANDING, js/common.js). This page is one
// team's page, and a visitor who has not said which team they want has not
// asked for it, so booting it for whichever team happens to be the fallback
// default is wrong. Try a claim-based auto-redirect first; anyone that does not
// resolve goes to the guild page.
//
// Until #779 the fallback was a modal with one button per team. guild.html
// answers the same question and a good deal more, so the modal is gone rather
// than duplicated. Note the auto-redirect above it is unchanged: a raider with
// a single claimed team still lands on their own roster, and only visitors who
// used to get the bare button list end up on the guild page.
function sendToGuildPage() {
  // replace(), not href: leaving index.html in history means Back from the
  // guild page lands here and redirects forward again.
  location.replace('guild.html');
}

function resolveColdLanding() {
  if (!supabaseClient) {
    sendToGuildPage();
    return;
  }
  supabaseClient.auth
    .getSession()
    .then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session) {
        sendToGuildPage();
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
            sendToGuildPage();
          }
        });
    })
    .catch(function () {
      sendToGuildPage();
    });
}

if (typeof IS_COLD_LANDING !== 'undefined' && IS_COLD_LANDING) {
  resolveColdLanding();
} else {
  bootRosterApp();
}
