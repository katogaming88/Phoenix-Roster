function buildRequestsTab() {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading requests...</p>';

  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  // team-read-guard: approved requests only, one row per item a player self-reported.
  supabaseClient
    .from('self_received_requests')
    .select('id, track, source, note, submitted_at, players(name_realm), items(name, slot)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        var c = document.getElementById('requestsContainer');
        if (c)
          c.innerHTML =
            '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      var requests = (result.data || []).map(function (row) {
        var itemRow = row.items || {};
        var diff = row.track === 'Myth' ? 'Mythic' : row.track === 'Hero' ? 'Heroic' : row.track || '';
        return {
          id: row.id,
          nameRealm: (row.players && row.players.name_realm) || '',
          item: itemRow.name || '',
          slot: itemRow.slot || '',
          source: (diff ? diff + ': ' : '') + (row.source || ''),
          notes: row.note || '',
          timestamp: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : ''
        };
      });
      renderPendingRequests(requests);
    });
}

function renderPendingRequests(requests) {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
    return;
  }
  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    requests.length +
    ' pending request' +
    (requests.length !== 1 ? 's' : '') +
    '</div>';
  requests.forEach(function (r) {
    html +=
      '<div class="request-card" data-row="' +
      r.id +
      '" data-name-realm="' +
      r.nameRealm.replace(/"/g, '&quot;') +
      '" data-item="' +
      r.item.replace(/"/g, '&quot;') +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      r.nameRealm.split('-')[0] +
      '</span>' +
      '<span class="signup-response-time">' +
      r.timestamp +
      '</span>' +
      '</div>' +
      '<div class="request-item">' +
      r.item +
      (r.slot ? ' <span style="color:var(--text-muted);font-weight:400;">(' + r.slot + ')</span>' : '') +
      '</div>' +
      '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Source: <span style="color:var(--text);">' +
      r.source +
      '</span></div>' +
      (r.notes
        ? '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          r.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveRequest(' +
      r.id +
      ', this)">Approve</button>' +
      '<button class="btn request-reject-btn" onclick="rejectRequest(' +
      r.id +
      ', this)">Reject</button>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

// Approve/reject are plain updates -- self_received_requests already has
// Officers update RLS in place (#406), unlike the insert path which has to
// go through submit_self_received()/direct_mark_received() since request
// tables have no INSERT policy for anyone.
function approveRequest(requestId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var item = card ? card.getAttribute('data-item') : '';

  supabaseClient
    .from('self_received_requests')
    .update({ status: 'approved' })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('Self-Received Approved', 'players', player ? player.id : null, null);
      if (player) notifyPlayer(player.id, 'Your self-received item (' + item + ') was approved.');
      if (card) card.remove();
      checkEmptyRequests();
    });
}

function rejectRequest(requestId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var item = card ? card.getAttribute('data-item') : '';

  supabaseClient
    .from('self_received_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Reject';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('Self-Received Rejected', 'players', player ? player.id : null, null);
      if (player) notifyPlayer(player.id, 'Your self-received item (' + item + ') was rejected.');
      if (card) card.remove();
      checkEmptyRequests();
    });
}

function checkEmptyRequests() {
  var container = document.getElementById('requestsContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
  }
  updateNavBadges();
}
