// ── Admin subtab management ───────────────────────────────────────────────

var ADMIN_SUBTABS = ['properties', 'export', 'officers', 'features', 'danger'];

// Which sub-tabs each access level may see (#317, honoring the RLS split from
// #294). true (site admins) sees everything; 'team_leader' sees the surfaces
// backed by the team-leader-scoped tables
// (team_settings, team_members) but not Data Export; any other value sees
// nothing. showAdminTab (officer.html) applies this map to the sub-tab
// buttons; buildAdminTab uses it to pick the landing sub-tab.
function adminSubTabVisibility(access) {
  var vis = {};
  ADMIN_SUBTABS.forEach(function (sub) {
    if (access === true) vis[sub] = true;
    else if (access === 'team_leader') vis[sub] = sub !== 'export';
    else vis[sub] = false;
  });
  return vis;
}

function buildAdminTab() {
  var vis = adminSubTabVisibility(window._adminAccessLevel);
  var defaultSub =
    ADMIN_SUBTABS.filter(function (sub) {
      return vis[sub];
    })[0] || 'properties';
  switchAdminSubTab(defaultSub, document.getElementById('admin-subtab-btn-' + defaultSub));
}

function switchAdminSubTab(name, btnEl) {
  document.querySelectorAll('[id^="admin-subtab-btn-"]').forEach(function (b) {
    b.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');
  ADMIN_SUBTABS.forEach(function (sub) {
    var el = document.getElementById('admin-sub-' + sub);
    if (el) el.style.display = sub === name ? '' : 'none';
  });
  if (name === 'properties') loadAdminProperties();
  if (name === 'officers') renderOfficerManagement();
  if (name === 'features') {
    renderAdminFeatureFlags();
    renderAdminWishlistLabels();
  }
  if (name === 'danger') renderDangerZone();
}

// ── Properties Inspector ──────────────────────────────────────────────────

function loadAdminProperties() {
  var content = document.getElementById('adminPropsContent');

  var rows = [
    ['Season Name', (DATA && DATA.seasonName) || '(not set)'],
    ['Season Start', (DATA && DATA.seasonStart) || '(not set)'],
    ['Season End', (DATA && DATA.seasonEnd) || '(not set)'],
    ['Archived Seasons', ((DATA && DATA.seasonHistory) || []).length + ' season(s)'],
    ['Raid Progression', ((DATA && DATA.raidProgression) || []).length + ' raid(s)'],
    ['Signups Open', DATA && DATA.signupsOpen ? 'Yes' : 'No'],
    ['BiS Submissions Open', DATA && DATA.bisSubmissionsOpen ? 'Yes' : 'No'],
    ['M+ Exclusions Open', DATA && DATA.mPlusExclusionsOpen ? 'Yes' : 'No']
  ];
  var html = '<table class="admin-props-table">';
  rows.forEach(function (r) {
    html += '<tr><td class="admin-prop-key">' + r[0] + '</td><td class="admin-prop-val">' + r[1] + '</td></tr>';
  });
  html += '</table>';
  if (content) content.innerHTML = html;
}

// ── Data Export ───────────────────────────────────────────────────────────

function downloadExport() {
  var btn = document.getElementById('adminExportBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Preparing...';
  }
  try {
    var payload = {
      exportedAt: new Date().toISOString(),
      team: TEAM_NAME,
      version: VERSION,
      data: DATA
    };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = TEAM_SLUG + '-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download JSON';
    }
  }
}

// ── Danger Zone ───────────────────────────────────────────────────────────

// Every op is Supabase-native now (#225). Each carries a supabaseFn (the
// clear*Supabase() function below it does its work through), so
// executeDangerOp() has one dispatch path for all of them -- no more GAS
// action/sheet pair or jsonpRequest fallback.
var DANGER_OPS = [
  {
    key: 'clearSeasonHistory',
    label: 'Clear Season History',
    desc: "Permanently deletes all archived seasons from this team's settings.",
    // #423: since #221 archived seasons live in team_settings.config
    // .seasonHistory, not GAS Script Properties (or season_snapshots, which
    // never held real data and was dropped, #455).
    supabase: true,
    supabaseFn: clearSeasonHistorySupabase,
    // The one team-leader-scoped danger op (the #294 decision); the rest stay
    // site-admin only.
    teamLeader: true
  },
  {
    key: 'clearLootData',
    label: 'Clear Loot Data',
    desc: 'Wipes all imported RCLootCouncil loot entries for this team.',
    supabase: true,
    supabaseFn: clearLootDataSupabase
  },
  {
    key: 'clearBisSubs',
    label: 'Clear BiS Submissions',
    desc: 'Wipes all pending BiS link submissions for this team.',
    supabase: true,
    supabaseFn: clearBisRequestsSupabase
  },
  {
    key: 'clearSignups',
    label: 'Clear Signups',
    desc: 'Wipes all signup applications for this team, any status.',
    supabase: true,
    supabaseFn: clearSeasonSignupsSupabase
  },
  {
    key: 'clearMplus',
    label: 'Clear M+ Exclusion Requests',
    desc: 'Wipes all M+ exclusion requests for this team.',
    supabase: true,
    supabaseFn: clearMplusExclusionRequestsSupabase
  },
  {
    key: 'clearPending',
    label: 'Clear Pending Roster',
    // Narrower than Clear Signups: matches the pending_roster view's own
    // definition (status = 'approved' and approved_player_id is null).
    desc: 'Wipes approved signups not yet added to the roster, leaving other signups alone.',
    supabase: true,
    supabaseFn: clearPendingRosterSupabase
  },
  {
    key: 'clearSelfReceived',
    label: 'Clear Self-Received',
    desc: 'Wipes all self-received loot requests for this team.',
    supabase: true,
    supabaseFn: clearSelfReceivedRequestsSupabase
  }
];

// Danger ops visible at a given access level: site admins see all of them,
// team leaders only the ops flagged teamLeader (#317).
function visibleDangerOps(access) {
  if (access === true) return DANGER_OPS;
  return DANGER_OPS.filter(function (op) {
    return op.teamLeader;
  });
}

function renderDangerZone() {
  var content = document.getElementById('adminDangerContent');
  if (!content) return;
  var html =
    '<p style="font-size:1rem;color:var(--melee);margin-bottom:1rem;">' +
    'These operations are permanent and cannot be undone. Type <strong>' +
    TEAM_NAME +
    '</strong> to confirm each action.' +
    '</p>';
  visibleDangerOps(window._adminAccessLevel).forEach(function (op) {
    html += '<div class="admin-danger-card">';
    html += '<div class="admin-danger-label">' + op.label + '</div>';
    html += '<p class="admin-danger-desc">' + op.desc + '</p>';
    html += '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">';
    html +=
      '<input type="text" class="add-player-input" id="danger-confirm-' +
      op.key +
      '"' +
      ' placeholder="Type team name to confirm" style="max-width:240px;font-size:1rem;">';
    html +=
      '<button class="btn btn-danger" id="danger-btn-' +
      op.key +
      '"' +
      ' onclick="executeDangerOp(\'' +
      op.key +
      '\')">' +
      op.label +
      '</button>';
    html += '<span id="danger-status-' + op.key + '" style="font-size:0.97rem;"></span>';
    html += '</div></div>';
  });
  content.innerHTML = html;
}

function executeDangerOp(key) {
  var op = null;
  for (var i = 0; i < DANGER_OPS.length; i++) {
    if (DANGER_OPS[i].key === key) {
      op = DANGER_OPS[i];
      break;
    }
  }
  if (!op) return;
  // Keep execute consistent with what renderDangerZone showed. Not a security
  // boundary in itself -- every op's real enforcement is in its Supabase RPC
  // (is_site_admin(), or the underlying grant for the one op with none).
  if (window._adminAccessLevel !== true && !op.teamLeader) return;

  var input = document.getElementById('danger-confirm-' + key);
  var btn = document.getElementById('danger-btn-' + key);
  var status = document.getElementById('danger-status-' + key);

  if (!input || input.value.trim() !== TEAM_NAME) {
    if (status) {
      status.style.color = 'var(--melee)';
      status.textContent = 'Team name does not match.';
      setTimeout(function () {
        if (status) {
          status.textContent = '';
        }
      }, 2500);
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Working...';
  }

  // count is optional -- the row-count RPCs pass it for a more specific
  // status message; clearSeasonHistorySupabase (no natural row count) omits
  // it and gets the generic "Done."
  function finish(err, ok, count) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = op.label;
    }
    if (!err && ok) {
      if (input) input.value = '';
      if (status) {
        status.style.color = 'var(--heal)';
        status.textContent =
          typeof count === 'number' ? 'Cleared ' + count + ' row' + (count === 1 ? '' : 's') + '.' : 'Done.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 3000);
      }
    } else {
      if (status) {
        status.style.color = 'var(--melee)';
        status.textContent = err ? err.message : 'Error.';
      }
    }
  }

  op.supabaseFn(finish);
}

// Clears team_settings.config.seasonHistory via the same set_team_setting RPC
// the Season Settings tab writes through (#221), so the "Archived Seasons"
// count and the Season tab's history list both reflect it without a reload.
// Archive stores its roster snapshot inline on the seasonHistory entry itself,
// so this is the whole record -- no separate table to clear alongside it (the
// season_snapshots table this comment used to carve out as untouched no longer
// exists, #455).
function clearSeasonHistorySupabase(finish) {
  saveTeamSetting({ seasonHistory: [] })
    .then(function (config) {
      if (DATA) DATA.seasonHistory = (config && config.seasonHistory) || [];
      if (typeof buildSeasonTab === 'function') buildSeasonTab();
      loadAdminProperties();
      return writeAuditLog('Season History Cleared', null, null, null);
    })
    .then(function () {
      finish(null, true);
    })
    .catch(function (err) {
      finish(err);
    });
}

// The one op with no dedicated RPC: officers already have a direct ALL grant
// on rclc_loot for their own team (js/tabs/tab-loot-import.js's import path
// relies on the same grant), so a Danger Zone clear needs no
// SECURITY DEFINER wrapper. Loot backs enough surfaces at once -- profile
// cards, loot history, BiS "received" badges -- that patching each in place
// isn't worth it; reload once the delete and audit log both land.
function clearLootDataSupabase(finish) {
  supabaseClient
    .from('rclc_loot')
    .delete()
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Loot Data Cleared', null, null, null);
    })
    .then(function () {
      finish(null, true);
      setTimeout(function () {
        location.reload();
      }, 1200);
    })
    .catch(function (err) {
      finish(err);
    });
}

function clearBisRequestsSupabase(finish) {
  supabaseClient
    .rpc('danger_clear_bis_requests', { p_team_id: _teamCfg.supabaseTeamId })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (typeof buildBisTab === 'function') buildBisTab();
      return writeAuditLog('BiS Submissions Cleared', null, null, null).then(function () {
        finish(null, true, result.data);
      });
    })
    .catch(function (err) {
      finish(err);
    });
}

// Clears every signup application for the team, any status -- distinct from
// clearPendingRosterSupabase below, which only clears the approved-but-not-
// yet-added subset. Both queues (Signups and Pending Roster) can read from
// the same season_signups rows, so both re-render.
function clearSeasonSignupsSupabase(finish) {
  supabaseClient
    .rpc('danger_clear_season_signups', { p_team_id: _teamCfg.supabaseTeamId })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (typeof buildSignupsTab === 'function') buildSignupsTab();
      if (typeof buildPendingRosterTab === 'function') buildPendingRosterTab();
      return writeAuditLog('Signups Cleared', null, null, null).then(function () {
        finish(null, true, result.data);
      });
    })
    .catch(function (err) {
      finish(err);
    });
}

function clearMplusExclusionRequestsSupabase(finish) {
  supabaseClient
    .rpc('danger_clear_mplus_exclusion_requests', { p_team_id: _teamCfg.supabaseTeamId })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (typeof buildMPlusTab === 'function') buildMPlusTab();
      return writeAuditLog('M+ Exclusion Requests Cleared', null, null, null).then(function () {
        finish(null, true, result.data);
      });
    })
    .catch(function (err) {
      finish(err);
    });
}

// The old GAS "Pending Roster" sheet was the queue of approved signups not
// yet pushed to the roster, not every signup ever submitted -- matches the
// pending_roster view's own definition (status = 'approved' and
// approved_player_id is null). A rejected or already-pushed signup survives;
// clearSeasonSignupsSupabase is the op for wiping everything.
function clearPendingRosterSupabase(finish) {
  supabaseClient
    .rpc('danger_clear_pending_roster', { p_team_id: _teamCfg.supabaseTeamId })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (typeof buildPendingRosterTab === 'function') buildPendingRosterTab();
      if (typeof buildSignupsTab === 'function') buildSignupsTab();
      return writeAuditLog('Pending Roster Cleared', null, null, null).then(function () {
        finish(null, true, result.data);
      });
    })
    .catch(function (err) {
      finish(err);
    });
}

function clearSelfReceivedRequestsSupabase(finish) {
  supabaseClient
    .rpc('danger_clear_self_received_requests', { p_team_id: _teamCfg.supabaseTeamId })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      if (typeof buildRequestsTab === 'function') buildRequestsTab();
      return writeAuditLog('Self-Received Requests Cleared', null, null, null).then(function () {
        finish(null, true, result.data);
      });
    })
    .catch(function (err) {
      finish(err);
    });
}

// ── Officer Management ────────────────────────────────────────────────────────

function renderOfficerManagement() {
  var el = document.getElementById('adminOfficersContent');
  if (!el || !supabaseClient) return;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:1.02rem;">Loading...</p>';
  fetchTeamClaims().then(function (claims) {
    // Team leaders are a distinct top tier managed outside this picker; only
    // plain officers are promotable/revocable here (matches the old flat
    // officerDiscordIds toggle this replaces).
    var teamLeaderClaim = claims.filter(function (c) {
      return c.role === 'team_leader';
    })[0];
    var officerClaims = claims.filter(function (c) {
      return c.role === 'officer';
    });
    var nonOfficerClaims = claims.filter(function (c) {
      return c.role !== 'officer' && c.role !== 'team_leader';
    });

    var rows = officerClaims
      .map(function (c) {
        var jsonId = JSON.stringify(c.teamMemberId);
        var jsonNr = JSON.stringify(c.nameRealm).replace(/"/g, '&quot;');
        var btn =
          '<button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.89rem;" onclick="revokeOfficer(' +
          jsonId +
          ',' +
          jsonNr +
          ')">Revoke</button>';
        return (
          '<tr>' +
          '<td style="width:75%">' +
          escHtml(c.nameRealm) +
          '</td>' +
          '<td style="width:25%;text-align:right">' +
          btn +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var table = rows
      ? '<table class="loot-table" style="width:100%;table-layout:fixed;margin-bottom:1rem;">' +
        '<thead><tr><th style="width:75%;text-align:left">Character</th><th style="width:25%"></th></tr></thead>' +
        '<tbody>' +
        rows +
        '</tbody></table>'
      : '<p style="color:var(--text-muted);font-size:1.02rem;margin-bottom:1rem;">No officers yet.</p>';

    // Promote a claimed character to officer
    var options = nonOfficerClaims
      .map(function (c) {
        return '<option value="' + escHtml(String(c.teamMemberId)) + '">' + escHtml(c.nameRealm) + '</option>';
      })
      .join('');

    var promote = options
      ? '<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">' +
        '<select id="promoteOfficerSelect" class="roster-search-input" style="width:280px;">' +
        '<option value="">Select a claimed character...</option>' +
        options +
        '</select>' +
        '<button class="btn" onclick="grantOfficerFromPicker()" style="padding:0.3rem 0.75rem;font-size:0.97rem;">Grant Officer</button>' +
        '<span id="manualOfficerStatus" style="font-size:0.97rem;"></span>' +
        '</div>'
      : '<p style="color:var(--text-muted);font-size:1.02rem;">No claimed characters left to promote.</p>';

    // Read-only -- team_leader is a distinct top tier granted outside this
    // picker (see the comment above), so this just makes that tier visible
    // instead of leaving the table looking empty/broken when the only
    // claimed character on a team is a team leader with no officers (#491).
    var leaderLine = teamLeaderClaim
      ? '<p style="font-size:1.02rem;color:var(--text);margin-bottom:0.75rem;">Team Leader: ' +
        escHtml(teamLeaderClaim.nameRealm) +
        '</p>'
      : '';

    el.innerHTML =
      leaderLine +
      table +
      '<p style="font-size:0.95rem;color:var(--text-muted);margin-bottom:0.5rem;">Promote a claimed character to officer:</p>' +
      promote;
  });
}

function grantOfficerFromPicker() {
  var selectEl = document.getElementById('promoteOfficerSelect');
  var stEl = document.getElementById('manualOfficerStatus');
  var teamMemberId = selectEl ? selectEl.value : '';
  if (!teamMemberId) {
    if (stEl) {
      stEl.style.color = 'var(--melee)';
      stEl.textContent = 'Select a claimed character first.';
    }
    return;
  }
  if (stEl) {
    stEl.style.color = 'var(--text-muted)';
    stEl.textContent = 'Saving...';
  }
  grantOfficer(teamMemberId);
}

function grantOfficer(teamMemberId) {
  supabaseClient
    .from('team_members')
    .update({ role: 'officer' })
    .eq('id', teamMemberId)
    .then(function (result) {
      if (result.error) {
        alert('Failed: ' + result.error.message);
        return;
      }
      renderOfficerManagement();
      if (typeof renderDiscordClaims === 'function') renderDiscordClaims();
    });
}

function revokeOfficer(teamMemberId, nameRealm) {
  if (!confirm('Revoke officer access for ' + (nameRealm || teamMemberId) + '?')) return;
  supabaseClient
    .from('team_members')
    .update({ role: 'raider' })
    .eq('id', teamMemberId)
    .then(function (result) {
      if (result.error) {
        alert('Failed: ' + result.error.message);
        return;
      }
      renderOfficerManagement();
      if (typeof renderDiscordClaims === 'function') renderDiscordClaims();
    });
}

// ── Feature Flags (#231) ──────────────────────────────────────────────────
// Team-leader/site-admin self-serve version of the same toggle list
// js/admin.js's site-admin dashboard has, scoped to this team only. Both
// write through the same saveTeamSetting({features: {...}}) path
// (set_team_setting RPC), whose RLS already accepts a team_leader or site
// admin -- no new write path needed here either.
var ADMIN_FEATURE_FLAGS = [
  { key: 'loot', label: 'Loot Import & Tracking' },
  { key: 'priority', label: 'Priority Order' },
  { key: 'bis', label: 'BiS Lists' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'mplus', label: 'M+ Exclusions' },
  { key: 'fairness', label: 'Fairness Charts' },
  { key: 'bench', label: 'Bench Management' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'requests', label: 'Received Item Requests' }
];

function renderAdminFeatureFlags() {
  var el = document.getElementById('adminFeatureFlagsContent');
  if (!el) return;
  el.innerHTML = ADMIN_FEATURE_FLAGS.map(function (f) {
    var checked = featureEnabled(f.key);
    return (
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);">' +
      '<span>' +
      escHtml(f.label) +
      '</span>' +
      '<input type="checkbox" style="width:1.1rem;height:1.1rem;accent-color:var(--gold);cursor:pointer;" ' +
      (checked ? 'checked' : '') +
      ' onchange="toggleAdminFeatureFlag(\'' +
      f.key +
      '\',this.checked)">' +
      '</div>'
    );
  }).join('');
}

function toggleAdminFeatureFlag(key, enabled) {
  var features = {};
  ADMIN_FEATURE_FLAGS.forEach(function (f) {
    features[f.key] = featureEnabled(f.key);
  });
  features[key] = enabled;

  saveTeamSetting({ features: features })
    .then(function (config) {
      DATA.features = config.features || {};
      applyFeatureFlagVisibility();
    })
    .catch(function (err) {
      alert(err.message);
      renderAdminFeatureFlags(); // revert the checkbox to last-known state
    });
}

// ── Wishlist Tier Labels (#515 Phase 2) ──────────────────────────────────
// Own copy of the 5 tier value/default-label pairs -- officer.html and
// index.html are separate script bundles (js/wishlist.js, where the raider
// wishlist itself renders, isn't loaded here), same reasoning already
// documented for the BIS_SLOTS/WISHLIST_SLOTS duplication.
var WISHLIST_LABEL_DEFAULTS = [
  { value: 'bis', label: 'BiS', dotColor: 'var(--gold)' },
  { value: 'good', label: 'Good', dotColor: 'var(--heal)' },
  { value: 'ok', label: 'OK', dotColor: 'var(--tank)' },
  { value: 'catalyst', label: 'Catalyst Only', dotColor: 'var(--ranged)' },
  { value: 'pass', label: 'Pass', dotColor: 'var(--melee)' }
];

function renderAdminWishlistLabels() {
  var el = document.getElementById('adminWishlistLabelsContent');
  if (!el) return;
  var overrides = (DATA && DATA.wishlistStatusLabels) || {};
  el.innerHTML =
    WISHLIST_LABEL_DEFAULTS.map(function (t) {
      return (
        '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0;">' +
        '<span style="width:0.6rem;height:0.6rem;border-radius:50%;background:' +
        t.dotColor +
        ';flex-shrink:0;"></span>' +
        '<input type="text" id="wishlistLabelInput-' +
        t.value +
        '" class="add-player-input" placeholder="' +
        escHtml(t.label) +
        '" value="' +
        escHtml(overrides[t.value] || '') +
        '" style="max-width:220px;font-size:0.95rem;padding:0.35rem 0.6rem;">' +
        '</div>'
      );
    }).join('') +
    '<div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" id="wishlistLabelsSaveBtn" onclick="saveAdminWishlistLabels()">Save</button>' +
    '<span id="wishlistLabelsStatus" style="font-size:0.92rem;color:var(--heal);"></span>' +
    '</div>';
}

function saveAdminWishlistLabels() {
  var overrides = {};
  WISHLIST_LABEL_DEFAULTS.forEach(function (t) {
    var input = document.getElementById('wishlistLabelInput-' + t.value);
    var val = input ? input.value.trim() : '';
    if (val && val !== t.label) overrides[t.value] = val;
  });

  var btn = document.getElementById('wishlistLabelsSaveBtn');
  var statusEl = document.getElementById('wishlistLabelsStatus');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Saving...';

  saveTeamSetting({ wishlistStatusLabels: overrides })
    .then(function (config) {
      DATA.wishlistStatusLabels = config.wishlistStatusLabels || {};
      var changed = Object.keys(overrides).length;
      writeAuditLog(
        'Wishlist Tier Labels Saved',
        null,
        null,
        changed ? changed + ' tier(s) renamed' : 'reset to defaults'
      );
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.textContent = 'Saved';
      setTimeout(function () {
        if (statusEl) statusEl.textContent = '';
      }, 2000);
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (statusEl) {
        statusEl.style.color = 'var(--melee)';
        statusEl.textContent = 'Failed: ' + err.message;
      }
    });
}
