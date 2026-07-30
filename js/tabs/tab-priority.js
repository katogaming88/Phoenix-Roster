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
function getUnmanagedItems() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var itemPlaceholders = DATA.itemPlaceholders || {};
  var seen = {};
  var result = [];
  Object.keys(prioOrder).forEach(function (item) {
    if (itemPlaceholders[item]) return;
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

// Every kind of fairness/health issue that lives on the Priority List --
// stale-after-heroic #1s, same-boss #1 conflicts, and players holding 2+ #1s
// team-wide. Was silently folded into the nav badge with nowhere of its own
// to live, so a mismatch between the nav total and the Unmanaged Items count
// looked like a bug rather than "there's 1 conflict on the Priority List" --
// and even the sub-tab badge was just a bare count, with no way to see which
// item(s) it referred to. Same-boss and duplicate-#1 groups are derived
// client-side from priority_order_live_first_prios (item_name/boss already
// joined) rather than querying priority_order_same_boss_conflicts /
// priority_order_first_prio_counts directly, so the banner below can name
// the actual items instead of just a number.
function getPriorityListConflicts() {
  var staleEntries = DATA.priorityStaleAfterHeroic || [];
  var byPlayer = {};
  (DATA.priorityLiveFirstPrios || []).forEach(function (r) {
    var entry = byPlayer[r.player_id] || { nameRealm: r.name_realm, items: [] };
    entry.items.push({ itemName: r.item_name, track: r.track, boss: r.boss });
    byPlayer[r.player_id] = entry;
  });

  var sameBossGroups = [];
  var duplicateGroups = [];
  Object.keys(byPlayer).forEach(function (playerId) {
    var entry = byPlayer[playerId];
    if (entry.items.length < 2) return;
    duplicateGroups.push({
      nameRealm: entry.nameRealm,
      itemNames: entry.items.map(function (it) {
        return it.itemName;
      })
    });
    var byBossTrack = {};
    entry.items.forEach(function (it) {
      if (!it.boss) return;
      var key = it.boss + '|' + it.track;
      (byBossTrack[key] = byBossTrack[key] || { boss: it.boss, itemNames: [] }).itemNames.push(it.itemName);
    });
    Object.keys(byBossTrack).forEach(function (key) {
      var group = byBossTrack[key];
      if (group.itemNames.length > 1) {
        sameBossGroups.push({ nameRealm: entry.nameRealm, boss: group.boss, itemNames: group.itemNames });
      }
    });
  });

  return {
    count: staleEntries.length + sameBossGroups.length + duplicateGroups.length,
    staleEntries: staleEntries,
    sameBossGroups: sameBossGroups,
    duplicateGroups: duplicateGroups
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
  conflicts.duplicateGroups.forEach(function (g) {
    html +=
      '<div class="prio-overalloc-player"><span class="prio-overalloc-name">' +
      escHtml(g.nameRealm) +
      '</span><span class="prio-overalloc-item">' +
      escHtml(g.itemNames.join(', ')) +
      ' <span class="prio-overalloc-diff">holds ' +
      g.itemNames.length +
      ' #1 priorities</span></span></div>';
  });

  html += '</div></div>';
  return html;
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
  if (_teamItemPreferences === null) {
    el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Loading...</p>';
    fetchTeamItemPreferences().then(function (rows) {
      _teamItemPreferences = rows || [];
      buildPriorityNotesTab();
    });
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

  var byItem = {};
  _teamItemPreferences.forEach(function (p) {
    if (!p.note || !p.note.trim()) return;
    if (p.slot) return; // Other Sources placeholder rows aren't a real catalog item to group under
    var name = idToName[p.item_id];
    if (!name) return;
    if (searchTerm && normalise(name).indexOf(searchTerm) === -1) return;
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
        '<div class="self-received-source" style="width:100%;box-sizing:border-box;font-size:0.92rem;margin-top:0.25rem;">' +
        escHtml(p.note) +
        '</div>' +
        '</div>';
    });
    html += '</div></div>';
  });

  el.innerHTML = html;
}

// Officer read view of one raider's full Wishlist (#610/#612 follow-up):
// ownWishlistSectionHTML() (js/wishlist.js) only ever renders on a raider's
// own self-view (backTo === 'landing') -- an officer opening someone else's
// profile got nothing at all beyond the BiS-tagged items already folded
// into the "BiS List" merge (bisMergeWishlistPrefs() in js/common.js).
// Good/OK/Catalyst Only/Pass tags and notes on non-BiS items were
// invisible. This reuses the same already-loaded _teamItemPreferences
// (Priority tab's Notes/Incomplete-Wishlists data) rather than a second
// per-profile fetch, grouped by canonical gear row via BIS_SLOTS/
// _priorityItemRows (tab-bis.js/this file) since js/wishlist.js's own
// WISHLIST_SLOTS isn't loaded on officer.html. Read-only -- no write path,
// same as the Notes tab.
function officerWishlistRowHTML(name, pref, statusLabels) {
  var color = PRIO_NOTES_TIER_COLORS[pref.status];
  var rowBackground = color ? 'rgba(' + color.rgb + ',0.08)' : 'var(--bg-card)';
  var rowBorder = color ? color.css : 'var(--border)';
  return (
    '<div style="padding:0.3rem 0.5rem;border-radius:4px;border:1px solid ' +
    rowBorder +
    ';background:' +
    rowBackground +
    ';margin-bottom:2px;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">' +
    '<span style="color:var(--text);">' +
    escHtml(name) +
    '</span>' +
    '<span style="font-size:0.85rem;font-weight:600;color:' +
    rowBorder +
    ';text-transform:uppercase;letter-spacing:0.04em;">' +
    escHtml(statusLabels[pref.status] || pref.status) +
    '</span>' +
    (pref.note
      ? '<span style="width:100%;font-size:0.92rem;color:var(--text-muted);font-style:italic;">"' +
        escHtml(pref.note) +
        '"</span>'
      : '') +
    '</div>'
  );
}

function officerWishlistSectionHTML(player) {
  if (!player) return '';
  if (typeof featureEnabled === 'function' && !featureEnabled('bis')) return '';

  var html = '<div class="profile-section"><div class="section-label">Wishlist</div>';

  if (_teamItemPreferences === null) {
    fetchTeamItemPreferences().then(function (rows) {
      _teamItemPreferences = rows || [];
      if (typeof reopenSelectedPlayer === 'function') reopenSelectedPlayer();
    });
    return html + '<p style="color:var(--text-muted);padding:0.5rem 0;">Loading...</p></div>';
  }

  var prefs = _teamItemPreferences.filter(function (p) {
    return p.player_id === player.id;
  });
  if (!prefs.length) {
    return html + '<p style="color:var(--text-muted);padding:0.5rem 0;">No wishlist tags yet.</p></div>';
  }

  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var itemSlots = DATA.itemSlots || {};
  var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};
  var statusLabels = {};
  (typeof WISHLIST_LABEL_DEFAULTS !== 'undefined' ? WISHLIST_LABEL_DEFAULTS : []).forEach(function (t) {
    statusLabels[t.value] = labelOverrides[t.value] || t.label;
  });

  var byRow = {};
  var other = [];
  prefs.forEach(function (p) {
    var name = idToName[p.item_id];
    if (!name) return;
    var rowsForItem = _priorityItemRows(p.item_id, p.slot || null, idToName, itemSlots);
    if (!rowsForItem.length) {
      other.push({ name: name, pref: p });
      return;
    }
    rowsForItem.forEach(function (row) {
      (byRow[row] = byRow[row] || []).push({ name: name, pref: p });
    });
  });

  (typeof BIS_SLOTS !== 'undefined' ? BIS_SLOTS : []).forEach(function (row) {
    var entries = byRow[row];
    if (!entries || !entries.length) return;
    html +=
      '<div style="font-size:0.85rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin:0.5rem 0 0.25rem;">' +
      escHtml(row) +
      '</div>';
    entries.forEach(function (e) {
      html += officerWishlistRowHTML(e.name, e.pref, statusLabels);
    });
  });
  if (other.length) {
    html +=
      '<div style="font-size:0.85rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin:0.5rem 0 0.25rem;">Other</div>';
    other.forEach(function (e) {
      html += officerWishlistRowHTML(e.name, e.pref, statusLabels);
    });
  }

  return html + '</div>';
}

function updatePriorityBadges() {
  var unmanagedCount = getUnmanagedItems().length;
  var conflicts = getPriorityListConflicts();
  var navBadge = document.getElementById('prioNavBadge');
  var subBadge = document.getElementById('prioSubBadge');
  var listBadge = document.getElementById('prioListBadge');
  var conflictsBanner = document.getElementById('priorityConflictsBanner');
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
}

// Wishlist completeness (#515): officers need to see which raiders haven't
// finished tagging their wishlist before generating priority order.
// item_preferences isn't part of the main DATA load (that'd add a query to
// every page load for an officer-only feature) -- fetched on demand here,
// same "cache + re-render once loaded" shape as js/wishlist.js's own
// fetchMyItemPreferences(), just for the whole team instead of one player.
var _teamItemPreferences = null;

function fetchTeamItemPreferences() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('item_preferences')
    .select('player_id, item_id, status, slot, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase item_preferences query failed.', result.error.message);
        return null;
      }
      return result.data || [];
    })
    .catch(function (err) {
      console.warn('Supabase item_preferences query failed.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
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

// officerBuckets (tab-bis.js's bisSlotBuckets().buckets for this player) --
// a row already covered by the officer's bis_items grid doesn't need the
// raider to have tagged it themselves too, same fallback js/wishlist.js's
// own wishlistCompleteness() applies on the raider side.
function _priorityWishlistMissingRows(prefs, idToName, itemSlots, officerBuckets) {
  var taggedRows = {};
  var offHandRequired = false;
  prefs.forEach(function (p) {
    _priorityItemRows(p.item_id, p.slot || null, idToName, itemSlots).forEach(function (row) {
      taggedRows[row] = true;
    });
    if (p.status === 'bis' && !p.slot) {
      var name = idToName[p.item_id];
      if (name && itemSlots[name] === 'One-Hand') offHandRequired = true;
    }
  });
  if (!taggedRows.Weapon && officerBuckets.Weapon && itemSlots[officerBuckets.Weapon.item] === 'One-Hand') {
    offHandRequired = true;
  }
  var requiredRows = BIS_SLOTS.filter(function (row) {
    return row !== 'Off Hand' || offHandRequired;
  });
  return requiredRows.filter(function (row) {
    return !taggedRows[row] && !officerBuckets[row];
  });
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
    var missingRows = _priorityWishlistMissingRows(prefsByPlayer[player.id] || [], idToName, itemSlots, officerBuckets);
    if (missingRows.length) raiders.push({ nameRealm: player.nameRealm, missingRows: missingRows });
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
  if (_teamItemPreferences === null) {
    fetchTeamItemPreferences().then(function (rows) {
      _teamItemPreferences = rows || [];
      renderWishlistIncompleteBanner();
      if (typeof buildBisListsTab === 'function' && document.getElementById('bis-lists-container')) {
        buildBisListsTab();
      }
      // Wishlists Completed stat card (js/tabs/tab-roster.js) shows "-" until
      // this fetch resolves -- refresh it now that real data's in.
      if (typeof buildStatsBar === 'function') buildStatsBar();
    });
    return;
  }
  if (compactEl) compactEl.innerHTML = buildWishlistIncompleteCompactHtml(getIncompleteWishlists());
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
  var count = _teamItemPreferences.filter(function (p) {
    return p.note && p.note.trim() && !p.slot;
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

function buildPriorityTab() {
  var prioOrder = DATA.priorityOrder || {};
  var itemSlots = DATA.itemSlots || {};
  var itemBosses = DATA.itemBosses || {};
  var roster = DATA.roster || [];

  var rosterMap = {};
  for (var i = 0; i < roster.length; i++) {
    rosterMap[normalise(roster[i].nameRealm)] = roster[i];
  }

  var prioSearchTerm = normalise((document.getElementById('prioSearch') || {}).value || '');
  var bossFilter = ((document.getElementById('prioBossFilter') || {}).value || '').toLowerCase();
  var hideEmpty = !!(document.getElementById('prioHideEmpty') || {}).checked;
  var items = Object.keys(prioOrder)
    .filter(function (i) {
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
      if (!ranked.length) {
        out +=
          '<span class="prio-item-count" style="color:var(--text-muted);font-style:italic;">Nobody assigned</span>';
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
        out += '<div class="prio-rank-row">';
        out += '<span class="prio-rank-num">' + (j + 1) + '</span>';
        out += '<span class="prio-rank-name" style="color:' + roleColor + ';">' + display + '</span>';
        if (role) out += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
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
  fairnessWarnings: {}
};

function openPrioEditModal(item, slot, autoGenerate, difficulty) {
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
    html += '<span class="prio-drag-handle">&#8942;&#8942;</span>';
    html += '<span class="prio-drag-rank">' + (i + 1) + '</span>';
    html += '<span class="prio-drag-name" style="color:' + roleColor + ';">' + display + '</span>';
    if (role) html += '<span class="prio-role-badge prio-role-' + role + '">' + role.toUpperCase() + '</span>';
    var scoreData = PRIO_EDIT.scores && PRIO_EDIT.scores[nameRealm];
    if (scoreData) {
      if (scoreData.weightedTotal !== null && scoreData.weightedTotal !== undefined) {
        html +=
          '<span style="font-size:0.91rem;color:var(--text-muted);margin-left:4px;">Score: ' +
          scoreData.weightedTotal +
          '</span>';
      }
      // "Has Heroic" (mythic track only -- still eligible for mythic, but
      // penalized) gets its own badge instead of sitting in the grey status
      // text, same as the BiS pool's "H" badge -- easy to miss otherwise.
      var statusParts = (scoreData.statusLabel || '').split(', ').filter(function (p) {
        return p !== 'Has Heroic';
      });
      var hasHeroicStatus = (scoreData.statusLabel || '').indexOf('Has Heroic') !== -1;
      if (hasHeroicStatus)
        html += '<span class="prio-diff-badge prio-diff-heroic" title="Has the Heroic version">H</span>';
      if (statusParts.length) {
        html +=
          '<span style="font-size:0.89rem;color:var(--text-muted);font-style:italic;margin-left:2px;">(' +
          statusParts.join(', ') +
          ')</span>';
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
    var nEnc = encodeURIComponent(nameRealm);
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

function prioEditGenerate() {
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
          statusLabel: r.status_label || ''
        };
        ranked.push(nameRealm);
      });
      PRIO_EDIT.scores = scoreMap;
      PRIO_EDIT.ranked = ranked;
      status.textContent = 'Suggested order loaded. Review and adjust as needed.';
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
