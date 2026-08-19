// Canonical Wowhead/in-game slot names (items.slot), matching getSlotColor()'s
// armor list in common.js -- this went stale after the slot vocabulary
// normalization migration (item_catalog_slot_normalization) updated
// items.slot/getSlotColor/BIS_CATALOG_SLOT_TO_ROWS to the new singular names
// but missed this array, so every armor item fell through getItemGroup() to
// "Other" instead of its real slot section.
var ARMOR_SLOT_ORDER = ['HEAD', 'SHOULDER', 'CHEST', 'HANDS', 'LEGS', 'BACK', 'WRIST', 'WAIST', 'FEET'];

// _utf8ToBase64() moved to js/common.js (#408) so index.html's Quick Actions
// export button can share it too.
//
// The payload itself comes from supabaseClient.rpc('build_rclc_export', ...)
// (see supabase/migrations/*_rclc_export.sql and the SYNC REMINDER in
// *_item_catalog_slot_normalization.sql) -- its shape is hardcoded on the
// decoding side by a separate repo, RCLootCouncil_PriorityLoot. Any change to
// what that RPC returns needs a matching check against that addon.
function fetchExportString() {
  var btn = document.getElementById('prioExportLoadBtn');
  var body = document.getElementById('prioExportBody');
  var area = document.getElementById('prioExportStr');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }

  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';

  supabaseClient
    .rpc('build_rclc_export', { p_team_id: _teamCfg.supabaseTeamId, p_season: season })
    .then(function (result) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Regenerate';
      }
      var str = !result.error && result.data ? _utf8ToBase64(JSON.stringify(result.data)) : '';
      area.value = str;
      area.placeholder = result.error ? result.error.message : '';
      body.style.display = '';
    });
}

function copyExportString() {
  var area = document.getElementById('prioExportStr');
  var msg = document.getElementById('prioExportCopyMsg');
  if (!area || !area.value) return;
  navigator.clipboard.writeText(area.value).then(function () {
    if (msg) {
      msg.style.display = '';
      setTimeout(function () {
        msg.style.display = 'none';
      }, 2000);
    }
  });
}

function _hasAnyPriority(entry) {
  if (!entry) return false;
  return 'heroic' in entry || 'mythic' in entry;
}

function _isFullyManaged(entry) {
  if (!entry) return false;
  return 'heroic' in entry && 'mythic' in entry;
}

// Season-scoped (isItemInSeasonScope(), #549) so every consumer -- the
// Unmanaged Items list itself and updatePriorityBadges()'s nav/tab counts --
// agrees on the same set, rather than each applying (or forgetting to apply)
// its own filter afterward.
//
// Excludes DATA.tierResolvedItemNames (#650/#651) -- priority is generated
// and matched against the token's own item_id (what rclc_loot actually
// logs), never the resolved class piece, so a resolved item showing up here
// alongside its token would just be duplicate, unmanageable information --
// mirrors js/wishlist.js's wishlistBucketRealItems and tab-bis.js's
// bisSlotOnInput skipping the same set for the same reason.
function getUnmanagedItems() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var itemPlaceholders = DATA.itemPlaceholders || {};
  var tierResolvedItemNames = DATA.tierResolvedItemNames || {};
  var seen = {};
  var result = [];
  Object.keys(prioOrder).forEach(function (item) {
    if (itemPlaceholders[item]) return;
    if (tierResolvedItemNames[item]) return;
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!isItemInSeasonScope(item)) return;
    if (!_isFullyManaged(prioOrder[item])) {
      seen[item] = true;
      result.push(item);
    }
  });
  Object.keys(itemSlots).forEach(function (item) {
    if (seen[item]) return;
    if (itemPlaceholders[item]) return;
    if (tierResolvedItemNames[item]) return;
    if ((itemSlots[item] || '').toLowerCase() === 'slot') return;
    if (!isItemInSeasonScope(item)) return;
    if (!_isFullyManaged(prioOrder[item])) result.push(item);
  });
  return result.sort(function (a, b) {
    return a.localeCompare(b);
  });
}

// Rebuilds both boss-filter dropdowns, scoped by isItemInSeasonScope() (#549:
// DATA.seasonView/raid_zones, not a per-tab checkbox anymore -- the "Show all
// seasons" checkboxes this used to honor independently per tab were retired).
// Re-run on data load, since the dropdown otherwise never picks up
// newly-in-scope bosses (e.g. a new season's) after raid_zones changes.
function populateBossFilters() {
  var itemBosses = DATA.itemBosses || {};

  // Kill order, not alphabetical -- DATA.raidProgression (Season Settings'
  // drag-reorderable boss list, team_settings.config.raidProgression) is the
  // one place that order is tracked. Flattened across every raid tier in
  // DATA.raidProgression's own order, so an older tier's bosses still sort
  // before the current one's. Anything not found there (name mismatch, or
  // raidProgression not set up yet) falls back to the end, alphabetically.
  var killOrder = {};
  var rank = 0;
  (DATA.raidProgression || []).forEach(function (raid) {
    (raid.bosses || []).forEach(function (b) {
      if (b && b.name && !(b.name in killOrder)) killOrder[b.name] = rank++;
    });
  });

  function bossOptionsHtml() {
    var bosses = [];
    var seen = {};
    Object.keys(itemBosses).forEach(function (item) {
      if (!isItemInSeasonScope(item)) return;
      var b = itemBosses[item];
      if (b && !seen[b]) {
        seen[b] = true;
        bosses.push(b);
      }
    });
    bosses.sort(function (a, b) {
      var ra = killOrder[a],
        rb = killOrder[b];
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.localeCompare(b);
    });
    return (
      '<option value="">All Bosses</option>' +
      bosses
        .map(function (b) {
          return '<option value="' + b.replace(/"/g, '&quot;') + '">' + b + '</option>';
        })
        .join('')
    );
  }

  function refresh(selectId) {
    var el = document.getElementById(selectId);
    if (!el) return;
    var prevValue = el.value;
    el.innerHTML = bossOptionsHtml();
    if (
      el.options &&
      [].some.call(el.options, function (o) {
        return o.value === prevValue;
      })
    ) {
      el.value = prevValue;
    }
  }

  refresh('prioBossFilter');
  refresh('unmanagedBossFilter');
}

// Groups DATA.priorityLiveFirstPrios (item_name/boss already joined) by
// player -- shared groundwork for getPriorityListConflicts() (the
// stale/same-boss/drift "needs attention" banner) and
// getPriorityFirstPrioSummary() (the full roster-wide #1 count table), both
// derived from the same rows just presented differently.
function _priorityFirstPriosByPlayer() {
  var byPlayer = {};
  (DATA.priorityLiveFirstPrios || []).forEach(function (r) {
    var entry = byPlayer[r.player_id] || { nameRealm: r.name_realm, items: [] };
    entry.items.push({ itemName: r.item_name, track: r.track, boss: r.boss });
    byPlayer[r.player_id] = entry;
  });
  return byPlayer;
}

// One player's #1s grouped by boss+track -- only returns groups with 2+
// items, i.e. an actual same-kill scheduling conflict (two guaranteed items
// both locked behind one boss pull), not just "holds several #1s overall"
// (that's expected and unavoidable once a raid has 30+ managed items -- see
// getPriorityFirstPrioSummary()'s own comment for why that stopped being
// flagged as a conflict here).
function _priorityFirstPrioSameBossGroups(entry) {
  var byBossTrack = {};
  entry.items.forEach(function (it) {
    if (!it.boss) return;
    var key = it.boss + '|' + it.track;
    (byBossTrack[key] = byBossTrack[key] || { boss: it.boss, itemNames: [] }).itemNames.push(it.itemName);
  });
  var groups = [];
  Object.keys(byBossTrack).forEach(function (key) {
    var group = byBossTrack[key];
    if (group.itemNames.length > 1) groups.push(group);
  });
  return groups;
}

// Genuine health issues on the Priority List -- stale-after-heroic #1s,
// same-boss #1 stacking (a real scheduling conflict: two items both locked
// behind one kill), and top-3 drift since the last save. Was silently
// folded into the nav badge with nowhere of its own to live, so a mismatch
// between the nav total and the Unmanaged Items count looked like a bug
// rather than "there's 1 conflict on the Priority List" -- and even the
// sub-tab badge was just a bare count, with no way to see which item(s) it
// referred to.
//
// Used to also flag every player holding 2+ #1s team-wide here, but once a
// raid has 30+ items under management that's nearly the entire roster --
// not a "conflict" worth an attention banner, just an expected fact about a
// deep priority list. That's now getPriorityFirstPrioSummary()'s full-roster
// table instead, always visible rather than only surfacing outliers.
function getPriorityListConflicts() {
  var staleEntries = DATA.priorityStaleAfterHeroic || [];
  var driftEntries = DATA.priorityDrift || [];
  var byPlayer = _priorityFirstPriosByPlayer();

  var sameBossGroups = [];
  Object.keys(byPlayer).forEach(function (playerId) {
    var entry = byPlayer[playerId];
    _priorityFirstPrioSameBossGroups(entry).forEach(function (group) {
      sameBossGroups.push({ nameRealm: entry.nameRealm, boss: group.boss, itemNames: group.itemNames });
    });
  });

  return {
    count: staleEntries.length + sameBossGroups.length + driftEntries.length,
    staleEntries: staleEntries,
    sameBossGroups: sameBossGroups,
    driftEntries: driftEntries
  };
}

function buildPriorityConflictsBannerHtml(conflicts) {
  if (!conflicts.count) return '';
  var html = '<div class="prio-overalloc-banner">';
  html += '<div class="prio-overalloc-title">Priority List Conflicts (' + conflicts.count + ')</div>';
  html += '<div class="prio-overalloc-list">';

  conflicts.staleEntries.forEach(function (e) {
    html +=
      '<div class="prio-overalloc-player"><span class="prio-overalloc-name">' +
      escHtml(e.name_realm) +
      '</span><span class="prio-overalloc-item">' +
      escHtml(e.item_name) +
      ' <span class="prio-overalloc-diff">may be stale -- already has Heroic</span></span></div>';
  });
  conflicts.sameBossGroups.forEach(function (g) {
    html +=
      '<div class="prio-overalloc-player"><span class="prio-overalloc-name">' +
      escHtml(g.nameRealm) +
      '</span><span class="prio-overalloc-item">' +
      escHtml(g.itemNames.join(', ')) +
      ' <span class="prio-overalloc-diff">same boss (' +
      escHtml(g.boss) +
      ')</span></span></div>';
  });
  (conflicts.driftEntries || []).forEach(function (d) {
    html +=
      '<div class="prio-overalloc-player"><span class="prio-overalloc-name">' +
      escHtml(d.item_name) +
      ' (' +
      escHtml(d.track === 'Myth' ? 'Mythic' : 'Heroic') +
      ')</span><span class="prio-overalloc-item">' +
      ' <span class="prio-overalloc-diff">saved: ' +
      escHtml((d.saved_top3 || []).join(', ') || 'none') +
      ' -- now: ' +
      escHtml((d.current_top3 || []).join(', ') || 'none') +
      '</span></span></div>';
  });

  html += '</div></div>';
  return html;
}

// Below this many #1s, holding several isn't unusual enough to flag --
// nearly the whole roster clears 2-3 once a raid has 30+ managed items (see
// getPriorityFirstPrioSummary()'s own comment). Used only to visually flag
// rows in that table; it doesn't filter anyone out of it or add to the
// Priority List Conflicts banner/badge counts above.
var PRIORITY_FIRSTPRIO_FLAG_THRESHOLD = 4;

// Full-roster table (Priority List sub-tab): every player currently holding
// 1+ #1 priority, with their total count and whether any of those #1s share
// a boss -- always visible, not just outliers, since "holds 2+ #1s" alone
// stopped being a meaningful signal once the raid has 30+ managed items
// (nearly the whole roster clears that bar). Sorted by count descending so
// the officer can eyeball who's carrying the most guaranteed first-dibs.
function getPriorityFirstPrioSummary() {
  var byPlayer = _priorityFirstPriosByPlayer();
  var rows = Object.keys(byPlayer).map(function (playerId) {
    var entry = byPlayer[playerId];
    return {
      nameRealm: entry.nameRealm,
      count: entry.items.length,
      sameBossGroups: _priorityFirstPrioSameBossGroups(entry)
    };
  });
  rows.sort(function (a, b) {
    return b.count - a.count || a.nameRealm.localeCompare(b.nameRealm);
  });
  return rows;
}

function buildPriorityFirstPrioSummaryHtml(rows) {
  if (!rows.length) return '';
  var html = '<div class="prio-firstprio-summary">';
  html +=
    '<div class="prio-firstprio-title">#1 Priorities Held (' +
    rows.length +
    ' player' +
    (rows.length !== 1 ? 's' : '') +
    ')</div>';
  html += '<div class="prio-firstprio-list">';
  rows.forEach(function (r) {
    var sameBossHTML = r.sameBossGroups.length
      ? '<span class="prio-firstprio-sameboss" title="' +
        escHtml(
          r.sameBossGroups
            .map(function (g) {
              return g.boss + ': ' + g.itemNames.join(', ');
            })
            .join(' | ')
        ) +
        '">Same boss: ' +
        escHtml(
          r.sameBossGroups
            .map(function (g) {
              return g.boss;
            })
            .join(', ')
        ) +
        '</span>'
      : '';
    var overThreshold = r.count >= PRIORITY_FIRSTPRIO_FLAG_THRESHOLD;
    html +=
      '<div class="prio-firstprio-row">' +
      '<span class="prio-firstprio-name">' +
      escHtml(r.nameRealm) +
      '</span>' +
      '<span class="prio-firstprio-count' +
      (overThreshold ? ' prio-firstprio-count-flagged' : '') +
      '">' +
      r.count +
      ' #1' +
      (r.count !== 1 ? 's' : '') +
      '</span>' +
      sameBossHTML +
      '</div>';
  });
  html += '</div></div>';
  return html;
}

// Re-fetches the top-3 saved-vs-current drift check and refreshes the nav +
// sub-tab badges -- called on demand (the "Check for Drift" button) and
// automatically right after a scoring commit (tab-scoring.js
// executeCommitPerformance()), same cross-tab refresh shape as
// refreshPriorityStaleBadge() below.
function refreshPriorityDriftBadge() {
  var teamId = _teamCfg && _teamCfg.supabaseTeamId;
  if (!teamId) return Promise.resolve();
  var season = resolveSeasonViewCode();
  return fetchSupabasePriorityDrift(teamId, season).then(function (rows) {
    DATA.priorityDrift = rows || [];
    updatePriorityBadges();
  });
}

function checkPriorityDrift() {
  var btn = document.getElementById('checkPriorityDriftBtn');
  var status = document.getElementById('checkPriorityDriftStatus');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = 'Checking...';
    status.style.color = 'var(--text-muted)';
  }
  refreshPriorityDriftBadge().then(function () {
    if (btn) btn.disabled = false;
    if (!status) return;
    var count = (DATA.priorityDrift || []).length;
    status.textContent = count ? count + ' item(s) drifted from their saved order.' : 'No drift from saved orders.';
    status.style.color = count ? 'var(--gold)' : 'var(--heal)';
  });
}

// #651: refreshes players.tier_pieces_equipped for the whole roster from
// Raider.IO, right before an officer would generate priority for a
// tier-token drop -- that count is what generate_priority_order() now
// weights tier-token candidates by (see the tier_pieces_priority_weighting
// migration). Sequential with a small delay between requests, polite to
// Raider.IO's public API across a full roster -- no existing bulk-roster
// loop pattern to mirror anywhere in js/tabs/, modeled instead on
// js/common.js's runRaiderIoTierSync (single-player) disable/restore-button
// idiom. A player with no Raider.IO data (never scanned, stale name_realm)
// is skipped and tallied rather than overwriting their last-known count with
// a false 0.
function syncRosterTierCounts() {
  var btn = document.getElementById('syncRosterTierBtn');
  var status = document.getElementById('syncRosterTierStatus');
  var roster = (DATA.roster || []).filter(function (p) {
    return p.firstName && p.realm;
  });
  if (!roster.length) return;
  if (btn) btn.disabled = true;

  var synced = 0;
  var skipped = 0;
  var i = 0;

  function next() {
    if (i >= roster.length) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync Roster Tier Counts';
      }
      if (status) {
        status.textContent =
          synced + ' synced' + (skipped ? ', ' + skipped + ' skipped (no Raider.IO data)' : '') + '.';
        status.style.color = skipped ? 'var(--gold)' : 'var(--heal)';
      }
      buildPriorityTab();
      return;
    }
    var player = roster[i];
    i++;
    if (btn) btn.textContent = 'Syncing ' + i + '/' + roster.length + '...';

    fetchRaiderIoGear(player.firstName, player.realm)
      .then(function (gearItems) {
        return writeTierPiecesEquipped(player, countEquippedTierPieces(player, gearItems));
      })
      .then(
        function () {
          synced++;
        },
        function () {
          skipped++;
        }
      )
      .then(function () {
        setTimeout(next, 200);
      });
  }

  if (status) status.textContent = '';
  next();
}

// Own copy of js/wishlist.js's WISHLIST_TIER_COLORS -- officer.html doesn't
// load wishlist.js, same bundle-boundary reason as WISHLIST_LABEL_DEFAULTS
// in tab-admin.js (whose dotColor values these .css fields match).
var PRIO_NOTES_TIER_COLORS = {
  bis: { css: 'var(--gold)', rgb: '214,163,68' },
  good: { css: 'var(--heal)', rgb: '61,220,132' },
  ok: { css: 'var(--tank)', rgb: '74,158,255' },
  catalyst: { css: 'var(--ranged)', rgb: '191,140,255' },
  pass: { css: 'var(--melee)', rgb: '255,124,92' }
};

// Notes sub-tab (#607 follow-up): raiders can explain a status choice via
// item_preferences.note (e.g. a pure-DPS spec-swapper tagging a slot's
// off-spec item "Good" with "BiS for Destro"), but that note only ever
// rendered back on the raider's own wishlist editor -- officers had no way
// to see it. This is read-only and deliberately doesn't feed
// generate_priority_order()'s weighting (20260720165552_priority_wishlist_ranking.sql
// already scores 'good' uniformly at 0.90x for everyone); surfacing the
// reasoning here is meant to inform officer discretion on sequencing calls,
// not to auto-rank one player's "good" above another's.
// Uses WISHLIST_LABEL_DEFAULTS (tab-admin.js) for status labels/overrides --
// officer.html doesn't load js/wishlist.js, same reasoning as the
// BIS_SLOTS/WISHLIST_SLOTS duplication elsewhere in this file.
function buildPriorityNotesTab() {
  var el = document.getElementById('priorityNotesContent');
  if (!el) return;
  if (_teamItemPreferences === null && !_teamItemPreferencesFailed) {
    el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Loading...</p>';
    fetchTeamItemPreferences().then(function (rows) {
      _setTeamItemPreferences(rows);
      buildPriorityNotesTab();
    });
    return;
  }
  if (_teamItemPreferencesUnavailable()) {
    el.innerHTML = TEAM_PREFS_UNAVAILABLE_HTML;
    return;
  }

  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var itemSlots = DATA.itemSlots || {};
  var rosterById = {};
  (DATA.roster || []).forEach(function (p) {
    rosterById[p.id] = p;
  });
  var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};
  var statusLabels = {};
  (typeof WISHLIST_LABEL_DEFAULTS !== 'undefined' ? WISHLIST_LABEL_DEFAULTS : []).forEach(function (t) {
    statusLabels[t.value] = labelOverrides[t.value] || t.label;
  });

  var searchTerm = normalise((document.getElementById('prioNotesSearch') || {}).value || '');

  // Placeholders (M+/Crafted/Catalyst) aren't a real catalog item to group
  // notes under -- excluded by their own identity (DATA.itemPlaceholders),
  // not by p.slot truthiness. p.slot alone used to be a reliable
  // placeholder signal (only Other Sources rows carried one), but Finger
  // 1/2, Trinket 1/2, Weapon, and Off Hand items now write an explicit
  // disambiguating slot too (#623/#673) -- the old `if (p.slot) return`
  // silently dropped every note on a real item tagged in one of those rows.
  var itemPlaceholders = DATA.itemPlaceholders || {};
  var byItem = {};
  // Finger 1/2 and Trinket 1/2 rows for the same item are two separate
  // item_preferences rows (one per numbered slot) that read as one raider
  // opinion -- wishlistCompleteness() already treats a status set on either
  // side as covering both (#623/#673 sibling fallback), so a raider who
  // typed the same note into both cards showed up here twice for the exact
  // same text. Dedupe per (player, note) within an item; a genuinely
  // different note per slot (Weapon vs Off Hand, or an intentionally
  // different Finger 1/2 note) still shows separately.
  var seenPlayerNote = {};
  _teamItemPreferences.forEach(function (p) {
    if (!p.note || !p.note.trim()) return;
    var name = idToName[p.item_id];
    if (!name) return;
    if (itemPlaceholders[name]) return;
    if (searchTerm && normalise(name).indexOf(searchTerm) === -1) return;
    var dedupeKey = name + '|' + p.player_id + '|' + p.note.trim();
    if (seenPlayerNote[dedupeKey]) return;
    seenPlayerNote[dedupeKey] = true;
    (byItem[name] = byItem[name] || []).push(p);
  });

  var itemNames = Object.keys(byItem).sort(function (a, b) {
    return a.localeCompare(b);
  });

  if (!itemNames.length) {
    el.innerHTML = '<p style="color:var(--text);padding:1rem;">No wishlist notes yet.</p>';
    return;
  }

  var html = '';
  itemNames.forEach(function (name) {
    var slot = itemSlots[name] || '';
    html +=
      '<div style="border:1px solid var(--border);border-radius:4px;margin-bottom:0.5rem;padding:0.6rem 0.75rem;">';
    html += itemNameBlockHtml(name, slot);
    html += '<div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:2px;">';
    byItem[name].forEach(function (p) {
      var player = rosterById[p.player_id];
      var display = player ? player.nick || player.firstName : 'Player #' + p.player_id;
      var color = PRIO_NOTES_TIER_COLORS[p.status];
      var rowBackground = color ? 'rgba(' + color.rgb + ',0.08)' : 'var(--bg-card)';
      var rowBorder = color ? color.css : 'var(--border)';
      html +=
        '<div style="padding:0.4rem 0.6rem;border-radius:4px;border:1px solid ' +
        rowBorder +
        ';background:' +
        rowBackground +
        ';">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">' +
        '<span style="display:flex;align-items:center;gap:0.5rem;">' +
        '<span style="color:var(--text);font-weight:600;">' +
        escHtml(display) +
        '</span>' +
        (player && player.class
          ? '<span class="badge badge-class" style="' +
            classBadgeStyle(player.class) +
            ';">' +
            escHtml(player.spec || player.class) +
            '</span>'
          : '') +
        '</span>' +
        '<span style="font-size:0.85rem;font-weight:600;color:' +
        rowBorder +
        ';text-transform:uppercase;letter-spacing:0.04em;">' +
        escHtml(statusLabels[p.status] || p.status) +
        '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;width:100%;margin-top:0.25rem;">' +
        '<div class="self-received-source" style="flex:1;box-sizing:border-box;font-size:0.92rem;">' +
        escHtml(p.note) +
        '</div>' +
        '<button type="button" class="btn btn-muted" style="font-size:0.85rem;padding:1px 8px;flex-shrink:0;" ' +
        'onclick="clearWishlistNote(' +
        p.id +
        ',' +
        p.player_id +
        ",'" +
        display.replace(/'/g, "\\'") +
        "','" +
        name.replace(/'/g, "\\'") +
        '\')">Clear Note</button>' +
        '</div>' +
        '</div>';
    });
    html += '</div></div>';
  });

  el.innerHTML = html;
}

// Officers clear a raider's redundant/noisy note without touching their
// status tag -- item_preferences' "Officers clear item_preferences note"
// policy (20260810160841_item_preferences_officer_clear_note.sql) plus its
// restrict trigger only allow this exact write (note set to NULL, nothing
// else), so there's nothing else this can be misused for even if the
// row id were guessed. Patches _teamItemPreferences locally rather than
// refetching, same "own write, then update local state" shape as
// clearMyWishlist() (js/wishlist.js).
function clearWishlistNote(prefId, playerId, displayName, itemName) {
  if (!supabaseClient) return;
  if (!confirm('Clear ' + displayName + "'s note on " + itemName + '?')) return;

  supabaseClient
    .from('item_preferences')
    .update({ note: null })
    .eq('id', prefId)
    .then(function (result) {
      if (result.error) {
        alert('Failed to clear note: ' + result.error.message);
        return;
      }
      var pref = (_teamItemPreferences || []).find(function (p) {
        return p.id === prefId;
      });
      if (pref) pref.note = null;
      writeAuditLog('Wishlist Note Cleared', 'players', playerId, displayName + ' -- ' + itemName);
      buildPriorityNotesTab();
      updatePriorityNotesBadge();
    });
}

// Re-renders whichever Priority sub-tab is currently visible, plus its boss
// filters and nav badges. Two call sites, both because DATA.priorityOrder
// can change out from under an already-rendered panel with nothing to
// rebuild it: (1) js/officer.js's loadData() heavy-data callback -- the
// boot sequence's onCoreReady pass can switchTab('priority') via a ?tab=
// deep link and build the panel before heavy data (DATA.priorityOrder) has
// landed, leaving it stuck on "No priority data found"; (2) tab-season.js's
// saveSeasonView(), once it has re-derived DATA.priorityOrder via
// common.js's remapPriorityDataForSeasonView() -- Season View changes both
// what counts as unmanaged/conflicted and which priority_order rows are in
// scope at all.
function refreshVisiblePriorityTab() {
  if (typeof populateBossFilters === 'function') populateBossFilters();
  var subList = document.getElementById('prio-sub-list');
  var subUnmanaged = document.getElementById('prio-sub-unmanaged');
  var subConflicts = document.getElementById('prio-sub-conflicts');
  if (subList && subList.style.display !== 'none') buildPriorityTab();
  if (subUnmanaged && subUnmanaged.style.display !== 'none') buildUnmanagedTab();
  if (subConflicts && subConflicts.style.display !== 'none') buildConflicts();
  updatePriorityBadges();
}

function updatePriorityBadges() {
  var unmanagedCount = getUnmanagedItems().length;
  var conflicts = getPriorityListConflicts();
  var navBadge = document.getElementById('prioNavBadge');
  var subBadge = document.getElementById('prioSubBadge');
  var listBadge = document.getElementById('prioListBadge');
  var conflictsBanner = document.getElementById('priorityConflictsBanner');
  var firstPrioSummary = document.getElementById('priorityFirstPrioSummary');
  if (navBadge) {
    var total = unmanagedCount + conflicts.count;
    navBadge.textContent = total;
    navBadge.style.display = total > 0 ? '' : 'none';
    navBadge.title =
      conflicts.count > 0 ? conflicts.count + ' Priority List conflict(s) -- see the Priority List tab' : '';
  }
  if (subBadge) {
    subBadge.textContent = unmanagedCount;
    subBadge.style.display = unmanagedCount > 0 ? '' : 'none';
  }
  if (listBadge) {
    listBadge.textContent = conflicts.count;
    listBadge.style.display = conflicts.count > 0 ? '' : 'none';
  }
  if (conflictsBanner) conflictsBanner.innerHTML = buildPriorityConflictsBannerHtml(conflicts);
  if (firstPrioSummary) firstPrioSummary.innerHTML = buildPriorityFirstPrioSummaryHtml(getPriorityFirstPrioSummary());
}

// Wishlist completeness (#515): officers need to see which raiders haven't
// finished tagging their wishlist before generating priority order.
// item_preferences isn't part of the main DATA load (that'd add a query to
// every page load for an officer-only feature) -- fetched on demand here,
// same "cache + re-render once loaded" shape as js/wishlist.js's own
// fetchMyItemPreferences(), just for the whole team instead of one player.
var _teamItemPreferences = null;
// Distinct from the null above, which means "not fetched yet" and is what
// triggers the fetch. fetchTeamItemPreferences() answers null for a failed
// read too, and every caller used to store `rows || []`, so one failed
// request became a confident empty wishlist for the rest of the session:
// every raider incomplete, no notes, and no retry, because the null that
// would have re-triggered the fetch was gone. Keeping the cache null and
// recording the failure separately means every existing `=== null` consumer
// (the stat card's "-", the suppressed completion badge, getIncompleteWishlists'
// empty answer) already does the right thing for "we don't know", and this
// flag only stops the render from asking again in a loop.
var _teamItemPreferencesFailed = false;

// Wishlists could not be fetched. Officer-facing, so it says what to do.
var TEAM_PREFS_UNAVAILABLE_HTML =
  '<p style="color:var(--melee);padding:1rem;">Wishlists could not be loaded. Refresh the page to try again.</p>';

// Single place the four lazy-load sites record a fetch result, so the
// null-means-unknown contract cannot drift between them.
function _setTeamItemPreferences(rows) {
  if (rows === null) {
    _teamItemPreferencesFailed = true;
    return;
  }
  _teamItemPreferencesFailed = false;
  _teamItemPreferences = rows;
}

// True once the fetch has settled one way or the other, so a render knows
// whether waiting is still the right thing to do.
function _teamItemPreferencesUnavailable() {
  return _teamItemPreferences === null && _teamItemPreferencesFailed;
}

// PostgREST caps a single request at its project-wide max-rows setting
// (1000 here) -- a table this size (1200+ rows for one team alone) silently
// lost whatever fell past that cap with no error, since nothing here ever
// asked for more than page 1. A raider's wishlist could then read as
// partially or entirely untagged to officers while their own view (a
// per-player query, never near the cap) showed it complete.
//
// Pages through js/common.js's fetchAllPaged (#707), which was the third
// hand-rolled loop here: it advanced by page size rather than by rows
// received, so an exact multiple of the page size cost a request past the
// end, and it raced one 20s budget against the whole read rather than
// against each page. A fixed budget across N sequential round trips becomes
// a truncation mechanism as N grows.
function fetchTeamItemPreferences() {
  if (!supabaseClient) return Promise.resolve(null);
  return fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('item_preferences')
        .select('id, player_id, item_id, status, slot, season, note', afterId === null ? { count: 'exact' } : undefined)
        .eq('team_id', _teamCfg.supabaseTeamId)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'item_preferences query' }
  );
}

// Own copy of js/wishlist.js's wishlistItemRows()/wishlistCompleteness()
// logic -- officer.html doesn't load wishlist.js, but does already load
// tab-bis.js's BIS_SLOTS/BIS_CATALOG_SLOT_TO_ROWS (identical vocabulary to
// WISHLIST_SLOTS/WISHLIST_CATALOG_SLOT_TO_ROWS), reused here instead of a
// third duplicate copy of the slot constants.
function _priorityItemRows(itemId, slot, idToName, itemSlots) {
  if (slot) return [slot];
  var name = idToName[itemId];
  if (!name) return [];
  return BIS_CATALOG_SLOT_TO_ROWS[itemSlots[name] || ''] || [];
}

// Own copy of js/wishlist.js's WISHLIST_DISAMBIGUATE_SLOTS -- the rows where
// item_preferences.slot is written as the row name itself (not null),
// because the same physical item (a ring, a trinket, a one-hander) can show
// up as a candidate on more than one row and needs to say which one it was
// tagged on. Needed here to match a preference row to a specific eligible
// item the same way wishlist.js's wishlistPrefFor() does.
var PRIORITY_WISHLIST_DISAMBIGUATE_SLOTS = {
  'Finger 1': true,
  'Finger 2': true,
  'Trinket 1': true,
  'Trinket 2': true,
  Weapon: true,
  'Off Hand': true
};

// Own copy of js/wishlist.js's WISHLIST_SIBLING_SLOT -- Finger 1/2 and
// Trinket 1/2 only (not Weapon/Off Hand, where a raider can legitimately
// want two *different* one-handers). The same ring/trinket provides
// identical stats regardless of which numbered slot it's tagged under, so a
// status set on one side counts for both.
var PRIORITY_WISHLIST_SIBLING_SLOT = {
  'Finger 1': 'Finger 2',
  'Finger 2': 'Finger 1',
  'Trinket 1': 'Trinket 2',
  'Trinket 2': 'Trinket 1'
};

// officerBuckets (tab-bis.js's bisSlotBuckets().buckets for this player) --
// eligibleBuckets (tab-bis.js's bisEligibleRealItemsBySlot() for this
// player) -- every real catalog item the raider could tag per row. Item-level
// completeness (#515 follow-up): a row is only fully covered once every
// eligible item in it has either a raider-tagged preference, or is the exact
// item the officer's bis_items grid already picked for that row (covers just
// that one item, not the whole row -- mirrors js/wishlist.js's
// wishlistCompleteness()).
function _priorityWishlistMissingRows(prefs, idToName, itemSlots, officerBuckets, eligibleBuckets) {
  var offHandRequired = false;
  var taggedWeaponRow = false;
  prefs.forEach(function (p) {
    if (_priorityItemRows(p.item_id, p.slot || null, idToName, itemSlots).indexOf('Weapon') !== -1) {
      taggedWeaponRow = true;
    }
    // Mirrors js/wishlist.js's wishlistCompleteness() fix: p.slot is now
    // 'Weapon' (not null) for anything tagged since dual-wield fan-out
    // (DUAL_WIELD_CLASSES) added Weapon/Off Hand to WISHLIST_DISAMBIGUATE_SLOTS.
    // Off Hand itself deliberately excluded -- a One-Hand BiS *there* fills
    // Off Hand, it doesn't require it.
    if (p.status === 'bis' && (p.slot === 'Weapon' || !p.slot)) {
      var name = idToName[p.item_id];
      if (name && itemSlots[name] === 'One-Hand') offHandRequired = true;
    }
  });
  if (!taggedWeaponRow && officerBuckets.Weapon && itemSlots[officerBuckets.Weapon.item] === 'One-Hand') {
    offHandRequired = true;
  }
  var requiredRows = BIS_SLOTS.filter(function (row) {
    return row !== 'Off Hand' || offHandRequired;
  });

  // Distinct from item-tagging completeness below: every eligible item
  // having *some* status says nothing about whether any of them is the
  // raider's actual BiS pick for that slot -- a row can hit 100% tagged with
  // everything Good/OK and still fall back to a "(Wishlist)" pick on the BiS
  // List. Mirrors js/wishlist.js's wishlistCompleteness() missingBisRows: a
  // row counts as covered once the raider has tagged one item 'bis' for it,
  // or the officer's bis_items grid already has a pick for it.
  var bisRows = {};
  prefs.forEach(function (p) {
    if (p.status !== 'bis') return;
    _priorityItemRows(p.item_id, p.slot || null, idToName, itemSlots).forEach(function (row) {
      bisRows[row] = true;
    });
  });
  var missingBisRows = requiredRows.filter(function (row) {
    return !bisRows[row] && !officerBuckets[row];
  });

  // Same lookup as _priorityWishlistMissingRows' exact-slot match, with two
  // fallbacks -- mirrors js/wishlist.js's wishlistPrefForRow():
  // 1. A legacy slot=null pref (tagged before Finger/Trinket/Weapon/Off Hand
  //    started writing an explicit disambiguating slot) when that pref's
  //    item still resolves to this row via its own catalog slot.
  // 2. For Finger 1/2 and Trinket 1/2, the sibling row's pref for the same
  //    item_id -- tagging one side always counts for both.
  function taggedForRow(itemId, row) {
    var rowSlot = PRIORITY_WISHLIST_DISAMBIGUATE_SLOTS[row] ? row : null;
    var exact = prefs.some(function (p) {
      return p.item_id === itemId && (p.slot || null) === rowSlot;
    });
    if (exact) return true;
    if (!rowSlot) return false;
    var legacy = prefs.some(function (p) {
      return (
        p.item_id === itemId && !p.slot && _priorityItemRows(itemId, null, idToName, itemSlots).indexOf(row) !== -1
      );
    });
    if (legacy) return true;
    var siblingSlot = PRIORITY_WISHLIST_SIBLING_SLOT[row];
    if (!siblingSlot) return false;
    return prefs.some(function (p) {
      return p.item_id === itemId && p.slot === siblingSlot;
    });
  }

  var missingRows = [];
  var missingCounts = {};
  var taggedCount = 0;
  var totalRequired = 0;
  requiredRows.forEach(function (row) {
    var items = eligibleBuckets[row] || [];
    var missing = 0;
    items.forEach(function (item) {
      totalRequired++;
      var officerCovers = officerBuckets[row] && officerBuckets[row].item === item.rankName;
      if (!officerCovers && !taggedForRow(item.itemId, row)) {
        missing++;
      } else {
        taggedCount++;
      }
    });
    if (missing > 0) {
      missingRows.push(row);
      missingCounts[row] = missing;
    }
  });
  return {
    missingRows: missingRows,
    missingCounts: missingCounts,
    taggedCount: taggedCount,
    totalRequired: totalRequired,
    missingBisRows: missingBisRows
  };
}

// Per-player {tagged, total} item-level Wishlist completion, for a compact
// "N% (tagged/total)" badge on the officer-facing profile card's Wishlist
// section header (mirrors the BiS List section's own received-count badge
// right above it, js/common.js's bisCompletionHTML). Own function rather
// than folding into getIncompleteWishlists() -- that one only runs the full
// roster and only returns raiders who are actually missing something; a
// profile card needs one player's real numbers whether they're complete or
// not. Returns null while item_preferences hasn't loaded yet, or when the
// bis feature is off -- caller should skip rendering the badge rather than
// show a false "0/0".
function wishlistCompletionForPlayer(player) {
  if ((typeof featureEnabled === 'function' && !featureEnabled('bis')) || _teamItemPreferences === null || !player) {
    return null;
  }
  var itemSlots = DATA.itemSlots || {};
  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var prefs = _teamItemPreferences.filter(function (p) {
    return p.player_id === player.id;
  });
  var officerBuckets =
    typeof getBisItems === 'function' && typeof bisSlotBuckets === 'function'
      ? bisSlotBuckets(getBisItems(player.nameRealm)).buckets
      : {};
  var playerArmorType = (typeof CLASS_ARMOR_TYPE !== 'undefined' && CLASS_ARMOR_TYPE[player.class]) || null;
  var playerMainStat = typeof specMainStat === 'function' ? specMainStat(player.class, player.spec) : null;
  var playerRole = (typeof SPEC_ROLE !== 'undefined' && SPEC_ROLE[player.spec]) || null;
  var eligibleBuckets =
    typeof bisEligibleRealItemsBySlot === 'function'
      ? bisEligibleRealItemsBySlot(playerArmorType, playerMainStat, playerRole, player.class || null)
      : {};
  var result = _priorityWishlistMissingRows(prefs, idToName, itemSlots, officerBuckets, eligibleBuckets);
  return { tagged: result.taggedCount, total: result.totalRequired, missingBisRows: result.missingBisRows };
}

// roster override (js/tabs/tab-roster.js's Wishlists Completed stat card):
// defaults to the full DATA.roster, same as every other caller here.
function getIncompleteWishlists(roster) {
  if ((typeof featureEnabled === 'function' && !featureEnabled('bis')) || _teamItemPreferences === null) {
    return { count: 0, raiders: [] };
  }
  var itemSlots = DATA.itemSlots || {};
  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });

  var prefsByPlayer = {};
  _teamItemPreferences.forEach(function (p) {
    (prefsByPlayer[p.player_id] = prefsByPlayer[p.player_id] || []).push(p);
  });

  roster = roster || DATA.roster || [];
  var raiders = [];
  roster.forEach(function (player) {
    var officerBuckets =
      typeof getBisItems === 'function' && typeof bisSlotBuckets === 'function'
        ? bisSlotBuckets(getBisItems(player.nameRealm)).buckets
        : {};
    var playerArmorType = (typeof CLASS_ARMOR_TYPE !== 'undefined' && CLASS_ARMOR_TYPE[player.class]) || null;
    var playerMainStat = typeof specMainStat === 'function' ? specMainStat(player.class, player.spec) : null;
    var playerRole = (typeof SPEC_ROLE !== 'undefined' && SPEC_ROLE[player.spec]) || null;
    var eligibleBuckets =
      typeof bisEligibleRealItemsBySlot === 'function'
        ? bisEligibleRealItemsBySlot(playerArmorType, playerMainStat, playerRole, player.class || null)
        : {};
    var result = _priorityWishlistMissingRows(
      prefsByPlayer[player.id] || [],
      idToName,
      itemSlots,
      officerBuckets,
      eligibleBuckets
    );
    if (result.missingRows.length) {
      raiders.push({
        nameRealm: player.nameRealm,
        missingRows: result.missingRows,
        missingCounts: result.missingCounts
      });
    }
  });
  raiders.sort(function (a, b) {
    return a.nameRealm.localeCompare(b.nameRealm);
  });

  return { count: raiders.length, raiders: raiders };
}

// Compact version for the Priority tab -- just who's incomplete, not the
// full missing-slot breakdown (that's a wall of near-identical text once
// most of the roster hasn't touched their wishlist yet, which swamped the
// Priority List Conflicts banner it sits next to). Points to the BiS Lists
// sub-tab, where each row shows its own missing slots instead.
function buildWishlistIncompleteCompactHtml(data) {
  if (!data.count) return '';
  var names = data.raiders
    .map(function (r) {
      return escHtml(r.nameRealm);
    })
    .join(', ');
  return (
    '<div class="prio-overalloc-banner">' +
    '<div class="prio-overalloc-title">Incomplete Wishlists (' +
    data.count +
    ')</div>' +
    '<div class="prio-overalloc-list"><span class="prio-overalloc-item">' +
    names +
    ' -- see BiS Manager &gt; BiS Lists for details</span></div>' +
    '</div>'
  );
}

// Called once from buildOfficerDashboard() so the banner's ready by the
// time an officer opens the Priority tab, not fetched lazily on tab click.
// Also refreshes the BiS Lists sub-tab's per-row indicators (tab-bis.js's
// buildBisListsTab()) if it's already been rendered, since that fetch is
// the same data source. Kept independent of updatePriorityBadges()'s
// nav-badge math -- that badge's count is specifically Priority List
// conflicts/unmanaged items, and mixing in this unrelated count would make
// it misleading.
function renderWishlistIncompleteBanner() {
  var compactEl = document.getElementById('wishlistIncompleteBanner');
  if (_teamItemPreferences === null && !_teamItemPreferencesFailed) {
    fetchTeamItemPreferences().then(function (rows) {
      _setTeamItemPreferences(rows);
      renderWishlistIncompleteBanner();
      if (typeof buildBisListsTab === 'function' && document.getElementById('bis-lists-container')) {
        buildBisListsTab();
      }
      // Wishlists Completed stat card (js/tabs/tab-roster.js) shows "-" until
      // this fetch resolves -- refresh it now that real data's in.
      if (typeof buildStatsBar === 'function') buildStatsBar();
      // #478 onboarding checklist (js/tabs/tab-roster.js) also waits on this
      // same fetch for its "wishlist not started" signal.
      if (typeof buildOnboardingAlert === 'function') buildOnboardingAlert();
      if (typeof buildRosterTable === 'function') buildRosterTable();
    });
    return;
  }
  if (compactEl) {
    // Not the same as no incomplete wishlists, which renders empty. Saying so
    // here is the only signal an officer gets that the banner is silent
    // because the read failed rather than because everyone is done.
    compactEl.innerHTML = _teamItemPreferencesUnavailable()
      ? TEAM_PREFS_UNAVAILABLE_HTML
      : buildWishlistIncompleteCompactHtml(getIncompleteWishlists());
  }
  updatePriorityNotesBadge();
}

// Gold rather than the red .nav-notif used for unmanaged/conflicts counts --
// this isn't a problem to fix, just a "something's here, go take a look"
// flag so an officer knows to glance at the Notes sub-tab. Deliberately kept
// off the top-level Priority nav badge (updatePriorityBadges()'s total) --
// that badge means "needs attention/action"; a note is just context, not an
// actionable item on its own.
function updatePriorityNotesBadge() {
  var badge = document.getElementById('prioNotesBadge');
  if (!badge) return;
  if (_teamItemPreferences === null) {
    badge.style.display = 'none';
    return;
  }
  // Same placeholder-by-identity fix as buildPriorityNotesTab() above -- a
  // real item's disambiguating slot (Finger 1/2, Trinket 1/2, Weapon, Off
  // Hand) is not a placeholder signal, only DATA.itemPlaceholders is.
  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var itemPlaceholders = DATA.itemPlaceholders || {};
  // Same per-(item, player, note) dedupe as buildPriorityNotesTab() -- a
  // Finger 1/2 or Trinket 1/2 pair with the identical note text is one
  // raider opinion, not two, so the badge count should match what the tab
  // actually shows.
  var seenPlayerNote = {};
  var count = _teamItemPreferences.filter(function (p) {
    if (!p.note || !p.note.trim()) return false;
    var name = idToName[p.item_id];
    if (itemPlaceholders[name]) return false;
    var dedupeKey = name + '|' + p.player_id + '|' + p.note.trim();
    if (seenPlayerNote[dedupeKey]) return false;
    seenPlayerNote[dedupeKey] = true;
    return true;
  }).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? '' : 'none';
}

// Re-fetches the fairness/health checks and refreshes the nav + sub-tab
// badges immediately -- called right after a loot import so officers see the
// flag without needing to revisit the Priority tab or reload the page.
function refreshPriorityStaleBadge() {
  Promise.all([fetchSupabasePriorityStaleAfterHeroic(), fetchSupabasePriorityLiveFirstPrios()]).then(
    function (results) {
      var seasonCode = resolveSeasonViewCode();
      DATA.priorityStaleAfterHeroic = (results[0] || []).filter(function (r) {
        return r.season === seasonCode;
      });
      DATA.priorityLiveFirstPrios = (results[1] || []).filter(function (r) {
        return r.season === seasonCode;
      });
      updatePriorityBadges();
    }
  );
}

function buildUnmanagedTab() {
  var itemSlots = DATA.itemSlots || {};
  var itemBosses = DATA.itemBosses || {};
  var searchTerm = normalise((document.getElementById('unmanagedSearch') || {}).value || '');
  var bossFilter = ((document.getElementById('unmanagedBossFilter') || {}).value || '').toLowerCase();
  var items = getUnmanagedItems().filter(function (item) {
    if (searchTerm && normalise(item).indexOf(searchTerm) === -1) return false;
    if (bossFilter && (itemBosses[item] || '').toLowerCase() !== bossFilter) return false;
    return true;
  });
  var el = document.getElementById('unmanagedContent');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p style="color:var(--heal);padding:1rem;">All items have been configured.</p>';
    return;
  }
  var groups = { Trinket: [], Armor: {}, Weapon: [], Jewelry: [], Other: [] };
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var slot = itemSlots[item] || '';
    var group = getItemGroup(slot);
    if (group === 'Armor') {
      var s = slot.toUpperCase();
      if (!groups.Armor[s]) groups.Armor[s] = [];
      groups.Armor[s].push(item);
    } else {
      groups[group].push(item);
    }
  }
  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };
  var html =
    '<p style="font-size:1rem;color:var(--text-muted);margin-bottom:1rem;">' +
    items.length +
    ' item' +
    (items.length === 1 ? '' : 's') +
    ' with no players ranked yet.</p>';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'unmanaged-sec-' + secId++;
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) {
          hasArmor = true;
          break;
        }
      }
      if (!hasArmor) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS.Armor +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'unmanaged-sec-' + secId++;
        html +=
          '<div class="prio-sub-header prio-collapsible" style="color:' +
          getSlotColor(slotKey) +
          ';" onclick="togglePrioSection(\'' +
          sid +
          '\')">' +
          slotKey.charAt(0) +
          slotKey.slice(1).toLowerCase() +
          '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderUnmanagedItem(slotItems[k], itemSlots[slotItems[k]]);
        html += '</div>';
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS[groupKey] +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++)
        html += renderUnmanagedItem(groups[groupKey][k], itemSlots[groups[groupKey][k]]);
      html += '</div>';
    }
  }
  el.innerHTML = html;
}

function renderUnmanagedItem(item, slot) {
  var itemEnc = encodeURIComponent(item).replace(/'/g, '%27');
  var entry = (DATA.priorityOrder || {})[item] || {};
  var hasHeroic = 'heroic' in entry;
  var hasMythic = 'mythic' in entry;
  var out = '<div class="prio-item">';
  out += '<div class="prio-item-header">';
  out += itemNameBlockHtml(item, slot);
  out +=
    '<span class="prio-item-count" style="color:#c0392b;">' +
    (!hasHeroic && !hasMythic ? 'No rankings' : 'Incomplete') +
    '</span>';
  out += '<span style="margin-left:auto;display:flex;gap:6px;">';
  // #607: view-only for a guild-officer-only visitor -- no edit affordances.
  if (window._guildOfficerAccessLevel !== 'guild') {
    if (!hasHeroic)
      out +=
        '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
        itemEnc +
        "'),'" +
        (slot || '') +
        "',true,'heroic')\">Set Heroic</button>";
    if (!hasMythic)
      out +=
        '<button class="btn btn-muted" style="font-size:0.93rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
        itemEnc +
        "'),'" +
        (slot || '') +
        "',true,'mythic')\">Set Mythic</button>";
  }
  out += '</span>';
  out += '</div></div>';
  return out;
}

function togglePrioSection(id) {
  var el = document.getElementById(id);
  var chevron = event.currentTarget.querySelector('.prio-chevron');
  var collapsed = el.style.display === 'none';
  el.style.display = collapsed ? '' : 'none';
  if (chevron) chevron.textContent = collapsed ? '-' : '+';
}

// Same-slot "already got one" flag (#607 follow-up): generate_priority_order()
// only excludes/derates a player for the exact item_id they already received
// (has_myth/has_hero/has_champ in 20260720165552_priority_wishlist_ranking.sql)
// -- a player who already has this season's belt from a *different* item
// shows up on another belt's ranked list with no signal at all. Rather than
// bake a slot-level penalty into the generator (which only reflects reality
// whenever that item's list is next regenerated -- could go stale for a
// while if an officer doesn't revisit it), this reads DATA.lootCounts live
// at render time so it's always current regardless of generation cadence.
// Client-side only, informational -- doesn't change ranking, just tells the
// officer to weigh it themselves before awarding.
function playerOtherSlotItems(player, slot, currentItem, itemSlots) {
  if (!player || !slot) return [];
  var seasonItems = getSeasonLootItems(player.firstName);
  var seen = {};
  var out = [];
  seasonItems.forEach(function (it) {
    var name = typeof it === 'string' ? it : it.name;
    if (!name || name === currentItem) return;
    if ((itemSlots[name] || '') !== slot) return;
    if (seen[name]) return;
    seen[name] = true;
    out.push(name);
  });
  // Trinket/Finger are dual-equip slots -- a player can hold two different
  // ones at once, so receiving a single one this season doesn't "spend" the
  // slot the way a single-equip slot does. Only flag once both are filled.
  var isDualEquipSlot = ['TRINKET', 'FINGER'].indexOf((slot || '').toUpperCase()) >= 0;
  if (isDualEquipSlot && out.length < 2) return [];
  return out;
}

function getItemGroup(slot) {
  var s = (slot || '').toUpperCase();
  if (s === 'TRINKET' || s === 'TRINKET 1' || s === 'TRINKET 2') return 'Trinket';
  if (['ONE-HAND', 'TWO-HAND', 'RANGED', 'OFF HAND', 'HELD IN OFF-HAND', '1H/2H', 'OH'].indexOf(s) >= 0)
    return 'Weapon';
  if (['NECK', 'FINGER', 'RING', 'RING 1', 'RING 2'].indexOf(s) >= 0) return 'Jewelry';
  if (ARMOR_SLOT_ORDER.indexOf(s) >= 0) return 'Armor';
  return 'Other';
}

// Best (BiS-first) wishlist status a player tagged for a given item, across
// however many item_preferences rows they have for it (Finger 1/2, Trinket
// 1/2, Weapon/Off Hand all write separate rows for the same item_id). Same
// tier order generate_priority_order()'s own `wishlist` CTE uses. Returns
// null if the player never tagged this item at all.
function _prioBestWishlistStatus(itemId, playerId) {
  var order = { bis: 1, good: 2, catalyst: 3, ok: 4, pass: 5 };
  var best = null;
  (_teamItemPreferences || []).forEach(function (p) {
    if (p.item_id !== itemId || p.player_id !== playerId) return;
    if (!best || order[p.status] < order[best]) best = p.status;
  });
  return best;
}

function buildPriorityTab() {
  var el = document.getElementById('priorityContent');
  // Wishlist status per ranked row (below) needs the same team-wide
  // item_preferences fetch the Notes sub-tab and Incomplete Wishlists banner
  // already use -- lazy-loaded once and cached, same shape as
  // buildPriorityNotesTab() above.
  if (_teamItemPreferences === null && !_teamItemPreferencesFailed) {
    if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Loading...</p>';
    fetchTeamItemPreferences().then(function (rows) {
      _setTeamItemPreferences(rows);
      buildPriorityTab();
    });
    return;
  }
  if (_teamItemPreferencesUnavailable()) {
    if (el) el.innerHTML = TEAM_PREFS_UNAVAILABLE_HTML;
    return;
  }

  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var itemBosses = DATA.itemBosses || {};
  var roster = DATA.roster || [];
  var itemIds = DATA.itemIds || {};
  var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};
  var wishlistStatusLabels = {};
  (typeof WISHLIST_LABEL_DEFAULTS !== 'undefined' ? WISHLIST_LABEL_DEFAULTS : []).forEach(function (t) {
    wishlistStatusLabels[t.value] = labelOverrides[t.value] || t.label;
  });

  var rosterMap = {};
  for (var i = 0; i < roster.length; i++) {
    rosterMap[normalise(roster[i].nameRealm)] = roster[i];
  }

  var prioSearchTerm = normalise((document.getElementById('prioSearch') || {}).value || '');
  var bossFilter = ((document.getElementById('prioBossFilter') || {}).value || '').toLowerCase();
  var hideEmpty = !!(document.getElementById('prioHideEmpty') || {}).checked;
  // Excludes DATA.tierResolvedItemNames -- see getUnmanagedItems()'s comment
  // above. Guards against a resolved item that somehow already has a
  // prioOrder entry (stale data from before this filter existed, or a
  // future import mistake) still leaking into the read-only list.
  var tierResolvedItemNames = DATA.tierResolvedItemNames || {};
  var items = Object.keys(prioOrder)
    .filter(function (i) {
      if (tierResolvedItemNames[i]) return false;
      if ((itemSlots[i] || '').toLowerCase() === 'slot') return false;
      if (!_hasAnyPriority(prioOrder[i])) return false;
      if (prioSearchTerm && normalise(i).indexOf(prioSearchTerm) === -1) return false;
      if (bossFilter && (itemBosses[i] || '').toLowerCase() !== bossFilter) return false;
      if (!isItemInSeasonScope(i)) return false;
      return true;
    })
    .sort(function (a, b) {
      return a.localeCompare(b);
    });

  if (!items.length) {
    document.getElementById('priorityContent').innerHTML =
      '<p style="color:var(--text);padding:1rem;">No priority data found.</p>';
    return;
  }

  var groups = { Trinket: [], Armor: {}, Weapon: [], Jewelry: [], Other: [] };
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var slot = itemSlots[item] || '';
    var group = getItemGroup(slot);
    if (group === 'Armor') {
      var s = slot.toUpperCase();
      if (!groups.Armor[s]) groups.Armor[s] = [];
      groups.Armor[s].push(item);
    } else {
      groups[group].push(item);
    }
  }

  function renderItem(item) {
    var entry = prioOrder[item];
    if (!entry) return '';
    var slot = itemSlots[item] || '';
    var itemEnc = encodeURIComponent(item).replace(/'/g, '%27');
    var itemId = itemIds[item];
    var out = '';
    var DIFFS = ['heroic', 'mythic'];
    for (var d = 0; d < DIFFS.length; d++) {
      var diff = DIFFS[d];
      var ranked = entry[diff];
      if (ranked === undefined || ranked === null) continue;
      if (hideEmpty && !ranked.length) continue;
      var diffLabel = diff === 'heroic' ? 'Heroic' : 'Mythic';
      out += '<div class="prio-item">';
      out += '<div class="prio-item-header">';
      out += itemNameBlockHtml(item, slot);
      out += '<span class="prio-diff-badge prio-diff-' + diff + '">' + diffLabel + '</span>';
      // #607: view-only for a guild-officer-only visitor -- no Edit button.
      var canEditPrio = window._guildOfficerAccessLevel !== 'guild';
      if (!ranked.length) {
        out +=
          '<span class="prio-item-count" style="color:var(--text-muted);font-style:italic;">Nobody assigned</span>';
        if (canEditPrio)
          out +=
            '<button class="btn btn-muted" style="margin-left:auto;font-size:0.93rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
            itemEnc +
            "'),'" +
            (slot || '') +
            "',false,'" +
            diff +
            '\')">Edit</button>';
        out += '</div></div>';
        continue;
      }
      out += '<span class="prio-item-count">' + ranked.length + ' ranked</span>';
      if (canEditPrio)
        out +=
          '<button class="btn btn-muted" style="margin-left:auto;font-size:0.93rem;padding:2px 10px;" onclick="openPrioEditModal(decodeURIComponent(\'' +
          itemEnc +
          "'),'" +
          (slot || '') +
          "',false,'" +
          diff +
          '\')">Edit</button>';
      out += '</div><div class="prio-ranked-list">';
      for (var j = 0; j < ranked.length; j++) {
        var nameRealm = ranked[j];
        var player = rosterMap[normalise(nameRealm)];
        var display = player ? player.nick || player.firstName : nameRealm;
        var role = player ? player.role : '';
        var roleColor =
          role === 'Tank'
            ? 'var(--tank)'
            : role === 'Heal'
              ? 'var(--heal)'
              : role === 'Ranged'
                ? 'var(--ranged)'
                : role === 'Melee'
                  ? 'var(--melee)'
                  : 'var(--text)';
        var otherSlotItems = playerOtherSlotItems(player, slot, item, itemSlots);
        var wishlistStatus = player && itemId != null ? _prioBestWishlistStatus(itemId, player.id) : null;
        var wishlistColor = wishlistStatus && PRIO_NOTES_TIER_COLORS[wishlistStatus];
        var wishlistHTML = wishlistStatus
          ? '<span class="prio-rank-wishlist" style="color:' +
            wishlistColor.css +
            ';border-color:' +
            wishlistColor.css +
            ';">' +
            escHtml(wishlistStatusLabels[wishlistStatus] || wishlistStatus) +
            '</span>'
          : '<span class="prio-rank-wishlist prio-rank-wishlist-none">No wishlist tag</span>';
        out += '<div class="prio-rank-row">';
        out += '<span class="prio-rank-num">' + (j + 1) + '</span>';
        out += '<span class="prio-rank-name" style="color:' + roleColor + ';">' + display + '</span>';
        if (role) out += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
        out += wishlistHTML;
        if (otherSlotItems.length) {
          out +=
            '<span style="margin-left:0.5rem;font-size:0.85em;color:var(--melee);" title="Already received ' +
            escHtml(otherSlotItems.join(', ')) +
            ' this season -- same slot">Already has this slot (' +
            escHtml(otherSlotItems.join(', ')) +
            ')</span>';
        }
        out += '</div>';
      }
      out += '</div></div>';
    }
    return out;
  }

  var GROUP_ORDER = ['Trinket', 'Armor', 'Weapon', 'Jewelry', 'Other'];
  var GROUP_LABELS = { Trinket: 'Trinkets', Armor: 'Armor', Weapon: 'Weapons', Jewelry: 'Jewelry', Other: 'Other' };

  var html = '';
  var secId = 0;
  for (var g = 0; g < GROUP_ORDER.length; g++) {
    var groupKey = GROUP_ORDER[g];
    var gid = 'prio-sec-' + secId++;
    if (groupKey === 'Armor') {
      var hasArmor = false;
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        if (groups.Armor[ARMOR_SLOT_ORDER[si]] && groups.Armor[ARMOR_SLOT_ORDER[si]].length) {
          hasArmor = true;
          break;
        }
      }
      if (!hasArmor) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS.Armor +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var si = 0; si < ARMOR_SLOT_ORDER.length; si++) {
        var slotKey = ARMOR_SLOT_ORDER[si];
        var slotItems = groups.Armor[slotKey];
        if (!slotItems || !slotItems.length) continue;
        var sid = 'prio-sec-' + secId++;
        html +=
          '<div class="prio-sub-header prio-collapsible" style="color:' +
          getSlotColor(slotKey) +
          ';" onclick="togglePrioSection(\'' +
          sid +
          '\')">' +
          slotKey.charAt(0) +
          slotKey.slice(1).toLowerCase() +
          '<span class="prio-chevron">-</span></div>';
        html += '<div id="' + sid + '">';
        for (var k = 0; k < slotItems.length; k++) html += renderItem(slotItems[k]);
        html += '</div>';
      }
      html += '</div>';
    } else {
      if (!groups[groupKey].length) continue;
      html +=
        '<div class="prio-section-header prio-collapsible" onclick="togglePrioSection(\'' +
        gid +
        '\')">' +
        GROUP_LABELS[groupKey] +
        '<span class="prio-chevron">-</span></div>';
      html += '<div id="' + gid + '">';
      for (var k = 0; k < groups[groupKey].length; k++) html += renderItem(groups[groupKey][k]);
      html += '</div>';
    }
  }

  document.getElementById('priorityContent').innerHTML = html;
}

// -- Priority Edit Modal --

var PRIO_EDIT = {
  item: '',
  slot: '',
  difficulty: 'Heroic',
  ranked: [],
  showAllRoster: false,
  dragSrcIdx: -1,
  scores: {},
  fairnessWarnings: {},
  // Set once prioEditGenerate() has produced a suggestion for this item/
  // difficulty -- a re-click while true triggers the "avoid stacking two #1
  // priorities on the same person" swap below. Reset on modal open/diff
  // switch so the very first suggestion always shows the algorithm's raw
  // top pick, conflict or not -- the officer can see it and re-click to fix
  // it rather than have it silently overridden every time.
  suggestedOnce: false
};

function openPrioEditModal(item, slot, autoGenerate, difficulty) {
  // #607: priority order is view-only for a guild-officer-only visitor;
  // RLS already blocks the underlying write, this is just a clean no-op
  // instead of a broken modal (the Edit/Set Heroic/Set Mythic buttons that
  // trigger this are also hidden for the same access level).
  if (window._guildOfficerAccessLevel === 'guild') return;
  var diff = (difficulty || 'heroic').toLowerCase();
  var diffCap = diff === 'mythic' ? 'Mythic' : 'Heroic';
  var entry = (DATA.priorityOrder || {})[item] || {};
  PRIO_EDIT.item = item;
  PRIO_EDIT.slot = slot;
  PRIO_EDIT.difficulty = diffCap;
  PRIO_EDIT.ranked = (entry[diff] || []).slice();
  PRIO_EDIT.showAllRoster = false;
  PRIO_EDIT.dragSrcIdx = -1;
  PRIO_EDIT.scores = {};
  PRIO_EDIT.fairnessWarnings = {};
  PRIO_EDIT.suggestedOnce = false;

  document.getElementById('prioEditTitle').textContent = item;
  var slotEl = document.getElementById('prioEditSlot');
  slotEl.textContent = slot;
  slotEl.style.color = slot ? getSlotColor(slot) : '';
  document.getElementById('prioEditError').style.display = 'none';
  document.getElementById('prioEditVersionWarning').style.display = 'none';
  document.getElementById('prioEditStatus').textContent = '';
  document.getElementById('prioEditShowAllBtn').textContent = 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = 'BiS Players';

  prioEditSetDiffToggle(diff);
  prioEditRenderList();
  prioEditRenderPool();
  document.getElementById('prioEditModal').classList.add('active');
  prioEditFetchFairnessWarnings();

  if (autoGenerate) prioEditGenerate();
}

function prioEditSetDiffToggle(diff) {
  var heroicBtn = document.getElementById('prioEditDiffHeroic');
  var mythicBtn = document.getElementById('prioEditDiffMythic');
  if (heroicBtn) heroicBtn.classList.toggle('active', diff === 'heroic');
  if (mythicBtn) mythicBtn.classList.toggle('active', diff === 'mythic');
}

function prioEditSwitchDiff(diff) {
  var diffCap = diff === 'mythic' ? 'Mythic' : 'Heroic';
  PRIO_EDIT.difficulty = diffCap;
  var entry = (DATA.priorityOrder || {})[PRIO_EDIT.item] || {};
  PRIO_EDIT.ranked = (entry[diff] || []).slice();
  PRIO_EDIT.scores = {};
  PRIO_EDIT.fairnessWarnings = {};
  PRIO_EDIT.suggestedOnce = false;
  PRIO_EDIT.showAllRoster = false;
  document.getElementById('prioEditShowAllBtn').textContent = 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = 'BiS Players';
  document.getElementById('prioEditStatus').textContent = '';
  document.getElementById('prioEditError').style.display = 'none';
  document.getElementById('prioEditVersionWarning').style.display = 'none';
  prioEditSetDiffToggle(diff);
  prioEditRenderList();
  prioEditRenderPool();
  prioEditFetchFairnessWarnings();
}

function closePrioEditModal() {
  document.getElementById('prioEditModal').classList.remove('active');
}

// Returns the full name_realm identity of every player whose BiS list has
// this item (#529: DATA.bisList is keyed by identity, not first name).
function prioEditGetBisPlayers() {
  var bisList = DATA.bisList || {};
  var itemLower = PRIO_EDIT.item.toLowerCase();
  var result = [];
  Object.keys(bisList).forEach(function (nameRealm) {
    var items = bisList[nameRealm] || [];
    for (var i = 0; i < items.length; i++) {
      if ((items[i].item || '').toLowerCase() === itemLower) {
        result.push(nameRealm);
        break;
      }
    }
  });
  return result;
}

function prioEditUpdateVersionWarning() {
  var el = document.getElementById('prioEditVersionWarning');
  if (!el) return;
  var scores = PRIO_EDIT.scores || {};
  var ranked = PRIO_EDIT.ranked;
  var seenHasHeroic = false;
  var warn = false;
  for (var i = 0; i < ranked.length; i++) {
    var s = scores[ranked[i]];
    var label = s ? s.statusLabel || '' : '';
    if (label.indexOf('Has Heroic') !== -1) {
      seenHasHeroic = true;
    }
    if (seenHasHeroic && label.indexOf('No Version') !== -1) {
      warn = true;
      break;
    }
  }
  el.style.display = warn ? '' : 'none';
}

// Fairness warnings for the current item/track -- non-blocking, surfaced
// only on whoever currently sits in the #1 slot. Queries
// priority_order_live_first_prios directly (rather than the aggregated
// priority_order_first_prio_counts view) so it can name the other items and
// tell same-boss conflicts apart from "just holds a #1 elsewhere". Excludes
// the item being edited itself, since that reflects whatever's already
// saved for this exact slot, not a competing claim. See
// 20260713150512_priority_order_fairness_warnings.sql.
function prioEditFetchFairnessWarnings() {
  if (!supabaseClient) return;
  var itemId = (DATA.itemIds || {})[PRIO_EDIT.item];
  if (!itemId) return;
  var season = resolveSeasonViewCode();
  var track = PRIO_EDIT.difficulty === 'Mythic' ? 'Myth' : 'Hero';
  var boss = (DATA.itemBosses || {})[PRIO_EDIT.item] || '';

  supabaseClient
    .from('priority_order_live_first_prios')
    .select('player_id, item_id, item_name, track, boss')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('season', season)
    .then(function (result) {
      if (result.error || !result.data) return;
      var rosterById = {};
      (DATA.roster || []).forEach(function (p) {
        rosterById[p.id] = p;
      });

      var byPlayer = {};
      result.data.forEach(function (r) {
        if (r.item_id === itemId) return;
        var player = rosterById[r.player_id];
        if (!player) return;
        var entry = byPlayer[player.nameRealm] || { otherItems: {}, sameBossItems: {} };
        entry.otherItems[r.item_name] = true;
        if (boss && r.boss === boss && r.track === track) entry.sameBossItems[r.item_name] = true;
        byPlayer[player.nameRealm] = entry;
      });
      PRIO_EDIT.fairnessWarnings = byPlayer;
      prioEditRenderList();
    });
}

function prioEditRenderList() {
  var list = document.getElementById('prioEditList');
  var ranked = PRIO_EDIT.ranked;
  var roster = DATA.roster || [];
  var rosterMap = {};
  roster.forEach(function (p) {
    rosterMap[normalise(p.nameRealm)] = p;
  });

  document.getElementById('prioEditCount').textContent = ranked.length ? '(' + ranked.length + ')' : '';

  if (!ranked.length) {
    list.innerHTML = '<div class="prio-drag-list-empty">No players ranked yet. Add from the right.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < ranked.length; i++) {
    var nameRealm = ranked[i];
    var player = rosterMap[normalise(nameRealm)];
    var display = player ? player.nick || player.firstName : nameRealm;
    var role = player ? player.role : '';
    var roleColor = getRoleColor(role);
    html +=
      '<div class="prio-drag-item" draggable="true"' +
      ' data-idx="' +
      i +
      '"' +
      ' ondragstart="prioEditDragStart(event,' +
      i +
      ')"' +
      ' ondragover="prioEditDragOver(event,' +
      i +
      ')"' +
      ' ondrop="prioEditDrop(event,' +
      i +
      ')"' +
      ' ondragend="prioEditDragEnd(event)"' +
      '>';
    html += '<div class="prio-drag-item-row">';
    html += '<span class="prio-drag-handle">&#8942;&#8942;</span>';
    html += '<span class="prio-drag-rank">' + (i + 1) + '</span>';
    html += '<span class="prio-drag-name" style="color:' + roleColor + ';">' + display + '</span>';
    if (role) html += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
    var scoreData = PRIO_EDIT.scores && PRIO_EDIT.scores[nameRealm];
    var metaHtml = '';
    if (scoreData) {
      if (scoreData.weightedTotal !== null && scoreData.weightedTotal !== undefined) {
        metaHtml += '<span>Score: ' + scoreData.weightedTotal + '</span>';
      }
      // "Has Heroic" (mythic track only -- still eligible for mythic, but
      // penalized) gets its own badge instead of sitting in the grey status
      // text, same as the BiS pool's "H" badge -- easy to miss otherwise.
      // Filters out empty entries too -- ''.split(', ') returns [''], not
      // [], so a player with no other status text at all used to still
      // render an empty "()" once nothing was left to join.
      var statusParts = (scoreData.statusLabel || '').split(', ').filter(function (p) {
        return p && p !== 'Has Heroic';
      });
      var hasHeroicStatus = (scoreData.statusLabel || '').indexOf('Has Heroic') !== -1;
      if (hasHeroicStatus)
        html += '<span class="prio-diff-badge prio-diff-heroic" title="Has the Heroic version">H</span>';
      // Wishlist sidegrade label built from the raw status + the team's own
      // custom overrides (team_settings.config.wishlistStatusLabels, set via
      // the admin panel) instead of generate_priority_order()'s old hardcoded
      // "Wishlist: Good"/"OK"/"Catalyst Only" text -- every other wishlist
      // status display on the site already respects these overrides.
      // 'bis'/untagged intentionally stay unlabeled here, same as before:
      // BiS is the default "really keeping this" case, only a sidegrade tag
      // gets called out.
      if (scoreData.wishlistStatus && scoreData.wishlistStatus !== 'bis') {
        var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};
        var defaultLabel = (typeof WISHLIST_LABEL_DEFAULTS !== 'undefined' ? WISHLIST_LABEL_DEFAULTS : []).filter(
          function (t) {
            return t.value === scoreData.wishlistStatus;
          }
        )[0];
        var wishlistLabel =
          labelOverrides[scoreData.wishlistStatus] || (defaultLabel && defaultLabel.label) || scoreData.wishlistStatus;
        statusParts.push('Wishlist: ' + wishlistLabel);
      }
      if (statusParts.length) {
        metaHtml += '<span class="prio-drag-meta-status">(' + statusParts.join(', ') + ')</span>';
      }
    }
    if (i === 0) {
      var warn = PRIO_EDIT.fairnessWarnings && PRIO_EDIT.fairnessWarnings[nameRealm];
      if (warn) {
        var sameBossNames = Object.keys(warn.sameBossItems);
        var otherNames = Object.keys(warn.otherItems);
        if (sameBossNames.length || otherNames.length) {
          var msgParts = [];
          if (sameBossNames.length) msgParts.push('Already #1 on ' + sameBossNames.join(', ') + ' from this boss');
          if (otherNames.length)
            msgParts.push('Holds ' + otherNames.length + ' other #1 priorit' + (otherNames.length === 1 ? 'y' : 'ies'));
          html +=
            '<span title="' +
            msgParts.join('; ').replace(/"/g, '&quot;') +
            '" style="margin-left:4px;color:var(--tank);font-weight:700;cursor:help;">&#9888;</span>';
        }
      }
    }
    html += '<button class="prio-drag-remove" onclick="prioEditRemove(' + i + ')" title="Remove">&times;</button>';
    html += '</div>';
    if (metaHtml) html += '<div class="prio-drag-meta">' + metaHtml + '</div>';
    html += '</div>';
  }
  list.innerHTML = html;
  prioEditUpdateVersionWarning();
}

// Whether firstName already has the current item at Heroic/Mythic, per
// DATA.lootCounts. Shared by the pool render (badge + block add) and
// prioEditAdd()'s guard, so "Show all roster" can't bypass the pool's
// filtering.
//
// Goes through getLootEntry() rather than indexing DATA.lootCounts directly:
// the map's keys are diacritic-stripped by normalise(), but a raw
// firstName.toLowerCase() lookup preserves accents, so it could never match an
// accented roster name (lowercasing "Katorri" with an accented i leaves the
// accent on; the key has it stripped). That silently returned no loot for those
// players, so they never got the "has Heroic version" badge AND were never
// blocked by prioEditIsBlocked() -- letting someone who already received the
// item be ranked for it again (#360). getLootEntry() normalises both sides,
// which is what every other loot consumer already does.
function prioEditLootFlags(firstName) {
  var itemLower = PRIO_EDIT.item.toLowerCase();
  var loot = getLootEntry(firstName);
  var flags = { hasHeroic: false, hasMythic: false };
  if (loot && loot.items) {
    for (var j = 0; j < loot.items.length; j++) {
      if (loot.items[j].name.toLowerCase() !== itemLower) continue;
      if (loot.items[j].difficulty === 'Heroic') flags.hasHeroic = true;
      else if (loot.items[j].difficulty === 'Mythic') flags.hasMythic = true;
    }
  }
  return flags;
}

// Whether firstName can be added to the currently-open track's ranked list.
// Matches generate_priority_order()'s exclusion rule: a mythic recipient is
// done with the item entirely (blocked from both tracks); a heroic
// recipient is only blocked from heroic (still eligible, penalized, for
// mythic).
function prioEditIsBlocked(firstName) {
  var flags = prioEditLootFlags(firstName);
  var isMythic = PRIO_EDIT.difficulty === 'Mythic';
  return flags.hasMythic || (!isMythic && flags.hasHeroic);
}

function prioEditRenderPool() {
  var pool = document.getElementById('prioEditPool');
  var ranked = PRIO_EDIT.ranked;
  var roster = DATA.roster || [];
  var rosterMap = {};
  roster.forEach(function (p) {
    rosterMap[normalise(p.nameRealm)] = p;
  });

  var rankedSet = {};
  ranked.forEach(function (n) {
    rankedSet[normalise(n)] = true;
  });

  var candidates;
  if (PRIO_EDIT.showAllRoster) {
    candidates = roster.map(function (p) {
      return p.nameRealm;
    });
  } else {
    candidates = prioEditGetBisPlayers();
  }

  var isMythic = PRIO_EDIT.difficulty === 'Mythic';

  var available = candidates.filter(function (n) {
    return !rankedSet[normalise(n)];
  });
  available.sort(function (a, b) {
    return a.localeCompare(b);
  });

  if (!available.length) {
    pool.innerHTML =
      '<div style="font-size:0.95rem;color:var(--text-muted);font-style:italic;padding:0.3rem 0;">All ' +
      (PRIO_EDIT.showAllRoster ? 'roster' : 'BiS') +
      ' players added.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < available.length; i++) {
    var nameRealm = available[i];
    var player = rosterMap[normalise(nameRealm)];
    var display = player ? player.nick || player.firstName : nameRealm;
    var role = player ? player.role : '';
    var nEnc = encodeURIComponent(nameRealm).replace(/'/g, '%27');
    var flags = prioEditLootFlags(nameRealm);
    // A mythic recipient can't go on either track's list -- they're done
    // with the item entirely (matches generate_priority_order()'s exclusion
    // rule). A heroic recipient is only blocked from heroic; still eligible,
    // penalized, for mythic.
    var blocked = flags.hasMythic || (!isMythic && flags.hasHeroic);
    var badgeTitle = flags.hasMythic
      ? 'Already has the Mythic version -- cannot be added to either list'
      : flags.hasHeroic
        ? isMythic
          ? 'Has the Heroic version'
          : 'Already has the Heroic version -- cannot be added to the Heroic list'
        : '';
    html += '<div class="prio-pool-item"' + (blocked ? ' style="opacity:0.55;cursor:default;"' : '');
    if (!blocked) html += ' onclick="prioEditAdd(decodeURIComponent(\'' + nEnc + '\'))"';
    html += '>';
    html += '<span class="prio-pool-name">' + display + '</span>';
    if (role) html += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
    if (flags.hasMythic) html += '<span class="prio-diff-badge prio-diff-mythic" title="' + badgeTitle + '">M</span>';
    else if (flags.hasHeroic)
      html += '<span class="prio-diff-badge prio-diff-heroic" title="' + badgeTitle + '">H</span>';
    if (!blocked) html += '<span class="prio-pool-add">+</span>';
    html += '</div>';
  }
  pool.innerHTML = html;
}

function prioEditAdd(nameRealm) {
  if (PRIO_EDIT.ranked.length >= 10) {
    document.getElementById('prioEditStatus').textContent = 'Maximum 10 players per item.';
    return;
  }
  if (prioEditIsBlocked(nameRealm)) {
    var blockedPlayer = (DATA.roster || []).filter(function (p) {
      return normalise(p.nameRealm) === normalise(nameRealm);
    })[0];
    var blockedName = blockedPlayer ? blockedPlayer.nick || blockedPlayer.firstName : nameRealm;
    document.getElementById('prioEditStatus').textContent =
      blockedName + ' already has this item at that difficulty and cannot be added.';
    return;
  }
  if (PRIO_EDIT.ranked.indexOf(nameRealm) === -1) {
    PRIO_EDIT.ranked.push(nameRealm);
    document.getElementById('prioEditStatus').textContent = '';
    prioEditRenderList();
    prioEditRenderPool();
  }
}

function prioEditRemove(idx) {
  PRIO_EDIT.ranked.splice(idx, 1);
  document.getElementById('prioEditStatus').textContent = '';
  prioEditRenderList();
  prioEditRenderPool();
}

function prioEditToggleAllRoster() {
  PRIO_EDIT.showAllRoster = !PRIO_EDIT.showAllRoster;
  document.getElementById('prioEditShowAllBtn').textContent = PRIO_EDIT.showAllRoster
    ? 'Show BiS only'
    : 'Show all roster';
  document.getElementById('prioEditPoolLabel').textContent = PRIO_EDIT.showAllRoster ? 'All Roster' : 'BiS Players';
  prioEditRenderPool();
}

// -- Drag-and-drop --

function prioEditDragStart(e, idx) {
  PRIO_EDIT.dragSrcIdx = idx;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function prioEditDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var items = document.querySelectorAll('#prioEditList .prio-drag-item');
  items.forEach(function (el) {
    el.classList.remove('drag-over');
  });
  if (idx !== PRIO_EDIT.dragSrcIdx) e.currentTarget.classList.add('drag-over');
}

function prioEditDrop(e, toIdx) {
  e.preventDefault();
  var fromIdx = PRIO_EDIT.dragSrcIdx;
  if (fromIdx === toIdx || fromIdx < 0) return;
  var moved = PRIO_EDIT.ranked.splice(fromIdx, 1)[0];
  PRIO_EDIT.ranked.splice(toIdx, 0, moved);
  PRIO_EDIT.dragSrcIdx = -1;
  prioEditRenderList();
}

function prioEditDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#prioEditList .prio-drag-item').forEach(function (el) {
    el.classList.remove('drag-over');
  });
  PRIO_EDIT.dragSrcIdx = -1;
}

// -- Generate suggested order --

// How many OTHER item/difficulty saved priority orders each name currently
// holds rank 1 on -- used by prioEditGenerate() below to avoid stacking
// another #1 priority on someone who already has one on a re-click.
// Excludes the item/difficulty currently being edited (nothing saved for it
// yet anyway). Names with zero #1s elsewhere are simply absent from the map.
function prioEditFirstPriorityCounts() {
  var order = DATA.priorityOrder || {};
  var currentDiff = PRIO_EDIT.difficulty.toLowerCase();
  var counts = {};
  Object.keys(order).forEach(function (itemName) {
    ['heroic', 'mythic'].forEach(function (diff) {
      if (itemName === PRIO_EDIT.item && diff === currentDiff) return;
      var arr = (order[itemName] || {})[diff];
      if (arr && arr.length) counts[arr[0]] = (counts[arr[0]] || 0) + 1;
    });
  });
  return counts;
}

function prioEditGenerate() {
  // #607: priority generation is excluded for a guild-officer-only visitor
  // (the modal that hosts this button never opens for them -- see the same
  // guard in openPrioEditModal -- but keep this too as a second checkpoint).
  if (window._guildOfficerAccessLevel === 'guild') return;
  var btn = document.getElementById('prioEditGenBtn');
  var status = document.getElementById('prioEditStatus');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  status.textContent = '';

  var itemId = (DATA.itemIds || {})[PRIO_EDIT.item];
  var track = PRIO_EDIT.difficulty === 'Mythic' ? 'Myth' : 'Hero';
  var season = resolveSeasonViewCode();

  if (!itemId) {
    btn.disabled = false;
    btn.textContent = 'Suggest Order';
    status.textContent = 'Item not found in catalog.';
    return;
  }

  supabaseClient
    .rpc('generate_priority_order', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_season: season,
      p_item_id: itemId,
      p_track: track
    })
    .then(function (result) {
      btn.disabled = false;
      btn.textContent = 'Suggest Order';
      if (result.error) throw new Error(result.error.message);
      var rows = result.data || [];
      if (!rows.length) {
        status.textContent = 'No BiS players found for this item.';
        return;
      }
      var rosterById = {};
      (DATA.roster || []).forEach(function (p) {
        rosterById[p.id] = p;
      });
      var scoreMap = {};
      var ranked = [];
      rows.forEach(function (r) {
        var player = rosterById[r.player_id];
        var nameRealm = player ? player.nameRealm : (r.name_realm || '').trim();
        scoreMap[nameRealm] = {
          nameRealm: nameRealm,
          weightedTotal: r.weighted_total,
          role: r.role,
          statusLabel: r.status_label || '',
          wishlistStatus: r.wishlist_status || null
        };
        ranked.push(nameRealm);
      });
      var statusMsg = 'Suggested order loaded. Review and adjust as needed.';
      // Only applied on a re-click (suggestedOnce already true) -- the very
      // first suggestion always shows the algorithm's raw #1 pick as-is, so
      // the officer can actually see the conflict before choosing to avoid
      // it, rather than have it silently swapped every time.
      if (PRIO_EDIT.suggestedOnce && ranked.length > 1) {
        var firstCounts = prioEditFirstPriorityCounts();
        var topCount = firstCounts[ranked[0]] || 0;
        if (topCount > 0) {
          // Not just "has zero #1s elsewhere" -- if everyone left in the
          // list already has at least one, fall back to whoever has the
          // fewest instead of giving up. Scanning left-to-right and only
          // updating on a strictly lower count keeps the algorithm's own
          // ordering as the tiebreaker among equally-fewest candidates.
          var swapIdx = -1;
          var swapCount = topCount;
          for (var i = 1; i < ranked.length; i++) {
            var c = firstCounts[ranked[i]] || 0;
            if (c < swapCount) {
              swapIdx = i;
              swapCount = c;
              if (swapCount === 0) break;
            }
          }
          if (swapIdx !== -1) {
            var promoted = ranked.splice(swapIdx, 1)[0];
            ranked.unshift(promoted);
            statusMsg =
              'Suggested order loaded -- promoted ' +
              promoted +
              (swapCount === 0
                ? " to #1 since the algorithm's top pick already has a #1 priority elsewhere."
                : ' to #1 -- everyone eligible already has a #1 priority elsewhere, so this pick has the fewest (' +
                  swapCount +
                  ').') +
              ' Review and adjust as needed.';
          }
        }
      }
      PRIO_EDIT.suggestedOnce = true;
      PRIO_EDIT.scores = scoreMap;
      PRIO_EDIT.ranked = ranked;
      status.textContent = statusMsg;
      prioEditRenderList();
      prioEditRenderPool();
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Suggest Order';
      status.textContent = err.message;
    });
}

// -- Save --

function prioEditSave() {
  var saveBtn = document.getElementById('prioEditSaveBtn');
  var status = document.getElementById('prioEditStatus');
  var errEl = document.getElementById('prioEditError');
  errEl.style.display = 'none';

  var itemId = (DATA.itemIds || {})[PRIO_EDIT.item];
  if (!itemId) {
    errEl.textContent = 'Item not found in catalog.';
    errEl.style.display = '';
    return;
  }

  // Keyed by full identity (#529), not first name -- PRIO_EDIT.ranked now
  // carries name_realm values, and this map used to be built by first name
  // alone, so two roster characters sharing a first name would silently
  // collide here (the second overwrites the first), letting a rank meant for
  // one twin resolve to and save the other's player_id.
  var rosterMap = {};
  (DATA.roster || []).forEach(function (p) {
    rosterMap[normalise(p.nameRealm)] = p;
  });
  var playerIds = [];
  for (var i = 0; i < PRIO_EDIT.ranked.length; i++) {
    var player = rosterMap[normalise(PRIO_EDIT.ranked[i])];
    if (!player || !player.id) {
      errEl.textContent = 'Unknown roster player: ' + PRIO_EDIT.ranked[i];
      errEl.style.display = '';
      return;
    }
    playerIds.push(player.id);
  }

  var track = PRIO_EDIT.difficulty === 'Mythic' ? 'Myth' : 'Hero';
  var season = resolveSeasonViewCode();

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  status.textContent = '';

  supabaseClient
    .rpc('save_priority_order', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_season: season,
      p_item_id: itemId,
      p_track: track,
      p_player_ids: playerIds
    })
    .then(function (result) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Priority';
      if (result.error) throw new Error(result.error.message);
      DATA.priorityOrder = DATA.priorityOrder || {};
      if (!DATA.priorityOrder[PRIO_EDIT.item]) DATA.priorityOrder[PRIO_EDIT.item] = {};
      DATA.priorityOrder[PRIO_EDIT.item][PRIO_EDIT.difficulty.toLowerCase()] = PRIO_EDIT.ranked.slice();
      // Mirror into the raw-rows cache too (common.js's
      // remapPriorityDataForSeasonView() rebuilds DATA.priorityOrder from
      // this on every Season View change) -- otherwise this save would
      // vanish from view the next time the officer switches Season View and
      // back, even though it's already persisted server-side.
      DATA._priorityOrderRawRows = (DATA._priorityOrderRawRows || []).filter(function (r) {
        return !(r.season === season && r.track === track && r.items && r.items.name === PRIO_EDIT.item);
      });
      PRIO_EDIT.ranked.forEach(function (nameRealm, idx) {
        DATA._priorityOrderRawRows.push({
          season: season,
          track: track,
          rank: idx + 1,
          items: { name: PRIO_EDIT.item },
          players: { name_realm: nameRealm }
        });
      });
      buildPriorityTab();
      buildUnmanagedTab();
      updatePriorityBadges();
      closePrioEditModal();
    })
    .catch(function (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Priority';
      errEl.textContent = err.message;
      errEl.style.display = '';
    });
}

function getRoleColor(role) {
  if (role === 'Tank') return 'var(--tank)';
  if (role === 'Heal') return 'var(--heal)';
  if (role === 'Ranged') return 'var(--ranged)';
  if (role === 'Melee') return 'var(--melee)';
  return 'var(--text)';
}
