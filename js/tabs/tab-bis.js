function renderBisToggle() {
  var badge = document.getElementById('bisStatusBadge');
  var btn = document.getElementById('bisToggleBtn');
  if (!badge || !btn) return;
  var open = bisSubmissionsOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Submissions' : 'Open Submissions';
}

function toggleBisSubmissionsOpen() {
  setBisSubmissionsOpen(!bisSubmissionsOpen());
}

function setBisSubmissionsOpen(open) {
  var btn = document.getElementById('bisToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ bisSubmissionsOpen: open }).then(
    function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.bisSubmissionsOpen = open;
      writeAuditLog(open ? 'BiS Submissions Opened' : 'BiS Submissions Closed', null, null, null);
      renderBisToggle();
    },
    function () {
      if (btn) btn.disabled = false;
      renderBisToggle();
    }
  );
}

// Distinct from the 'bis' feature flag (whole tab hidden vs. just editing
// paused) and from bisSubmissionsOpen (that gates the BiS Link submit form,
// this gates the wishlist's own status buttons/notes) -- same toggle shape
// as both, just its own team_settings.config key.
function renderWishlistToggle() {
  var badge = document.getElementById('wishlistStatusBadge');
  var btn = document.getElementById('wishlistToggleBtn');
  if (!badge || !btn) return;
  var open = wishlistOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Wishlist Editing' : 'Open Wishlist Editing';
}

function toggleWishlistOpen() {
  setWishlistOpen(!wishlistOpen());
}

function setWishlistOpen(open) {
  var btn = document.getElementById('wishlistToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ wishlistOpen: open }).then(
    function () {
      if (btn) btn.disabled = false;
      if (DATA) DATA.wishlistOpen = open;
      writeAuditLog(open ? 'Wishlist Editing Opened' : 'Wishlist Editing Closed', null, null, null);
      renderWishlistToggle();
    },
    function () {
      if (btn) btn.disabled = false;
      renderWishlistToggle();
    }
  );
}

function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  supabaseClient
    .from('bis_requests')
    .select('id, bis_link, player_note, submitted_at, players(name_realm)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        var c = document.getElementById('bisContainer');
        if (c)
          c.innerHTML =
            '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      var submissions = (result.data || []).map(function (row) {
        var nameRealm = (row.players && row.players.name_realm) || '';
        var bisLink = row.bis_link || '';
        var rosterPlayer = findRosterPlayerByNameRealm(nameRealm);
        return {
          id: row.id,
          nameRealm: nameRealm,
          bisLink: bisLink,
          notes: row.player_note || '',
          timestamp: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '',
          // #278: the link on file didn't change -- this is a "recheck the
          // items behind it" flag, not a new-link submission.
          sameLink: !!(rosterPlayer && rosterPlayer.bisLink && rosterPlayer.bisLink === bisLink)
        };
      });
      renderBisSubmissions(submissions);
    });
}

function renderBisSubmissions(submissions) {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  if (!submissions.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
    return;
  }
  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length +
    ' pending submission' +
    (submissions.length !== 1 ? 's' : '') +
    '</div>';
  submissions.forEach(function (s) {
    html +=
      '<div class="request-card" data-row="' +
      s.id +
      '" data-name-realm="' +
      s.nameRealm.replace(/"/g, '&quot;') +
      '" data-bis-link="' +
      s.bisLink.replace(/"/g, '&quot;') +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      s.nameRealm +
      '</span>' +
      (s.sameLink
        ? '<span class="signup-status-badge signup-status-open" style="margin-left:0.5rem;">Same link -- items changed</span>'
        : '') +
      '<span class="signup-response-time">' +
      s.timestamp +
      '</span>' +
      '</div>' +
      '<div class="request-item" style="word-break:break-all;margin-top:0.35rem;">' +
      '<a href="' +
      s.bisLink +
      '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;">' +
      s.bisLink +
      '</a>' +
      '</div>' +
      (s.notes
        ? '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          s.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
      s.id +
      ",'" +
      s.nameRealm.replace(/'/g, "\\'") +
      '\', this)">Approve</button>' +
      '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
      s.id +
      ",'" +
      s.nameRealm.replace(/'/g, "\\'") +
      '\', this)">Reject</button>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

// Mirrors tab-mplus.js's approveMPlusExclusion: swaps the Approve/Reject
// pair for an inline optional note field before confirming, same as
// rejectBisSubmission below.
function approveBisSubmission(requestId, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_bisApproveNote' + requestId;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Officer note (optional):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Looks good, nice upgrades this tier" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_bisApproveConfirm' +
    requestId +
    '" class="btn request-approve-btn" style="font-size:1rem;padding:0.25rem 0.75rem;">Approve</button>' +
    '<button id="_bisApproveCancel' +
    requestId +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_bisApproveConfirm' + requestId);
  var cancelBtn = document.getElementById('_bisApproveCancel' + requestId);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmApproveBisSubmission(requestId, nameRealm, note, confirmBtn);
    });
  }
}

// Writes both bis_requests.status and players.bis_link -- two separate
// officer-writable tables, no RPC needed (mirrors the direct-write pattern
// tab-roster.js already uses). Not atomic, but a failure between the two
// calls just leaves the request pending for a retry -- no partial state an
// officer could act on incorrectly.
function confirmApproveBisSubmission(requestId, nameRealm, note, btnEl) {
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var bisLink = card ? card.getAttribute('data-bis-link') : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';

  supabaseClient
    .from('bis_requests')
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
        .update({ bis_link: bisLink })
        .eq('team_id', _teamCfg.supabaseTeamId)
        .eq('name_realm', nameRealm)
        .then(function (playerResult) {
          if (playerResult.error) {
            btnEl.disabled = false;
            btnEl.textContent = 'Approve';
            return;
          }
          writeAuditLog('BiS Approved', 'players', player ? player.id : null, bisLink);
          if (player) notifyPlayer(player.id, 'Your BiS list link was approved.');
          if (card) card.remove();
          checkEmptyBisSubmissions();
        });
    });
}

// Mirrors tab-mplus.js's rejectMPlusExclusion/confirmRejectMPlusExclusion:
// swaps the Approve/Reject pair for an inline note field so an officer can
// leave a reason before confirming, rather than rejecting blind.
function rejectBisSubmission(requestId, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_bisRejectNote' + requestId;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Rejection reason (optional, shown to raider):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Link is broken, please resubmit" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_bisRejectConfirm' +
    requestId +
    '" class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>' +
    '<button id="_bisRejectCancel' +
    requestId +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_bisRejectConfirm' + requestId);
  var cancelBtn = document.getElementById('_bisRejectCancel' + requestId);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveBisSubmission(' +
        requestId +
        ', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' +
        requestId +
        ",'" +
        nrSafe +
        '\', this)">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmRejectBisSubmission(requestId, nameRealm, note, confirmBtn);
    });
  }
}

function confirmRejectBisSubmission(requestId, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');

  supabaseClient
    .from('bis_requests')
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
      writeAuditLog('BiS Rejected', 'players', player ? player.id : null, note || null);
      if (player) {
        notifyPlayer(player.id, 'Your BiS list link was rejected.' + (note ? ' Reason: ' + note : ''));
      }
      if (card) card.remove();
      checkEmptyBisSubmissions();
    });
}

function checkEmptyBisSubmissions() {
  var container = document.getElementById('bisContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
  }
  updateNavBadges();
}

// ── BiS Lists sub-tab (Supabase, #217) ───────────────────────────────────────
//
// Every add/remove/mark-obtained writes straight to bis_items and logs itself
// via writeAuditLog() (#214) -- no staged "Save" step, since the backend
// supports true per-row writes now (unlike the old GAS setBisItems, which
// only rewrote a player's whole BiS column at once). getBisItems(nameRealm)
// (js/common.js) is the live source of truth; DATA.bisList is patched in
// place after each successful write instead of re-fetching. Audit entries use
// target_type 'players' (not 'bis_items') so TARGET still resolves to the
// character name even after a row is deleted -- a bis_items id would go
// stale the moment "remove" runs, since resolveAuditTargetNames() (tab-audit.js)
// only ever looks the row up by a still-existing primary key.
//
// The editor is a fixed grid of BIS_SLOTS rows rather than a flat add-list
// (#393 follow-up): a BiS list only ever has one item per slot, so showing
// every slot up front and letting an officer fill in the empty ones removes
// the search-then-guess-the-slot step search previously required, especially
// for M+/Crafted/Catalyst placeholders which have no catalog slot to search
// by at all.

var _bisListEditor = null; // { firstName, nameRealm }
var _bisActiveSlot = null; // canonical BIS_SLOTS row currently showing its inline add-search, or null
var _bisActiveSlotQuery = '';

// Every row a BiS list can have an opinion about. Finger/Trinket get two
// rows each since a player can want a different item in each -- items.slot
// itself only ever says "Finger" or "Trinket" (fetch-items.js has no notion
// of which of the two), so bis_items.slot is what actually distinguishes them
// once an item's assigned to one of these rows (see bisSlotPickItem).
var BIS_SLOTS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
];

// Maps an items.slot catalog value to the BIS_SLOTS row(s) an item with that
// slot can fill. Both sides now speak the same vocabulary: items.slot holds the
// canonical Wowhead/in-game slot name, so most entries are a straight 1:1 and
// the old synonym half of this map (Boots -> Feet, Gloves -> Hands, Belt ->
// Waist, Bracers -> Wrist, Cloak -> Back, Shoulders -> Shoulder, Ring ->
// Finger) is gone with the hand-typed spreadsheet vocabulary it translated.
//
// What remains is the one mapping that is irreducible: an item's slot is a
// *type* (a ring fits either finger; a trinket either trinket slot), while a
// BIS_SLOTS row is a *position*. Only the officer's BiS assignment can say
// which, so Finger/Trinket fan out to both numbered rows.
//
// Weapons collapse to the single Weapon row: this app has never modeled 2H vs
// 1H+OH as different BiS slots. 'Held In Off-hand' is Wowhead's own name for
// the off-hand-only items (tomes, orbs) that share the Off Hand row with
// shields. Slotless catalog values -- 'Placeholder' (M+/Crafted/Catalyst) and
// 'Curio' (a class-set trade token, not equippable) -- map to no row on
// purpose: nothing about them names a gear position.
var BIS_CATALOG_SLOT_TO_ROWS = {
  Head: ['Head'],
  Neck: ['Neck'],
  Shoulder: ['Shoulder'],
  Back: ['Back'],
  Chest: ['Chest'],
  Wrist: ['Wrist'],
  Hands: ['Hands'],
  Waist: ['Waist'],
  Legs: ['Legs'],
  Feet: ['Feet'],
  Finger: ['Finger 1', 'Finger 2'],
  Trinket: ['Trinket 1', 'Trinket 2'],
  'One-Hand': ['Weapon'],
  'Two-Hand': ['Weapon'],
  Ranged: ['Weapon'],
  'Off Hand': ['Off Hand'],
  'Held In Off-hand': ['Off Hand']
};

var BIS_ARMOR_TYPES = { Plate: true, Mail: true, Leather: true, Cloth: true };
// Rows for which armor-type filtering doesn't apply -- trinkets/jewelry/
// cloaks have no armor type, and both weapon rows accept any class' gear.
var BIS_UNIVERSAL_ROWS = {
  Neck: true,
  Back: true,
  Wrist: true,
  'Finger 1': true,
  'Finger 2': true,
  'Trinket 1': true,
  'Trinket 2': true,
  Weapon: true,
  'Off Hand': true
};

// bis_items keys on (player_id, item_id); items aren't looked up by id
// anywhere on the client yet, so resolve by exact name match (items.name has
// a unique index) the same way #216 resolved classes_specs.
function resolveItemId(itemName) {
  return supabaseClient
    .from('items')
    .select('id')
    .eq('name', itemName)
    .maybeSingle()
    .then(function (result) {
      if (result.error || !result.data) throw new Error('Unknown item: ' + itemName);
      return result.data.id;
    });
}

function bisItemAuditDetail(itemName, slot) {
  return [slot, itemName].filter(Boolean).join(' ');
}

// DATA.bisList's key may not be an exact case match for the roster's
// nameRealm (mirrors the same normalise-based lookup getBisItems() already
// does); falls back to nameRealm itself for a player's first-ever BiS entry.
// Keyed by full identity (#529), not first name, so this can never resolve
// to the wrong twin.
function bisListKeyFor(nameRealm) {
  var bisMap = DATA.bisList || {};
  var norm = normalise(nameRealm);
  var keys = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return keys[i];
  }
  return nameRealm;
}

function buildBisListsTab() {
  var container = document.getElementById('bis-lists-container');
  if (!container) return;

  var roster = DATA.roster || [];
  var order = ['Tank', 'Heal', 'Melee', 'Ranged', 'Bench'];
  var labels = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged', Bench: 'Bench' };
  var groups = { Tank: [], Heal: [], Melee: [], Ranged: [], Bench: [] };

  // Wishlist completeness (#515) -- getIncompleteWishlists() is defined in
  // tab-priority.js, loaded after this file, but that only matters for
  // parse-time references; by the time this function actually runs (a tab
  // switch, well after page load) it's available. A per-player missing-slot
  // badge here replaces the standalone "big block of missing" banner that
  // used to sit under the Wishlist Editing toggle.
  var incompleteWishlists =
    typeof getIncompleteWishlists === 'function' ? getIncompleteWishlists() : { count: 0, raiders: [] };
  var missingByNameRealm = {};
  incompleteWishlists.raiders.forEach(function (r) {
    missingByNameRealm[r.nameRealm] = r.missingRows;
  });

  for (var i = 0; i < roster.length; i++) {
    var rp = roster[i];
    if (rp.isBench) groups['Bench'].push(rp);
    else if (groups[rp.role]) groups[rp.role].push(rp);
  }

  var html =
    '<table class="roster-table" style="margin-top:0.25rem;">' +
    '<thead><tr><th>Player</th><th>Class / Spec</th><th>BiS Items</th><th></th></tr></thead><tbody>';

  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    var players = groups[role];
    if (!players.length) continue;
    players.sort(function (a, b) {
      return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
    });
    html += '<tr class="group-header"><td colspan="4">' + labels[role] + '</td></tr>';

    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var bisCount = getBisItems(p.nameRealm).filter(function (e) {
        return typeof isItemInSeasonScope !== 'function' || isItemInSeasonScope(e.item);
      }).length;
      var roleColor =
        p.role === 'Tank'
          ? 'var(--tank)'
          : p.role === 'Heal'
            ? 'var(--heal)'
            : p.role === 'Ranged'
              ? 'var(--ranged)'
              : 'var(--melee)';
      var dispName = p.nick || p.firstName;
      var isEditing = _bisListEditor && _bisListEditor.nameRealm === p.nameRealm;
      var fnSafe = p.firstName.replace(/'/g, "\\'");
      var nrSafe = p.nameRealm.replace(/'/g, "\\'");
      var missingRows = missingByNameRealm[p.nameRealm];

      html +=
        '<tr id="bis-player-row-' +
        p.nameRealm +
        '">' +
        '<td><div class="player-name-cell">' +
        '<div class="mini-avatar" style="background:rgba(0,0,0,0.25);color:' +
        roleColor +
        ';border:2px solid ' +
        roleColor +
        ';">' +
        dispName.slice(0, 2).toUpperCase() +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
        '<span style="font-weight:600;color:var(--text);">' +
        dispName +
        '</span>' +
        (p.firstName !== dispName
          ? '<span style="font-size:1.02rem;color:var(--text-muted);">(' + p.firstName + ')</span>'
          : '') +
        (missingRows
          ? '<span style="font-size:0.85em;color:var(--melee);cursor:default;" title="Wishlist missing: ' +
            missingRows.join(', ').replace(/"/g, '&quot;') +
            '">Wishlist incomplete (' +
            missingRows.length +
            ')</span>'
          : '') +
        '</div>' +
        '</div></td>' +
        '<td>' +
        (p.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(p.class) +
            ';">' +
            (p.spec || p.class) +
            '</span>'
          : '<span style="color:var(--text-dim);">-</span>') +
        '</td>' +
        '<td><span style="color:' +
        (bisCount > 0 ? 'var(--gold)' : 'var(--text-dim)') +
        ';font-weight:600;">' +
        bisCount +
        '</span></td>' +
        '<td><button class="btn ' +
        (isEditing ? 'btn-gold' : 'btn-muted') +
        '" style="font-size:0.97rem;padding:0.2rem 0.65rem;" ' +
        'onclick="toggleBisListEditor(\'' +
        fnSafe +
        "','" +
        nrSafe +
        '\')">' +
        (isEditing ? 'Close' : 'Edit') +
        '</button></td>' +
        '</tr>' +
        '<tr id="bis-editor-row-' +
        p.nameRealm +
        '" style="display:' +
        (isEditing ? '' : 'none') +
        ';">' +
        '<td colspan="4" style="padding:0.75rem 1rem 0.75rem 1.25rem;background:rgba(0,0,0,0.12);border-top:none;">' +
        '<div id="bis-editor-panel-' +
        p.nameRealm +
        '">' +
        (isEditing ? bisEditorHTML() : '') +
        '</div>' +
        '</td>' +
        '</tr>';
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  if (_bisListEditor) wireBisSlotSearchInput();
}

function wireBisSlotSearchInput() {
  var searchEl = document.getElementById('bisSlotSearchInput');
  if (!searchEl) return;
  searchEl.value = _bisActiveSlotQuery;
  searchEl.focus();
  searchEl.addEventListener('blur', function () {
    setTimeout(function () {
      var dd = document.getElementById('bisSlotDropdown');
      if (dd) dd.style.display = 'none';
    }, 150);
  });
  bisSlotOnInput();
}

function toggleBisListEditor(firstName, nameRealm) {
  if (_bisListEditor && _bisListEditor.nameRealm === nameRealm) {
    _bisListEditor = null;
  } else {
    _bisListEditor = { firstName: firstName, nameRealm: nameRealm };
  }
  _bisActiveSlot = null;
  _bisActiveSlotQuery = '';
  buildBisListsTab();
}

// Groups a player's bis_items entries under their canonical BIS_SLOTS row.
// New rows always carry an explicit dbSlot (set at insert time by
// bisSlotPickItem); rows added before this feature existed have dbSlot null
// and fall back to their item's catalog slot, landing in the first open
// matching row -- Finger/Trinket ambiguity for those legacy rows was never
// tracked per-slot, so this is a best-effort placement, not a source of
// truth. Anything that still doesn't land anywhere (unrecognised slot, or
// every candidate row already taken) surfaces in a separate leftover list
// so nothing silently disappears from the editor.
function bisSlotBuckets(items) {
  var buckets = {};
  BIS_SLOTS.forEach(function (s) {
    buckets[s] = null;
  });
  var leftover = [];
  var itemSlots = DATA.itemSlots || {};
  var unassigned = [];

  items.forEach(function (entry, idx) {
    if (typeof isItemInSeasonScope === 'function' && !isItemInSeasonScope(entry.item)) return;
    if (entry.dbSlot && BIS_SLOTS.indexOf(entry.dbSlot) !== -1 && !buckets[entry.dbSlot]) {
      buckets[entry.dbSlot] = { entry: entry, index: idx };
    } else {
      unassigned.push({ entry: entry, index: idx });
    }
  });

  unassigned.forEach(function (u) {
    var catalogSlot = itemSlots[u.entry.item] || '';
    var candidates = BIS_CATALOG_SLOT_TO_ROWS[catalogSlot] || [];
    for (var c = 0; c < candidates.length; c++) {
      if (!buckets[candidates[c]]) {
        buckets[candidates[c]] = { entry: u.entry, index: u.index };
        return;
      }
    }
    leftover.push({ entry: u.entry, index: u.index });
  });

  return { buckets: buckets, leftover: leftover };
}

function bisSlotRowHTML(label, colorSlot, index, entry, isEmpty, isActive, rowPosition) {
  var html =
    '<div style="display:flex;align-items:center;gap:0.5rem;font-size:1.07rem;padding:0.3rem 0.5rem;' +
    'border-radius:4px;border:1px solid var(--border);background:' +
    (rowPosition % 2 ? 'var(--bg-elevated)' : 'var(--bg-card)') +
    ';">' +
    '<span style="min-width:5rem;color:' +
    getSlotColor(colorSlot) +
    ';font-size:0.97rem;">' +
    label +
    '</span>';

  if (entry) {
    var obtained = !!entry.obtained;
    html +=
      '<span style="flex:1;color:var(--text);' +
      (obtained ? 'text-decoration:line-through;opacity:0.7;' : '') +
      '">' +
      entry.item +
      '</span>' +
      '<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.95rem;color:var(--text-muted);cursor:pointer;white-space:nowrap;">' +
      '<input type="checkbox" ' +
      (obtained ? 'checked' : '') +
      ' onchange="toggleBisItemObtained(' +
      index +
      ', this.checked)">Obtained</label>' +
      '<button class="btn btn-muted" style="font-size:0.91rem;padding:1px 7px;color:var(--melee);" ' +
      'onclick="removeBisListItem(' +
      index +
      ')">x</button>';
  } else if (isActive) {
    html +=
      '<div style="position:relative;flex:1;">' +
      '<input type="text" id="bisSlotSearchInput" placeholder="Search items for ' +
      label +
      '..." class="self-received-source" style="width:100%;box-sizing:border-box;font-size:1.02rem;" ' +
      'oninput="bisSlotOnInput()" autocomplete="off">' +
      '<div id="bisSlotDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;' +
      'background:var(--bg-card);border:1px solid var(--border);border-radius:4px;z-index:100;' +
      'max-height:200px;overflow-y:auto;"></div>' +
      '</div>' +
      '<button class="btn btn-muted" style="font-size:0.91rem;padding:1px 7px;" ' +
      'onclick="bisSlotCancelAdd()">Cancel</button>';
  } else if (isEmpty) {
    html +=
      '<span style="flex:1;color:var(--text-dim);font-style:italic;">-- empty --</span>' +
      '<button class="btn btn-muted" style="font-size:0.91rem;padding:1px 7px;" ' +
      'onclick="bisSlotStartAdd(\'' +
      label +
      '\')">+ Add</button>';
  }

  html += '</div>';
  return html;
}

function bisEditorHTML() {
  if (!_bisListEditor) return '';
  var items = getBisItems(_bisListEditor.nameRealm);
  var grouped = bisSlotBuckets(items);
  var buckets = grouped.buckets;
  var leftover = grouped.leftover;
  var html = '<div style="margin-bottom:0.6rem;">';

  var player = findRosterPlayerByNameRealm(_bisListEditor.nameRealm);
  var bisLink = player && player.bisLink;
  html +=
    '<div style="font-size:1rem;color:var(--text-muted);margin-bottom:0.5rem;">BiS Source: ' +
    (bisLink
      ? '<a href="' + bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);">' + bisLink + '</a>'
      : '<span style="color:var(--text-dim);">none</span>') +
    '</div>';

  html += '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:0.6rem;">';
  for (var s = 0; s < BIS_SLOTS.length; s++) {
    var slotName = BIS_SLOTS[s];
    var bucket = buckets[slotName];
    html += bisSlotRowHTML(
      slotName,
      slotName,
      bucket ? bucket.index : -1,
      bucket ? bucket.entry : null,
      !bucket,
      _bisActiveSlot === slotName,
      s
    );
  }
  html += '</div>';

  if (leftover.length) {
    html +=
      '<p style="font-size:0.95rem;color:var(--text-dim);margin:0.3rem 0 0.2rem;">Other (doesn\'t match a standard slot):</p>' +
      '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:0.6rem;">';
    leftover.forEach(function (u, li) {
      html += bisSlotRowHTML(u.entry.slot || '?', u.entry.slot, u.index, u.entry, false, false, li);
    });
    html += '</div>';
  }

  html +=
    '<div style="display:flex;gap:0.5rem;align-items:center;">' +
    '<span id="bisListSaveMsg" style="font-size:1.04rem;color:var(--text-muted);"></span>' +
    '</div>';

  html += '</div>';
  return html;
}

function refreshBisEditorPanel() {
  if (!_bisListEditor) return;
  var panel = document.getElementById('bis-editor-panel-' + _bisListEditor.nameRealm);
  if (!panel) return;
  panel.innerHTML = bisEditorHTML();
  wireBisSlotSearchInput();
}

// A placeholder item (M+/Crafted/Catalyst) or a Finger/Trinket item can now
// have more than one row per player, distinguished only by bis_items.slot
// (#393 follow-up) -- .eq('item_id', ...) alone would match every one of
// them. entry.dbSlot is the raw column value (set for every row added
// through this editor; null only for legacy rows added before it existed).
function bisSlotFilter(query, dbSlot) {
  return dbSlot ? query.eq('slot', dbSlot) : query.is('slot', null);
}

function removeBisListItem(index) {
  if (!_bisListEditor) return;
  var entry = getBisItems(_bisListEditor.nameRealm)[index];
  var player = findRosterPlayerByNameRealm(_bisListEditor.nameRealm);
  if (!entry || !player || !player.id || entry.itemId == null) return;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Removing...';
  bisSlotFilter(
    supabaseClient.from('bis_items').delete().eq('player_id', player.id).eq('item_id', entry.itemId),
    entry.dbSlot
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('BiS Item Removed', 'players', player.id, bisItemAuditDetail(entry.item, entry.slot));
    })
    .then(function () {
      var key = bisListKeyFor(_bisListEditor.nameRealm);
      if (DATA.bisList && DATA.bisList[key]) {
        DATA.bisList[key] = DATA.bisList[key].filter(function (e) {
          return !(e.itemId === entry.itemId && (e.dbSlot || null) === (entry.dbSlot || null));
        });
      }
      // Rebuilds the whole tab, not just refreshBisEditorPanel() -- the row's
      // own BiS-count badge needs to move too, since this is already committed
      // state rather than a pending draft.
      buildBisListsTab();
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}

function toggleBisItemObtained(index, checked) {
  if (!_bisListEditor) return;
  var entry = getBisItems(_bisListEditor.nameRealm)[index];
  var player = findRosterPlayerByNameRealm(_bisListEditor.nameRealm);
  if (!entry || !player || !player.id || entry.itemId == null) return;
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Saving...';
  bisSlotFilter(
    supabaseClient
      .from('bis_items')
      .update({ obtained: checked })
      .eq('player_id', player.id)
      .eq('item_id', entry.itemId),
    entry.dbSlot
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var detail =
        (checked ? 'Marked obtained: ' : 'Marked not obtained: ') + bisItemAuditDetail(entry.item, entry.slot);
      return writeAuditLog('BiS Item Obtained Changed', 'players', player.id, detail);
    })
    .then(function () {
      // entry is the same object reference stored in DATA.bisList (getBisItems()
      // returns object entries as-is, not copies), so this mutation persists.
      entry.obtained = checked;
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = '';
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
      refreshBisEditorPanel();
    });
}

function bisSlotStartAdd(slotName) {
  _bisActiveSlot = slotName;
  _bisActiveSlotQuery = '';
  refreshBisEditorPanel();
}

function bisSlotCancelAdd() {
  _bisActiveSlot = null;
  _bisActiveSlotQuery = '';
  refreshBisEditorPanel();
}

function bisSlotOnInput() {
  if (!_bisActiveSlot) return;
  var slotName = _bisActiveSlot;
  _bisActiveSlotQuery = (document.getElementById('bisSlotSearchInput') || {}).value || '';
  var dropdown = document.getElementById('bisSlotDropdown');
  if (!dropdown) return;
  var query = normalise(_bisActiveSlotQuery.trim());

  var itemSlots = DATA.itemSlots || {};
  var itemArmorTypes = DATA.itemArmorTypes || {};
  var itemPlaceholders = DATA.itemPlaceholders || {};
  var allItems = Object.keys(itemSlots);

  var playerArmorType = null;
  var existingRealItems = {};
  if (_bisListEditor) {
    var roster = DATA.roster || [];
    var edNorm = normalise(_bisListEditor.nameRealm);
    for (var pi = 0; pi < roster.length; pi++) {
      if (normalise(roster[pi].nameRealm) === edNorm) {
        playerArmorType = (CLASS_ARMOR_TYPE || {})[roster[pi].class] || null;
        break;
      }
    }
    var currentItems = getBisItems(_bisListEditor.nameRealm);
    for (var e = 0; e < currentItems.length; e++) {
      if (!itemPlaceholders[currentItems[e].item]) existingRealItems[normalise(currentItems[e].item)] = true;
    }
  }

  var matches = [];
  for (var i = 0; i < allItems.length; i++) {
    var name = allItems[i];
    var isPlaceholder = !!itemPlaceholders[name];
    var catalogSlot = itemSlots[name] || '';

    // Scope to items whose catalog slot maps to this row; placeholders
    // (M+/Crafted/Catalyst) fit every row, since they name a source, not a slot.
    if (!isPlaceholder && (BIS_CATALOG_SLOT_TO_ROWS[catalogSlot] || []).indexOf(slotName) === -1) continue;

    // A real item can only occupy one row -- don't re-offer one already
    // placed elsewhere on this player's list. Placeholders are exempt: the
    // same one can legitimately fill more than one row.
    if (!isPlaceholder && existingRealItems[normalise(name)]) continue;

    if (!isItemInSeasonScope(name)) continue;

    var armorType = itemArmorTypes[name] || '';
    if (
      !isPlaceholder &&
      playerArmorType &&
      BIS_ARMOR_TYPES[armorType] &&
      !BIS_UNIVERSAL_ROWS[slotName] &&
      armorType !== playerArmorType
    )
      continue;

    if (query && normalise(name).indexOf(query) === -1) continue;

    matches.push(name);
    if (matches.length >= 12) break;
  }

  if (!matches.length) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = matches
    .map(function (name) {
      return (
        '<div class="realm-option" onmousedown="bisSlotPickItem(\'' +
        name.replace(/'/g, "\\'") +
        '\')"><span>' +
        name +
        '</span></div>'
      );
    })
    .join('');
  dropdown.style.display = 'block';
}

function bisSlotPickItem(itemName) {
  if (!_bisActiveSlot || !_bisListEditor) return;
  var slotName = _bisActiveSlot;
  var player = findRosterPlayerByNameRealm(_bisListEditor.nameRealm);
  if (!player || !player.id) return;
  var nameRealm = _bisListEditor.nameRealm;
  _bisActiveSlot = null;
  _bisActiveSlotQuery = '';
  var msgEl = document.getElementById('bisListSaveMsg');
  if (msgEl) msgEl.textContent = 'Adding...';
  resolveItemId(itemName)
    .then(function (itemId) {
      return supabaseClient
        .from('bis_items')
        .insert({ player_id: player.id, item_id: itemId, slot: slotName })
        .then(function (result) {
          if (result.error) throw new Error(result.error.message);
          return writeAuditLog('BiS Item Added', 'players', player.id, bisItemAuditDetail(itemName, slotName)).then(
            function () {
              return itemId;
            }
          );
        });
    })
    .then(function (itemId) {
      var key = bisListKeyFor(nameRealm);
      if (!DATA.bisList) DATA.bisList = {};
      if (!DATA.bisList[key]) DATA.bisList[key] = [];
      DATA.bisList[key].push({
        item: itemName,
        slot: slotName,
        dbSlot: slotName,
        obtained: false,
        playerId: player.id,
        itemId: itemId
      });
      buildBisListsTab();
    })
    .catch(function (err) {
      var msg = document.getElementById('bisListSaveMsg');
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}
