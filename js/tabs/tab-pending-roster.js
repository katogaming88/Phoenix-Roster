var _pendingRosterEntries = [];
var _pendingMissingSignups = [];
var _pendingFilterRole = null;
var _pendingSwapOnly = false;
var _pendingSortKey = 'name';
var _pendingSelected = {}; // signupId -> true, for checked entries in the selection-based push
var _pendingTrialOverride = {}; // signupId -> true/false, user's manual Trial toggle (survives re-render)
var _pendingBackupTankOverride = {}; // signupId -> true/false, manual Backup Tank toggle (survives re-render)
var _pendingBackupHealerOverride = {}; // signupId -> true/false, manual Backup Healer toggle (survives re-render)
var _pendingSwapOverride = {}; // signupId -> selected archive player id, survives re-render
var _pendingBatchMessage = ''; // last "N of M added, ..." summary from a batch push

// Map of nameRealm.toLowerCase() -> current roster player, for diff/conflict checks.
function buildPendingRosterMap() {
  var map = {};
  var roster = (window.DATA && DATA.roster) || [];
  roster.forEach(function (p) {
    if (p.nameRealm) map[p.nameRealm.toLowerCase()] = p;
  });
  return map;
}

// Maps a pending_roster view row to the shape the render functions expect.
function mapPendingRosterRow(row) {
  return {
    signupId: row.signup_id,
    nameRealm: row.signup_name_realm,
    className: row.class || '',
    mainSpec: row.spec || '',
    role: row.role || '',
    offSpecs: row.off_specs || '',
    mainSwap: !!row.main_swap,
    notes: row.player_note || '',
    officerNote: row.signup_officer_note || '',
    season: row.season || '',
    swapFromNameRealm: row.swap_from_name_realm || ''
  };
}

function buildPendingRosterTab() {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading...</p>';

  var loaded = { entries: false, missing: false };
  _pendingRosterEntries = [];
  _pendingMissingSignups = [];
  _pendingSelected = {};
  _pendingBatchMessage = '';

  function tryRender() {
    if (!loaded.entries || !loaded.missing) return;
    renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
  }

  if (!supabaseClient) {
    _pendingRosterEntries = [];
    loaded.entries = true;
    tryRender();
  } else {
    // team-read-guard: one row per roster member awaiting promotion.
    supabaseClient
      .from('pending_roster')
      .select('*')
      .eq('team_id', _teamCfg.supabaseTeamId)
      .then(function (result) {
        _pendingRosterEntries = result.error ? [] : (result.data || []).map(mapPendingRosterRow);
        loaded.entries = true;
        tryRender();
      });
  }

  fetchMissingSignups(function (err, missing) {
    _pendingMissingSignups = err ? [] : missing;
    loaded.missing = true;
    tryRender();
  });
}

// Roster members with no live season_signups row (any status but 'rejected')
// for the active signup season. Was GAS getMissingSignups(), which compared
// against the same GAS "Roster Responses" sheet the officer tabs stopped
// reading in #328 (#403) -- both sides now read Supabase.
function fetchMissingSignups(callback) {
  var roster = (window.DATA && DATA.roster) || [];
  if (!supabaseClient) {
    callback(null, []);
    return;
  }
  // team-read-guard: one row per player per season signup.
  supabaseClient
    .from('season_signups')
    .select('signup_name_realm, swap_from_name_realm, status, season')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        callback(result.error);
        return;
      }
      var season = DATA && DATA.signupSeason;
      var submitted = {};
      (result.data || []).forEach(function (row) {
        if (row.status === 'rejected') return;
        if (season && row.season !== season) return;
        if (row.signup_name_realm) submitted[row.signup_name_realm.toLowerCase()] = true;
        // Verified-claim mainswap: the old character already has a pending
        // signup in flight, so it shouldn't show as missing even though its
        // own name_realm never appears as signup_name_realm.
        if (row.swap_from_name_realm) submitted[row.swap_from_name_realm.toLowerCase()] = true;
      });
      var missing = roster
        .filter(function (p) {
          return p.nameRealm && !submitted[p.nameRealm.toLowerCase()];
        })
        .map(function (p) {
          return { nameRealm: p.nameRealm, className: p.class, spec: p.spec, role: p.role };
        });
      callback(null, missing);
    });
}

function renderPendingRoster(entries, missing) {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;

  // Drop selections for signups no longer in the pending list (already pushed/removed).
  var stillPending = {};
  entries.forEach(function (e) {
    stillPending[e.signupId] = true;
  });
  Object.keys(_pendingSelected).forEach(function (id) {
    if (!stillPending[id]) delete _pendingSelected[id];
  });

  var rosterMap = buildPendingRosterMap();
  var html = '<div style="margin-top:1.5rem;">';

  html += buildPendingStatsHtml(entries);
  html += buildMissingSignupsHtml(missing);

  if (entries.length) {
    var coverage = computeBuffCoverage(entries, 'className', 'mainSpec', 'nameRealm');
    html += buildPendingBuffCoverageHtml(coverage);
  }

  if (!entries.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No approved signups in the pending roster.</p>';
  } else {
    html += buildPendingControlsHtml();
    var visible = getFilteredSortedPendingEntries(entries);
    if (!visible.length) {
      html +=
        '<p style="color:var(--text-muted);font-size:1rem;margin-top:1rem;">No pending entries match the current filter.</p>';
    } else {
      html += buildPendingSelectionBarHtml(visible);
      visible.forEach(function (e) {
        html += buildPendingCardHtml(e, rosterMap);
      });
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── Filter / sort controls ────────────────────────────────────────────────────

function getFilteredSortedPendingEntries(entries) {
  var filtered = entries.filter(function (e) {
    if (_pendingFilterRole && e.role !== _pendingFilterRole) return false;
    if (_pendingSwapOnly && !e.mainSwap) return false;
    return true;
  });
  filtered.sort(function (a, b) {
    if (_pendingSortKey === 'class') {
      return (
        (a.className || '').localeCompare(b.className || '') || (a.nameRealm || '').localeCompare(b.nameRealm || '')
      );
    }
    return (a.nameRealm || '').localeCompare(b.nameRealm || '');
  });
  return filtered;
}

function buildPendingControlsHtml() {
  var roles = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };

  function chip(active, color, label, onclick) {
    return (
      '<button onclick="' +
      onclick +
      '" style="cursor:pointer;font-size:0.95rem;padding:0.2rem 0.65rem;border-radius:4px;' +
      'border:1px solid ' +
      (active ? color : 'var(--border)') +
      ';background:' +
      (active ? color : 'var(--bg)') +
      ';color:' +
      (active ? 'var(--bg)' : 'var(--text-muted)') +
      ';font-weight:600;">' +
      label +
      '</button>'
    );
  }

  var roleChips = roles
    .map(function (r) {
      return chip(_pendingFilterRole === r, roleColors[r], r, "setPendingFilterRole('" + r + "')");
    })
    .join('');

  var swapChip = chip(_pendingSwapOnly, 'var(--gold-light)', 'Main Swap Only', 'togglePendingSwapOnly()');

  var sortChip = chip(
    _pendingSortKey === 'class',
    'var(--text)',
    'Sort: ' + (_pendingSortKey === 'class' ? 'Class' : 'Name'),
    'togglePendingSortKey()'
  );

  return (
    '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;margin-bottom:1rem;">' +
    roleChips +
    swapChip +
    '<span style="flex:1;"></span>' +
    sortChip +
    '</div>'
  );
}

function setPendingFilterRole(role) {
  _pendingFilterRole = _pendingFilterRole === role ? null : role;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSwapOnly() {
  _pendingSwapOnly = !_pendingSwapOnly;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSortKey() {
  _pendingSortKey = _pendingSortKey === 'class' ? 'name' : 'class';
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

// ── Selection-based push ─────────────────────────────────────────────────────

function buildPendingSelectionBarHtml(visible) {
  var selectedCount = visible.filter(function (e) {
    return !!_pendingSelected[e.signupId];
  }).length;
  var allSelected = visible.length > 0 && selectedCount === visible.length;

  var messageHtml = _pendingBatchMessage
    ? '<span id="pendingBatchPushStatus" style="font-size:0.97rem;color:var(--text-muted);">' +
      escHtml(_pendingBatchMessage) +
      '</span>'
    : '<span id="pendingBatchPushStatus" style="font-size:0.97rem;color:var(--text-muted);"></span>';

  return (
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.75rem;' +
    'padding:0.5rem 0.75rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:6px;">' +
    '<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.97rem;color:var(--text-muted);cursor:pointer;">' +
    '<input type="checkbox" onchange="toggleSelectAllPending()"' +
    (allSelected ? ' checked' : '') +
    ' style="accent-color:var(--gold-light);">Select All' +
    '</label>' +
    '<span style="font-size:0.97rem;color:var(--text-muted);">' +
    selectedCount +
    ' selected</span>' +
    '<button id="pendingBatchPushBtn" class="btn btn-gold" onclick="batchAddSelectedToRoster()"' +
    (selectedCount ? '' : ' disabled') +
    ' style="font-size:1rem;padding:0.25rem 0.75rem;">Add Selected to Roster</button>' +
    messageHtml +
    '</div>'
  );
}

function setPendingTrialOverride(signupId, checked) {
  _pendingTrialOverride[signupId] = !!checked;
}

function setPendingBackupTankOverride(signupId, checked) {
  _pendingBackupTankOverride[signupId] = !!checked;
}

function setPendingBackupHealerOverride(signupId, checked) {
  _pendingBackupHealerOverride[signupId] = !!checked;
}

function setPendingSwapOverride(signupId, playerId) {
  _pendingSwapOverride[signupId] = playerId || null;
}

function togglePendingSelected(signupId) {
  if (_pendingSelected[signupId]) {
    delete _pendingSelected[signupId];
  } else {
    _pendingSelected[signupId] = true;
  }
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function toggleSelectAllPending() {
  var visible = getFilteredSortedPendingEntries(_pendingRosterEntries);
  var allSelected =
    visible.length > 0 &&
    visible.every(function (e) {
      return !!_pendingSelected[e.signupId];
    });
  visible.forEach(function (e) {
    if (allSelected) {
      delete _pendingSelected[e.signupId];
    } else {
      _pendingSelected[e.signupId] = true;
    }
  });
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function batchAddSelectedToRoster() {
  var ids = Object.keys(_pendingSelected)
    .map(Number)
    .filter(function (id) {
      return _pendingRosterEntries.some(function (e) {
        return e.signupId === id;
      });
    });
  if (!ids.length) return;

  _pendingBatchMessage = '';
  var btn = document.getElementById('pendingBatchPushBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding...';
  }

  var results = { success: 0, failed: [] };
  var remaining = ids.length;

  ids.forEach(function (signupId) {
    var entry = _pendingRosterEntries.filter(function (e) {
      return e.signupId === signupId;
    })[0];
    var card = document.querySelector('.signup-response-card[data-row="' + signupId + '"]');
    var trialEl = card ? card.querySelector('.pending-trial-checkbox') : null;
    var backupTankEl = card ? card.querySelector('.pending-backup-tank-checkbox') : null;
    var backupHealerEl = card ? card.querySelector('.pending-backup-healer-checkbox') : null;
    var swapEl = card ? card.querySelector('.pending-swap-select') : null;

    if (swapEl && !swapEl.value) {
      results.failed.push({
        name: entry ? entry.nameRealm : signupId,
        reason: 'missing archive selection'
      });
      finishOne();
      return;
    }

    supabaseClient
      .rpc('add_signup_to_roster', {
        p_signup_id: signupId,
        p_is_trial: !!(trialEl && trialEl.checked),
        p_archive_player_id: swapEl && swapEl.value ? parseInt(swapEl.value, 10) : null,
        p_is_backup_tank: !!(backupTankEl && backupTankEl.checked),
        p_is_backup_healer: !!(backupHealerEl && backupHealerEl.checked)
      })
      .then(function (result) {
        if (result.error) {
          results.failed.push({ name: entry ? entry.nameRealm : signupId, reason: result.error.message });
        } else {
          results.success++;
          delete _pendingSelected[signupId];
          _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
            return e.signupId !== signupId;
          });
        }
        finishOne();
      });
  });

  function finishOne() {
    remaining--;
    if (remaining > 0) return;
    _pendingBatchMessage =
      results.success +
      ' of ' +
      ids.length +
      ' added' +
      (results.failed.length
        ? ', ' +
          results.failed.length +
          ' failed: ' +
          results.failed
            .map(function (f) {
              return f.name + ' (' + f.reason + ')';
            })
            .join('; ')
        : '');
    updateNavBadges();
    renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
  }
}

// ── Stats panel ──────────────────────────────────────────────────────────────

function buildPendingStatsHtml(entries) {
  var roles = { Tank: 0, Heal: 0, Melee: 0, Ranged: 0 };
  entries.forEach(function (e) {
    if (roles[e.role] !== undefined) roles[e.role]++;
  });

  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
  var rolePills = Object.keys(roles)
    .map(function (r) {
      return (
        '<span style="display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg-alt);' +
        'border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.6rem;font-size:0.97rem;">' +
        '<span style="color:' +
        roleColors[r] +
        ';font-weight:700;">' +
        r +
        '</span>' +
        '<span style="color:var(--text);font-weight:600;">' +
        roles[r] +
        '</span>' +
        '</span>'
      );
    })
    .join('');

  return (
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.25rem;">' +
    '<span style="font-size:0.97rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;' +
    'letter-spacing:0.12em;margin-right:0.25rem;">' +
    entries.length +
    ' Pending</span>' +
    rolePills +
    '</div>'
  );
}

// ── Missing signups section ──────────────────────────────────────────────────

function buildMissingSignupsHtml(missing) {
  var collapsed = missing.length > 0;
  var collapseId = 'pendingMissingCollapse';

  var headerColor = missing.length ? 'var(--melee)' : 'var(--text-muted)';
  var icon = missing.length ? '&#9660;' : '&#9654;';

  var html =
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="toggleMissingSignups()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.97rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:' +
    headerColor +
    ';">Missing Signups (' +
    missing.length +
    ')</span>' +
    '<span id="pendingMissingIcon" style="font-size:0.93rem;color:var(--text-muted);">' +
    icon +
    '</span>' +
    '</div>' +
    '<div id="' +
    collapseId +
    '" style="display:' +
    (collapsed ? 'block' : 'none') +
    ';padding:0.75rem 0.85rem;">';

  if (!missing.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:1.02rem;margin:0;">All roster members have submitted a signup.</p>';
  } else {
    var byRole = { Tank: [], Heal: [], Melee: [], Ranged: [] };
    missing.forEach(function (p) {
      var r = p.role || 'Melee';
      if (!byRole[r]) byRole[r] = [];
      byRole[r].push(p);
    });
    var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
    Object.keys(byRole).forEach(function (role) {
      if (!byRole[role].length) return;
      html +=
        '<div style="margin-bottom:0.5rem;">' +
        '<span style="font-size:0.91rem;text-transform:uppercase;letter-spacing:0.1em;color:' +
        roleColors[role] +
        ';font-weight:700;">' +
        role +
        ' (' +
        byRole[role].length +
        ')</span>' +
        '<div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.35rem;">';
      byRole[role].forEach(function (p) {
        var clsColor = classColor(p.className);
        html +=
          '<span style="font-size:0.95rem;background:var(--bg);border:1px solid var(--border);' +
          'border-radius:4px;padding:0.15rem 0.5rem;color:' +
          clsColor +
          ';">' +
          (p.nameRealm ? p.nameRealm.split('-')[0] : p.nameRealm) +
          '<span style="color:var(--text-muted);font-weight:400;"> (' +
          (p.spec || p.className || '') +
          ')</span>' +
          '</span>';
      });
      html += '</div></div>';
    });
  }

  html += '</div></div>';
  return html;
}

function toggleMissingSignups() {
  var panel = document.getElementById('pendingMissingCollapse');
  var icon = document.getElementById('pendingMissingIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Buff / debuff coverage panel ─────────────────────────────────────────────

function buildPendingBuffCoverageHtml(coverage) {
  var sections = [
    { label: 'Raid Buffs', buffs: RAID_BUFFS },
    { label: 'Boss Debuffs', buffs: BOSS_DEBUFFS },
    { label: 'Utility', buffs: RAID_UTILITY }
  ];

  var bodyHtml = '';
  sections.forEach(function (sec) {
    bodyHtml +=
      '<div style="margin-bottom:0.6rem;">' +
      '<span style="font-size:0.89rem;text-transform:uppercase;letter-spacing:0.1em;' +
      'color:var(--text-muted);font-weight:700;display:block;margin-bottom:0.35rem;">' +
      sec.label +
      '</span>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;">';
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
      var titleAttr = data.providers.length ? ' title="' + data.providers.join(', ') + '"' : '';
      bodyHtml +=
        '<span' +
        titleAttr +
        ' style="display:inline-flex;align-items:center;gap:0.3rem;' +
        'background:var(--bg);border:1px solid var(--border);border-radius:4px;' +
        'padding:0.2rem 0.6rem;font-size:1rem;cursor:default;">' +
        '<span style="color:' +
        color +
        ';font-weight:700;">' +
        indicator +
        '</span>' +
        buffNameLinkHtml(buff, 'color:' + nameColor) +
        (count > 0 ? '<span style="color:' + color + ';font-weight:600;font-size:0.93rem;">' + count + '</span>' : '') +
        '</span>';
    });
    bodyHtml += '</div></div>';
  });

  return (
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="togglePendingBuffCoverage()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.97rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;' +
    'color:var(--text-muted);">Buff Coverage</span>' +
    '<span id="pendingBuffIcon" style="font-size:0.93rem;color:var(--text-muted);">&#9654;</span>' +
    '</div>' +
    '<div id="pendingBuffCollapse" style="display:none;padding:0.75rem 0.85rem;">' +
    bodyHtml +
    '</div>' +
    '</div>'
  );
}

function togglePendingBuffCoverage() {
  var panel = document.getElementById('pendingBuffCollapse');
  var icon = document.getElementById('pendingBuffIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Pending entry cards ──────────────────────────────────────────────────────
//
// The old bulk "Push to Roster" area operated on Sheets row indices and pushed
// every pending entry in one GAS call; that model doesn't carry over to the
// signup_id-keyed Supabase data (#328). Each card below gets its own
// "Add to Roster" control (trial toggle + main-swap picker) that calls
// add_signup_to_roster() directly, plus a selection checkbox so the batch
// "Add Selected to Roster" push (see the Selection-based push section above)
// can loop the same per-row values across a chosen subset (#273).

function buildPendingCardHtml(e, rosterMap) {
  rosterMap = rosterMap || {};
  var clsColor = classColor(e.className);
  var isNew = !(e.nameRealm && rosterMap[e.nameRealm.toLowerCase()]);
  var borderStyle = e.mainSwap ? 'border-left:3px solid var(--gold-light);' : '';

  var html =
    '<div class="signup-response-card" style="' +
    borderStyle +
    '" data-row="' +
    e.signupId +
    '">' +
    '<div class="signup-response-header">' +
    '<div style="display:flex;align-items:center;">' +
    '<input type="checkbox" class="pending-select-checkbox" onchange="togglePendingSelected(' +
    e.signupId +
    ')"' +
    (_pendingSelected[e.signupId] ? ' checked' : '') +
    ' style="accent-color:var(--gold-light);margin-right:0.4rem;">' +
    '<span class="signup-response-name">' +
    escHtml(e.nameRealm) +
    '</span>' +
    '<span style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;' +
    'margin-left:0.4rem;color:' +
    (isNew ? 'var(--heal)' : 'var(--text-muted)') +
    ';">' +
    (isNew ? 'New' : 'Update') +
    '</span>' +
    '</div>';

  if (e.season)
    html +=
      '<span style="font-size:0.85rem;color:var(--text-muted);background:var(--bg-alt);' +
      'border:1px solid var(--border);border-radius:3px;padding:0.1rem 0.4rem;margin-left:0.4rem;">' +
      escHtml(e.season) +
      '</span>';

  html += '</div>';
  html +=
    '<div style="font-size:1rem;color:' +
    clsColor +
    ';margin-top:0.35rem;font-weight:600;">' +
    e.className +
    ' &middot; ' +
    e.mainSpec +
    (e.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + e.offSpecs + '</span>' : '') +
    '</div>';

  if (e.role)
    html +=
      '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' +
      e.role +
      '</span></div>';
  if (e.mainSwap)
    html +=
      '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">' +
      '<span style="color:var(--gold-light);font-weight:600;">Main swap requested</span> ' +
      '<span style="font-size:0.97rem;">-- select the old character to archive below.</span></div>';
  if (e.notes)
    html +=
      '<div style="font-size:1.02rem;color:var(--text-muted);margin-top:0.35rem;font-style:italic;">' +
      escHtml(e.notes) +
      '</div>';

  html += buildAddToRosterControlHtml(e, isNew);

  html +=
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-danger" onclick="removePendingRosterRow(' +
    e.signupId +
    ',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Remove from Pending</button>' +
    '</div>' +
    '</div>';

  return html;
}

// Per-row "Add to Roster" control: trial toggle and, for main-swap signups,
// a picker of active roster members to archive (add_signup_to_roster's
// p_archive_player_id, team-scoped in the function). Trial defaults on only
// for genuinely new characters -- roster signups are normally returning
// raiders re-upping for next season, not new recruits, so defaulting every
// card to Trial mismarked them.
function buildAddToRosterControlHtml(e, isNew) {
  var roster = (window.DATA && DATA.roster) || [];
  var swapPicker = '';
  if (e.mainSwap) {
    var savedSwapId = _pendingSwapOverride[e.signupId];
    // Verified-claim mainswap (swap_from_name_realm set at signup time,
    // js/signup.js's claimDiffers branch): auto-select the old character
    // instead of making the officer pick it manually, unless they've already
    // overridden it this session. The free-typed swap case has no verified
    // name to match on, so it still defaults to the blank option.
    if (savedSwapId == null && e.swapFromNameRealm) {
      var autoMatch = findRosterPlayerByNameRealm(e.swapFromNameRealm);
      if (autoMatch) savedSwapId = autoMatch.id;
    }
    var options = roster
      .map(function (p) {
        return (
          '<option value="' +
          p.id +
          '"' +
          (savedSwapId != null && String(savedSwapId) === String(p.id) ? ' selected' : '') +
          '>' +
          escHtml(p.nameRealm) +
          '</option>'
        );
      })
      .join('');
    swapPicker =
      '<select class="pending-swap-select" onchange="setPendingSwapOverride(' +
      e.signupId +
      ',this.value)" style="font-size:0.97rem;padding:0.2rem 0.4rem;' +
      'background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);margin-right:0.5rem;">' +
      '<option value="">-- character to archive --</option>' +
      options +
      '</select>';
  }

  // A main-swap signup is a returning raider under a new character name even
  // when the name itself is new to the roster, so it defaults off too.
  var defaultTrial = isNew && !e.mainSwap;
  // Re-renders (e.g. from toggling the row's own selection checkbox) rebuild
  // this control from scratch, so a manual uncheck/check must be remembered
  // per signup rather than recomputed from defaultTrial every time (#502).
  var trialChecked = Object.prototype.hasOwnProperty.call(_pendingTrialOverride, e.signupId)
    ? _pendingTrialOverride[e.signupId]
    : defaultTrial;
  // Backup Tank/Healer have no smart default (unlike Trial) -- there's nothing
  // on the signup itself to infer willingness to backup a role from, so both
  // always start unchecked unless the officer already toggled one this session.
  var backupTankChecked = !!_pendingBackupTankOverride[e.signupId];
  var backupHealerChecked = !!_pendingBackupHealerOverride[e.signupId];

  return (
    '<div class="pending-add-roster" style="display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;' +
    'margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
    '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.97rem;color:var(--text-muted);cursor:pointer;">' +
    '<input type="checkbox" class="pending-trial-checkbox" onchange="setPendingTrialOverride(' +
    e.signupId +
    ',this.checked)"' +
    (trialChecked ? ' checked' : '') +
    ' style="accent-color:var(--gold-light);">Trial' +
    '</label>' +
    '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.97rem;color:var(--text-muted);cursor:pointer;">' +
    '<input type="checkbox" class="pending-backup-tank-checkbox" onchange="setPendingBackupTankOverride(' +
    e.signupId +
    ',this.checked)"' +
    (backupTankChecked ? ' checked' : '') +
    ' style="accent-color:var(--gold-light);">Backup Tank' +
    '</label>' +
    '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.97rem;color:var(--text-muted);cursor:pointer;">' +
    '<input type="checkbox" class="pending-backup-healer-checkbox" onchange="setPendingBackupHealerOverride(' +
    e.signupId +
    ',this.checked)"' +
    (backupHealerChecked ? ' checked' : '') +
    ' style="accent-color:var(--gold-light);">Backup Healer' +
    '</label>' +
    swapPicker +
    '<button class="btn request-approve-btn pending-add-btn" onclick="addSignupToRoster(' +
    e.signupId +
    ',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Add to Roster</button>' +
    '<span class="pending-add-error" style="color:var(--melee);font-size:0.97rem;"></span>' +
    '</div>'
  );
}

// ── Add to Roster ─────────────────────────────────────────────────────────────

function addSignupToRoster(signupId, btnEl) {
  var card = btnEl.closest('.signup-response-card');
  var trialEl = card ? card.querySelector('.pending-trial-checkbox') : null;
  var backupTankEl = card ? card.querySelector('.pending-backup-tank-checkbox') : null;
  var backupHealerEl = card ? card.querySelector('.pending-backup-healer-checkbox') : null;
  var swapEl = card ? card.querySelector('.pending-swap-select') : null;
  var errEl = card ? card.querySelector('.pending-add-error') : null;

  if (swapEl && !swapEl.value) {
    if (errEl) errEl.textContent = 'Select the character to archive for this main swap.';
    return;
  }

  if (errEl) errEl.textContent = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Adding...';

  supabaseClient
    .rpc('add_signup_to_roster', {
      p_signup_id: signupId,
      p_is_trial: !!(trialEl && trialEl.checked),
      p_archive_player_id: swapEl && swapEl.value ? parseInt(swapEl.value, 10) : null,
      p_is_backup_tank: !!(backupTankEl && backupTankEl.checked),
      p_is_backup_healer: !!(backupHealerEl && backupHealerEl.checked)
    })
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Add to Roster';
        if (errEl) errEl.textContent = result.error.message;
        return;
      }
      if (card) card.remove();
      delete _pendingSelected[signupId];
      _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
        return e.signupId !== signupId;
      });
      renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
      updateNavBadges();
    });
}

// ── Remove from pending ──────────────────────────────────────────────────────

function removePendingRosterRow(signupId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '...';
  }

  supabaseClient
    .from('season_signups')
    .update({ status: 'rejected' })
    .eq('id', signupId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = 'Remove from Pending';
        }
        return;
      }
      var card = document.querySelector('.signup-response-card[data-row="' + signupId + '"]');
      if (card) card.remove();
      delete _pendingSelected[signupId];
      _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
        return e.signupId !== signupId;
      });
      // Re-render stats with the updated list
      renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
      updateNavBadges();
    });
}
