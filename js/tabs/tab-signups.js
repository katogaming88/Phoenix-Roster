function renderSignupToggle() {
  var badge = document.getElementById('signupStatusBadge');
  var btn = document.getElementById('signupToggleBtn');
  if (!badge || !btn) return;
  var open = !!(DATA && DATA.signupsOpen);
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Signups' : 'Open Signups';
}

function toggleSignupsOpen() {
  setSignupsOpen(!(DATA && DATA.signupsOpen));
}

function setSignupsOpen(open) {
  var btn = document.getElementById('signupToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ signupsOpen: open })
    .then(function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.signupsOpen = open;
      writeAuditLog(open ? 'Signups Opened' : 'Signups Closed', null, null, null);
      renderSignupToggle();
    })
    .catch(function () {
      if (btn) btn.disabled = false;
      renderSignupToggle();
    });
}

// Two FKs from season_signups to classes_specs (class_spec_id, swap_class_spec_id)
// require the embed to name the constraint explicitly to avoid ambiguity.
var SIGNUP_SELECT_COLUMNS =
  'id, signup_name_realm, off_specs, main_swap, player_note, submitted_at, status, season, ' +
  'reviewed_at, reviewed_by, signup_officer_note, ' +
  'main_class:classes_specs!signups_class_spec_id_fkey(class, spec, role), ' +
  'swap_class:classes_specs!season_signups_swap_class_spec_id_fkey(class, spec, role)';

var SIGNUP_STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Denied', added: 'Rostered' };

// Maps a raw season_signups row (with embedded classes_specs) to the shape the
// existing render functions expect. main_swap signups display the swap
// character's class/spec (swap_class_spec_id), matching the pending_roster
// view's coalesce(swap_class_spec_id, class_spec_id) logic.
function mapSignupRow(row) {
  var cs = (row.main_swap && row.swap_class) || row.main_class || {};
  return {
    id: row.id,
    nameRealm: row.signup_name_realm,
    timestamp: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '',
    className: cs.class || '',
    mainSpec: cs.spec || '',
    role: cs.role || '',
    offSpecs: row.off_specs || '',
    mainSwap: !!row.main_swap,
    notes: row.player_note || '',
    officerNote: row.signup_officer_note || '',
    status: row.status || 'pending',
    season: row.season || ''
  };
}

function fetchSignups(callback) {
  if (!supabaseClient) {
    callback(new Error('Not connected to Supabase.'));
    return;
  }
  supabaseClient
    .from('season_signups')
    .select(SIGNUP_SELECT_COLUMNS)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        callback(result.error);
        return;
      }
      callback(null, (result.data || []).map(mapSignupRow));
    });
}

function buildSignupsTab() {
  renderSignupToggle();
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  fetchSignups(function (err, signups) {
    if (err) {
      var c = document.getElementById('signupsResponsesContainer');
      if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + err.message + '</p>';
      return;
    }
    renderSignupResponses(signups);
  });
}

function renderSignupResponses(signups) {
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;

  // Approved/rostered signups move to the Pending Roster / roster tabs;
  // denied signups move to the History sub-tab. Only pending stays here.
  signups = signups.filter(function (s) {
    return s.status === 'pending';
  });

  if (!signups.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    return;
  }

  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    signups.length +
    ' submission' +
    (signups.length !== 1 ? 's' : '') +
    '</div>';

  signups.forEach(function (s) {
    var clsColor = classColor(s.className);
    var isPending = s.status === 'pending';
    var statusLabel = SIGNUP_STATUS_LABELS[s.status] || s.status;
    var statusBadge = isPending
      ? ''
      : '<span class="signup-status-badge ' +
        (s.status === 'approved' ? 'signup-status-open' : 'signup-status-closed') +
        '" style="font-size:0.85rem;padding:0.1rem 0.5rem;margin-left:0.4rem;">' +
        statusLabel +
        '</span>';
    var actionBtns = isPending
      ? '<div class="signup-review-actions" style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
        '<input type="text" class="signup-officer-note-input" placeholder="Officer note (optional)" ' +
        'style="width:100%;box-sizing:border-box;margin-bottom:0.5rem;padding:0.3rem 0.5rem;font-size:0.97rem;' +
        'background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
        '<div style="display:flex;gap:0.5rem;">' +
        '<button class="btn request-approve-btn" onclick="approveSignupRow(' +
        s.id +
        ',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="denySignupRow(' +
        s.id +
        ',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Deny</button>' +
        '</div>' +
        '</div>'
      : '';
    html +=
      '<div class="signup-response-card" data-row="' +
      s.id +
      '">' +
      '<div class="signup-response-header">' +
      '<div style="display:flex;align-items:center;">' +
      '<span class="signup-response-name">' +
      escHtml(s.nameRealm) +
      '</span>' +
      statusBadge +
      '</div>' +
      '<span class="signup-response-time">' +
      s.timestamp +
      '</span>' +
      '</div>' +
      '<div style="font-size:1rem;color:' +
      clsColor +
      ';margin-top:0.35rem;font-weight:600;">' +
      s.className +
      ' &middot; ' +
      s.mainSpec +
      (s.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + s.offSpecs + '</span>' : '') +
      '</div>';
    if (s.role)
      html +=
        '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' +
        s.role +
        '</span></div>';
    if (s.mainSwap)
      html +=
        '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">' +
        '<span style="color:var(--gold-light);font-weight:600;">Main swap requested</span></div>';
    if (s.notes)
      html +=
        '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
        escHtml(s.notes) +
        '</div>';
    if (!isPending && s.officerNote)
      html +=
        '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.4rem;font-style:italic;">' +
        'Officer note: ' +
        escHtml(s.officerNote) +
        '</div>';
    html += actionBtns + '</div>';
  });

  container.innerHTML = html + '</div>';
}

// ── Signup History sub-tab ───────────────────────────────────────────────────

function buildSignupHistoryTab() {
  var container = document.getElementById('signupHistoryContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading...</p>';

  fetchSignups(function (err, signups) {
    if (err) {
      var c = document.getElementById('signupHistoryContainer');
      if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + err.message + '</p>';
      return;
    }
    renderSignupHistory(signups);
  });
}

function renderSignupHistory(signups) {
  var container = document.getElementById('signupHistoryContainer');
  if (!container) return;

  var season = DATA && DATA.signupSeason;
  var filtered = season
    ? signups.filter(function (s) {
        return s.season === season;
      })
    : signups;

  var seasonLabel = season ? ' for ' + season : '';

  if (!filtered.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups recorded' +
      seasonLabel +
      '.</p>';
    return;
  }

  var statusOrder = ['Rostered', 'Approved', 'Pending', 'Denied'];
  var statusColors = {
    Rostered: 'var(--heal)',
    Approved: 'var(--heal)',
    Pending: 'var(--gold-light)',
    Denied: 'var(--melee)'
  };
  var byStatus = { Rostered: [], Approved: [], Pending: [], Denied: [] };
  filtered.forEach(function (s) {
    var st = SIGNUP_STATUS_LABELS[s.status] || 'Pending';
    if (!byStatus[st]) byStatus[st] = [];
    byStatus[st].push(s);
  });

  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);' +
    'font-weight:600;margin-bottom:0.75rem;">' +
    filtered.length +
    ' signup' +
    (filtered.length !== 1 ? 's' : '') +
    seasonLabel +
    '</div>';

  statusOrder.forEach(function (st) {
    var group = byStatus[st];
    if (!group || !group.length) return;
    html +=
      '<div style="margin-bottom:1.5rem;">' +
      '<div style="font-size:0.91rem;text-transform:uppercase;letter-spacing:0.12em;color:' +
      (statusColors[st] || 'var(--text-muted)') +
      ';font-weight:700;margin-bottom:0.5rem;">' +
      st +
      ' (' +
      group.length +
      ')</div>';
    group.forEach(function (s) {
      var clsColor = classColor(s.className);
      html +=
        '<div class="signup-response-card" style="opacity:' +
        (st === 'Denied' ? '0.55' : '1') +
        ';">' +
        '<div class="signup-response-header">' +
        '<div style="display:flex;align-items:center;">' +
        '<span class="signup-response-name">' +
        escHtml(s.nameRealm) +
        '</span>' +
        '<span class="signup-status-badge ' +
        (st === 'Approved' || st === 'Rostered'
          ? 'signup-status-open'
          : st === 'Denied'
            ? 'signup-status-closed'
            : '') +
        '" style="font-size:0.85rem;padding:0.1rem 0.5rem;margin-left:0.4rem;">' +
        st +
        '</span>' +
        '</div>' +
        '<span class="signup-response-time">' +
        s.timestamp +
        '</span>' +
        '</div>' +
        '<div style="font-size:1rem;color:' +
        clsColor +
        ';margin-top:0.35rem;font-weight:600;">' +
        s.className +
        ' &middot; ' +
        s.mainSpec +
        (s.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + s.offSpecs + '</span>' : '') +
        '</div>';
      if (s.role)
        html +=
          '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' +
          s.role +
          '</span></div>';
      if (s.mainSwap)
        html +=
          '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">' +
          '<span style="color:var(--gold-light);font-weight:600;">Main swap requested</span></div>';
      if (s.notes)
        html +=
          '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          escHtml(s.notes) +
          '</div>';
      if (s.officerNote)
        html +=
          '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.4rem;font-style:italic;">' +
          'Officer note: ' +
          escHtml(s.officerNote) +
          '</div>';
      html += '</div>';
    });
    html += '</div>';
  });

  container.innerHTML = html + '</div>';
}

// Shared by approveSignupRow/denySignupRow: updates status/reviewed_at/
// reviewed_by (+ optional signup_officer_note) via the "Officers update
// signups" RLS policy -- no RPC needed for approve/reject.
function reviewSignup(signupId, status, btnEl) {
  var card = btnEl.closest('.signup-response-card');
  var noteEl = card ? card.querySelector('.signup-officer-note-input') : null;
  var note = noteEl ? noteEl.value.trim() : '';

  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var payload = {
    status: status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: session && session.teamMemberId ? session.teamMemberId : null
  };
  if (note) payload.signup_officer_note = note;

  return supabaseClient
    .from('season_signups')
    .update(payload)
    .eq('id', signupId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      return result;
    });
}

function approveSignupRow(signupId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var denyBtn = btnEl.nextElementSibling;
  if (denyBtn) denyBtn.disabled = true;
  reviewSignup(signupId, 'approved', btnEl).then(function (result) {
    if (result.error) {
      btnEl.disabled = false;
      btnEl.textContent = 'Approve';
      if (denyBtn) denyBtn.disabled = false;
      var card = btnEl.closest('.signup-response-card');
      if (card) {
        var existing = card.querySelector('.signup-action-error');
        if (!existing) {
          existing = document.createElement('p');
          existing.className = 'signup-action-error';
          existing.style.cssText = 'color:var(--melee);font-size:1rem;margin:0.4rem 0 0;';
          btnEl.parentNode.insertBefore(existing, btnEl.parentNode.firstChild);
        }
        existing.textContent = result.error.message;
      }
      return;
    }
    var approvedCard = document.querySelector('.signup-response-card[data-row="' + signupId + '"]');
    if (approvedCard) approvedCard.remove();
    var container = document.getElementById('signupsResponsesContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML =
        '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    }
    updateNavBadges();
  });
}

function denySignupRow(signupId, btnEl) {
  if (!confirm('Deny this signup?')) return;
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var approveBtn = btnEl.previousElementSibling;
  if (approveBtn) approveBtn.disabled = true;
  reviewSignup(signupId, 'rejected', btnEl).then(function (result) {
    if (result.error) {
      btnEl.disabled = false;
      btnEl.textContent = 'Deny';
      if (approveBtn) approveBtn.disabled = false;
      return;
    }
    var card = document.querySelector('.signup-response-card[data-row="' + signupId + '"]');
    if (card) card.remove();
    var container = document.getElementById('signupsResponsesContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML =
        '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    }
    updateNavBadges();
  });
}
