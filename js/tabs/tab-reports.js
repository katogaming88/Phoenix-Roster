// Officer report views (#227, Phase 5). Reads directly from the Supabase
// views in supabase/migrations/20260710140000_officer_report_views.sql --
// there's no Apps Script fallback for any of these, they only exist in
// Supabase.

var REPORTS_STATE = {
  rnlsiRows: [],
  rnlsiRoleFilter: null,
  rnlsiSort: { key: 'nights', dir: -1 },
  bisDemandRows: [],
  staleRows: [],
  gapRows: [],
  staleAfterHeroicRows: [],
  lootPaceRows: [],
  tierSetRoleFilter: null,
  tierSetSort: { key: 'count', dir: 1 }
};

function buildReportsTab() {
  loadRnlsiReport();
}

function reportsUniqueSorted(values, compareFn) {
  var seen = {};
  var out = [];
  values.forEach(function (v) {
    if (v === null || v === undefined || v === '') return;
    if (seen[v]) return;
    seen[v] = true;
    out.push(v);
  });
  out.sort(compareFn);
  return out;
}

function reportsSeasonLabel(code) {
  return (typeof seasonDisplayName === 'function' && seasonDisplayName(code)) || code;
}

function reportsCurrentSeasonCode() {
  return window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
}

// -- Raid nights since last item --

function loadRnlsiReport() {
  var container = document.getElementById('reportsRnlsiContent');
  if (!supabaseClient) {
    container.innerHTML = '<p>Reports require Supabase, which is unavailable right now.</p>';
    return;
  }
  container.innerHTML = '<p style="color:var(--text-muted);">Loading...</p>';
  // team-read-guard: a view, one row per roster member.
  supabaseClient
    .from('rnlsi')
    .select('*')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        container.innerHTML = '<p style="color:var(--tank);">' + result.error.message + '</p>';
        return;
      }
      REPORTS_STATE.rnlsiRows = result.data || [];
      renderRnlsiTable();
    });
}

function toggleRnlsiRole(role) {
  REPORTS_STATE.rnlsiRoleFilter = REPORTS_STATE.rnlsiRoleFilter === role ? null : role;
  ['Tank', 'Heal', 'Melee', 'Ranged'].forEach(function (r) {
    document.getElementById('rnlsi-chip-role-' + r).classList.toggle('active', REPORTS_STATE.rnlsiRoleFilter === r);
  });
  renderRnlsiTable();
}

function toggleRnlsiSort(key) {
  var sort = REPORTS_STATE.rnlsiSort;
  if (sort.key === key) sort.dir *= -1;
  else {
    sort.key = key;
    sort.dir = key === 'player' ? 1 : -1;
  }
  ['player', 'lastAward', 'nights'].forEach(function (k) {
    var chip = document.getElementById('rnlsi-chip-sort-' + k);
    var isActive = sort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent =
      { player: 'Player', lastAward: 'Last Award', nights: 'Raid Nights Since' }[k] +
      (isActive ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');
  });
  renderRnlsiTable();
}

// Severity color scaled to the highest value in the currently rendered set,
// same "relative to what's on screen" approach the Loot Fairness tab uses
// for its average line -- a flat night count means something different
// early vs. late in a season, so a fixed threshold would drift out of date.
function rnlsiSeverityColor(nights, maxNights) {
  if (!maxNights) return 'var(--text)';
  var ratio = nights / maxNights;
  if (ratio >= 0.66) return 'var(--melee)';
  if (ratio >= 0.33) return 'var(--gold-light)';
  return 'var(--heal)';
}

function renderRnlsiTable() {
  var container = document.getElementById('reportsRnlsiContent');
  var rows = REPORTS_STATE.rnlsiRows;
  if (!rows.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No active roster players found.</p>';
    return;
  }

  var filtered = REPORTS_STATE.rnlsiRoleFilter
    ? rows.filter(function (r) {
        return r.role === REPORTS_STATE.rnlsiRoleFilter;
      })
    : rows;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No players in this role.</p>';
    return;
  }

  var maxNights = filtered.reduce(function (m, r) {
    return Math.max(m, r.raid_nights_since_last_item || 0);
  }, 0);

  var sort = REPORTS_STATE.rnlsiSort;
  var sorted = filtered.slice().sort(function (a, b) {
    if (sort.key === 'player') return sort.dir * a.name_realm.localeCompare(b.name_realm);
    if (sort.key === 'lastAward') {
      var at = a.last_award_at ? new Date(a.last_award_at).getTime() : -Infinity;
      var bt = b.last_award_at ? new Date(b.last_award_at).getTime() : -Infinity;
      return sort.dir * (at - bt);
    }
    return sort.dir * (a.raid_nights_since_last_item - b.raid_nights_since_last_item);
  });

  var html =
    '<table class="roster-table"><thead><tr><th>Player</th><th>Last Award</th><th>Raid Nights Since</th></tr></thead><tbody>';
  sorted.forEach(function (r) {
    var nights = r.raid_nights_since_last_item;
    html +=
      '<tr><td>' +
      r.name_realm +
      '</td><td>' +
      (r.last_award_at ? new Date(r.last_award_at).toLocaleDateString() : 'Never') +
      '</td><td style="color:' +
      rnlsiSeverityColor(nights, maxNights) +
      ';font-weight:600;">' +
      nights +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// -- BiS demand vs awards --

function loadBisDemandReport() {
  var container = document.getElementById('reportsBisDemandContent');
  if (!supabaseClient) {
    container.innerHTML = '<p>Reports require Supabase, which is unavailable right now.</p>';
    return;
  }
  container.innerHTML = '<p style="color:var(--text-muted);">Loading...</p>';
  // team-read-guard: a view aggregated to one row per item on a BiS list.
  supabaseClient
    .from('bis_demand_vs_awards')
    .select('*')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        container.innerHTML = '<p style="color:var(--tank);">' + result.error.message + '</p>';
        return;
      }
      REPORTS_STATE.bisDemandRows = result.data || [];
      var select = document.getElementById('reportsBisSeasonFilter');
      var seasons = reportsUniqueSorted(
        REPORTS_STATE.bisDemandRows.map(function (r) {
          return r.season;
        })
      );
      var current = reportsCurrentSeasonCode();
      select.innerHTML = seasons
        .map(function (s) {
          return '<option value="' + s + '">' + reportsSeasonLabel(s) + '</option>';
        })
        .join('');
      if (seasons.indexOf(current) !== -1) select.value = current;
      renderBisDemandTable();
    });
}

function renderBisDemandTable() {
  var container = document.getElementById('reportsBisDemandContent');
  var select = document.getElementById('reportsBisSeasonFilter');
  var season = select.value;

  var byItem = {};
  REPORTS_STATE.bisDemandRows.forEach(function (r) {
    if (!byItem[r.item_id]) {
      byItem[r.item_id] = { item_name: r.item_name, slot: r.slot, demand_count: r.demand_count, awarded_count: 0 };
    }
    if (r.season === season) byItem[r.item_id].awarded_count = r.awarded_count;
  });
  var list = Object.keys(byItem).map(function (id) {
    return byItem[id];
  });
  if (!list.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No BiS demand recorded for the active roster.</p>';
    return;
  }
  list.sort(function (a, b) {
    return b.demand_count - a.demand_count || a.awarded_count - b.awarded_count;
  });

  var html =
    '<table class="roster-table"><thead><tr><th>Item</th><th>Slot</th><th>Demand</th><th>Awarded (' +
    (season ? reportsSeasonLabel(season) : 'no season selected') +
    ')</th></tr></thead><tbody>';
  list.forEach(function (it) {
    html +=
      '<tr><td>' +
      it.item_name +
      '</td><td>' +
      (it.slot || '') +
      '</td><td>' +
      it.demand_count +
      '</td><td>' +
      it.awarded_count +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// -- Priority order health --

function loadPriorityHealthReport() {
  var staleContainer = document.getElementById('reportsPriorityStaleContent');
  var gapsContainer = document.getElementById('reportsPriorityGapsContent');
  if (!supabaseClient) {
    staleContainer.innerHTML = '<p>Reports require Supabase, which is unavailable right now.</p>';
    gapsContainer.innerHTML = '';
    return;
  }
  staleContainer.innerHTML = '<p style="color:var(--text-muted);">Loading...</p>';
  gapsContainer.innerHTML = '';
  Promise.all([
    // team-read-guard: a view of stale ranked entries, far smaller than the table.
    supabaseClient.from('priority_order_stale_entries').select('*').eq('team_id', _teamCfg.supabaseTeamId),
    // team-read-guard: a view of ranked items missing a priority, far smaller than the table.
    supabaseClient.from('priority_order_gaps').select('*').eq('team_id', _teamCfg.supabaseTeamId),
    // team-read-guard: a view of stale ranked entries, far smaller than the table.
    supabaseClient.from('priority_order_stale_after_heroic').select('*').eq('team_id', _teamCfg.supabaseTeamId)
  ]).then(function (results) {
    if (results[0].error || results[1].error || results[2].error) {
      staleContainer.innerHTML =
        '<p style="color:var(--tank);">' + (results[0].error || results[1].error || results[2].error).message + '</p>';
      return;
    }
    REPORTS_STATE.staleRows = results[0].data || [];
    REPORTS_STATE.gapRows = results[1].data || [];
    REPORTS_STATE.staleAfterHeroicRows = results[2].data || [];
    var select = document.getElementById('reportsPriorityHealthSeasonFilter');
    var seasons = reportsUniqueSorted(
      REPORTS_STATE.staleRows
        .map(function (r) {
          return r.season;
        })
        .concat(
          REPORTS_STATE.gapRows.map(function (r) {
            return r.season;
          })
        )
        .concat(
          REPORTS_STATE.staleAfterHeroicRows.map(function (r) {
            return r.season;
          })
        )
    );
    var current = reportsCurrentSeasonCode();
    select.innerHTML = seasons
      .map(function (s) {
        return '<option value="' + s + '">' + reportsSeasonLabel(s) + '</option>';
      })
      .join('');
    if (seasons.indexOf(current) !== -1) select.value = current;
    renderPriorityHealthTables();
  });
}

function renderPriorityHealthTables() {
  var season = document.getElementById('reportsPriorityHealthSeasonFilter').value;
  var staleContainer = document.getElementById('reportsPriorityStaleContent');
  var gapsContainer = document.getElementById('reportsPriorityGapsContent');

  var stale = REPORTS_STATE.staleRows.filter(function (r) {
    return r.season === season;
  });
  if (!stale.length) {
    staleContainer.innerHTML = '<p style="color:var(--text-muted);">No stale entries for this season.</p>';
  } else {
    var staleHtml =
      '<table class="roster-table"><thead><tr><th>Item</th><th>Track</th><th>Rank</th><th>Player</th></tr></thead><tbody>';
    stale.forEach(function (r) {
      staleHtml +=
        '<tr><td>' +
        r.item_name +
        '</td><td>' +
        r.track +
        '</td><td>' +
        r.rank +
        '</td><td>' +
        r.name_realm +
        '</td></tr>';
    });
    staleHtml += '</tbody></table>';
    staleContainer.innerHTML = staleHtml;
  }

  var gaps = REPORTS_STATE.gapRows.filter(function (r) {
    return r.season === season;
  });
  if (!gaps.length) {
    gapsContainer.innerHTML = '<p style="color:var(--text-muted);">No gaps for this season.</p>';
  } else {
    var gapsHtml = '<table class="roster-table"><thead><tr><th>Player</th></tr></thead><tbody>';
    gaps.forEach(function (r) {
      gapsHtml += '<tr><td>' + r.name_realm + '</td></tr>';
    });
    gapsHtml += '</tbody></table>';
    gapsContainer.innerHTML = gapsHtml;
  }

  var staleAfterHeroicContainer = document.getElementById('reportsPriorityStaleAfterHeroicContent');
  var staleAfterHeroic = (REPORTS_STATE.staleAfterHeroicRows || []).filter(function (r) {
    return r.season === season;
  });
  if (!staleAfterHeroic.length) {
    staleAfterHeroicContainer.innerHTML = '<p style="color:var(--text-muted);">No flagged entries for this season.</p>';
  } else {
    var staleAfterHeroicHtml =
      '<table class="roster-table"><thead><tr><th>Item</th><th>Player</th></tr></thead><tbody>';
    staleAfterHeroic.forEach(function (r) {
      staleAfterHeroicHtml += '<tr><td>' + r.item_name + '</td><td>' + r.name_realm + '</td></tr>';
    });
    staleAfterHeroicHtml += '</tbody></table>';
    staleAfterHeroicContainer.innerHTML = staleAfterHeroicHtml;
  }
}

// -- Season loot pace --

function loadLootPaceReport() {
  var container = document.getElementById('reportsPaceContent');
  if (!supabaseClient) {
    container.innerHTML = '<p>Reports require Supabase, which is unavailable right now.</p>';
    return;
  }
  container.innerHTML = '<p style="color:var(--text-muted);">Loading...</p>';
  // team-read-guard: a view aggregated to one row per player per week.
  supabaseClient
    .from('season_loot_pace')
    .select('*')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        container.innerHTML = '<p style="color:var(--tank);">' + result.error.message + '</p>';
        return;
      }
      REPORTS_STATE.lootPaceRows = result.data || [];
      var seasonSelect = document.getElementById('reportsPaceSeasonFilter');
      var slotSelect = document.getElementById('reportsPaceSlotFilter');
      var seasons = reportsUniqueSorted(
        REPORTS_STATE.lootPaceRows.map(function (r) {
          return r.season;
        })
      );
      var slots = reportsUniqueSorted(
        REPORTS_STATE.lootPaceRows.map(function (r) {
          return r.slot;
        })
      );
      var current = reportsCurrentSeasonCode();
      seasonSelect.innerHTML = seasons
        .map(function (s) {
          return '<option value="' + s + '">' + reportsSeasonLabel(s) + '</option>';
        })
        .join('');
      if (seasons.indexOf(current) !== -1) seasonSelect.value = current;
      slotSelect.innerHTML =
        '<option value="">All Slots</option>' +
        slots
          .map(function (s) {
            return '<option value="' + s + '">' + s + '</option>';
          })
          .join('');
      renderLootPaceTable();
    });
}

function renderLootPaceTable() {
  var container = document.getElementById('reportsPaceContent');
  var seasons = reportsUniqueSorted(
    REPORTS_STATE.lootPaceRows.map(function (r) {
      return r.season;
    })
  );
  var season = document.getElementById('reportsPaceSeasonFilter').value;
  var track = document.getElementById('reportsPaceTrackFilter').value;
  var slot = document.getElementById('reportsPaceSlotFilter').value;
  var seasonIdx = seasons.indexOf(season);
  var prevSeason = seasonIdx > 0 ? seasons[seasonIdx - 1] : null;

  function filterRows(s) {
    return REPORTS_STATE.lootPaceRows.filter(function (r) {
      return r.season === s && (!track || r.track === track) && (!slot || r.slot === slot);
    });
  }
  function weeklyTotals(list) {
    var map = {};
    list.forEach(function (r) {
      map[r.season_week] = (map[r.season_week] || 0) + r.items_awarded;
    });
    return map;
  }

  var curMap = weeklyTotals(filterRows(season));
  var prevMap = prevSeason ? weeklyTotals(filterRows(prevSeason)) : {};
  var weeks = reportsUniqueSorted(
    Object.keys(curMap).map(Number).concat(Object.keys(prevMap).map(Number)),
    function (a, b) {
      return a - b;
    }
  );

  if (!weeks.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No loot awarded yet for this filter.</p>';
    return;
  }

  var html =
    '<table class="roster-table"><thead><tr><th>Week</th><th>' +
    (season ? reportsSeasonLabel(season) : 'Selected Season') +
    '</th><th>' +
    (prevSeason ? reportsSeasonLabel(prevSeason) : 'Previous Season') +
    '</th></tr></thead><tbody>';
  weeks.forEach(function (w) {
    html +=
      '<tr><td>Week ' +
      w +
      '</td><td>' +
      (curMap[w] || 0) +
      '</td><td>' +
      (prevSeason ? prevMap[w] || 0 : '&mdash;') +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// -- Tier set progress --
// No fetch needed, unlike the reports above -- js/common.js's roster load
// already carries tierPiecesEquipped/tierPiecesSyncedAt on every DATA.roster
// player (synced separately via Sync Roster Tier Counts, tab-priority.js).
// This just renders what's already in memory.

function loadTierSetReport() {
  renderTierSetTable();
}

function toggleTierSetRole(role) {
  REPORTS_STATE.tierSetRoleFilter = REPORTS_STATE.tierSetRoleFilter === role ? null : role;
  ['Tank', 'Heal', 'Melee', 'Ranged'].forEach(function (r) {
    document.getElementById('tierSet-chip-role-' + r).classList.toggle('active', REPORTS_STATE.tierSetRoleFilter === r);
  });
  renderTierSetTable();
}

function toggleTierSetSort(key) {
  var sort = REPORTS_STATE.tierSetSort;
  if (sort.key === key) sort.dir *= -1;
  else {
    sort.key = key;
    sort.dir = key === 'syncedAt' ? -1 : 1;
  }
  ['player', 'count', 'syncedAt'].forEach(function (k) {
    var chip = document.getElementById('tierSet-chip-sort-' + k);
    var isActive = sort.key === k;
    chip.classList.toggle('active', isActive);
    chip.textContent =
      { player: 'Player', count: 'Tier Count', syncedAt: 'Last Synced' }[k] +
      (isActive ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');
  });
  renderTierSetTable();
}

// Low count is the concerning end (not yet geared into tier), so the color
// scale runs the opposite direction from rnlsiSeverityColor's "high is bad".
function tierCountColor(count) {
  if (count == null) return 'var(--text-muted)';
  if (count <= 1) return 'var(--melee)';
  if (count <= 3) return 'var(--gold-light)';
  return 'var(--heal)';
}

function renderTierSetTable() {
  var container = document.getElementById('reportsTierSetContent');
  if (!container) return;
  var roster = (window.DATA && DATA.roster) || [];
  if (!roster.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No active roster players found.</p>';
    return;
  }

  var filtered = REPORTS_STATE.tierSetRoleFilter
    ? roster.filter(function (p) {
        return p.role === REPORTS_STATE.tierSetRoleFilter;
      })
    : roster;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No players in this role.</p>';
    return;
  }

  var sort = REPORTS_STATE.tierSetSort;
  var sorted = filtered.slice().sort(function (a, b) {
    if (sort.key === 'player') return sort.dir * a.nameRealm.localeCompare(b.nameRealm);
    if (sort.key === 'syncedAt') {
      var at = a.tierPiecesSyncedAt ? new Date(a.tierPiecesSyncedAt).getTime() : -Infinity;
      var bt = b.tierPiecesSyncedAt ? new Date(b.tierPiecesSyncedAt).getTime() : -Infinity;
      return sort.dir * (at - bt);
    }
    // Never-synced (null) sorts as -1 so it doesn't masquerade as 0/5 (fully
    // missing) among players who've actually been checked and have 0.
    var ac = a.tierPiecesEquipped == null ? -1 : a.tierPiecesEquipped;
    var bc = b.tierPiecesEquipped == null ? -1 : b.tierPiecesEquipped;
    return sort.dir * (ac - bc);
  });

  var html =
    '<table class="roster-table"><thead><tr><th>Player</th><th>Class / Spec</th><th>Tier Count</th><th>Last Synced</th></tr></thead><tbody>';
  sorted.forEach(function (p) {
    var count = p.tierPiecesEquipped;
    html +=
      '<tr><td>' +
      (p.nick || p.firstName) +
      '</td><td style="color:' +
      classColor(p.class) +
      ';">' +
      p.class +
      ' &middot; ' +
      p.spec +
      '</td><td style="color:' +
      tierCountColor(count) +
      ';font-weight:600;">' +
      (count == null ? 'Not synced' : count + '/5') +
      '</td><td>' +
      (p.tierPiecesSyncedAt ? new Date(p.tierPiecesSyncedAt).toLocaleDateString() : 'Never') +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}
