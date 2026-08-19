// Below this many players wanting the same item, it isn't rare enough to be
// useful contested-item information -- most gear ends up wanted by a couple
// of players once wishlists fill out, so a low bar just re-lists most of the
// catalog instead of surfacing genuine multi-way competition.
var CONTESTED_ITEMS_MIN_PLAYERS = 6;

// Which item rows are expanded to show their contesting players -- survives
// re-renders triggered by toggling (buildConflicts() re-runs in full, same
// "flip a flag, re-render" convention js/wishlist.js's
// wishlistCollapsibleCardHTML/_wishlistExpandedSlots uses), resets on next
// page load.
var _contestedItemsExpanded = {};

function toggleContestedItem(item) {
  _contestedItemsExpanded[item] = !_contestedItemsExpanded[item];
  buildConflicts();
}

// Who wants each item, merging the officer's bis_items grid with every
// raider's own wishlist BiS tags -- previously read bis_items only
// (DATA.bisList straight from getBisItems()), so a team relying mainly on
// raiders tagging their own wishlist (item_preferences) instead of officers
// filling out the BiS grid saw this tab read as almost entirely empty. Same
// per-player merge renderProfile()'s officer branch already uses
// (bisMergeWishlistPrefs()), just run across the whole roster instead of one
// player at a time.
function buildContestedItemMap() {
  var itemMap = {};
  (DATA.roster || []).forEach(function (player) {
    var officerBis = getBisItems(player.nameRealm);
    var prefs = (_teamItemPreferences || []).filter(function (p) {
      return p.player_id === player.id;
    });
    var merged = bisMergeWishlistPrefs(prefs, officerBis, player.id);
    var items = merged.fromWishlist.concat(merged.officerSet);
    items.forEach(function (entry) {
      var itemName = entry.item;
      if (itemName === 'M+' || itemName === 'Crafted' || itemName === 'Catalyst') return;
      if (!itemMap[itemName]) itemMap[itemName] = [];
      if (itemMap[itemName].indexOf(player.firstName) === -1) itemMap[itemName].push(player.firstName);
    });
  });
  return itemMap;
}

function buildConflicts() {
  var el = document.getElementById('conflictsContent');
  if (!el) return;
  // Same lazy-load-then-cache shape as buildPriorityNotesTab() -- this tab
  // needs the same team-wide item_preferences fetch, not part of the main
  // DATA load since it's an officer-only feature (see _teamItemPreferences's
  // own comment above).
  if (_teamItemPreferences === null && !_teamItemPreferencesFailed) {
    el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Loading...</p>';
    fetchTeamItemPreferences().then(function (rows) {
      _setTeamItemPreferences(rows);
      buildConflicts();
    });
    return;
  }
  if (_teamItemPreferencesUnavailable()) {
    el.innerHTML = TEAM_PREFS_UNAVAILABLE_HTML;
    return;
  }

  var itemMap = buildContestedItemMap();
  var prioOrder = DATA.priorityOrder || {};

  // Only items CONTESTED_ITEMS_MIN_PLAYERS+ players actually want -- below
  // that, wanting the same item isn't rare enough to be useful information
  // (most gear ends up wanted by at least a couple of players once wishlists
  // fill out).
  var sorted = Object.keys(itemMap)
    .filter(function (item) {
      return itemMap[item].length >= CONTESTED_ITEMS_MIN_PLAYERS;
    })
    .sort(function (a, b) {
      return itemMap[b].length - itemMap[a].length;
    });

  var html =
    '<div style="display:flex;align-items:center;margin-bottom:0.75rem;">' +
    '<span class="section-label" style="margin-bottom:0;">Contested Items' +
    '<button class="help-btn" onclick="toggleHelp(\'help-loot-conflicts\')" title="Show help">?</button>' +
    '</span></div>' +
    '<div id="help-loot-conflicts" class="help-tip" style="margin-top:0;margin-bottom:0.75rem;">' +
    'Items wanted by ' +
    CONTESTED_ITEMS_MIN_PLAYERS +
    '+ players (officer BiS picks and raider wishlists combined), sorted by how many players want them. Click an item to see who wants it and their current priority rank.<br>' +
    'Ranks show H (Heroic) or M (Mythic). See the Priority List sub-tab for who currently holds multiple #1 priorities.' +
    '</div>';

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i];
    var players = itemMap[item];
    var slot = (DATA.itemSlots || {})[item] || '';
    var iEntry = prioOrder[item] || {};
    var expanded = !!_contestedItemsExpanded[item];

    // Build rank lookup for this item: normKey -> [{diff, pos}]
    var rankInfo = {};
    ['heroic', 'mythic'].forEach(function (diff) {
      var ranked = iEntry[diff] || [];
      ranked.forEach(function (r, idx) {
        var key = normalise(r);
        if (!rankInfo[key]) rankInfo[key] = [];
        rankInfo[key].push({ diff: diff, pos: idx });
      });
    });

    html += '<div class="conflict-item">';
    html +=
      '<button type="button" class="conflict-item-toggle" onclick="toggleContestedItem(\'' +
      item.replace(/'/g, "\\'") +
      '\')">';
    html += '<span class="conflict-item-name">' + escHtml(item);
    if (slot)
      html +=
        '<span style="font-size:1rem;color:' +
        getSlotColor(slot) +
        ';text-transform:uppercase;letter-spacing:0.08em;">' +
        escHtml(slot) +
        '</span>';
    html += '</span>';
    html +=
      '<span class="conflict-count">' + players.length + ' player' + (players.length !== 1 ? 's' : '') + '</span>';
    html += '<span class="conflict-item-chevron">' + (expanded ? '▾' : '▸') + '</span>';
    html += '</button>';

    if (expanded) {
      html += '<div class="conflict-players">';
      for (var j = 0; j < players.length; j++) {
        var pName = players[j];
        var pKey = normalise(pName);
        var pData = null;
        for (var k = 0; k < DATA.roster.length; k++) {
          if (normalise(DATA.roster[k].firstName) === pKey) {
            pData = DATA.roster[k];
            break;
          }
        }
        var display = pData ? pData.nick || pData.firstName : pName;

        var info = rankInfo[pKey] || [];
        var isRanked = info.length > 0;

        var seasonItems = getSeasonLootItems(pName);
        var received = false,
          receivedDiff = '';
        for (var m = 0; m < seasonItems.length; m++) {
          var itemObj = seasonItems[m];
          var iName = typeof itemObj === 'string' ? itemObj : itemObj.name;
          if (normalise(iName) === normalise(item)) {
            received = true;
            receivedDiff = typeof itemObj === 'object' ? itemObj.difficulty : '';
            break;
          }
        }

        var rankLabel = '';
        if (info.length > 0) {
          var parts = info.map(function (x) {
            return '#' + (x.pos + 1) + (x.diff === 'mythic' ? 'M' : 'H');
          });
          rankLabel = ' ' + parts.join('/');
        }

        var badge = received
          ? ' <span class="received-badge">Received' + (receivedDiff ? ' (' + receivedDiff + ')' : '') + '</span>'
          : '';

        var classes = 'conflict-player-tag' + (isRanked ? ' ranked' : '') + (received ? ' received' : '');

        html += '<span class="' + classes + '">' + display + rankLabel + badge + '</span>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  if (sorted.length === 0)
    html +=
      '<p style="color:var(--text);padding:1rem;">No contested items -- nothing wanted by ' +
      CONTESTED_ITEMS_MIN_PLAYERS +
      '+ players yet.</p>';
  el.innerHTML = html;
}
