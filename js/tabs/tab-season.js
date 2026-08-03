function switchSeasonSubTab(name, btnEl) {
  document.querySelectorAll('[id^="season-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ['settings', 'progression', 'history'].forEach(function (sub) {
    var el = document.getElementById('season-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'progression') renderRaidProgressionCards();
  if (name === 'history') renderSeasonHistory();
}

function buildSeasonTab() {
  var startInput = document.getElementById('seasonStartInput');
  if (startInput) startInput.value = (DATA && DATA.seasonStart) || '';
  var nameInput = document.getElementById('seasonNameInput');
  if (nameInput) nameInput.value = (DATA && DATA.seasonName) || '';
  var endInput = document.getElementById('seasonEndInput');
  if (endInput) endInput.value = (DATA && DATA.seasonEnd) || '';
  populateSeasonViewOptions();
  var signupSeasonInput = document.getElementById('signupSeasonInput');
  if (signupSeasonInput) signupSeasonInput.value = (DATA && DATA.signupSeason) || '';
  var trialWeeksInput = document.getElementById('trialWeeksInput');
  var trialAttendInput = document.getElementById('trialAttendInput');
  if (trialWeeksInput) trialWeeksInput.value = DATA && DATA.trialWeeks != null ? DATA.trialWeeks : 4;
  if (trialAttendInput) trialAttendInput.value = DATA && DATA.trialAttend != null ? DATA.trialAttend : 75;
  var targetTankCountInput = document.getElementById('targetTankCountInput');
  var targetHealCountInput = document.getElementById('targetHealCountInput');
  if (targetTankCountInput)
    targetTankCountInput.value = DATA && DATA.targetTankCount != null ? DATA.targetTankCount : '';
  if (targetHealCountInput)
    targetHealCountInput.value = DATA && DATA.targetHealCount != null ? DATA.targetHealCount : '';
  var codePrefixInput = document.getElementById('seasonCodePrefixInput');
  var displayPrefixInput = document.getElementById('seasonDisplayPrefixInput');
  if (codePrefixInput) codePrefixInput.value = (DATA && DATA.seasonCodePrefix) || 'MID';
  if (displayPrefixInput) displayPrefixInput.value = (DATA && DATA.seasonDisplayPrefix) || 'Midnight Season';
  var wclUrlInput = document.getElementById('wclUrlInput');
  if (wclUrlInput) wclUrlInput.value = (DATA && DATA.externalLinks && DATA.externalLinks.warcraftLogsUrl) || '';
  SEASON_RAIDS = JSON.parse(JSON.stringify((DATA && DATA.raidProgression) || []));
  // Reset to Settings subtab; Progression and History render lazily on switch
  var defaultBtn = document.getElementById('season-subtab-btn-settings');
  switchSeasonSubTab('settings', defaultBtn);
}

function renderSeasonHistory() {
  var history = (DATA && DATA.seasonHistory) || [];
  var wrap = document.getElementById('seasonHistoryWrap');
  var list = document.getElementById('seasonHistoryList');
  if (!wrap || !list) return;
  if (!history.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  var html = '';
  for (var i = history.length - 1; i >= 0; i--) {
    var s = history[i];
    var raidCount = s.raids && s.raids.length ? s.raids.length : 0;
    html += '<div style="border-bottom:1px solid rgba(255,255,255,0.06);padding:0.45rem 0 0.6rem;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">';
    html += '<div>';
    html += '<strong style="color:var(--text);">' + (s.name || '(unnamed)') + '</strong>';
    html +=
      '<span style="font-size:0.97rem;color:var(--text-muted);margin-left:0.75rem;">' +
      (s.start || '-') +
      ' to ' +
      (s.end || 'ongoing') +
      '</span>';
    if (raidCount)
      html +=
        '<span style="font-size:0.95rem;color:var(--text-muted);margin-left:0.5rem;">(' +
        raidCount +
        ' raid' +
        (raidCount !== 1 ? 's' : '') +
        ')</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:0.4rem;">';
    if (s.roster) {
      html +=
        '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;white-space:nowrap;" onclick="toggleSeasonSnapshot(' +
        i +
        ', this)">View Roster</button>';
    }
    if (s.bis) {
      html +=
        '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;white-space:nowrap;" onclick="toggleSeasonBisSnapshot(' +
        i +
        ', this)">View BiS</button>';
    }
    html +=
      '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;white-space:nowrap;" onclick="confirmUnarchiveSeason(' +
      i +
      ')">Unarchive</button>';
    html += '</div>';
    html += '</div>';
    if (s.roster) {
      html += '<div id="snapshot-' + i + '" style="display:none;margin-top:0.5rem;"></div>';
    }
    if (s.bis) {
      html += '<div id="bis-snapshot-' + i + '" style="display:none;margin-top:0.5rem;"></div>';
    }
    // #264: WCL season performance fetch is only offered for the most
    // recently archived season -- once a new season has started, that's
    // "the previous season" heroic priority needs a baseline from. Earlier
    // history entries are old news by the time a new season begins.
    if (i === history.length - 1) {
      html += _renderSeasonPerfFetchRow(s, i);
    }
    html += '</div>';
  }
  list.innerHTML = html;
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  if (confirmEl) confirmEl.style.display = 'none';

  var newest = history[history.length - 1];
  if (newest) {
    var newestSeasonCode = seasonCodeForDisplay((newest.name || '').trim());
    _checkSeasonPerfFetchedStatus(history.length - 1, _teamCfg.supabaseTeamId, newestSeasonCode);
  }
}

// #264: only raids with a WCL zone ID recorded can be fetched from.
//
// Multiple raid-progression entries can share the same WCL zone -- most
// seasons have just one raid instance, but a season with several separate
// raid releases (e.g. Dreamrift/Voidspire/March on Quel'Danas were three
// distinct raids across one season, confirmed live) can still have WCL
// scope its performance rankings to one season-wide zone (46) spanning all
// of them, rather than a zone per raid. Since zoneRankings is scoped by
// zone alone, querying any of those raid-progression entries returns
// identical data under a different, confusing label. The picker dedupes to
// one option per distinct zone, using whichever entry in that zone has the
// most bosses as its label (the main raid, as opposed to a shorter release
// sharing the same zone) -- and defaults to the non-mini-raid zone with the
// most total bosses across its entries.
function _renderSeasonPerfFetchRow(season, historyIndex) {
  var raids = (season.raids || []).filter(function (r) {
    return r.wclZoneId;
  });
  if (!raids.length) return '';

  var byZone = {};
  var zoneOrder = [];
  raids.forEach(function (r) {
    var zoneId = r.wclZoneId;
    if (!byZone[zoneId]) {
      byZone[zoneId] = { zoneId: zoneId, label: r, bossCount: 0, allMini: true };
      zoneOrder.push(zoneId);
    }
    var group = byZone[zoneId];
    var bossCount = (r.bosses || []).length;
    group.bossCount += bossCount;
    if (!r.isMiniRaid) group.allMini = false;
    if (bossCount > (group.label.bosses || []).length) group.label = r;
  });
  var zoneGroups = zoneOrder.map(function (zoneId) {
    return byZone[zoneId];
  });

  var defaultIdx = zoneGroups.length - 1;
  var bestBossCount = -1;
  zoneGroups.forEach(function (g, j) {
    if (!g.allMini && g.bossCount > bestBossCount) {
      bestBossCount = g.bossCount;
      defaultIdx = j;
    }
  });

  var html =
    '<div style="margin-top:0.6rem;padding-top:0.5rem;border-top:1px dashed rgba(255,255,255,0.08);display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">';
  html += '<span style="font-size:0.97rem;color:var(--text-muted);">WCL Performance Baseline:</span>';
  html +=
    '<select id="seasonPerfRaidSelect-' +
    historyIndex +
    '" class="add-player-input" style="font-size:0.97rem;padding:0.2rem 0.4rem;">';
  zoneGroups.forEach(function (g, j) {
    html +=
      '<option value="' +
      _escAttr(g.zoneId) +
      '"' +
      (j === defaultIdx ? ' selected' : '') +
      '>' +
      _escAttr(g.label.name || 'Raid ' + (j + 1)) +
      '</option>';
  });
  html += '</select>';
  html +=
    '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;" id="seasonPerfFetchBtn-' +
    historyIndex +
    '" onclick="fetchSeasonPerf(' +
    historyIndex +
    ')">Fetch WCL Performance</button>';
  html += '<span id="seasonPerfFetchStatus-' + historyIndex + '" style="font-size:0.97rem;"></span>';
  // Live "already done or not" indicator (Kat couldn't remember this step
  // existed at all) -- filled in by _checkSeasonPerfFetchedStatus(), fired
  // from renderSeasonHistory() below and re-fired after a successful fetch,
  // so this is visible every time an officer opens Season Settings, not
  // just in the few seconds right after archiving.
  html +=
    '<span id="seasonPerfFetchedStatus-' +
    historyIndex +
    '" style="font-size:0.92rem;color:var(--text-muted);">Checking...</span>';
  html += '</div>';
  return html;
}

// Pure so it's testable without DOM (tests/frontend). count is the number of
// player_wcl_season_perf rows already on file for this team/season.
function _seasonPerfStatusLabel(count) {
  return count > 0
    ? {
        text: 'Already fetched (' + count + ' player' + (count === 1 ? '' : 's') + ').',
        color: 'var(--heal)'
      }
    : { text: 'Not fetched yet -- do this before generating Heroic priority.', color: 'var(--gold)' };
}

// player_wcl_season_perf has a public-read RLS policy (same as streamers/
// team_raid_progress -- see docs/rls_policies.csv), so this is a plain
// client-side count query, no RPC needed.
function _checkSeasonPerfFetchedStatus(historyIndex, teamId, seasonCode) {
  var el = document.getElementById('seasonPerfFetchedStatus-' + historyIndex);
  if (!el || !supabaseClient || !seasonCode) return;
  supabaseClient
    .from('player_wcl_season_perf')
    .select('player_id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('season', seasonCode)
    .then(function (result) {
      var target = document.getElementById('seasonPerfFetchedStatus-' + historyIndex);
      if (!target || result.error) return;
      var label = _seasonPerfStatusLabel(result.count || 0);
      target.textContent = label.text;
      target.style.color = label.color;
    });
}

// #264: officer-triggered, once-per-season fetch of the just-archived
// season's character-page performance (best/median heroic-or-higher DPS
// average per roster player) into player_wcl_season_perf -- the baseline
// heroic priority generation reads before the new season has raid reports
// of its own. Also seeds scoring.performance_score for the new season so
// generate_priority_order has a number to work with immediately, without
// ever overwriting a real executeCommitPerformance() commit (see the
// ignoreDuplicates upsert below).
function fetchSeasonPerf(historyIndex) {
  var history = (DATA && DATA.seasonHistory) || [];
  var season = history[historyIndex];
  var select = document.getElementById('seasonPerfRaidSelect-' + historyIndex);
  var btn = document.getElementById('seasonPerfFetchBtn-' + historyIndex);
  var status = document.getElementById('seasonPerfFetchStatus-' + historyIndex);
  if (!season || !select) return;

  var zoneId = parseInt(select.value, 10);
  var seasonCode = seasonCodeForDisplay((season.name || '').trim());
  if (!zoneId || !seasonCode) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Fetching...';
  }
  if (status) {
    status.textContent = 'This may take a minute...';
    status.style.color = 'var(--text-muted)';
  }

  supabaseClient.functions
    .invoke('wcl-sync', {
      body: { action: 'fetchSeasonPerf', teamId: _teamCfg.supabaseTeamId, season: seasonCode, zoneId: zoneId }
    })
    .then(function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Fetch WCL Performance';
      }
      var result = res.data;
      if (res.error || !result || !result.success) {
        if (status) {
          status.textContent =
            'Error: ' + (result && result.error ? result.error : res.error ? res.error.message : 'Unknown error');
          status.style.color = 'var(--melee)';
        }
        return;
      }
      if (status) {
        status.textContent =
          result.updated + ' player(s) updated' + (result.noData ? ', ' + result.noData + ' with no data' : '') + '.';
        status.style.color = 'var(--heal)';
      }
      _seedScoringFromSeasonPerf(result.players);
      _checkSeasonPerfFetchedStatus(historyIndex, _teamCfg.supabaseTeamId, seasonCode);
    });
}

// Seeds scoring.performance_score for the *current* season from each
// player's fetched previous-season best_perf_avg -- but only for players
// with no scoring row yet this season (ignoreDuplicates: true), so a real
// executeCommitPerformance() commit (js/tabs/tab-scoring.js), now or later,
// is never clobbered by this baseline. Best-effort: not gated on its result,
// same reasoning as this app's other post-write notification/seed calls --
// the player_wcl_season_perf upsert above is the write of record for #264
// itself.
function _seedScoringFromSeasonPerf(players) {
  if (!players || !players.length || !supabaseClient) return;
  var currentSeasonCode = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
  if (!currentSeasonCode) return;

  var rows = players.map(function (p) {
    return {
      player_id: p.playerId,
      season: currentSeasonCode,
      performance_score: p.bestPerfAvg
    };
  });

  supabaseClient.from('scoring').upsert(rows, { onConflict: 'player_id,season', ignoreDuplicates: true });
}

// The roster snapshot lives inline on the seasonHistory entry itself
// (history[index].roster, see archive_current_season() in
// 20260712100000_team_settings_season_config.sql) rather than behind a
// separate lookup key, so this just renders what's already in DATA -- no
// round trip needed (#221 follow-up to the old getRosterSnapshot GAS action).
function toggleSeasonSnapshot(index, btnEl) {
  var panel = document.getElementById('snapshot-' + index);
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    btnEl.textContent = 'View Roster';
    return;
  }
  if (panel.dataset.loaded) {
    panel.style.display = '';
    btnEl.textContent = 'Hide Roster';
    return;
  }
  var history = (DATA && DATA.seasonHistory) || [];
  var season = history[index];
  var players = (season && season.roster) || [];
  panel.dataset.loaded = '1';
  btnEl.textContent = 'Hide Roster';
  if (!players.length) {
    panel.innerHTML = '<p style="font-size:1rem;color:var(--text-muted);">No roster data captured for this season.</p>';
    panel.style.display = '';
    return;
  }
  var roleOrder = { Tank: 0, Heal: 1, Melee: 2, Ranged: 3 };
  players = players.slice().sort(function (a, b) {
    var ra = roleOrder[a.role] !== undefined ? roleOrder[a.role] : 9;
    var rb = roleOrder[b.role] !== undefined ? roleOrder[b.role] : 9;
    if (ra !== rb) return ra - rb;
    return a.nameRealm.localeCompare(b.nameRealm);
  });
  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.97rem;margin-top:0.25rem;">';
  html += '<thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">';
  html += '<th style="padding:0.2rem 0.5rem 0.2rem 0;">Player</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Role</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Status</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Join Date</th>';
  html += '<th style="padding:0.2rem 0;">Attendance</th>';
  html += '</tr></thead><tbody>';
  players.forEach(function (p) {
    var status = p.isBench ? 'Bench' : p.isTrial ? 'Trial' : 'Roster';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<td style="padding:0.18rem 0.5rem 0.18rem 0;color:var(--text);">' + p.nameRealm + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + (p.role || '-') + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + status + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + (p.joinDate || '-') + '</td>';
    html += '<td style="padding:0.18rem 0;color:var(--text-muted);">' + (p.attendance || '-') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  panel.style.display = '';
}

// Same inline-snapshot pattern as toggleSeasonSnapshot above, for the BiS
// list captured at archive time (history[index].bis, see
// archive_current_season() in 20260714173649_archive_season_resets_bis_mplus.sql).
// Placeholder entries (M+/Crafted/Catalyst) are included in the snapshot even
// though their live bis_items rows survive the archive-time wipe -- this is a
// point-in-time record of what officers saw then, not a reflection of what's
// live now.
function toggleSeasonBisSnapshot(index, btnEl) {
  var panel = document.getElementById('bis-snapshot-' + index);
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    btnEl.textContent = 'View BiS';
    return;
  }
  if (panel.dataset.loaded) {
    panel.style.display = '';
    btnEl.textContent = 'Hide BiS';
    return;
  }
  var history = (DATA && DATA.seasonHistory) || [];
  var season = history[index];
  var rows = (season && season.bis) || [];
  panel.dataset.loaded = '1';
  btnEl.textContent = 'Hide BiS';
  if (!rows.length) {
    panel.innerHTML = '<p style="font-size:1rem;color:var(--text-muted);">No BiS data captured for this season.</p>';
    panel.style.display = '';
    return;
  }
  rows = rows.slice().sort(function (a, b) {
    if (a.nameRealm !== b.nameRealm) return a.nameRealm.localeCompare(b.nameRealm);
    return (a.item || '').localeCompare(b.item || '');
  });
  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.97rem;margin-top:0.25rem;">';
  html += '<thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">';
  html += '<th style="padding:0.2rem 0.5rem 0.2rem 0;">Player</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Item</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Slot</th>';
  html += '<th style="padding:0.2rem 0;">Obtained</th>';
  html += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<td style="padding:0.18rem 0.5rem 0.18rem 0;color:var(--text);">' + r.nameRealm + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text);">' + (r.item || '-') + '</td>';
    html += '<td style="padding:0.18rem 0.5rem;color:var(--text-muted);">' + (r.slot || '-') + '</td>';
    html +=
      '<td style="padding:0.18rem 0;color:' +
      (r.obtained ? 'var(--heal)' : 'var(--text-muted)') +
      ';">' +
      (r.obtained ? 'Yes' : 'No') +
      '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  panel.style.display = '';
}

var _unarchiveIndex = -1;

function confirmUnarchiveSeason(index) {
  _unarchiveIndex = index;
  var history = (DATA && DATA.seasonHistory) || [];
  var s = history[index] || {};
  var msg = document.getElementById('seasonUnarchiveConfirmMsg');
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  if (msg) {
    var text = 'Restore "' + (s.name || '(unnamed)') + '" as the active season?';
    if (DATA && DATA.seasonName) {
      text +=
        ' The current active season ("' +
        DATA.seasonName +
        '") will be overwritten. Archive it first if you want to keep it.';
    }
    msg.textContent = text;
  }
  if (confirmEl) confirmEl.style.display = '';
}

function executeUnarchiveSeason() {
  var confirmEl = document.getElementById('seasonUnarchiveConfirm');
  var status = document.getElementById('seasonUnarchiveStatus');
  var btn = document.getElementById('seasonUnarchiveExecBtn');
  if (confirmEl) confirmEl.style.display = 'none';
  if (btn) btn.disabled = true;
  var index = _unarchiveIndex;

  supabaseClient
    .rpc('unarchive_season', { p_team_id: _teamCfg.supabaseTeamId, p_index: index })
    .then(function (result) {
      if (btn) btn.disabled = false;
      if (result.error) throw new Error(result.error.message);
      var season = result.data.season;
      DATA.seasonName = season.name || '';
      DATA.seasonStart = season.start || '';
      DATA.seasonEnd = season.end || '';
      DATA.raidProgression = season.raids || [];
      DATA.seasonHistory = result.data.config.seasonHistory || [];
      _unarchiveIndex = -1;
      buildSeasonTab();
      populateSeasonSelector();
      return writeAuditLog('Season Unarchived', null, null, season.name || '');
    })
    .then(function () {
      if (status) {
        status.textContent = 'Season restored.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (status) status.textContent = err.message || 'Error restoring season.';
    });
}

function confirmClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonStartInput');
  if (input) input.value = '';
  saveSeasonStart();
}

function confirmClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonEndInput');
  if (input) input.value = '';
  saveSeasonEnd();
}

function confirmArchiveSeason() {
  var name = (DATA && DATA.seasonName) || '';
  var msg = document.getElementById('seasonArchiveConfirmMsg');
  if (msg) {
    if (!name) {
      msg.textContent = 'No current season name is set. Please set a Season Name before archiving.';
      document.getElementById('seasonArchiveExecBtn').style.display = 'none';
    } else {
      msg.textContent =
        'Archive "' +
        name +
        '"? The current season name, start date, and end date will be moved to history and cleared. Every player\'s BiS list (real items -- M+/Crafted/Catalyst entries are kept) will be snapshotted into history, then wiped, their submitted BiS source will be cleared, and M+ exclusion and Bench status will reset for the whole roster (Trial status is left alone). The new season name will be applied automatically as "' +
        CURRENT_SEASON.displayName +
        '". Set a new Season Start Date for it afterward.';
      document.getElementById('seasonArchiveExecBtn').style.display = '';
    }
  }
  var el = document.getElementById('seasonArchiveConfirm');
  if (el) el.style.display = '';
}

// Roster snapshot is computed client-side from the roster already in DATA
// (nameRealm/role/isTrial/isBench/joinDate/attendance -- the same fields the
// old GAS archiveSeason() read straight off the sheets) and passed to the
// archive_current_season RPC, which stores it inline on the new history
// entry rather than in a separate lookup key (#221).
function buildSeasonArchiveRosterSnapshot() {
  var roster = (DATA && DATA.roster) || [];
  return roster.map(function (p) {
    return {
      nameRealm: p.nameRealm,
      role: p.role,
      isTrial: !!p.isTrial,
      isBench: !!p.isBench,
      joinDate: p.joinDate || '',
      attendance: p.attendance || ''
    };
  });
}

function executeArchiveSeason() {
  var el = document.getElementById('seasonArchiveConfirm');
  var status = document.getElementById('seasonArchiveStatus');
  var btn = document.getElementById('seasonArchiveExecBtn');
  if (el) el.style.display = 'none';
  if (btn) {
    btn.disabled = true;
  }
  var archivedName = DATA.seasonName;

  supabaseClient
    .rpc('archive_current_season', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_roster_snapshot: buildSeasonArchiveRosterSnapshot()
    })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var config = result.data;
      DATA.seasonName = config.seasonName || '';
      DATA.seasonStart = config.seasonStart || '';
      DATA.seasonEnd = config.seasonEnd || '';
      DATA.raidProgression = config.raidProgression || [];
      DATA.seasonHistory = config.seasonHistory || [];
      // Combine archive + auto-name into one click (#537): fill the new
      // season's name straight from CURRENT_SEASON instead of leaving it
      // blank for an officer to retype. seasonView: null resets any
      // forward-looking "planning" pointer (#549) back to "default to live"
      // now that the planned season just became the live one.
      // skipAudit: true -- this is an incidental follow-up (auto-filling the
      // new season's name/clearing seasonView), not the archive itself; the
      // meaningful event is already logged below as "Season Archived".
      return saveTeamSetting({ seasonName: CURRENT_SEASON.displayName, seasonView: null }, true);
    })
    .then(function (config) {
      if (btn) btn.disabled = false;
      DATA.seasonName = config.seasonName || '';
      DATA.seasonView = config.seasonView || null;
      SEASON_RAIDS = [];
      buildSeasonTab();
      populateSeasonSelector();
      return writeAuditLog('Season Archived', null, null, archivedName);
    })
    .then(function () {
      if (status) {
        status.textContent = 'Season archived.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
      // archive_current_season() also wipes real-item bis_items rows and
      // resets m_plus_excluded server-side -- the in-memory DATA.bisList and
      // roster still hold the pre-archive values until refetched, same
      // staleness officerRenamePlayer works around with a full reload rather
      // than patching state in place.
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
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (status) status.textContent = err.message || 'Error archiving season.';
    });
}

// Options come from raid_zones.season (DATA.raidZones, #285/#549), not a
// free-typed value -- making a season selectable here is just adding its
// raid_zones row, a step already required for that tier eventually anyway.
// Preserves the current DATA.seasonView selection (even if it's since fallen
// out of DATA.raidZones) so the dropdown doesn't silently reset it.
function populateSeasonViewOptions() {
  var select = document.getElementById('seasonViewInput');
  if (!select) return;
  var seasons = [];
  var seen = {};
  ((DATA && DATA.raidZones) || []).forEach(function (rz) {
    if (rz.season && !seen[rz.season]) {
      seen[rz.season] = true;
      seasons.push(rz.season);
    }
  });
  var current = (DATA && DATA.seasonView) || '';
  if (current && !seen[current]) seasons.push(current);
  seasons.sort();
  select.innerHTML =
    '<option value="">Live season (current)</option>' +
    seasons
      .map(function (s) {
        return '<option value="' + _esc(s) + '">' + _esc(s) + '</option>';
      })
      .join('');
  select.value = current;
}

function saveSeasonView() {
  var input = document.getElementById('seasonViewInput');
  var val = input ? input.value : '';
  var btn = document.getElementById('seasonViewSaveBtn');
  var status = document.getElementById('seasonViewStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonView: val || null })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonView = val || null;
      // Season View changes both what counts as unmanaged/conflicted
      // (isItemInSeasonScope) and which priority_order rows are in scope at
      // all -- DATA.priorityOrder is otherwise locked to whichever season
      // was active when applyHeavyData() first ran (common.js's
      // remapPriorityDataForSeasonView() re-derives it from the cached raw
      // rows). Without both calls, an already-open Priority tab shows
      // stale/empty data until a full page reload.
      if (typeof remapPriorityDataForSeasonView === 'function') remapPriorityDataForSeasonView();
      if (typeof refreshVisiblePriorityTab === 'function') refreshVisiblePriorityTab();
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSignupSeason() {
  var input = document.getElementById('signupSeasonInput');
  var val = input ? input.value.trim() : '';
  var btn = document.getElementById('signupSeasonSaveBtn');
  var status = document.getElementById('signupSeasonStatus');
  if (!val) {
    if (status) {
      status.textContent = 'Season name cannot be blank.';
      setTimeout(function () {
        if (status) status.textContent = '';
      }, 3000);
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ activeSignupSeason: val })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.signupSeason = val;
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonName() {
  var input = document.getElementById('seasonNameInput');
  var val = input ? input.value.trim() : '';
  var btn = document.getElementById('seasonNameSaveBtn');
  var status = document.getElementById('seasonNameStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonName: val }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonName = val;
      if (input) input.value = val;
      populateSeasonSelector();
      writeAuditLog('Season Name Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

// Only needed once a season code stops matching the current
// <codePrefix><N>/<displayPrefix> N pattern -- an expansion change, not a
// routine new season within Midnight (js/common.js seasonDisplayName()/
// seasonCodeForDisplay(), #341). Blank inputs fall back to the shipped
// defaults ('MID'/'Midnight Season') rather than saving an empty prefix that
// would match every season code.
function saveSeasonCodePrefixes() {
  var codeInput = document.getElementById('seasonCodePrefixInput');
  var displayInput = document.getElementById('seasonDisplayPrefixInput');
  var codeVal = (codeInput ? codeInput.value.trim() : '') || 'MID';
  var displayVal = (displayInput ? displayInput.value.trim() : '') || 'Midnight Season';
  var btn = document.getElementById('seasonCodePrefixSaveBtn');
  var status = document.getElementById('seasonCodePrefixStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonCodePrefix: codeVal, seasonDisplayPrefix: displayVal }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) {
        DATA.seasonCodePrefix = codeVal;
        DATA.seasonDisplayPrefix = displayVal;
      }
      if (codeInput) codeInput.value = codeVal;
      if (displayInput) displayInput.value = displayVal;
      writeAuditLog('Season Code Prefix Changed', null, null, codeVal + ' / ' + displayVal);
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

// Per-team WCL guild link (#288). Saved as its own externalLinks key
// (rather than folded into an existing settings key) so a future per-team
// link can be added the same way without touching this one.
function saveWclUrl() {
  var input = document.getElementById('wclUrlInput');
  var val = input ? input.value.trim() : '';
  var btn = document.getElementById('wclUrlSaveBtn');
  var status = document.getElementById('wclUrlStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ externalLinks: { warcraftLogsUrl: val } }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.externalLinks = { warcraftLogsUrl: val };
      if (input) input.value = val;
      if (typeof renderExternalWclLink === 'function') renderExternalWclLink();
      writeAuditLog('WarcraftLogs Guild URL Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonStart() {
  var input = document.getElementById('seasonStartInput');
  var val = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn = document.getElementById('seasonStartSaveBtn');
  var status = document.getElementById('seasonStartStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonStart: val }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonStart = val;
      if (input) input.value = val;
      populateSeasonSelector();
      writeAuditLog('Season Start Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveSeasonEnd() {
  var input = document.getElementById('seasonEndInput');
  var val = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn = document.getElementById('seasonEndSaveBtn');
  var status = document.getElementById('seasonEndStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ seasonEnd: val }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) DATA.seasonEnd = val;
      if (input) input.value = val;
      writeAuditLog('Season End Set', null, null, val);
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

// -- Raid Progression --

var SEASON_RAIDS = [];

function raidAddRaid() {
  raidCollectFromDOM();
  SEASON_RAIDS.push({
    name: '',
    wclZoneId: '',
    encounterStart: '',
    encounterEnd: '',
    isMiniRaid: false,
    bosses: [],
    aotcDate: ''
  });
  renderRaidProgressionCards();
}

function raidRemoveRaid(idx) {
  raidCollectFromDOM();
  SEASON_RAIDS.splice(idx, 1);
  renderRaidProgressionCards();
}

function raidAddBoss(raidIdx) {
  raidCollectFromDOM();
  SEASON_RAIDS[raidIdx].bosses.push({ name: '', mythicDate: '' });
  renderRaidProgressionCards();
}

function raidRemoveBoss(raidIdx, bossIdx) {
  raidCollectFromDOM();
  SEASON_RAIDS[raidIdx].bosses.splice(bossIdx, 1);
  renderRaidProgressionCards();
}

// -- Boss reordering (drag-and-drop) --

var _raidBossDrag = { raidIdx: -1, bossIdx: -1 };

function raidBossDragStart(e, raidIdx, bossIdx) {
  raidCollectFromDOM();
  _raidBossDrag.raidIdx = raidIdx;
  _raidBossDrag.bossIdx = bossIdx;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function raidBossDragOver(e, raidIdx, bossIdx) {
  if (raidIdx !== _raidBossDrag.raidIdx) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var rows = document.querySelectorAll('.raid-boss-row');
  rows.forEach(function (el) {
    el.classList.remove('drag-over');
  });
  if (bossIdx !== _raidBossDrag.bossIdx) e.currentTarget.classList.add('drag-over');
}

function raidBossDrop(e, raidIdx, toIdx) {
  if (raidIdx !== _raidBossDrag.raidIdx) return;
  e.preventDefault();
  var fromIdx = _raidBossDrag.bossIdx;
  if (fromIdx === toIdx || fromIdx < 0) return;
  var bosses = SEASON_RAIDS[raidIdx].bosses;
  var moved = bosses.splice(fromIdx, 1)[0];
  bosses.splice(toIdx, 0, moved);
  _raidBossDrag.raidIdx = -1;
  _raidBossDrag.bossIdx = -1;
  renderRaidProgressionCards();
}

function raidBossDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.raid-boss-row').forEach(function (el) {
    el.classList.remove('drag-over');
  });
  _raidBossDrag.raidIdx = -1;
  _raidBossDrag.bossIdx = -1;
}

function raidCollectFromDOM() {
  var wrap = document.getElementById('raidProgressionCards');
  if (!wrap) return;
  var raidEls = wrap.querySelectorAll('.raid-prog-block');
  for (var i = 0; i < raidEls.length; i++) {
    if (!SEASON_RAIDS[i]) continue;
    var nameEl = raidEls[i].querySelector('.raid-name-input');
    var miniEl = raidEls[i].querySelector('.raid-mini-check');
    var aotcEl = raidEls[i].querySelector('.raid-aotc-input');
    var zoneEl = raidEls[i].querySelector('.raid-zone-input');
    if (nameEl) SEASON_RAIDS[i].name = nameEl.value.trim();
    if (miniEl) SEASON_RAIDS[i].isMiniRaid = miniEl.checked;
    if (aotcEl) SEASON_RAIDS[i].aotcDate = aotcEl.value;
    if (zoneEl) SEASON_RAIDS[i].wclZoneId = zoneEl.value.trim();
    var encStartEl = raidEls[i].querySelector('.raid-enc-start');
    var encEndEl = raidEls[i].querySelector('.raid-enc-end');
    if (encStartEl) SEASON_RAIDS[i].encounterStart = encStartEl.value.trim();
    if (encEndEl) SEASON_RAIDS[i].encounterEnd = encEndEl.value.trim();
    var bossEls = raidEls[i].querySelectorAll('.raid-boss-row');
    for (var j = 0; j < bossEls.length; j++) {
      if (!SEASON_RAIDS[i].bosses[j]) continue;
      var bnEl = bossEls[j].querySelector('.boss-name-input');
      var bdEl = bossEls[j].querySelector('.boss-date-input');
      if (bnEl) SEASON_RAIDS[i].bosses[j].name = bnEl.value.trim();
      if (bdEl) SEASON_RAIDS[i].bosses[j].mythicDate = bdEl.value;
    }
  }
}

function renderRaidProgressionCards() {
  var wrap = document.getElementById('raidProgressionCards');
  if (!wrap) return;
  if (!SEASON_RAIDS.length) {
    wrap.innerHTML =
      '<p style="font-size:1rem;color:var(--text-muted);">No raids added yet. Click "+ Add Raid" to start.</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < SEASON_RAIDS.length; i++) {
    var raid = SEASON_RAIDS[i];
    var isMini = !!raid.isMiniRaid;
    html +=
      '<div class="raid-prog-block" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;">';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="raid-name-input add-player-input" placeholder="Raid name (e.g. Liberation of Undermine)" value="' +
      _escAttr(raid.name) +
      '" style="flex:1;min-width:200px;font-size:1.07rem;padding:0.35rem 0.6rem;">';
    html +=
      '<label style="display:flex;align-items:center;gap:5px;font-size:0.97rem;color:var(--text-muted);cursor:pointer;white-space:nowrap;"><input type="checkbox" class="raid-mini-check"' +
      (isMini ? ' checked' : '') +
      ' onchange="raidToggleMini(' +
      i +
      ',this)"> Mini-raid</label>';
    html +=
      '<button class="btn btn-danger" style="padding:2px 10px;font-size:0.93rem;" onclick="raidRemoveRaid(' +
      i +
      ')">Remove</button>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html += '<span style="font-size:0.95rem;color:var(--text-muted);white-space:nowrap;">WCL Zone ID</span>';
    html +=
      '<input class="raid-zone-input add-player-input" type="number" placeholder="e.g. 46" value="' +
      _escAttr(raid.wclZoneId || '') +
      '" style="width:80px;font-size:1rem;padding:0.28rem 0.5rem;">';
    html +=
      '<button class="btn btn-muted" style="font-size:0.91rem;padding:2px 8px;" onclick="listWclEncounters(' +
      i +
      ')">List</button>';
    html += '</div>';
    html +=
      '<p style="font-size:0.93rem;color:var(--melee);margin:0 0 0.5rem;">Click List first to see encounter IDs and set the Encounters from/to range -- fetching without narrowing the range pulls every fight logged in that zone, including M+ dungeon bosses.</p>';
    html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.75rem;">';
    html += '<span style="font-size:0.95rem;color:var(--text-muted);white-space:nowrap;">Encounters</span>';
    html +=
      '<input class="raid-enc-start add-player-input" type="number" placeholder="from" value="' +
      _escAttr(raid.encounterStart || '') +
      '" style="width:70px;font-size:1rem;padding:0.28rem 0.5rem;">';
    html += '<span style="font-size:0.95rem;color:var(--text-muted);">-</span>';
    html +=
      '<input class="raid-enc-end add-player-input" type="number" placeholder="to" value="' +
      _escAttr(raid.encounterEnd || '') +
      '" style="width:70px;font-size:1rem;padding:0.28rem 0.5rem;">';
    html +=
      '<button class="btn btn-muted" style="font-size:0.95rem;padding:3px 12px;" onclick="fetchWclForRaid(' +
      i +
      ')">Fetch from WCL</button>';
    html += '<span id="wclFetchStatus_' + i + '" style="font-size:0.93rem;color:var(--text-muted);"></span>';
    html += '</div>';
    html +=
      '<div id="wclEncList_' +
      i +
      '" style="display:none;font-size:0.93rem;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:4px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;line-height:1.8;"></div>';
    if (!isMini) {
      html += '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">';
      html += '<span style="font-size:0.97rem;color:var(--text-muted);white-space:nowrap;">AOTC Date</span>';
      html +=
        '<input type="date" class="raid-aotc-input add-player-input" value="' +
        _escAttr(raid.aotcDate || '') +
        '" style="max-width:170px;font-size:1.02rem;padding:0.3rem 0.5rem;">';
      html += '</div>';
    }
    html +=
      '<div style="font-size:0.93rem;color:var(--text-muted);margin-bottom:0.4rem;font-weight:600;letter-spacing:0.04em;">BOSSES</div>';
    if (raid.bosses.length) {
      html += '<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.5rem;">';
      for (var j = 0; j < raid.bosses.length; j++) {
        var boss = raid.bosses[j];
        html +=
          '<div class="raid-boss-row prio-drag-item" draggable="true"' +
          ' ondragstart="raidBossDragStart(event,' +
          i +
          ',' +
          j +
          ')"' +
          ' ondragover="raidBossDragOver(event,' +
          i +
          ',' +
          j +
          ')"' +
          ' ondrop="raidBossDrop(event,' +
          i +
          ',' +
          j +
          ')"' +
          ' ondragend="raidBossDragEnd(event)"' +
          '>';
        html += '<span class="prio-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>';
        html +=
          '<span style="font-size:0.93rem;color:var(--text-muted);min-width:1.2rem;text-align:right;">' +
          (j + 1) +
          '</span>';
        html +=
          '<input class="boss-name-input add-player-input" placeholder="Boss name" value="' +
          _escAttr(boss.name) +
          '" style="flex:1;font-size:1rem;padding:0.28rem 0.5rem;">';
        html += '<span style="font-size:0.91rem;color:var(--text-muted);white-space:nowrap;">Mythic kill</span>';
        html +=
          '<input type="date" class="boss-date-input add-player-input" value="' +
          _escAttr(boss.mythicDate || '') +
          '" style="width:150px;font-size:1rem;padding:0.28rem 0.5rem;">';
        html +=
          '<button class="btn btn-muted" style="padding:2px 8px;font-size:0.91rem;" onclick="raidRemoveBoss(' +
          i +
          ',' +
          j +
          ')">&times;</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    html +=
      '<button class="btn btn-muted" style="font-size:0.93rem;padding:3px 10px;" onclick="raidAddBoss(' +
      i +
      ')">+ Add Boss</button>';
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function raidToggleMini(idx, checkbox) {
  raidCollectFromDOM();
  SEASON_RAIDS[idx].isMiniRaid = checkbox.checked;
  if (checkbox.checked) SEASON_RAIDS[idx].aotcDate = '';
  renderRaidProgressionCards();
}

function _escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// #223 stage 1: these two used to call GAS (?action=getWclZoneEncounters /
// ?action=fetchWclProgression); both now go through the wcl-sync Edge
// Function instead, which forwards this session's own JWT so the function's
// officer/team_leader/site_admin check runs as this user (see the function's
// own header comment for why no service-role key is involved).
// getZoneEncounters queries WCL's static zone/encounter data (worldData.zone),
// not the guild's own reports -- unlike fetchWclForRaid()/fetchProgression
// (guild-scoped, needs logged fights), this works before a single fight has
// been logged. Renders each encounter as a checkbox (checked by default) so
// "Add Selected" can push exact WCL names straight into SEASON_RAIDS[idx]
// .bosses without an officer retyping/misspelling them by hand -- useful
// specifically for setting up a season's boss list ahead of the raid going
// live, when there's nothing yet for "Fetch from WCL" to pull kill dates from.
function listWclEncounters(idx) {
  raidCollectFromDOM();
  var zoneId = SEASON_RAIDS[idx].wclZoneId ? parseInt(SEASON_RAIDS[idx].wclZoneId, 10) : 0;
  if (!zoneId || isNaN(zoneId)) {
    alert('Enter a WCL Zone ID first.');
    return;
  }

  var el = document.getElementById('wclEncList_' + idx);
  if (el) {
    el.style.display = '';
    el.textContent = 'Loading...';
  }

  supabaseClient.functions
    .invoke('wcl-sync', { body: { action: 'getZoneEncounters', teamId: _teamCfg.supabaseTeamId, zoneId: zoneId } })
    .then(function (result) {
      if (!el) return;
      if (result.error || !result.data || !result.data.success) {
        el.textContent = result.error
          ? result.error.message
          : 'Error: ' + ((result.data && result.data.error) || 'Unknown');
        return;
      }
      var encounters = result.data.encounters || [];
      if (!encounters.length) {
        el.textContent = 'No encounters found for this zone.';
        return;
      }
      var rows = encounters
        .map(function (e) {
          return (
            '<label style="display:block;cursor:pointer;">' +
            '<input type="checkbox" class="wcl-enc-check" data-enc-id="' +
            e.id +
            '" data-enc-name="' +
            _escAttr(e.name) +
            '" checked> ' +
            e.id +
            ' -- ' +
            _esc(e.name) +
            '</label>'
          );
        })
        .join('');
      el.innerHTML =
        '<strong style="color:var(--text);">' +
        _esc(result.data.zoneName || 'Zone ' + zoneId) +
        '</strong>' +
        '<div style="margin:0.4rem 0;">' +
        '<a href="#" onclick="wclEncSelectAll(' +
        idx +
        ',true);return false;" style="color:var(--gold);">Select All</a>' +
        ' <span style="color:var(--text-muted);">|</span> ' +
        '<a href="#" onclick="wclEncSelectAll(' +
        idx +
        ',false);return false;" style="color:var(--gold);">Select None</a>' +
        '</div>' +
        rows +
        '<button class="btn btn-gold" style="margin-top:0.5rem;font-size:0.91rem;padding:3px 10px;" onclick="addWclEncounters(' +
        idx +
        ')">Add Selected as Bosses</button>';
    });
}

function wclEncSelectAll(idx, checked) {
  var el = document.getElementById('wclEncList_' + idx);
  if (!el) return;
  el.querySelectorAll('.wcl-enc-check').forEach(function (cb) {
    cb.checked = checked;
  });
}

// Appends the checked encounters as bosses on SEASON_RAIDS[idx], skipping any
// whose wclEncounterId already has a boss entry so re-clicking after adding
// more bosses by hand (or running this twice) doesn't create duplicates.
// mythicDate stays blank -- only fetchWclForRaid() (guild-scoped, needs
// logged fights) knows kill dates. Reuses the raid card's own
// wclFetchStatus_<idx> span (defined outside the encounter-list container
// this function reads from) for the result message, since
// renderRaidProgressionCards() rebuilds the whole card -- including that
// list -- so a status element written inside it would already be gone by
// the time anyone could read it.
function addWclEncounters(idx) {
  raidCollectFromDOM();
  var el = document.getElementById('wclEncList_' + idx);
  if (!el) return;
  var existingIds = {};
  (SEASON_RAIDS[idx].bosses || []).forEach(function (b) {
    if (b.wclEncounterId != null) existingIds[b.wclEncounterId] = true;
  });
  var added = 0;
  el.querySelectorAll('.wcl-enc-check:checked').forEach(function (cb) {
    var encId = parseInt(cb.getAttribute('data-enc-id'), 10);
    if (!encId || existingIds[encId]) return;
    SEASON_RAIDS[idx].bosses.push({
      name: cb.getAttribute('data-enc-name') || '',
      mythicDate: '',
      wclEncounterId: encId
    });
    existingIds[encId] = true;
    added++;
  });
  renderRaidProgressionCards();
  var status = document.getElementById('wclFetchStatus_' + idx);
  if (status) {
    status.textContent = added ? 'Added ' + added + ' boss(es).' : 'Nothing new to add.';
    setTimeout(function () {
      if (status) status.textContent = '';
    }, 3000);
  }
}

function fetchWclForRaid(idx) {
  raidCollectFromDOM();
  var raid = SEASON_RAIDS[idx];
  var zoneId = raid.wclZoneId ? parseInt(raid.wclZoneId, 10) : 0;
  if (!zoneId || isNaN(zoneId)) {
    alert('Enter a WCL Zone ID first.');
    return;
  }

  var status = document.getElementById('wclFetchStatus_' + idx);
  if (status) {
    status.textContent = 'Fetching from WCL...';
  }

  supabaseClient.functions
    .invoke('wcl-sync', { body: { action: 'fetchProgression', teamId: _teamCfg.supabaseTeamId, zoneId: zoneId } })
    .then(function (result) {
      if (result.error || !result.data || !result.data.success) {
        if (status)
          status.textContent = result.error
            ? result.error.message
            : 'Error: ' + ((result.data && result.data.error) || 'Unknown');
        return;
      }
      var data = result.data;
      var encStart = parseInt(SEASON_RAIDS[idx].encounterStart, 10) || 0;
      var encEnd = parseInt(SEASON_RAIDS[idx].encounterEnd, 10) || 0;
      var filtered = (data.bosses || []).filter(function (b) {
        if (encStart && b.encounterID < encStart) return false;
        if (encEnd && b.encounterID > encEnd) return false;
        return true;
      });
      SEASON_RAIDS[idx].bosses = filtered.map(function (b) {
        return { name: b.name || '', mythicDate: b.mythicDate || '', wclEncounterId: b.encounterID };
      });
      var lastInRange = filtered[filtered.length - 1];
      if (!SEASON_RAIDS[idx].isMiniRaid && lastInRange && lastInRange.heroicDate) {
        SEASON_RAIDS[idx].aotcDate = lastInRange.heroicDate;
      }
      renderRaidProgressionCards();
      var s = document.getElementById('wclFetchStatus_' + idx);
      if (s) {
        s.textContent = 'Fetched ' + SEASON_RAIDS[idx].bosses.length + ' boss(es)!';
        setTimeout(function () {
          if (s) s.textContent = '';
        }, 3000);
      }
    });
}

function saveRaidProgression() {
  raidCollectFromDOM();
  var btn = document.getElementById('raidSaveBtn');
  var status = document.getElementById('raidProgressionStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ raidProgression: SEASON_RAIDS }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Progression';
      }
      DATA.raidProgression = JSON.parse(JSON.stringify(SEASON_RAIDS));
      writeAuditLog('Raid Progression Saved', null, null, SEASON_RAIDS.length + ' raid(s)');
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2500);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Progression';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

// Blank means "no target configured" (null), not a default like Trial
// Thresholds' 4wk/75% -- a team that's never set this shouldn't suddenly
// see a "we have enough" nudge appear on the signup form for a number they
// never chose.
function saveRosterTargets() {
  var tankInput = document.getElementById('targetTankCountInput');
  var healInput = document.getElementById('targetHealCountInput');
  var btn = document.getElementById('rosterTargetsSaveBtn');
  var status = document.getElementById('rosterTargetsStatus');
  var tankParsed = parseInt(tankInput ? tankInput.value : '', 10);
  var healParsed = parseInt(healInput ? healInput.value : '', 10);
  var tankCount = isNaN(tankParsed) ? null : Math.max(0, Math.min(20, tankParsed));
  var healCount = isNaN(healParsed) ? null : Math.max(0, Math.min(20, healParsed));
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ targetTankCount: tankCount, targetHealCount: healCount }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) {
        DATA.targetTankCount = tankCount;
        DATA.targetHealCount = healCount;
      }
      writeAuditLog(
        'Roster Targets Set',
        null,
        null,
        (tankCount == null ? '-' : tankCount) + ' tank / ' + (healCount == null ? '-' : healCount) + ' heal'
      );
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}

function saveTrialThresholds() {
  var weeksInput = document.getElementById('trialWeeksInput');
  var attendInput = document.getElementById('trialAttendInput');
  var btn = document.getElementById('trialThresholdsSaveBtn');
  var status = document.getElementById('trialThresholdsStatus');
  var weeks = Math.max(1, Math.min(52, parseInt(weeksInput ? weeksInput.value : 4) || 4));
  var attend = Math.max(0, Math.min(100, parseInt(attendInput ? attendInput.value : 75) || 75));
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ trialWeeks: weeks, trialAttend: attend }, true)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (DATA) {
        DATA.trialWeeks = weeks;
        DATA.trialAttend = attend;
      }
      PROMO_THRESHOLDS.weeks = weeks;
      PROMO_THRESHOLDS.attend = attend;
      writeAuditLog('Trial Thresholds Set', null, null, weeks + ' wk / ' + attend + '%');
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}
