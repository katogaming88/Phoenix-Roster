// ── Import sub-tab (Supabase, #219) ─────────────────────────────────────────
//
// submitLootImport() carries every field import_rclc_loot() (migration
// 20260709180000) needs straight through from the RCLC paste -- date/time,
// itemID, boss, instance -- instead of the old GAS path's minimal
// id/player/date/itemName/instance subset. The RPC does its own date
// parsing (accepts RCLC's "YYYY/MM/DD" as-is) and player/item resolution
// server-side, so there's no client-side reshaping needed beyond picking the
// fields off each entry. One RPC call per paste, not chunked -- a raid
// night's export is at most a couple hundred entries, well within a normal
// request body, and the old GAS chunking was worked around Apps Script's own
// URL-length limits (JSONP GET), which don't apply to a POST through
// supabase-js.

function buildLootImportForm() {
  var el = document.getElementById('loot-sub-import');
  if (!el) return;

  // #607: loot import is excluded for a guild-officer-only visitor (the
  // RCLC dedupe key is per-team and a mixed-team paste can't be caught by
  // it, so this stays blocked even for otherwise-full-access surfaces).
  if (window._guildOfficerAccessLevel === 'guild') {
    el.innerHTML =
      '<p class="signup-officer-note">Loot import is not available for guild officer access on a team you are not an officer of.</p>';
    return;
  }

  var seasonName = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';

  var html = '<div class="signup-officer-panel">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Import from RCLootCouncil<button class="help-btn" onclick="toggleHelp(\'help-loot-import\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-import" class="help-tip">';
  html += '<strong>How to import:</strong>';
  html += '<ul>';
  html +=
    '<li>In-game: open <strong>RCLootCouncil</strong>, click <strong>Export</strong>, choose <strong>JSON</strong>, and copy the output.</li>';
  html +=
    '<li>Paste it into the box below. You can paste multiple nights at once -- duplicates are skipped automatically.</li>';
  html +=
    '<li>Make sure <strong>Season Name</strong> is set correctly in Season Settings before importing so entries are tagged with the right season label.</li>';
  html += '</ul>';
  html +=
    '<strong>Season reset:</strong> update Season Name in Season Settings before re-importing so new entries are tagged with the new season -- past seasons stay in the loot feed under their own label, filterable there.';
  html += '</div>';
  if (seasonName) {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;">Active season: <strong>' +
      seasonName +
      '</strong>. All imported entries will be tagged with this label. To change it, go to <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a>.</p>';
  } else {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;color:var(--melee);">No season name configured. Set one in <a href="#" onclick="switchTab(\'season\');return false;">Season Settings</a> before importing so loot entries are properly labeled.</p>';
  }
  html += '<p class="signup-officer-note" style="margin-top:0.5rem;">In-game: RCLootCouncil &gt; Export &gt; JSON. ';
  html += "Paste one night's export (or multiple nights) below. Duplicate entries are skipped automatically.</p>";
  html += '<div style="margin-top:0.75rem;">';
  html +=
    '<textarea id="lootImportPaste" class="prio-export-textarea" placeholder="Paste RCLC JSON here..." style="height:160px;resize:vertical;"></textarea>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.75rem;flex-wrap:wrap;">';
  html += '<button class="btn btn-gold" onclick="submitLootImport()">Import</button>';
  html += '<span id="lootImportStatus" style="font-size:1.04rem;"></span>';
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}

function submitLootImport() {
  var pasteEl = document.getElementById('lootImportPaste');
  var paste = pasteEl ? pasteEl.value.trim() : '';

  if (!paste) {
    setLootImportStatus('Paste the RCLC JSON export first.', 'var(--melee)');
    return;
  }

  var entries;
  try {
    entries = JSON.parse(paste);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array.');
  } catch (err) {
    setLootImportStatus('Invalid JSON: ' + err.message, 'var(--melee)');
    return;
  }

  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var id = String(e.id || '').trim();
    var player = String(e.player || '').trim();
    var instance = String(e.instance || '').trim();
    if (!id || !player || !instance) continue;
    rows.push({
      id: id,
      player: player,
      date: String(e.date || '').trim(),
      time: String(e.time || '').trim(),
      itemID: e.itemID != null ? e.itemID : null,
      itemName: String(e.itemName || '').trim(),
      instance: instance,
      boss: String(e.boss || '').trim()
    });
  }

  if (rows.length === 0) {
    setLootImportStatus(
      'No valid entries found -- check that the JSON has id, player, and instance fields.',
      'var(--melee)'
    );
    return;
  }

  // rclc_loot.season stores the compact code ('MID1'), same convention as
  // priority_order.season/scoring.season (see js/common.js's
  // seasonCodeForDisplay block comment) -- this used to write the raw
  // display name straight through, which is why season_loot_pace's season
  // dropdown showed "Midnight Season 1" twice (once as the correctly-coded
  // "MID1" translated back for display, once as the raw un-translated
  // string sitting in the same column).
  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';

  setLootImportStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  supabaseClient
    .rpc('import_rclc_loot', { p_team_id: _teamCfg.supabaseTeamId, p_season: season, p_rows: rows })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var counts = result.data || {};
      var inserted = counts.inserted || 0;
      var skipped = counts.skipped_duplicate || 0;
      var unresolved = counts.unresolved_item || 0;
      var msg = 'Done. ' + inserted + ' new entries added';
      if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
      if (unresolved > 0) msg += ', ' + unresolved + ' with an unresolved item (check Item Lookup)';
      msg += '.';
      setLootImportStatus(msg, 'var(--heal)');
      // Newly imported loot can make a saved Mythic #1 stale (player already
      // has the Heroic version) -- refresh that check now so the Priority
      // nav badge reflects it immediately, since an officer may not visit
      // the Priority tab this session otherwise.
      if (typeof refreshPriorityStaleBadge === 'function') refreshPriorityStaleBadge();
    })
    .catch(function (err) {
      setLootImportStatus('Import failed: ' + err.message, 'var(--melee)');
    });
}

function setLootImportStatus(text, color) {
  var el = document.getElementById('lootImportStatus');
  if (!el) return;
  el.style.color = color || 'var(--text-muted)';
  el.textContent = text;
}

// ── Import History sub-tab (Supabase, #219) ─────────────────────────────────
//
// Sourced from audit_log rather than rclc_loot directly: every successful
// import already logs one 'Loot Imported (RCLC)' entry per row (player as
// TARGET, "track - item name" as DETAIL), and -- critically -- only genuine
// paste-imports ever produce that action. rclc_loot itself can't tell a
// paste-imported row apart from the separate legacy-tracker rows the #320
// historical import already merged in, so querying it directly here would
// misrepresent old history as recent imports. No "Clear All" in this
// version for the same reason: there's no safe way yet to select only
// paste-imported rows for deletion (see docs/database-decisions.md).
function buildLootHistoryTab() {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;
  el.innerHTML = '<p style="font-size:1.04rem;color:var(--text-muted);padding:0.5rem 0;">Loading...</p>';
  if (!supabaseClient) {
    el.innerHTML = '<p style="font-size:1.04rem;color:var(--melee);padding:0.5rem 0;">Not connected to Supabase.</p>';
    return;
  }

  var teamId = _teamCfg.supabaseTeamId;
  supabaseClient
    .from('audit_log')
    .select('target_type, target_id, detail, created_at')
    .eq('team_id', teamId)
    .eq('action', 'Loot Imported (RCLC)')
    .order('created_at', { ascending: false })
    .limit(100)
    .then(function (result) {
      if (result.error) {
        el.innerHTML =
          '<p style="font-size:1.04rem;color:var(--melee);padding:0.5rem 0;">' + escHtml(result.error.message) + '</p>';
        return;
      }
      var rows = result.data || [];
      return resolveAuditTargetNames(rows, teamId).then(function (targetNames) {
        renderLootHistoryPanel(rows, targetNames);
      });
    });
}

function renderLootHistoryPanel(rows, targetNames) {
  var el = document.getElementById('loot-sub-history');
  if (!el) return;

  var html = '<div class="signup-officer-panel">';
  html +=
    '<div class="signup-status-row"><span class="signup-status-label">Recent RCLC Imports<button class="help-btn" onclick="toggleHelp(\'help-loot-history\')" title="Show help">?</button></span></div>';
  html += '<div id="help-loot-history" class="help-tip" style="margin-bottom:0.5rem;">';
  html +=
    'Shows the most recent loot entries imported via the Import tab (up to the last 100), so any officer can confirm a paste went through. Sourced from the audit log -- every successful import logs one entry per item.';
  html += '</div>';

  if (!rows.length) {
    html +=
      '<p class="signup-officer-note" style="margin-top:0.35rem;">No loot imported yet. Go to the <a href="#" onclick="switchLootSubTab(\'import\', document.getElementById(\'loot-subtab-btn-import\'));return false;">Import</a> tab to add entries.</p>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  html +=
    '<div style="font-size:1rem;color:var(--text-muted);margin:0.5rem 0;">' +
    rows.length +
    ' recent import' +
    (rows.length !== 1 ? 's' : '') +
    '</div>';
  html +=
    '<div style="overflow-x:auto;"><table class="roster-table" style="width:100%;"><thead><tr><th>Time</th><th>Player</th><th>Item</th></tr></thead><tbody>';
  rows.forEach(function (row) {
    var player = row.target_type === 'players' && row.target_id != null ? targetNames[row.target_id] || '' : '';
    html +=
      '<tr><td style="white-space:nowrap;">' +
      escHtml(auditFormatTs(row.created_at)) +
      '</td><td>' +
      escHtml(player) +
      '</td><td>' +
      escHtml(typeof row.detail === 'string' ? row.detail : '') +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '</div>';

  el.innerHTML = html;
}

// Legacy alias — called by old code paths that still reference buildLootImportTab
function buildLootImportTab() {
  buildLootImportForm();
}
