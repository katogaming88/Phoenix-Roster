var _attendanceGrid = null;

function switchAttendSubTab(name, btn) {
  document.querySelectorAll('[id^="attend-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  var manage = document.getElementById('attend-sub-manage');
  var scores = document.getElementById('attend-sub-scores');
  var bench = document.getElementById('attend-sub-bench');
  if (manage) manage.style.display = name === 'manage' ? '' : 'none';
  if (scores) scores.style.display = name === 'scores' ? '' : 'none';
  if (bench) bench.style.display = name === 'bench' ? '' : 'none';
  if (name === 'bench') {
    if (Array.isArray(_attendanceGrid)) {
      buildBenchFairness();
    } else {
      var el = document.getElementById('benchFairnessContent');
      if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem 0;">Loading attendance data...</p>';
      ensureAttendanceGridLoaded();
    }
  }
}

function buildAttendanceTab() {
  var allDetails = DATA.attendanceDetails || {};
  var roster = DATA.roster || [];
  var THRESHOLD = parseInt((document.getElementById('attendThreshold') || { value: '95' }).value) || 95;
  var range = getSeasonDateRange();

  // Filter penalty events to the active season window
  function filterPenalties(penalties) {
    if (!ACTIVE_SEASON) return penalties;
    return penalties.filter(function (ae) {
      return (!range.start || ae.date >= range.start) && (!range.end || ae.date <= range.end);
    });
  }

  // With attendance unknown every player's percentage parsed to 0, which is
  // at or below any threshold, so this list named the entire roster as being
  // in trouble. Banner instead of guessing in either direction (#694).
  if (!DATA.rawAttendanceData) {
    document.getElementById('attendanceContent').innerHTML =
      '<div class="state-msg' +
      (DATA._attendanceLoadFailed ? ' error' : '') +
      '">' +
      (DATA._attendanceLoadFailed
        ? 'Attendance could not be loaded, so below-threshold raiders cannot be listed.'
        : 'Loading attendance...') +
      '</div>';
    ensureAttendanceGridLoaded();
    return;
  }

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    var att = getDisplayAttendancePct(p);
    var pct = parseFloat(att) || 0;
    if (pct <= THRESHOLD) below.push({ player: p, att: att, pct: pct });
  }
  below.sort(function (a, b) {
    return a.pct - b.pct;
  });

  var seasonLabel = ACTIVE_SEASON ? ' (' + ACTIVE_SEASON + ')' : '';
  var html = '';
  if (!below.length) {
    html =
      '<p style="color:var(--text);padding:1rem;">All raiders are at or above ' +
      THRESHOLD +
      '% attendance' +
      seasonLabel +
      '.</p>';
  } else {
    html +=
      '<p style="font-size:1rem;color:var(--text);margin-bottom:1rem;">' +
      below.length +
      ' raider' +
      (below.length !== 1 ? 's' : '') +
      ' at or below ' +
      THRESHOLD +
      '% attendance' +
      seasonLabel +
      '</p>';
    for (var i = 0; i < below.length; i++) {
      var p = below[i].player;
      var att = below[i].att;
      var color = attendColor(parseFloat(att) || 0);
      var penalty = filterPenalties(allDetails[p.firstName] || []);

      html += '<div class="attend-player-row">';
      html += '<div class="attend-player-header">';
      html +=
        '<span class="attend-player-name">' +
        (p.nick || p.firstName) +
        (p.firstName !== (p.nick || p.firstName)
          ? ' <span style="font-size:1.07rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        '</span>';
      html += '<span style="font-size:1rem;font-weight:700;color:' + color + ';">' + att + '</span>';
      html += '</div>';
      html += '<div class="attend-row" style="margin-bottom:0.5rem;">';
      html +=
        '<div class="attend-bar-wrap"><div class="attend-bar" style="width:' +
        att +
        ';background:' +
        color +
        ';"></div></div>';
      html += '</div>';
      if (penalty.length) {
        html += '<div class="attend-penalty-list">';
        for (var j = 0; j < penalty.length; j++) {
          var ae = penalty[j];
          var sc = ae.status === 'No Show' ? 'var(--melee)' : 'var(--gold)';
          html += '<div class="attend-penalty-entry">';
          html += '<span style="color:var(--text);">' + ae.date + '</span>';
          html += '<span style="color:' + sc + ';font-weight:600;">' + ae.status + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  document.getElementById('attendanceContent').innerHTML = html;

  ensureAttendanceGridLoaded();
}

function ensureAttendanceGridLoaded() {
  if (_attendanceGrid !== null) return;
  _attendanceGrid = 'loading';
  loadAttendanceGrid();
}

function loadAttendanceGrid() {
  var status = document.getElementById('attendGridStatus');
  var nightRow = document.getElementById('attendGridNightRow');
  var table = document.getElementById('attendGridTable');
  if (status) status.textContent = 'Loading attendance data...';
  if (nightRow) nightRow.style.display = 'none';
  if (table) table.innerHTML = '';

  // Paged through fetchAllPaged (#694). This read was unpaginated, so past
  // 1000 rows PostgREST truncated it and returned that as a normal 200 -- and
  // ordered raid_date descending, what fell off was the oldest nights, so the
  // start of the season quietly went missing from the grid and the night
  // dropdown with nothing reporting a problem. Paging is keyed on id (the only
  // column guaranteed unique and stable here), so the newest-first display
  // order is restored below rather than being asked of the query.
  fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('attendance')
        .select(
          'id, raid_date, report_title, report_excluded, player_id, status, source',
          afterId === null ? { count: 'exact' } : undefined
        )
        .eq('team_id', _teamCfg.supabaseTeamId)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'attendance grid' }
  ).then(function (rows) {
    if (rows === null) {
      // null, not [], is the failure signal: an empty grid renders as "no
      // raid nights recorded yet", which is a different claim entirely.
      _attendanceGrid = null;
      if (status) {
        status.textContent = 'Error: could not load attendance data.';
        status.style.color = 'var(--melee)';
      }
      return;
    }

    var roster = (DATA && DATA.roster) || [];
    var rosterById = {};
    roster.forEach(function (p) {
      rosterById[p.id] = p;
    });

    var nightsByDate = {};
    var order = [];
    rows.forEach(function (row) {
      if (!nightsByDate[row.raid_date]) {
        nightsByDate[row.raid_date] = {
          date: row.raid_date,
          title: row.report_title || row.raid_date,
          excluded: !!row.report_excluded,
          players: [],
          seen: {}
        };
        order.push(row.raid_date);
      }
      var night = nightsByDate[row.raid_date];
      var p = rosterById[row.player_id];
      night.players.push({
        name: p ? p.firstName : 'Player ' + row.player_id,
        status: row.status,
        source: row.source
      });
      night.seen[row.player_id] = true;
    });

    // The query orders by id so paging is deterministic, so the newest-first
    // order the grid and the night dropdown both expect is applied here.
    // raid_date is an ISO date, so a plain string compare is chronological.
    order.sort(function (a, b) {
      if (a === b) return 0;
      return a < b ? 1 : -1;
    });

    // Roster players without a row for this night still need to show up
    // (no status), so an officer can fill one in from the grid -- matches
    // GAS's behavior of always listing the full roster per night.
    order.forEach(function (date) {
      var night = nightsByDate[date];
      roster.forEach(function (p) {
        if (!night.seen[p.id]) night.players.push({ name: p.firstName, status: '', source: '' });
      });
      night.players.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      delete night.seen;
    });

    _attendanceGrid = order.map(function (date) {
      return nightsByDate[date];
    });
    if (status) status.textContent = '';
    renderAttendanceGrid();
    var benchEl = document.getElementById('attend-sub-bench');
    if (benchEl && benchEl.style.display !== 'none') buildBenchFairness();
  });
}

function renderAttendanceGrid() {
  var nightRow = document.getElementById('attendGridNightRow');
  var nightSelect = document.getElementById('attendNightSelect');
  var status = document.getElementById('attendGridStatus');
  var table = document.getElementById('attendGridTable');

  if (!_attendanceGrid || !Array.isArray(_attendanceGrid) || !_attendanceGrid.length) {
    if (status) {
      status.textContent = 'No raid nights recorded yet. Run "Refresh from WCL" first.';
      status.style.color = 'var(--text-muted)';
    }
    if (nightRow) nightRow.style.display = 'none';
    if (table) table.innerHTML = '';
    return;
  }

  if (status) {
    status.textContent = '';
  }
  if (nightRow) nightRow.style.display = '';

  if (nightSelect) {
    var prevIndex = nightSelect.selectedIndex >= 0 ? nightSelect.selectedIndex : 0;
    nightSelect.innerHTML = '';
    for (var i = 0; i < _attendanceGrid.length; i++) {
      var raid = _attendanceGrid[i];
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = raid.title + (raid.excluded ? ' [EXCLUDED]' : '');
      nightSelect.appendChild(opt);
    }
    nightSelect.selectedIndex = Math.min(prevIndex, _attendanceGrid.length - 1);
    renderNightGrid(nightSelect.selectedIndex);
  }
}

var ATTENDANCE_STATUSES = [
  'Present',
  'Bench',
  'Late (with notice)',
  'Excused',
  'Late (no notice)',
  'No Show',
  'Extended Leave',
  'Medical Leave',
  'Not on Roster'
];

function renderNightGrid(index) {
  var table = document.getElementById('attendGridTable');
  if (!table || !Array.isArray(_attendanceGrid)) return;

  var raid = _attendanceGrid[index];
  if (!raid) {
    table.innerHTML = '';
    return;
  }

  var html = '<div class="attend-grid-info">';
  html +=
    '<span style="color:var(--text-muted);">' +
    raid.players.length +
    ' player' +
    (raid.players.length !== 1 ? 's' : '') +
    '</span>';
  if (raid.excluded) html += '<span style="color:var(--melee);margin-left:0.75rem;">Excluded from scoring</span>';
  html +=
    '<button id="excludeReportBtn" class="btn btn-muted" style="margin-left:auto;font-size:0.97rem;padding:0.2rem 0.65rem;" onclick="toggleReportExcluded(' +
    index +
    ')">' +
    (raid.excluded ? 'Remove Exclusion' : 'Exclude Report') +
    '</button>';
  html += '</div>';
  html += '<div class="attend-grid-rows">';

  for (var i = 0; i < raid.players.length; i++) {
    var p = raid.players[i];
    html += '<div class="attend-grid-row">';
    html += '<span class="attend-grid-name">' + escHtml(p.name) + '</span>';
    var hasStatus = !!p.status;
    // WCL sync flags a probable late arrival (missed the raid's first pull,
    // present in later ones) by leaving status unset with this source value
    // instead of guessing which Late status applies -- surfaced here so an
    // officer notices it needs manual classification, same idea as the
    // "(no status)" placeholder option below.
    var isLateFlag = p.source === 'WCL (Late?)';
    html +=
      '<span class="attend-grid-source"' +
      (isLateFlag ? ' style="color:var(--gold);font-weight:600;"' : '') +
      '>' +
      escHtml(p.source || '') +
      '</span>';
    html += '<div class="attend-status-wrap">';
    html +=
      '<select class="attend-status-select" data-date="' +
      escHtml(raid.date) +
      '" data-name="' +
      escHtml(p.name) +
      '" data-old="' +
      escHtml(p.status) +
      '" onchange="setPlayerStatus(this)">';
    if (!p.status) html += '<option value="" selected disabled>(no status)</option>';
    for (var j = 0; j < ATTENDANCE_STATUSES.length; j++) {
      var s = ATTENDANCE_STATUSES[j];
      html += '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s + '</option>';
    }
    html += '</select>';
    html += '</div>';
    html += '<span class="attend-save-ind" style="color:var(--heal);">' + (hasStatus ? '&#10003;' : '') + '</span>';
    html += '</div>';
  }

  html += '</div>';
  table.innerHTML = html;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Attendance grid reads still come from the Apps Script Sheet (#218 scope
// note: the WCL sync pipeline that populates new raid nights hasn't moved to
// Supabase yet -- that's #223 -- so migrating reads now would show an empty
// grid for any team without a historical import and a stale one for Phoenix).
// Only the two writes below move to Supabase. Known interim quirk: since the
// grid itself still reads the untouched Sheet, an officer's edit persists
// only for the rest of this browser session (the local _attendanceGrid patch
// below) until reads migrate alongside #223.
function attendFindRosterPlayer(firstName) {
  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) return roster[i];
  }
  return null;
}

function setPlayerStatus(selectEl) {
  var date = selectEl.getAttribute('data-date');
  var firstName = selectEl.getAttribute('data-name');
  var status = selectEl.value;
  var oldStatus = selectEl.getAttribute('data-old');
  var row = selectEl.parentElement;
  var indicator = row ? row.querySelector('.attend-save-ind') : null;

  if (!status) return;
  var player = attendFindRosterPlayer(firstName);
  if (!player || !player.id) {
    selectEl.value = oldStatus || '';
    if (indicator) {
      indicator.textContent = 'Error';
      indicator.style.color = 'var(--melee)';
      setTimeout(function () {
        if (indicator) indicator.textContent = '';
      }, 3000);
    }
    return;
  }

  selectEl.disabled = true;
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.style.color = 'var(--text-muted)';
  }

  supabaseClient
    .from('attendance')
    .upsert(
      { team_id: _teamCfg.supabaseTeamId, player_id: player.id, raid_date: date, status: status, source: 'Officer' },
      { onConflict: 'team_id,player_id,raid_date' }
    )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Attendance Status Set', 'players', player.id, (oldStatus || '(none)') + ' -> ' + status);
    })
    .then(function () {
      selectEl.disabled = false;
      selectEl.setAttribute('data-old', status);
      var nightSelect = document.getElementById('attendNightSelect');
      var idx = nightSelect ? parseInt(nightSelect.value) : -1;
      if (idx >= 0 && Array.isArray(_attendanceGrid) && _attendanceGrid[idx]) {
        var players = _attendanceGrid[idx].players;
        for (var i = 0; i < players.length; i++) {
          if (players[i].name === firstName) {
            players[i].status = status;
            players[i].source = 'Officer';
            break;
          }
        }
      }
      if (indicator) {
        indicator.innerHTML = '&#10003;';
        indicator.style.color = 'var(--heal)';
      }
    })
    .catch(function (err) {
      selectEl.disabled = false;
      selectEl.value = oldStatus || '';
      console.warn('Failed to save attendance status.', err);
      if (indicator) {
        indicator.textContent = 'Error';
        indicator.style.color = 'var(--melee)';
        setTimeout(function () {
          if (indicator) indicator.textContent = '';
        }, 3000);
      }
    });
}

function toggleReportExcluded(index) {
  if (!Array.isArray(_attendanceGrid) || !_attendanceGrid[index]) return;
  var raid = _attendanceGrid[index];
  var btn = document.getElementById('excludeReportBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  var newExcluded = !raid.excluded;
  supabaseClient
    .from('attendance')
    .update({ report_excluded: newExcluded })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('raid_date', raid.date)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog(newExcluded ? 'Report Excluded' : 'Report Exclusion Removed', null, null, raid.date);
    })
    .then(function () {
      raid.excluded = newExcluded;
      // Update dropdown label
      var nightSelect = document.getElementById('attendNightSelect');
      if (nightSelect && nightSelect.options[index]) {
        var baseTitle = raid.title.replace(/ \[EXCLUDED\]$/, '');
        nightSelect.options[index].textContent = baseTitle + (newExcluded ? ' [EXCLUDED]' : '');
      }
      renderNightGrid(index);
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = newExcluded ? 'Exclude Report' : 'Remove Exclusion';
      }
      alert('Failed to update report exclusion: ' + err.message);
    });
}

function refreshAttendanceWCL() {
  var btn = document.getElementById('refreshWCLBtn');
  var status = document.getElementById('refreshWCLStatus');
  var progress = document.getElementById('refreshWCLProgress');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }
  if (status) {
    status.textContent = 'This may take 30-60 seconds...';
    status.style.color = 'var(--text-muted)';
  }
  if (progress) progress.classList.add('active');

  supabaseClient.functions
    .invoke('wcl-sync', { body: { action: 'refreshAttendance', teamId: _teamCfg.supabaseTeamId } })
    .then(function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh from WCL';
      }
      if (progress) progress.classList.remove('active');
      var result = res.data;
      if (!res.error && result && result.success) {
        if (status) {
          status.textContent =
            'Done: ' +
            result.mainNights +
            ' night' +
            (result.mainNights !== 1 ? 's' : '') +
            ' found, ' +
            result.excluded +
            ' excluded.';
          status.style.color = 'var(--heal)';
        }
        _attendanceGrid = null;
        loadAttendanceGrid();
      } else {
        if (status) {
          status.textContent = res.error
            ? res.error.message
            : result && result.error
              ? result.error
              : 'Error refreshing.';
          status.style.color = 'var(--melee)';
        }
      }
    });
}

function confirmCommitScores() {
  var banner = document.getElementById('commitConfirmBanner');
  if (banner) banner.style.display = '';
}

function cancelCommitScores() {
  var banner = document.getElementById('commitConfirmBanner');
  if (banner) banner.style.display = 'none';
}

function executeCommitScores() {
  cancelCommitScores();
  var btn = document.getElementById('commitScoresBtn');
  var status = document.getElementById('commitScoresStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Committing...';
  }
  if (status) status.textContent = '';

  supabaseClient
    .from('attendance')
    .select('player_id, raid_date, status, report_excluded')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);

      var byPlayer = {};
      var nightSet = {};
      (result.data || []).forEach(function (row) {
        if (row.report_excluded) return;
        var weight = ATTENDANCE_WEIGHTS_JS[row.status];
        if (weight === undefined) return;
        if (!byPlayer[row.player_id]) byPlayer[row.player_id] = { sum: 0, nights: 0 };
        byPlayer[row.player_id].sum += weight;
        byPlayer[row.player_id].nights += 1;
        nightSet[row.raid_date] = true;
      });

      var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
      var rows = Object.keys(byPlayer).map(function (playerId) {
        var agg = byPlayer[playerId];
        var ratio = agg.sum / agg.nights;
        return {
          player_id: parseInt(playerId, 10),
          season: season,
          attendance_score: Math.min(Math.round(ratio * 10 * 100) / 100, 10),
          attendance_pct: Math.round(ratio * 1000) / 10
        };
      });
      var totalNights = Object.keys(nightSet).length;

      if (rows.length === 0) return { committed: 0, totalNights: totalNights };

      return supabaseClient
        .from('scoring')
        .upsert(rows, { onConflict: 'player_id,season' })
        .then(function (upsertResult) {
          if (upsertResult.error) throw new Error(upsertResult.error.message);
          return writeAuditLog(
            'Attendance Scores Committed',
            null,
            null,
            rows.length + ' players, ' + totalNights + ' nights'
          ).then(function () {
            return { committed: rows.length, totalNights: totalNights };
          });
        });
    })
    .then(function (summary) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Commit Attendance Scores';
      }
      if (status) {
        status.textContent =
          summary.committed +
          ' players scored (' +
          summary.totalNights +
          ' night' +
          (summary.totalNights !== 1 ? 's' : '') +
          ')';
        status.style.color = 'var(--heal)';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 6000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Commit Attendance Scores';
      }
      if (status) {
        status.textContent = 'Error committing scores: ' + err.message;
        status.style.color = 'var(--melee)';
      }
    });
}
