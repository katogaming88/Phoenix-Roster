// Officer roster tab: table, filters, add/remove player, player settings

// -- Roster writes (Supabase, #216) ------------------------------------------
//
// Roster reads still merge attendance/M+ fields from the Apps Script core
// payload (js/common.js fetchSupabaseRoster()), but every write below goes
// straight to Supabase: RLS already permits an officer's plain
// insert/update against `players` (no RPC needed for the write itself), and
// each write logs itself via writeAuditLog() (#214). GAS keeps its
// addPlayer/removePlayer/updatePlayerField handlers until this path is
// verified side by side (#216); nothing here calls them anymore.
//
// class/spec/role collapse into a single `class_spec_id` FK (role is derived
// from classes_specs.role, not stored), so unlike the old sheet, class and
// spec can't be written independently -- see docs/database-decisions.md. The
// Class dropdown only repopulates the Spec dropdown; the actual write fires
// from the single Player Settings Save button, along with Name/Realm,
// Joined Date, and Nickname if changed (officerSavePlayerSettings, #489).

function findRosterPlayer(nameRealm) {
  return (
    (DATA &&
      DATA.roster.find(function (p) {
        return p.nameRealm === nameRealm;
      })) ||
    null
  );
}

// Runs a Supabase write promise, updating a status message element the same
// way the old jsonpRequest callbacks did ('Saving...' -> 'Saved.'/'Failed to
// save.', cleared after 2s). Resolves true/false so callers can gate further
// local state mutation on whether the write actually succeeded.
function runRosterWrite(promise, msgEl) {
  return promise
    .then(function () {
      if (msgEl) msgEl.textContent = 'Saved.';
      return true;
    })
    .catch(function (err) {
      console.warn('Roster write failed.', err);
      if (msgEl) msgEl.textContent = 'Failed to save.';
      return false;
    })
    .then(function (ok) {
      if (msgEl) {
        setTimeout(function () {
          if (msgEl) msgEl.textContent = '';
        }, 2000);
      }
      return ok;
    });
}

var ROSTER_FIELD_COLUMN = {
  isTrial: 'is_trial',
  isBench: 'is_bench',
  isBackupTank: 'is_backup_tank',
  isBackupHealer: 'is_backup_healer',
  joinDate: 'join_date',
  mPlusExcluded: 'm_plus_excluded',
  officerNote: 'officer_notes',
  nick: 'nickname'
};
var ROSTER_FIELD_AUDIT_LABEL = {
  isTrial: 'Trial Status Changed',
  isBench: 'Bench Status Changed',
  isBackupTank: 'Backup Tank Status Changed',
  isBackupHealer: 'Backup Healer Status Changed',
  joinDate: 'Join Date Changed',
  mPlusExcluded: 'M+ Exclusion Toggled',
  officerNote: 'Officer Note Changed',
  nick: 'Nickname Changed'
};
// Fields that store their raw value as-is rather than coercing to boolean.
var ROSTER_FIELD_RAW_VALUE = { joinDate: true, officerNote: true, nick: true };

function rosterFieldAuditDetail(field, value) {
  if (field === 'isTrial') return value ? 'Trial added' : 'Trial removed';
  if (field === 'isBench') return value ? 'Moved to bench' : 'Removed from bench';
  if (field === 'isBackupTank') return value ? 'Marked as backup tank' : 'Backup tank removed';
  if (field === 'isBackupHealer') return value ? 'Marked as backup healer' : 'Backup healer removed';
  if (field === 'joinDate') return 'Changed to ' + value;
  if (field === 'mPlusExcluded') return value ? 'Excluded' : 'Exclusion removed';
  if (field === 'officerNote') return value ? 'Changed to ' + value : 'Cleared';
  if (field === 'nick') return value ? 'Changed to ' + value : 'Cleared';
  return null;
}

// Targeted update for the fields that map 1:1 onto a players column
// (isTrial/isBench/joinDate/officerNote). class/spec go through
// updateClassSpecSupabase instead, since they resolve to one FK together.
function updateRosterFieldSupabase(nameRealm, field, value) {
  var player = findRosterPlayer(nameRealm);
  var column = ROSTER_FIELD_COLUMN[field];
  if (!player || !player.id || !column) return Promise.reject(new Error('Unknown player or field.'));
  var payload = {};
  payload[column] = ROSTER_FIELD_RAW_VALUE[field] ? value || null : !!value;
  return supabaseClient
    .from('players')
    .update(payload)
    .eq('id', player.id)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog(ROSTER_FIELD_AUDIT_LABEL[field], 'players', player.id, rosterFieldAuditDetail(field, value));
    });
}

var statItemsDiff = 'all';

// Same colors as RANK_PILL_DIFF_COLORS (js/common.js) -- reused here instead
// of inventing a new pair, so "Heroic = green, Mythic = purple" reads the
// same everywhere it shows up (rank pills, BiS-received badges, this).
var STAT_DIFF_BUTTONS = [
  { value: 'all', label: 'All', c: 'var(--gold-light)', bg: 'rgba(214,163,68,0.18)', bd: 'var(--gold-dim)' },
  { value: 'heroic', label: 'Hero', c: 'var(--heal)', bg: 'rgba(72,187,120,0.18)', bd: 'rgba(72,187,120,0.4)' },
  { value: 'mythic', label: 'Myth', c: 'var(--ranged)', bg: 'rgba(191,140,255,0.18)', bd: 'rgba(191,140,255,0.4)' }
];

function setStatItemsDiff(diff) {
  statItemsDiff = diff;
  buildStatsBar();
}

function buildStatsBar() {
  var roster = DATA.roster || [];
  var raiders = roster.filter(function (p) {
    return !p.isBench;
  });
  var totalAttend = 0,
    attendCount = 0,
    bisCount = 0;
  // attendanceKnown is separate from attendCount: a roster where every player
  // is genuinely at 0% still has a real average, but a roster whose attendance
  // has not loaded has none, and reporting 0 for the second is the confident
  // wrong number this change removes (#694).
  var attendanceKnown = !!(DATA && DATA.rawAttendanceData);
  for (var i = 0; i < raiders.length; i++) {
    var p = raiders[i];
    var pct = parseInt(getDisplayAttendancePct(p));
    if (!isNaN(pct)) {
      totalAttend += pct;
      attendCount++;
    }
  }
  // BiS List and Wishlists Completed count the full roster (bench included)
  // -- unlike Raiders/Avg Attendance/Items Distributed, which are about
  // active raid participation, gear prep is something bench players do too.
  for (var k = 0; k < roster.length; k++) {
    if (roster[k].bisLink) bisCount++;
  }
  var avgAttend = attendanceKnown && attendCount ? Math.round(totalAttend / attendCount) : null;
  var avgColor = attendColor(avgAttend);
  var avgAttendHtml = avgAttend === null ? '-' : avgAttend + '%';
  // DATA.lootCounts carries every season for the team (js/common.js
  // fetchSupabaseLoot has no season filter) -- count/heroicCount/mythicCount
  // are all-time aggregates, so scoping to the active season means walking
  // each entry's items[] and filtering by season ourselves, same as
  // buildRecentLoot() does on the public roster page.
  var totalItems = 0;
  var lootMap = DATA.lootCounts || {};
  var lootKeys = Object.keys(lootMap);
  var currentSeason = (DATA && DATA.seasonName) || '';
  for (var j = 0; j < lootKeys.length; j++) {
    var lootItems = (lootMap[lootKeys[j]] && lootMap[lootKeys[j]].items) || [];
    for (var m = 0; m < lootItems.length; m++) {
      if (currentSeason && lootItems[m].season !== currentSeason) continue;
      if (statItemsDiff === 'heroic' && lootItems[m].difficulty !== 'Heroic') continue;
      if (statItemsDiff === 'mythic' && lootItems[m].difficulty !== 'Mythic') continue;
      totalItems++;
    }
  }
  var diffTip =
    statItemsDiff === 'heroic'
      ? 'Heroic loot entries tracked'
      : statItemsDiff === 'mythic'
        ? 'Mythic loot entries tracked'
        : 'Total loot entries tracked across all difficulties';
  var diffButtonsHtml =
    '<div class="stat-diff-buttons">' +
    STAT_DIFF_BUTTONS.map(function (d) {
      var active = statItemsDiff === d.value;
      var style = active
        ? 'color:' + d.c + ';background:' + d.bg + ';border-color:' + d.bd + ';'
        : 'border-color:' + d.bd + ';';
      return (
        '<button class="stat-diff-btn" style="' +
        style +
        '" onclick="setStatItemsDiff(\'' +
        d.value +
        '\')">' +
        d.label +
        '</button>'
      );
    }).join('') +
    '</div>';

  // _teamItemPreferences (tab-priority.js) loads separately from the rest of
  // DATA -- null means its fetch hasn't resolved yet, not "zero incomplete".
  // Showing "-" until then avoids a misleading "all complete" flash, same
  // race #604/#605 fixed for the trial promo alert. renderWishlistIncomplete
  // Banner() (called from buildOfficerDashboard(), same as this) triggers
  // that fetch and re-calls buildStatsBar() once it resolves.
  var wishlistHtml;
  if (typeof _teamItemPreferences === 'undefined' || _teamItemPreferences === null) {
    wishlistHtml = '<div class="stat-value">-</div>';
  } else {
    var incomplete = getIncompleteWishlists(roster).count;
    var wishlistCompleted = roster.length - incomplete;
    wishlistHtml =
      '<div class="stat-value">' +
      wishlistCompleted +
      '<span style="font-size:1.2rem;color:var(--text-muted);">/' +
      roster.length +
      '</span></div>';
  }

  document.getElementById('officerStats').innerHTML =
    '<div class="stat-card" data-tip="Full roster, including bench"><div class="stat-value">' +
    roster.length +
    '</div><div class="stat-label">Raiders</div></div>' +
    '<div class="stat-card" data-tip="Average attendance % across active raiders this season"><div class="stat-value" style="color:' +
    avgColor +
    ';">' +
    avgAttendHtml +
    '</div><div class="stat-label">Avg Attendance</div></div>' +
    '<div class="stat-card" style="position:relative;" data-tip="' +
    diffTip +
    '">' +
    diffButtonsHtml +
    '<div class="stat-value">' +
    totalItems +
    '</div><div class="stat-label">Items Distributed</div></div>' +
    '<div class="stat-card" data-tip="Roster members (incl. bench) with an approved BiS list link on file"><div class="stat-value">' +
    bisCount +
    '<span style="font-size:1.2rem;color:var(--text-muted);">/' +
    roster.length +
    '</span></div><div class="stat-label">BiS List</div></div>' +
    '<div class="stat-card" data-tip="Roster members (incl. bench) with every wishlist slot tagged (or covered by the officer BiS list)">' +
    wishlistHtml +
    '<div class="stat-label">Wishlists Completed</div></div>';
}

function toggleFilter(name) {
  activeFilters[name] = !activeFilters[name];
  document.getElementById('chip-' + name).classList.toggle('active', activeFilters[name]);
  buildRosterTable();
}

function toggleRole(role) {
  var current = activeFilters.role;
  activeFilters.role = current === role ? null : role;
  ['Tank', 'Heal', 'Melee', 'Ranged'].forEach(function (r) {
    document.getElementById('chip-role-' + r).classList.toggle('active', activeFilters.role === r);
  });
  buildRosterTable();
}

function toggleSort(key) {
  if (activeSort.key === key) {
    activeSort.dir *= -1;
  } else {
    activeSort.key = key;
    activeSort.dir = 1;
  }
  ['name', 'attendance', 'items'].forEach(function (k) {
    var chip = document.getElementById('chip-sort-' + k);
    var isActive = activeSort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent =
      { name: 'Name', attendance: 'Attendance', items: 'Items' }[k] +
      (isActive ? (activeSort.dir === 1 ? ' ^' : ' v') : '');
  });
  buildRosterTable();
}

// Committed scoring.performance_score per player for the roster's Recent
// Score column -- the exact number generate_priority_order() reads for DPS
// priority, not the live/uncommitted WCL preview the Scoring tab's own
// "Refresh from WCL" shows. Officer-only, so (like _teamItemPreferences in
// tab-priority.js) this stays out of the core DATA load and is fetched here
// instead, once per season per session.
var _teamScoringCache = null; // { season, byPlayerId: { [player_id]: performance_score } }

function _fetchTeamScoringIfNeeded() {
  if (!supabaseClient) return;
  var seasonCode = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
  if (!seasonCode || (_teamScoringCache && _teamScoringCache.season === seasonCode)) return;
  // scoring has no team_id column (it's scoped by player_id only, and
  // "Public read scoring" has no team restriction at the RLS level either)
  // -- team-scoping has to happen here, against this team's own roster ids.
  var playerIds = (DATA.roster || [])
    .map(function (p) {
      return p.id;
    })
    .filter(function (id) {
      return id != null;
    });
  if (!playerIds.length) return;

  supabaseClient
    .from('scoring')
    .select('player_id, performance_score')
    .in('player_id', playerIds)
    .eq('season', seasonCode)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase scoring query failed.', result.error.message);
        return;
      }
      var byPlayerId = {};
      (result.data || []).forEach(function (row) {
        if (row.performance_score !== null && row.performance_score !== undefined) {
          byPlayerId[row.player_id] = row.performance_score;
        }
      });
      _teamScoringCache = { season: seasonCode, byPlayerId: byPlayerId };
      buildRosterTable();
    });
}

// Same color thresholds as the Scoring tab's own Recent Score column
// (tab-scoring.js renderScoresTable()), so a number means the same thing in
// both places. Tank/Heal roles are excluded from generate_priority_order()'s
// performance blend entirely (it reads Attendance only for them), so a
// stored column value for those roles isn't what Priority actually uses --
// shown as "--" rather than a possibly-misleading number.
function _rosterScoreCellHtml(p) {
  if (p.role === 'Tank' || p.role === 'Heal') {
    return '<span style="color:var(--text-dim);" title="Priority uses Attendance only for this role">-</span>';
  }
  var score = _teamScoringCache ? _teamScoringCache.byPlayerId[p.id] : undefined;
  if (score === null || score === undefined) {
    return '<span style="color:var(--text-dim);" title="No committed score yet this season">-</span>';
  }
  var color = score >= 7 ? 'var(--heal)' : score >= 5 ? 'var(--gold)' : 'var(--text-dim)';
  return '<span style="color:' + color + ';font-weight:600;">' + score.toFixed(2) + '</span>';
}

// #478 -- wishlist-not-started check backing the onboarding checklist.
// Returns null when _teamItemPreferences (tab-priority.js) hasn't loaded yet
// -- same "don't flash a false state" convention as buildStatsBar()'s
// wishlistHtml above -- else true/false.
function onboardingWishlistNotStarted(playerId) {
  if (typeof _teamItemPreferences === 'undefined' || _teamItemPreferences === null) return null;
  for (var i = 0; i < _teamItemPreferences.length; i++) {
    if (_teamItemPreferences[i].player_id === playerId) return false;
  }
  return true;
}

function buildRosterTable() {
  _fetchTeamScoringIfNeeded();
  var order = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [], Bench: [] };

  var searchTerm = normalise((document.getElementById('rosterSearch') || {}).value || '');
  var bisItemTerm = normalise((document.getElementById('bisItemSearch') || {}).value || '');

  for (var i = 0; i < DATA.roster.length; i++) {
    var p = DATA.roster[i];
    // "Low attendance" is a claim about a measured value, so an unknown one
    // is excluded rather than defaulted. Coercing null to 0 here made the
    // filter match the entire roster whenever attendance had not loaded (#694).
    if (activeFilters.lowAttend) {
      var lowPct = parseInt(getDisplayAttendancePct(p));
      if (isNaN(lowPct) || lowPct >= 95) continue;
    }
    if (activeFilters.noBis && p.bisLink) continue;
    if (activeFilters.trial && !p.isTrial) continue;
    if (activeFilters.bench && !p.isBench) continue;
    if (activeFilters.role && p.role !== activeFilters.role) continue;
    if (
      searchTerm &&
      normalise(p.nick || '').indexOf(searchTerm) === -1 &&
      normalise(p.firstName || '').indexOf(searchTerm) === -1
    )
      continue;
    if (bisItemTerm) {
      var bisItems = getBisItems(p.nameRealm);
      var hasBisMatch = false;
      for (var bi = 0; bi < bisItems.length; bi++) {
        if (normalise(bisItems[bi].item).indexOf(bisItemTerm) !== -1) {
          hasBisMatch = true;
          break;
        }
      }
      if (!hasBisMatch) continue;
    }
    if (p.isBench) groups['Bench'].push(p);
    else if (groups[p.role]) groups[p.role].push(p);
  }

  var sortFn;
  if (activeSort.key === 'name') {
    sortFn = function (a, b) {
      return activeSort.dir * (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    };
  } else if (activeSort.key === 'attendance') {
    // Unknown sorts to the bottom in both directions rather than tying at 0,
    // which used to flatten the whole comparator into a no-op (#694).
    sortFn = function (a, b) {
      var av = getDisplayAttendancePct(a);
      var bv = getDisplayAttendancePct(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return activeSort.dir * ((parseFloat(av) || 0) - (parseFloat(bv) || 0));
    };
  } else if (activeSort.key === 'items') {
    sortFn = function (a, b) {
      var ac = (getSeasonLootEntry(a.nameRealm) || { count: 0 }).count;
      var bc = (getSeasonLootEntry(b.nameRealm) || { count: 0 }).count;
      return activeSort.dir * (ac - bc);
    };
  } else {
    sortFn = function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    };
  }
  for (var r = 0; r < order.length; r++) {
    groups[order[r]].sort(sortFn);
  }

  var html =
    '<thead><tr><th>Player</th><th>Attendance</th><th title="The committed value generate_priority_order() reads for DPS priority. Tank/Heal roles use Attendance only.">Recent Score</th><th>Items</th><th>BiS Source</th><th>M+ Excl.</th><th>Status</th><th><button class="btn btn-gold" style="font-size:0.95rem;padding:0.25rem 0.75rem;white-space:nowrap;" onclick="showAddPlayerModal()">+ Add Player</button></th></tr></thead><tbody>';
  var totalRows = 0;

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    html += '<tr class="group-header"><td colspan="8">' + labels[role] + '</td></tr>';
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var name = p.nick || p.firstName;
      var att = getDisplayAttendancePct(p);
      var pct = att === null ? null : parseFloat(att);
      var color = attendColor(pct);
      var lootEntry = getSeasonLootEntry(p.nameRealm);
      var lootCount = lootEntry ? lootEntry.count : 0;
      var hasBis = !!p.bisLink;
      var roleColor =
        p.role === 'Tank'
          ? 'var(--tank)'
          : p.role === 'Heal'
            ? 'var(--heal)'
            : p.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var statusTags = '';
      if (p.isTrial) statusTags += '<span class="tag tag-trial">Trial</span> ';
      if (p.isBench) statusTags += '<span class="tag tag-bench">Bench</span> ';
      if (p.isBackupTank) statusTags += '<span class="tag tag-backup-tank">Backup Tank</span> ';
      if (p.isBackupHealer) statusTags += '<span class="tag tag-backup-healer">Backup Healer</span>';
      // Informational only (not fed into priority order, see
      // 20260808212802_tier_priority_bis_match.sql's neutral tier_rank on
      // non-tier items) -- a heads-up for officers making an in-raid loot
      // call, same "raider self-service, officer-visible" shape as the
      // Wishlist onboarding badge below.
      if (p.bonusRollBoss)
        statusTags +=
          ' <span class="tag tag-bonus-roll" title="Bonus Roll target this week">🎲 ' +
          _esc(p.bonusRollBoss) +
          '</span>';
      if (!statusTags) statusTags = '<span style="color:var(--text);">-</span>';
      // Width goes straight into a CSS declaration, so unknown collapses the
      // bar to nothing rather than rendering a full-width red one at 0%.
      var barPct = pct === null ? '0%' : pct.toFixed(1) + '%';
      var clsColor = classColor(p.class);
      html +=
        '<tr class="player-row' +
        (selectedOfficerPlayer === p.firstName ? ' selected' : '') +
        '" onclick="officerSelectPlayer(\'' +
        p.firstName +
        '\')" data-player="' +
        p.firstName +
        '">' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        name.slice(0, 2).toUpperCase() +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;">' +
        '<span style="font-weight:600;color:var(--text);">' +
        name +
        '</span>' +
        (p.firstName !== name
          ? '<span style="font-size:1.07rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        '</div>' +
        (p.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(p.class) +
            ';align-self:flex-start;">' +
            (p.spec || p.class) +
            '</span>'
          : '') +
        (p.joinDate
          ? '<span style="font-size:0.95rem;color:var(--text-dim);">Joined: ' + formatJoinDate(p.joinDate) + '</span>'
          : '') +
        '</div>' +
        '</div></td>' +
        '<td><div class="attend-mini-cell"><span class="attend-mini" style="color:' +
        color +
        ';">' +
        formatAttendancePct(att) +
        '</span>' +
        (pct
          ? '<div class="attend-mini-bar-wrap"><div class="attend-mini-bar" style="width:' +
            barPct +
            ';background:' +
            color +
            ';"></div></div>'
          : '') +
        '</div></td>' +
        '<td>' +
        _rosterScoreCellHtml(p) +
        '</td>' +
        '<td>' +
        lootCount +
        '</td>' +
        '<td>' +
        (hasBis
          ? '<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td>' +
        (p.mPlusExcluded
          ? '<span style="color:var(--heal);font-size:1.1rem;">&#10003;</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td>' +
        statusTags +
        '</td>' +
        '<td>' +
        (seasonHasStarted() &&
        joinedAfterSeasonStart(p) &&
        isRecentJoiner(p, 30) &&
        onboardingWishlistNotStarted(p.id) === true
          ? '<span class="onboarding-badge" title="Joined within the last 30 days, no wishlist tags yet">Wishlist not started</span>'
          : '') +
        '</td>' +
        '</tr>';
      totalRows++;
    }
  }
  if (totalRows === 0)
    html +=
      '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem;">No players match the current filters.</td></tr>';
  html += '</tbody>';
  document.getElementById('rosterTable').innerHTML = html;

  var countEl = document.getElementById('bisItemCount');
  if (countEl) countEl.textContent = bisItemTerm ? totalRows + ' player' + (totalRows !== 1 ? 's' : '') : '';
}

function officerSelectPlayer(firstName) {
  var existingRow = document.getElementById('inlineProfileRow');

  // Toggle closed if clicking the already-open player
  if (selectedOfficerPlayer === firstName && existingRow) {
    selectedOfficerPlayer = null;
    existingRow.remove();
    buildRosterTable();
    return;
  }

  selectedOfficerPlayer = firstName;
  buildRosterTable();

  // Remove any existing inline row (buildRosterTable wipes the tbody but keep this as safety)
  existingRow = document.getElementById('inlineProfileRow');
  if (existingRow) existingRow.remove();

  var playerRow = document.querySelector('.player-row[data-player="' + firstName + '"]');
  if (!playerRow) return;

  var inlineRow = document.createElement('tr');
  inlineRow.id = 'inlineProfileRow';
  var inlineCell = document.createElement('td');
  inlineCell.colSpan = 8;
  inlineCell.style.padding = '0';
  inlineCell.style.border = 'none';
  inlineRow.appendChild(inlineCell);
  playerRow.parentNode.insertBefore(inlineRow, playerRow.nextSibling);

  renderProfile(firstName, 'officer', inlineCell);
  inlineRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Re-renders the currently open player card. Originally only ever called
// right after buildRosterTable() wipes the table HTML (onHeavyReady,
// rebuildSeasonFilteredViews), so any prior inlineProfileRow was already
// gone by the time this ran -- but js/common.js's officerWishlistSectionHTML()
// section now also calls this directly (toggleOfficerWishlistExpanded(),
// the item_preferences fetch callback) to refresh just the open card
// without a full table rebuild, and without this removal a second
// #inlineProfileRow got inserted alongside the still-present first one
// instead of replacing it -- the whole profile appeared to duplicate on the
// page every time, e.g. clicking "Show all N other tagged items".
function reopenSelectedPlayer() {
  if (!selectedOfficerPlayer) return;
  var playerRow = document.querySelector('.player-row[data-player="' + selectedOfficerPlayer + '"]');
  if (!playerRow) return;
  var existingRow = document.getElementById('inlineProfileRow');
  if (existingRow) existingRow.remove();
  var inlineRow = document.createElement('tr');
  inlineRow.id = 'inlineProfileRow';
  var inlineCell = document.createElement('td');
  inlineCell.colSpan = 8;
  inlineCell.style.padding = '0';
  inlineCell.style.border = 'none';
  inlineRow.appendChild(inlineCell);
  playerRow.parentNode.insertBefore(inlineRow, playerRow.nextSibling);
  renderProfile(selectedOfficerPlayer, 'officer', inlineCell);
}

// -- Add player modal -------------------------------------------------------
function showAddPlayerModal() {
  document.getElementById('addPlayerName').value = '';
  document.getElementById('addPlayerRealm').value = '';
  document.getElementById('addPlayerNick').value = '';
  document.getElementById('addPlayerClass').value = '';
  document.getElementById('addPlayerSpec').innerHTML = '<option value="">-- Select spec --</option>';
  document.getElementById('addPlayerRole').value = 'Melee';
  document.getElementById('addPlayerTrial').checked = false;
  document.getElementById('addPlayerError').style.display = 'none';

  var today = new Date();
  var mm = today.getMonth() + 1;
  var dd = today.getDate();
  document.getElementById('addPlayerJoinDate').value =
    today.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;

  var classSel = document.getElementById('addPlayerClass');
  classSel.innerHTML = '<option value="">-- Select class --</option>';
  var classes = Object.keys(CLASS_SPECS).sort();
  for (var i = 0; i < classes.length; i++) {
    var opt = document.createElement('option');
    opt.value = classes[i];
    opt.textContent = classes[i];
    classSel.appendChild(opt);
  }

  var apdd = document.getElementById('addPlayerRealmDropdown');
  if (apdd) apdd.style.display = 'none';

  document.getElementById('addPlayerModal').classList.add('active');
  setTimeout(function () {
    document.getElementById('addPlayerName').focus();
  }, 50);
}

function hideAddPlayerModal() {
  var apdd = document.getElementById('addPlayerRealmDropdown');
  if (apdd) apdd.style.display = 'none';
  document.getElementById('addPlayerModal').classList.remove('active');
}

function initAddPlayerRealmCombobox() {
  var input = document.getElementById('addPlayerRealm');
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) {
      dropdown.style.display = 'none';
      return;
    }
    var matches = WOW_REALMS.filter(function (r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = matches
      .map(function (r) {
        return (
          '<div class="realm-option" onmousedown="pickAddPlayerRealm(\'' +
          r.replace(/'/g, "\\'") +
          '\')">' +
          r +
          '</div>'
        );
      })
      .join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function () {
    showMatches(this.value);
  });
  input.addEventListener('focus', function () {
    showMatches(this.value);
  });
  input.addEventListener('blur', function () {
    setTimeout(function () {
      dropdown.style.display = 'none';
    }, 150);
  });
}

function pickAddPlayerRealm(realm) {
  var input = document.getElementById('addPlayerRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('addPlayerRealmDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function addPlayerClassChanged() {
  var cls = document.getElementById('addPlayerClass').value;
  var specSel = document.getElementById('addPlayerSpec');
  var roleSel = document.getElementById('addPlayerRole');
  specSel.innerHTML = '<option value="">-- Select spec --</option>';
  if (!cls || !CLASS_SPECS[cls]) return;
  var specs = CLASS_SPECS[cls].specs;
  for (var i = 0; i < specs.length; i++) {
    var opt = document.createElement('option');
    opt.value = specs[i];
    opt.textContent = specs[i];
    specSel.appendChild(opt);
  }
  var roles = CLASS_SPECS[cls].roles;
  if (roles) {
    roleSel.value = roles[0] === 'Healer' ? 'Heal' : roles[0];
  }
}

function submitAddPlayer() {
  var nameVal = (document.getElementById('addPlayerName').value || '').trim();
  var realmVal = (document.getElementById('addPlayerRealm').value || '').trim();
  var nickVal = (document.getElementById('addPlayerNick').value || '').trim();
  var cls = document.getElementById('addPlayerClass').value;
  var spec = document.getElementById('addPlayerSpec').value;
  var role = document.getElementById('addPlayerRole').value;
  var isTrial = document.getElementById('addPlayerTrial').checked;
  var errEl = document.getElementById('addPlayerError');

  var nameErr = validateCharName(nameVal);
  if (nameErr) {
    errEl.textContent = nameErr;
    errEl.style.display = '';
    return;
  }
  if (!realmVal || !cls || !spec || !role) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.style.display = '';
    return;
  }

  var joinDateVal = (document.getElementById('addPlayerJoinDate').value || '').trim();

  var nameRealm = nameVal + '-' + realmVal;
  var duplicate = false;
  if (DATA && DATA.roster) {
    for (var i = 0; i < DATA.roster.length; i++) {
      if (normalise(DATA.roster[i].nameRealm) === normalise(nameRealm)) {
        duplicate = true;
        break;
      }
    }
  }
  if (duplicate) {
    errEl.textContent = nameRealm + ' is already on the roster.';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  var submitBtn = document.querySelector('#addPlayerModal .btn-gold');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';
  }

  addPlayerToRosterSupabase({
    nameRealm: nameRealm,
    nick: nickVal,
    class: cls,
    spec: spec,
    role: role,
    isTrial: isTrial,
    joinDate: joinDateVal
  })
    .then(function (playerId) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Player';
      }
      if (DATA && DATA.roster) {
        var parts = nameRealm.split('-');
        DATA.roster.push({
          id: playerId,
          nameRealm: nameRealm,
          firstName: parts[0],
          realm: parts.slice(1).join('-'),
          nick: nickVal,
          class: cls,
          spec: spec,
          role: role,
          isTrial: isTrial,
          isBench: false,
          bisLink: '',
          joinDate: joinDateVal
        });
      }
      hideAddPlayerModal();
      buildOfficerDashboard();
      if (typeof window._pendingRosterOnSuccess === 'function') {
        window._pendingRosterOnSuccess();
        window._pendingRosterOnSuccess = null;
      }
    })
    .catch(function (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Player';
      }
      errEl.textContent = 'Failed to add player: ' + err.message;
      errEl.style.display = '';
      window._pendingRosterOnSuccess = null;
    });
}

// Three-case upsert (docs/database-decisions.md roster-promotion pattern):
// brand-new name_realm -> insert; a previously archived row for the same
// name_realm -> un-archive it in place (preserves its id, so historical
// rclc_loot/bis_items/attendance rows stay linked); an already-active row ->
// reject rather than silently overwrite. Resolves to the written player's id.
function addPlayerToRosterSupabase(payload) {
  if (!supabaseClient) return Promise.reject(new Error('Not connected to Supabase.'));
  var teamId = _teamCfg.supabaseTeamId;
  return supabaseClient
    .from('classes_specs')
    .select('id')
    .eq('class', payload.class)
    .eq('spec', payload.spec)
    .maybeSingle()
    .then(function (csResult) {
      if (csResult.error || !csResult.data) throw new Error('Unknown class/spec combination.');
      var classSpecId = csResult.data.id;
      return supabaseClient
        .from('players')
        .select('id, archived_at')
        .eq('team_id', teamId)
        .eq('name_realm', payload.nameRealm)
        .maybeSingle()
        .then(function (existing) {
          if (existing.error) throw new Error(existing.error.message);
          var row = existing.data;
          if (row && !row.archived_at) throw new Error(payload.nameRealm + ' is already on the roster.');
          var fields = {
            team_id: teamId,
            name_realm: payload.nameRealm,
            nickname: payload.nick || null,
            class_spec_id: classSpecId,
            is_trial: !!payload.isTrial,
            is_bench: false,
            join_date: payload.joinDate || null,
            archived_at: null
          };
          return row
            ? supabaseClient.from('players').update(fields).eq('id', row.id).select('id').single()
            : supabaseClient.from('players').insert(fields).select('id').single();
        });
    })
    .then(function (writeResult) {
      if (writeResult.error) throw new Error(writeResult.error.message);
      var playerId = writeResult.data.id;
      var detail = [payload.class, payload.spec, payload.role].filter(Boolean).join(' ');
      return writeAuditLog('Player Added', 'players', playerId, detail)
        .then(function () {
          return backfillNotOnRosterForPlayer(teamId, playerId, payload.joinDate);
        })
        .catch(function (err) {
          // Best-effort: the player is already added successfully at this
          // point, so a backfill failure shouldn't surface as an add failure.
          console.warn('Not on Roster backfill failed.', err);
        })
        .then(function () {
          return playerId;
        });
    });
}

// #241: marks every raid night the team has any attendance row for, dated
// before this player's join date, as "Not on Roster" for this player -- so
// a mid-season add doesn't leave every pre-join night blank/editable in the
// player detail panel. Only fills nights this player has no row for yet
// (never overwrites a real historical status, which matters for the
// reactivate-an-archived-player path above).
// Both reads below page through fetchAllPaged (#694). The team-wide one was
// the live defect: past 1000 rows PostgREST truncated it to a normal-looking
// 200, and because this function INSERTs off that read, a capped read didn't
// just show less -- it wrote an incomplete backfill that then looked like real
// history. The per-player read is nowhere near the cap today, but it is the
// same query shape in the same function, so it pages too rather than being
// left as the next instance of this.
function backfillNotOnRosterForPlayer(teamId, playerId, joinDate) {
  if (!joinDate) return Promise.resolve();

  return fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('attendance')
        .select('id, raid_date', afterId === null ? { count: 'exact' } : undefined)
        .eq('team_id', teamId)
        .lt('raid_date', joinDate)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'pre-join attendance' }
  ).then(function (allRows) {
    if (allRows === null) throw new Error("Could not read the team's pre-join attendance.");
    var seen = {};
    allRows.forEach(function (row) {
      if (row.raid_date) seen[row.raid_date] = true;
    });
    var preJoinDates = Object.keys(seen);
    if (!preJoinDates.length) return;

    return fetchAllPaged(
      function (afterId, limit) {
        var q = supabaseClient
          .from('attendance')
          .select('id, raid_date', afterId === null ? { count: 'exact' } : undefined)
          .eq('team_id', teamId)
          .eq('player_id', playerId)
          .order('id', { ascending: true })
          .limit(limit);
        return afterId === null ? q : q.gt('id', afterId);
      },
      { label: "this player's attendance" }
    ).then(function (existingRows) {
      if (existingRows === null) throw new Error("Could not read this player's existing attendance.");
      var existing = {};
      existingRows.forEach(function (row) {
        if (row.raid_date) existing[row.raid_date] = true;
      });
      var missing = preJoinDates.filter(function (d) {
        return !existing[d];
      });
      if (!missing.length) return;

      var rows = missing.map(function (d) {
        return { team_id: teamId, player_id: playerId, raid_date: d, status: 'Not on Roster', source: 'WCL' };
      });
      return supabaseClient
        .from('attendance')
        .insert(rows)
        .then(function (insertResult) {
          if (insertResult.error) throw new Error(insertResult.error.message);
          return writeAuditLog(
            'Attendance Backfilled',
            'players',
            playerId,
            missing.length + ' pre-join night(s) marked Not on Roster'
          );
        });
    });
  });
}

function confirmRemovePlayer(nameRealm, firstName) {
  var confirmDiv = document.getElementById('removePlayerConfirm-' + firstName);
  if (confirmDiv) confirmDiv.style.display = 'flex';
  var removeBtn = document.getElementById('removePlayerBtn-' + firstName);
  if (removeBtn) removeBtn.style.display = 'none';
}

function cancelRemovePlayer(firstName) {
  var confirmDiv = document.getElementById('removePlayerConfirm-' + firstName);
  if (confirmDiv) confirmDiv.style.display = 'none';
  var removeBtn = document.getElementById('removePlayerBtn-' + firstName);
  if (removeBtn) removeBtn.style.display = '';
}

function executeRemovePlayer(nameRealm, firstName) {
  var msgEl = document.getElementById('removePlayerMsg-' + firstName);
  if (msgEl) {
    msgEl.textContent = 'Removing...';
    msgEl.style.color = 'var(--text-muted)';
    msgEl.style.display = '';
  }

  var player = findRosterPlayer(nameRealm);
  if (!player || !player.id) {
    if (msgEl) {
      msgEl.textContent = 'Failed: player not found.';
      msgEl.style.color = 'var(--melee)';
    }
    return;
  }

  // Soft-delete via archived_at, not a hard DELETE -- an archived row keeps
  // its id so rclc_loot/bis_items/attendance rows referencing it stay intact
  // (docs/database-decisions.md).
  supabaseClient
    .from('players')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', player.id)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Player Removed', 'players', player.id, null);
    })
    .then(function () {
      if (DATA && DATA.roster) {
        DATA.roster = DATA.roster.filter(function (p) {
          return p.nameRealm !== nameRealm;
        });
      }
      document.getElementById('officerProfile').innerHTML = '';
      selectedOfficerPlayer = null;
      buildOfficerDashboard();
    })
    .catch(function (err) {
      if (msgEl) {
        msgEl.textContent = 'Failed: ' + err.message;
        msgEl.style.color = 'var(--melee)';
      }
    });
}

// -- Player settings --------------------------------------------------------
function savePlayerField(nameRealm, firstName, field, value) {
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  runRosterWrite(updateRosterFieldSupabase(nameRealm, field, value), msgEl).then(function (ok) {
    if (ok && DATA) {
      var player = findRosterPlayer(nameRealm);
      if (player) player[field] = value;
      if (field === 'joinDate') buildTrialPromoAlert();
    }
  });
}

function updateClassSpecSupabase(nameRealm, classValue, specValue) {
  var player = findRosterPlayer(nameRealm);
  if (!player || !player.id) return Promise.reject(new Error('Player not found.'));
  return supabaseClient
    .from('classes_specs')
    .select('id, role')
    .eq('class', classValue)
    .eq('spec', specValue)
    .maybeSingle()
    .then(function (csResult) {
      if (csResult.error || !csResult.data) throw new Error('Unknown class/spec combination.');
      return supabaseClient
        .from('players')
        .update({ class_spec_id: csResult.data.id })
        .eq('id', player.id)
        .then(function (result) {
          if (result.error) throw new Error(result.error.message);
          player.role = csResult.data.role;
          return writeAuditLog('Spec Changed', 'players', player.id, 'Changed to ' + classValue + ' ' + specValue);
        });
    });
}

// UI-only: repopulates the Spec dropdown for the newly picked class. Doesn't
// write anything -- Class, Spec, Name, and Joined Date all commit together
// from the single Player Settings Save button (officerSavePlayerSettings,
// #489), not per-field.
function officerUpdateClass(nameRealm, firstName, newClass) {
  var specSel = document.getElementById('specSelect-' + firstName);
  if (!specSel) return;
  specSel.innerHTML = '<option value="">-- Select spec --</option>';
  if (newClass && CLASS_SPECS[newClass]) {
    var specs = CLASS_SPECS[newClass].specs;
    for (var i = 0; i < specs.length; i++) {
      var opt = document.createElement('option');
      opt.value = specs[i];
      opt.textContent = specs[i];
      specSel.appendChild(opt);
    }
  }
}

// Renaming updates players.name_realm in place by id, so the row's id --
// and every rclc_loot/bis_items/attendance row that references it -- stays
// linked (#407). Guarded by the same players_team_id_name_realm_key unique
// constraint addPlayerToRosterSupabase relies on: a rename onto a name
// already in use (active or archived) fails with a constraint-violation
// error surfaced through the normal "Failed to save." path, same as any
// other write failure here.
function renamePlayerSupabase(oldNameRealm, newNameRealm) {
  var player = findRosterPlayer(oldNameRealm);
  if (!player || !player.id) return Promise.reject(new Error('Unknown player.'));
  return supabaseClient
    .from('players')
    .update({ name_realm: newNameRealm })
    .eq('id', player.id)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Player Renamed', 'players', player.id, oldNameRealm + ' -> ' + newNameRealm);
    });
}

// Single Save action for the whole Player Settings panel (#489): commits
// Class, Spec, Name, Realm, and Joined Date together instead of each having
// its own auto-save or Save button. Class/Spec, Name/Realm, Joined Date, and
// Nickname each only write (and audit-log) if actually changed from the
// current player record -- the dropdowns always hold a valid combo since
// they're required fields, but that doesn't mean it differs from what's
// already saved.
function officerSavePlayerSettings(nameRealm, firstName) {
  var player = findRosterPlayer(nameRealm);
  if (!player) return;
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);

  var classSel = document.getElementById('classSelect-' + firstName);
  var specSel = document.getElementById('specSelect-' + firstName);
  var classValue = classSel ? classSel.value : '';
  var specValue = specSel ? specSel.value : '';
  if (!classValue || !specValue) {
    if (msgEl) msgEl.textContent = 'Select both a class and a spec.';
    return;
  }

  var nameInput = document.getElementById('editNameInput-' + firstName);
  var realmSel = document.getElementById('editRealmSelect-' + firstName);
  var newName = nameInput ? nameInput.value.trim() : player.firstName;
  var newRealm = realmSel ? realmSel.value : player.realm;
  if (!newName || !newRealm) {
    if (msgEl) msgEl.textContent = 'Name and realm are required.';
    return;
  }
  var newNameRealm = newName + '-' + newRealm;
  var renamed = newNameRealm.toLowerCase() !== nameRealm.toLowerCase();

  var joinDateInput = document.getElementById('joinDateInput-' + firstName);
  var newJoinDate = joinDateInput ? joinDateInput.value : player.joinDate || '';
  var joinDateChanged = newJoinDate !== (player.joinDate || '');

  var nicknameInput = document.getElementById('editNicknameInput-' + firstName);
  var newNickname = nicknameInput ? nicknameInput.value.trim() : player.nick || '';
  var nicknameChanged = newNickname !== (player.nick || '');

  var specChanged = classValue !== (player.class || '') || specValue !== (player.spec || '');

  if (msgEl) msgEl.textContent = 'Saving...';

  var chain = specChanged ? updateClassSpecSupabase(nameRealm, classValue, specValue) : Promise.resolve();
  if (joinDateChanged) {
    chain = chain.then(function () {
      return updateRosterFieldSupabase(nameRealm, 'joinDate', newJoinDate);
    });
  }
  if (nicknameChanged) {
    chain = chain.then(function () {
      return updateRosterFieldSupabase(nameRealm, 'nick', newNickname);
    });
  }
  if (renamed) {
    chain = chain.then(function () {
      return renamePlayerSupabase(nameRealm, newNameRealm);
    });
  }

  runRosterWrite(chain, msgEl).then(function (ok) {
    if (!ok) return;
    player.class = classValue;
    player.spec = specValue;
    // player.role is set inside updateClassSpecSupabase from the
    // classes_specs lookup, since it already has the resolved row there.
    if (joinDateChanged) {
      player.joinDate = newJoinDate;
      buildTrialPromoAlert();
    }
    if (nicknameChanged) {
      player.nick = newNickname || null;
    }

    if (renamed) {
      selectedOfficerPlayer = null;
      var inlineRow = document.getElementById('inlineProfileRow');
      if (inlineRow) inlineRow.remove();
      // Full reload rather than patching DATA.roster in place: lootCounts,
      // bisList, and the jsonp-merged attendance field (js/common.js) are all
      // keyed by the player's name, not id, so a rename leaves every one of
      // those client-side maps pointing at the old name until they're
      // refetched (#407 follow-up). buildRosterTable() alone only re-renders
      // the roster row itself, which is why the name updated but the profile
      // card's Items Received / BiS List went blank until a manual page reload.
      loadData(
        function () {
          buildOfficerDashboard();
        },
        function () {
          buildStatsBar();
          buildRosterTable();
          // Attendance-driven -- buildOfficerDashboard() above ran before
          // heavy data (DATA.rawAttendanceData) arrived, so its own call to
          // this saw everyone at 0% attendance and excluded them.
          buildTrialPromoAlert();
        }
      );
    } else {
      buildRosterTable();
      reopenSelectedPlayer();
    }
  });
}

function togglePlayerTrial(nameRealm, firstName) {
  var player = findRosterPlayer(nameRealm);
  if (!player) return;
  var newVal = !player.isTrial;
  var btn = document.getElementById('trialToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'isTrial', newVal), msgEl).then(function (ok) {
    if (ok) {
      player.isTrial = newVal;
      buildTrialPromoAlert();
    }
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove Trial' : 'Mark as Trial';
    }
  });
}

function togglePlayerBench(nameRealm, firstName) {
  var player = findRosterPlayer(nameRealm);
  if (!player) return;
  var newVal = !player.isBench;
  var btn = document.getElementById('benchToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'isBench', newVal), msgEl).then(function (ok) {
    if (ok) player.isBench = newVal;
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove from Bench' : 'Move to Bench';
    }
  });
}

function togglePlayerBackupTank(nameRealm, firstName) {
  var player = findRosterPlayer(nameRealm);
  if (!player) return;
  var newVal = !player.isBackupTank;
  var btn = document.getElementById('backupTankToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'isBackupTank', newVal), msgEl).then(function (ok) {
    if (ok) player.isBackupTank = newVal;
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove Backup Tank' : 'Mark as Backup Tank';
    }
  });
}

function togglePlayerBackupHealer(nameRealm, firstName) {
  var player = findRosterPlayer(nameRealm);
  if (!player) return;
  var newVal = !player.isBackupHealer;
  var btn = document.getElementById('backupHealerToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'isBackupHealer', newVal), msgEl).then(function (ok) {
    if (ok) player.isBackupHealer = newVal;
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      btn.textContent = newVal ? 'Remove Backup Healer' : 'Mark as Backup Healer';
    }
  });
}

function toggleMPlusExcluded(nameRealm, firstName) {
  var player =
    DATA &&
    DATA.roster.find(function (p) {
      return p.nameRealm === nameRealm;
    });
  if (!player) return;
  var newVal = !player.mPlusExcluded;
  var btn = document.getElementById('mplusExclToggle-' + firstName);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  var msgEl = document.getElementById('playerSettingsMsg-' + firstName);
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'mPlusExcluded', newVal), msgEl).then(function (ok) {
    if (ok) {
      player.mPlusExcluded = newVal;
      buildRosterTable();
    }
    var newBtn = document.getElementById('mplusExclToggle-' + firstName);
    if (newBtn) {
      newBtn.disabled = false;
      newBtn.className = 'btn ' + (newVal ? 'btn-gold' : 'btn-muted');
      newBtn.textContent = newVal ? 'Remove Exclusion' : 'Mark as Excluded';
    }
  });
}

function savePlayerNote(nameRealm, firstName) {
  var noteEl = document.getElementById('playerNote-' + firstName);
  if (!noteEl) return;
  var note = noteEl.value.trim();
  var msgEl = document.getElementById('playerNoteMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';
  runRosterWrite(updateRosterFieldSupabase(nameRealm, 'officerNote', note), msgEl).then(function (ok) {
    if (ok) {
      var player = findRosterPlayer(nameRealm);
      if (player) player.officerNote = note;
    }
  });
}

// -- Trial promotion tracking (#78) ----------------------------------------

var PROMO_THRESHOLDS = { weeks: 4, attend: 75 };

function buildTrialPromoAlert() {
  var el = document.getElementById('trialPromoAlert');
  if (!el) return;

  if (DATA && DATA.trialWeeks != null) PROMO_THRESHOLDS.weeks = DATA.trialWeeks;
  if (DATA && DATA.trialAttend != null) PROMO_THRESHOLDS.attend = DATA.trialAttend;

  // Promotion readiness is half an attendance threshold, so with attendance
  // unknown this list cannot be computed at all. Rendering it empty reads as
  // "no trials are ready", which is a stronger claim than the data supports
  // and the same confident-wrong-data failure #694 exists to remove.
  if (!(DATA && DATA.rawAttendanceData)) {
    el.innerHTML =
      '<div class="state-msg' +
      (DATA && DATA._attendanceLoadFailed ? ' error' : '') +
      '">' +
      (DATA && DATA._attendanceLoadFailed
        ? 'Attendance could not be loaded, so trial promotion readiness is unknown.'
        : 'Checking trial promotion readiness...') +
      '</div>';
    return;
  }

  var minDays = PROMO_THRESHOLDS.weeks * 7;
  var minAttend = PROMO_THRESHOLDS.attend;
  var today = new Date();
  var todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  var ready = [];
  var roster = DATA.roster || [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (!p.isTrial || !p.joinDate) continue;
    var pct = parseInt(getDisplayAttendancePct(p));
    if (isNaN(pct) || pct < minAttend) continue;
    var parts = p.joinDate.split('-');
    if (parts.length < 3) continue;
    var joinMs = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    var ageDays = Math.floor((todayMs - joinMs) / 86400000);
    if (ageDays < minDays) continue;
    ready.push({ p: p, ageDays: ageDays, ageWeeks: Math.floor(ageDays / 7) });
  }

  if (!ready.length) {
    el.innerHTML = '';
    return;
  }

  ready.sort(function (a, b) {
    return b.ageDays - a.ageDays;
  });

  var html = '<div class="trial-promo-card">';
  html += '<div class="trial-promo-header">';
  html += '<span class="trial-promo-title">Trial Promotions</span>';
  html += '<span class="trial-promo-count">' + ready.length + ' ready for review</span>';
  html += '</div>';
  html +=
    '<p style="font-size:0.97rem;color:var(--text-muted);margin:0 0 0.75rem;">Thresholds: ' +
    PROMO_THRESHOLDS.weeks +
    ' wk on roster, ' +
    PROMO_THRESHOLDS.attend +
    '% attendance. Adjust in Season Settings.</p>';

  html +=
    '<table class="trial-promo-table"><thead><tr><th>Player</th><th>On Roster</th><th>Attendance</th><th></th></tr></thead><tbody>';
  for (var j = 0; j < ready.length; j++) {
    var r = ready[j];
    var p = r.p;
    var name = p.nick || p.firstName;
    var pAtt = getDisplayAttendancePct(p);
    var aColor = attendColor(pAtt === null ? null : parseInt(pAtt));
    var roleColor =
      p.role === 'Tank'
        ? 'var(--tank)'
        : p.role === 'Heal'
          ? 'var(--heal)'
          : p.role === 'Ranged'
            ? 'var(--ranged)'
            : 'var(--melee)';
    var nrSafe = p.nameRealm.replace(/'/g, "\\'");
    var fnSafe = p.firstName.replace(/'/g, "\\'");
    html +=
      '<tr class="trial-promo-row" onclick="officerSelectPlayer(\'' + fnSafe + '\')" title="Open player profile">';
    html += '<td><div class="player-name-cell">';
    html +=
      '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
      roleColor +
      ';border:2px solid ' +
      roleColor +
      ';">' +
      name.slice(0, 2).toUpperCase() +
      '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:0.1rem;">';
    html += '<span style="font-weight:600;color:var(--text);">' + name + '</span>';
    if (p.class)
      html +=
        '<span class="badge badge-class" style="' +
        classBadgeStyle(p.class) +
        ';align-self:flex-start;">' +
        (p.spec || p.class) +
        '</span>';
    html += '</div></div></td>';
    html += '<td style="color:var(--gold-light);font-weight:600;">' + r.ageWeeks + ' wk</td>';
    html += '<td><span style="color:' + aColor + ';font-weight:700;">' + formatAttendancePct(pAtt) + '</span></td>';
    html +=
      '<td><button class="btn btn-gold" style="font-size:0.95rem;padding:0.2rem 0.6rem;white-space:nowrap;" onclick="event.stopPropagation();promoteTrialPlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\',this)">Promote</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  el.innerHTML = html;
}

// #478 -- onboarding checklist alert: recently-joined (<=30 days) raiders
// who haven't started their wishlist yet. Same shape as buildTrialPromoAlert
// above; null _teamItemPreferences (not loaded yet) means "show nothing"
// rather than a false-empty list, same as onboardingWishlistNotStarted's
// null convention.
function buildOnboardingAlert() {
  var el = document.getElementById('onboardingAlert');
  if (!el) return;
  if (typeof _teamItemPreferences === 'undefined' || _teamItemPreferences === null) return;
  if (!seasonHasStarted()) {
    el.innerHTML = '';
    return;
  }

  var roster = DATA.roster || [];
  var pending = [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (joinedAfterSeasonStart(p) && isRecentJoiner(p, 30) && onboardingWishlistNotStarted(p.id) === true)
      pending.push(p);
  }

  if (!pending.length) {
    el.innerHTML = '';
    return;
  }

  pending.sort(function (a, b) {
    return (b.joinDate || '').localeCompare(a.joinDate || '');
  });

  var html = '<div class="onboarding-alert-card">';
  html += '<div class="onboarding-alert-header">';
  html += '<span class="onboarding-alert-title">New Raider Onboarding</span>';
  html += '<span class="onboarding-alert-count">' + pending.length + ' still onboarding</span>';
  html += '</div>';
  html +=
    '<p style="font-size:0.97rem;color:var(--text-muted);margin:0 0 0.75rem;">Joined within the last 30 days, no wishlist tags yet.</p>';

  html += '<table class="onboarding-alert-table"><thead><tr><th>Player</th><th>Joined</th></tr></thead><tbody>';
  for (var j = 0; j < pending.length; j++) {
    var pl = pending[j];
    var plName = pl.nick || pl.firstName;
    var plFnSafe = pl.firstName.replace(/'/g, "\\'");
    var plRoleColor =
      pl.role === 'Tank'
        ? 'var(--tank)'
        : pl.role === 'Heal'
          ? 'var(--heal)'
          : pl.role === 'Ranged'
            ? 'var(--ranged)'
            : 'var(--melee)';
    html +=
      '<tr class="onboarding-alert-row" onclick="officerSelectPlayer(\'' +
      plFnSafe +
      '\')" title="Open player profile">';
    html += '<td><div class="player-name-cell">';
    html +=
      '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
      plRoleColor +
      ';border:2px solid ' +
      plRoleColor +
      ';">' +
      plName.slice(0, 2).toUpperCase() +
      '</div>';
    html += '<span style="font-weight:600;color:var(--text);">' + plName + '</span>';
    html += '</div></td>';
    html += '<td style="color:var(--text-muted);">' + formatJoinDate(pl.joinDate) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  el.innerHTML = html;
}

function promoteTrialPlayer(nameRealm, firstName, btn) {
  var player = null;
  var roster = (DATA && DATA.roster) || [];
  for (var i = 0; i < roster.length; i++) {
    if (roster[i].nameRealm === nameRealm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.isTrial) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Promoting...';
  }

  updateRosterFieldSupabase(nameRealm, 'isTrial', false)
    .then(function () {
      player.isTrial = false;
      buildTrialPromoAlert();
      buildRosterTable();
      var trialBtn = document.getElementById('trialToggle-' + firstName);
      if (trialBtn) {
        trialBtn.textContent = 'Mark as Trial';
        trialBtn.classList.remove('btn-gold');
        trialBtn.classList.add('btn-muted');
      }
    })
    .catch(function (err) {
      console.warn('Trial promotion failed.', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Promote';
      }
    });
}

initAddPlayerRealmCombobox();

// ── Buff / debuff coverage (compact) ─────────────────────────────────────────

function buildRosterBuffCoverage() {
  var el = document.getElementById('rosterBuffCoverage');
  if (!el) return;
  var raiders = (DATA.roster || []).filter(function (p) {
    return !p.isBench;
  });
  var coverage = computeBuffCoverage(raiders, 'class', 'spec', 'firstName');

  var sections = [
    { label: 'Raid Buffs', buffs: RAID_BUFFS },
    { label: 'Boss Debuffs', buffs: BOSS_DEBUFFS },
    { label: 'Utility', buffs: RAID_UTILITY }
  ];

  var html =
    '<div style="margin-bottom:0.75rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--border);border-radius:6px;">' +
    '<span style="font-size:0.91rem;text-transform:uppercase;letter-spacing:0.12em;' +
    'color:var(--text-muted);font-weight:700;display:block;margin-bottom:0.5rem;">Buff Coverage</span>';

  sections.forEach(function (sec) {
    html +=
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.25rem;margin-bottom:0.4rem;">' +
      '<span style="font-size:0.87rem;text-transform:uppercase;letter-spacing:0.08em;' +
      'color:var(--text-dim);font-weight:600;min-width:4.5rem;">' +
      sec.label +
      '</span>';
    sec.buffs.forEach(function (buff) {
      var data = coverage[buff.name] || { count: 0, providers: [] };
      var count = data.count;
      var indicator, color;
      if (count >= 2) {
        indicator = '&#10003;';
        color = 'var(--heal)';
      } else if (count === 1) {
        indicator = '!';
        color = 'var(--gold-light)';
      } else {
        indicator = '&#10007;';
        color = 'var(--melee)';
      }
      var nameColor = buff.classes.length === 1 ? classColor(buff.classes[0]) : 'var(--text)';
      html +=
        '<span style="display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg);' +
        'border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.55rem;' +
        'font-size:1rem;cursor:default;">' +
        '<span style="color:' +
        color +
        ';font-weight:700;">' +
        indicator +
        '</span>' +
        buffNameLinkHtml(buff, 'color:' + nameColor) +
        '</span>';
    });
    html += '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

// ── Roster subtabs ────────────────────────────────────────────────────────────

function switchRosterSubTab(name, btnEl) {
  document.querySelectorAll('[id^="roster-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['roster', 'discord'].forEach(function (sub) {
    var el = document.getElementById('roster-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'discord') renderDiscordClaims();
}

// ── Discord Claims ────────────────────────────────────────────────────────────

function renderDiscordClaims() {
  var el = document.getElementById('rosterDiscordClaimsContent');
  if (!el || !supabaseClient) return;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:1.02rem;">Loading...</p>';
  fetchTeamClaims().then(function (claims) {
    // fetchTeamClaims() and DATA.roster both scope to this team's active
    // (archived_at is null) players, so claims.length / total is a direct
    // "how many have claimed" count, not an approximation.
    var total = (DATA.roster || []).length;
    var countHtml =
      '<p style="color:var(--text-muted);font-size:1.02rem;margin-bottom:0.75rem;">' +
      claims.length +
      ' of ' +
      total +
      ' roster member' +
      (total === 1 ? '' : 's') +
      ' ' +
      (claims.length === 1 ? 'has' : 'have') +
      ' claimed a character.</p>';

    var claimedNorm = {};
    claims.forEach(function (c) {
      claimedNorm[normalise(c.nameRealm)] = true;
    });
    var unclaimed = (DATA.roster || [])
      .filter(function (p) {
        return !claimedNorm[normalise(p.nameRealm)];
      })
      .sort(function (a, b) {
        return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
      });
    var unclaimedHtml = unclaimed.length
      ? '<p style="color:var(--text-muted);font-size:1.02rem;margin-bottom:0.75rem;">Not yet claimed: ' +
        unclaimed
          .map(function (p) {
            return escHtml(p.nick || p.firstName);
          })
          .join(', ') +
        '</p>'
      : '';

    if (!claims.length) {
      el.innerHTML =
        countHtml +
        unclaimedHtml +
        '<p style="color:var(--text-muted);font-size:1.02rem;">No characters have been claimed yet.</p>';
      return;
    }
    var rows = claims
      .map(function (c) {
        var isOfficer = c.role === 'officer' || c.role === 'team_leader';
        var roleCell = isOfficer
          ? '<span style="color:var(--heal)">Officer</span>'
          : '<span style="color:var(--text-muted)">Raider</span>';
        var jsonNr = JSON.stringify(c.nameRealm).replace(/"/g, '&quot;');
        var actionCell =
          '<button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.89rem;" onclick="removeDiscordClaim(' +
          jsonNr +
          ')">Remove</button>';
        var discordCell = c.discordName
          ? escHtml(c.discordName) +
            '<br><span style="font-size:0.93rem;color:var(--text-dim);">' +
            escHtml(c.discordId) +
            '</span>'
          : escHtml(c.discordId);
        return (
          '<tr>' +
          '<td style="width:35%">' +
          escHtml(c.nameRealm) +
          '</td>' +
          '<td style="width:30%">' +
          discordCell +
          '</td>' +
          '<td style="width:20%">' +
          roleCell +
          '</td>' +
          '<td style="width:15%;text-align:right">' +
          actionCell +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    el.innerHTML =
      countHtml +
      unclaimedHtml +
      '<table class="loot-table" style="width:100%;table-layout:fixed;">' +
      '<thead><tr>' +
      '<th style="width:35%;text-align:left">Character</th>' +
      '<th style="width:30%;text-align:left">Discord</th>' +
      '<th style="width:20%;text-align:left">Role</th>' +
      '<th style="width:15%"></th>' +
      '</tr></thead>' +
      '<tbody>' +
      rows +
      '</tbody>' +
      '</table>';
  });
}

function removeDiscordClaim(nameRealm) {
  if (!confirm('Remove claim for ' + nameRealm + '? The raider will need to re-claim their character on next login.'))
    return;
  supabaseClient
    .from('players')
    .update({ team_member_id: null })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (result.error) {
        alert('Failed to remove claim: ' + result.error.message);
        return;
      }
      renderDiscordClaims();
    });
}
