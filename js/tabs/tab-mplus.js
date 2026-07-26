function renderMPlusToggle() {
  var badge = document.getElementById('mplusStatusBadge');
  var btn = document.getElementById('mplusToggleBtn');
  if (!badge || !btn) return;
  var open = !!(DATA && DATA.mPlusExclusionsOpen);
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Requests' : 'Open Requests';
}

function toggleMPlusOpen() {
  var open = !(DATA && DATA.mPlusExclusionsOpen);
  var btn = document.getElementById('mplusToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ mPlusExclusionsOpen: open })
    .then(function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.mPlusExclusionsOpen = open;
      writeAuditLog(open ? 'M+ Exclusions Opened' : 'M+ Exclusions Closed', null, null, null);
      renderMPlusToggle();
    })
    .catch(function () {
      if (btn) btn.disabled = false;
      renderMPlusToggle();
    });
}

function confirmClearAllMPlusExclusions() {
  var el = document.getElementById('mplusClearConfirm');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// Bulk-clears the roster's live exclusion flag directly (#405) -- unlike GAS,
// which also flipped any "Approved" request rows to a 'Reset' sentinel so a
// re-scan of the sheet wouldn't re-count them, the exclusion state now lives
// only on players.m_plus_excluded, so there's nothing else to reconcile.
function executeClearAllMPlusExclusions() {
  var confirmEl = document.getElementById('mplusClearConfirm');
  if (confirmEl) confirmEl.style.display = 'none';
  if (!supabaseClient) return;

  supabaseClient
    .from('players')
    .update({ m_plus_excluded: false })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('m_plus_excluded', true)
    .then(function (result) {
      if (result.error || !DATA || !DATA.roster) return;
      DATA.roster.forEach(function (p) {
        p.mPlusExcluded = false;
      });
      writeAuditLog('All M+ Exclusions Cleared', null, null, null);
      renderActiveExclusions();
      buildRosterTable();
    });
}

function buildMPlusTab() {
  renderMPlusToggle();
  renderActiveExclusions();
  var container = document.getElementById('mplusContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  supabaseClient
    .from('mplus_exclusion_requests')
    .select('id, reason, raiderio_url, submitted_at, players(name_realm)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        var c = document.getElementById('mplusContainer');
        if (c)
          c.innerHTML =
            '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      var submissions = (result.data || []).map(function (row) {
        return {
          id: row.id,
          nameRealm: (row.players && row.players.name_realm) || '',
          raiderioUrl: row.raiderio_url || '',
          notes: row.reason || '',
          timestamp: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : ''
        };
      });
      renderMPlusSubmissions(submissions);
    });
}

function renderActiveExclusions() {
  var container = document.getElementById('mplusActiveContainer');
  if (!container) return;
  var active = ((DATA && DATA.roster) || []).filter(function (p) {
    return p.mPlusExcluded;
  });
  if (!active.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1.07rem;margin-top:0.75rem;">No players currently excluded.</p>';
    return;
  }
  var html = '<div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.4rem;">';
  active.forEach(function (p) {
    html +=
      '<div style="display:flex;align-items:baseline;gap:0.6rem;padding:0.4rem 0;border-bottom:1px solid var(--border);">' +
      '<span style="font-size:1rem;font-weight:600;color:var(--text);min-width:140px;">' +
      p.nameRealm +
      '</span>' +
      (p.mPlusNote
        ? '<span style="font-size:1rem;color:var(--text-muted);font-style:italic;">' + p.mPlusNote + '</span>'
        : '') +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function renderMPlusSubmissions(submissions) {
  var container = document.getElementById('mplusContainer');
  if (!container) return;

  if (!submissions.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
    return;
  }

  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length +
    ' pending request' +
    (submissions.length !== 1 ? 's' : '') +
    '</div>';

  submissions.forEach(function (s) {
    var nrSafe = s.nameRealm.replace(/'/g, "\\'");
    html +=
      '<div class="request-card" data-row="' +
      s.id +
      '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
      '<div>' +
      '<div style="font-size:1.05rem;font-weight:600;color:var(--text);">' +
      s.nameRealm +
      '</div>' +
      '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.15rem;">' +
      s.timestamp +
      '</div>' +
      '</div>' +
      '</div>' +
      (s.raiderioUrl
        ? '<div style="margin-top:0.5rem;"><a href="' +
          s.raiderioUrl +
          '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1.07rem;">View Raider.io Profile</a></div>'
        : '') +
      (s.notes
        ? '<div style="font-size:1.07rem;color:var(--text);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">' +
          s.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
      s.id +
      ",'" +
      nrSafe +
      '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
      '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
      s.id +
      ",'" +
      nrSafe +
      '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>' +
      '</div>' +
      '</div>';
  });

  container.innerHTML = html + '</div>';
}

function approveMPlusExclusion(rowIndex, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_mplusNote' + rowIndex;
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Officer note (optional):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Focus on getting sockets this week instead" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_mplusApproveConfirm' +
    rowIndex +
    '" class="btn request-approve-btn" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
    '<button id="_mplusApproveCancel' +
    rowIndex +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_mplusApproveConfirm' + rowIndex);
  var cancelBtn = document.getElementById('_mplusApproveCancel' + rowIndex);

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmApproveMPlusExclusion(rowIndex, nameRealm, note, confirmBtn);
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      var nrSafe = nameRealm.replace(/'/g, "\\'");
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>';
    });
  }
}

// Approve both settles the request and flips the roster's live exclusion
// flag in one action (#405) -- GAS decoupled these into two separate manual
// steps (approve the request, then remember to also flip the roster
// toggle), which meant an approved request could sit approved without ever
// actually excluding the player. Two officer-writable tables, no RPC needed,
// same pattern as #404's BiS approve.
function confirmApproveMPlusExclusion(requestId, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  supabaseClient
    .from('mplus_exclusion_requests')
    .update({ status: 'approved', officer_notes: note || null })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      supabaseClient
        .from('players')
        .update({ m_plus_excluded: true, m_plus_note: note || null })
        .eq('team_id', _teamCfg.supabaseTeamId)
        .eq('name_realm', nameRealm)
        .then(function (playerResult) {
          if (playerResult.error) {
            btnEl.disabled = false;
            btnEl.textContent = 'Approve';
            return;
          }
          if (player) {
            player.mPlusExcluded = true;
            player.mPlusNote = note || '';
          }
          writeAuditLog('M+ Exclusion Approved', 'players', player ? player.id : null, note || null);
          if (player) notifyPlayer(player.id, 'Your Mythic+ exclusion request was approved.');
          var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
          if (card) card.remove();
          var container = document.getElementById('mplusContainer');
          if (container && !container.querySelector('.request-card')) {
            container.innerHTML =
              '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
          }
          renderActiveExclusions();
          buildRosterTable();
          updateNavBadges();
        });
    });
}

function rejectMPlusExclusion(rowIndex, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_mplusRejectNote' + rowIndex;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Rejection reason (optional, shown to raider):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. You still need to meet the weekly M+ requirement" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_mplusRejectConfirm' +
    rowIndex +
    '" class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>' +
    '<button id="_mplusRejectCancel' +
    rowIndex +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_mplusRejectConfirm' + rowIndex);
  var cancelBtn = document.getElementById('_mplusRejectCancel' + rowIndex);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmRejectMPlusExclusion(rowIndex, nameRealm, note, confirmBtn);
    });
  }
}

function confirmRejectMPlusExclusion(requestId, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  supabaseClient
    .from('mplus_exclusion_requests')
    .update({ status: 'rejected', officer_notes: note || null })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Reject';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      if (player) {
        player.mPlusRejected = true;
        player.mPlusRejectionNote = note || '';
      }
      writeAuditLog('M+ Exclusion Rejected', 'players', player ? player.id : null, note || null);
      if (player) {
        notifyPlayer(player.id, 'Your Mythic+ exclusion request was rejected.' + (note ? ' Reason: ' + note : ''));
      }
      var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
      if (card) card.remove();
      var container = document.getElementById('mplusContainer');
      if (container && !container.querySelector('.request-card')) {
        container.innerHTML =
          '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
      }
      updateNavBadges();
    });
}
