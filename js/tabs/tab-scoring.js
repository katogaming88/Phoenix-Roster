// Team-scoped: this site serves multiple teams from one origin distinguished
// only by a ?team= query param, which sessionStorage knows nothing about.
// An unscoped key here leaked one team's cached WCL scores onto another
// team's Scoring tab after switching teams in the same session.
var _WCL_SCORES_KEY = 'wgaWclScores_' + TEAM_SLUG;

function _saveScoresCache(scores, statusText) {
  try {
    sessionStorage.setItem(_WCL_SCORES_KEY, JSON.stringify({ scores: scores, status: statusText, ts: Date.now() }));
  } catch (e) {}
}

function _loadScoresCache() {
  try {
    var raw = sessionStorage.getItem(_WCL_SCORES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var cached = _loadScoresCache();
  if (!cached || !cached.scores || !cached.scores.length) return;
  var status = document.getElementById('refreshPerfStatus');
  if (status) {
    var ago = Math.round((Date.now() - cached.ts) / 60000);
    var agoStr = ago < 1 ? 'just now' : ago === 1 ? '1 min ago' : ago + ' mins ago';
    status.textContent = (cached.status || '') + ' (cached ' + agoStr + ')';
    status.style.color = 'var(--text-muted)';
  }
  renderScoresTable(cached.scores);
});

function refreshWclPerformance() {
  var btn = document.getElementById('refreshPerfBtn');
  var status = document.getElementById('refreshPerfStatus');
  var progress = document.getElementById('refreshPerfProgress');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = 'Fetching from WCL...';
    status.style.color = 'var(--text-muted)';
  }
  if (progress) progress.classList.add('active');

  supabaseClient.functions
    .invoke('wcl-sync', { body: { action: 'refreshPerformance', teamId: _teamCfg.supabaseTeamId } })
    .then(function (res) {
      if (btn) btn.disabled = false;
      if (progress) progress.classList.remove('active');
      var result = res.data;
      if (!res.error && result && result.success) {
        var statusText =
          result.updated +
          ' player(s) updated (' +
          result.recentReports +
          ' recent / ' +
          result.trendReports +
          ' trend reports).';
        if (status) {
          status.textContent = statusText;
          status.style.color = 'var(--heal)';
        }
        var freshScores = (result.scores || []).map(function (s) {
          return Object.assign({}, s, { committed: false });
        });
        renderScoresTable(freshScores);
        _saveScoresCache(freshScores, statusText);
      } else {
        if (status) {
          status.textContent = res.error
            ? res.error.message
            : 'Error: ' + ((result && result.error) || 'Unknown error');
          status.style.color = 'var(--melee)';
        }
      }
    });
}

function renderScoresTable(scores) {
  var el = document.getElementById('scoringContent');
  if (!el) return;
  if (!scores.length) {
    el.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem 0;">No players found.</p>';
    return;
  }

  scores.sort(function (a, b) {
    if (a.manual && !b.manual) return 1;
    if (!a.manual && b.manual) return -1;
    if (a.noData && !b.noData) return 1;
    if (!a.noData && b.noData) return -1;
    return (b.recent || 0) - (a.recent || 0);
  });

  var rows = '';
  for (var i = 0; i < scores.length; i++) {
    var s = scores[i];
    var recentDisplay, recentColor;
    if (s.manual) {
      recentDisplay = s.role === 'healer' ? 'Excluded (Healer)' : 'Excluded (Tank)';
      recentColor = 'var(--text-muted)';
    } else if (s.noData) {
      recentDisplay = 'No data';
      recentColor = 'var(--melee)';
    } else if (s.usedTrend) {
      recentDisplay = (s.recent !== null ? s.recent.toFixed(2) : '--') + ' (trend fallback)';
      recentColor = '#b085f0';
    } else {
      recentDisplay = s.recent !== null ? s.recent.toFixed(2) : '--';
      recentColor = s.recent >= 7 ? 'var(--heal)' : s.recent >= 5 ? 'var(--gold)' : 'var(--text-dim)';
    }

    var trendDisplay = s.trend !== null && !s.manual ? s.trend.toFixed(2) : '--';
    var trendColor = 'var(--text-muted)';
    if (s.trend !== null && !s.manual) {
      trendColor = s.trend >= 7 ? 'var(--heal)' : s.trend >= 5 ? 'var(--gold)' : 'var(--text-dim)';
    }

    var bestDisplay = '--';
    var bestColor = 'var(--text-muted)';
    var hasBest = !s.manual && s.best !== null && s.best !== undefined;
    if (hasBest) {
      bestDisplay = s.best.toFixed(2);
      bestColor = s.best >= 7 ? 'var(--heal)' : s.best >= 5 ? 'var(--gold)' : 'var(--text-dim)';
    }

    var dataScore = s.recent !== null ? s.recent.toFixed(2) : '';
    var committedBadge = s.committed
      ? ' <span style="color:var(--heal);font-size:0.89rem;font-weight:400;opacity:0.85;">committed</span>'
      : '';
    var recentTd;
    if (s.manual) {
      recentTd =
        '<td style="padding:0.4rem 0.75rem;color:' + recentColor + ';font-weight:600;">' + recentDisplay + '</td>';
    } else {
      recentTd =
        '<td style="padding:0.4rem 0.75rem;color:' +
        recentColor +
        ';font-weight:600;cursor:pointer;" ' +
        'title="Click to edit manually" ' +
        'data-name="' +
        s.name +
        '" data-score="' +
        dataScore +
        '" ' +
        'onclick="editScoreCell(this)">' +
        recentDisplay +
        committedBadge +
        ' <span style="font-size:0.85rem;opacity:0.4;font-weight:400;">edit</span>' +
        '</td>';
    }

    var bestTd = hasBest
      ? '<td style="padding:0.4rem 0.75rem;color:' +
        bestColor +
        ';" data-name="' +
        s.name +
        '" data-best="' +
        s.best.toFixed(2) +
        '">' +
        bestDisplay +
        ' <span style="font-size:0.85rem;opacity:0.4;font-weight:400;cursor:pointer;" onclick="useBestScore(this.parentElement)">use</span>' +
        '</td>'
      : '<td style="padding:0.4rem 0.75rem;color:' + bestColor + ';">' + bestDisplay + '</td>';

    rows +=
      '<tr>' +
      '<td style="padding:0.4rem 0.75rem;font-weight:600;">' +
      s.name +
      '</td>' +
      recentTd +
      '<td style="padding:0.4rem 0.75rem;color:' +
      trendColor +
      ';">' +
      trendDisplay +
      '</td>' +
      bestTd +
      '</tr>';
  }

  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;margin-top:1rem;font-size:1.07rem;">' +
    '<thead><tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-size:0.93rem;text-transform:uppercase;letter-spacing:0.06em;">' +
    '<th style="padding:0.4rem 0.75rem;text-align:left;font-weight:500;">Player</th>' +
    '<th style="padding:0.4rem 0.75rem;text-align:left;font-weight:500;">Recent Score</th>' +
    '<th style="padding:0.4rem 0.75rem;text-align:left;font-weight:500;">Trend Score</th>' +
    '<th style="padding:0.4rem 0.75rem;text-align:left;font-weight:500;">Best Score (all)</th>' +
    '</tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody>' +
    '</table>';
}

function editScoreCell(el) {
  if (el.querySelector('input')) return;
  var playerName = el.getAttribute('data-name');
  var current = el.getAttribute('data-score') || '';
  var origHtml = el.innerHTML;
  var origColor = el.style.color;

  el.innerHTML =
    '<input type="number" step="0.01" min="0" max="10" value="' +
    current +
    '" style="width:80px;background:var(--surface);color:var(--text);border:1px solid var(--gold);' +
    'border-radius:3px;padding:0.15rem 0.3rem;font-size:1.02rem;" />';
  var input = el.querySelector('input');
  input.focus();
  input.select();

  function commit() {
    var raw = input.value.trim();
    if (raw === '' || isNaN(parseFloat(raw))) {
      el.innerHTML = origHtml;
      el.style.color = origColor;
      return;
    }
    var val = Math.round(parseFloat(raw) * 100) / 100;
    if (val < 0 || val > 10) {
      el.innerHTML = origHtml;
      el.style.color = origColor;
      return;
    }
    saveManualScore(playerName, val, el, origColor);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      input.blur();
    }
    if (e.key === 'Escape') {
      el.innerHTML = origHtml;
      el.style.color = origColor;
    }
  });
}

// Manual edits are pending-draft state only -- nothing is written to
// Supabase until "Commit" (executeCommitPerformance). GAS used to persist
// this to a sheet cell the app never read back, so there's no server round
// trip to replace here.
function saveManualScore(playerName, score, cellEl, origColor) {
  var scoreStr = score.toFixed(2);
  var color = score >= 7 ? 'var(--heal)' : score >= 5 ? 'var(--gold)' : 'var(--text-dim)';
  cellEl.setAttribute('data-score', scoreStr);
  cellEl.style.color = color;
  cellEl.innerHTML = scoreStr + ' <span style="font-size:0.85rem;opacity:0.4;font-weight:400;">edit</span>';
  var cached = _loadScoresCache();
  if (cached && cached.scores) {
    for (var ci = 0; ci < cached.scores.length; ci++) {
      if (cached.scores[ci].name.toLowerCase() === playerName.toLowerCase()) {
        cached.scores[ci].recent = score;
        cached.scores[ci].noData = false;
        cached.scores[ci].usedTrend = false;
        cached.scores[ci].committed = false;
        break;
      }
    }
    _saveScoresCache(cached.scores, cached.status);
  }
}

function useBestScore(bestCell) {
  var name = bestCell.getAttribute('data-name');
  var best = parseFloat(bestCell.getAttribute('data-best'));
  if (!name || isNaN(best)) return;

  var row = bestCell.parentElement;
  var recentCell = row.cells[1];
  if (!recentCell || recentCell.querySelector('input')) return;

  var origColor = recentCell.style.color;
  recentCell.setAttribute('data-name', name);
  recentCell.setAttribute('data-score', best.toFixed(2));
  saveManualScore(name, best, recentCell, origColor);
}

function confirmCommitPerformance() {
  var banner = document.getElementById('perfConfirmBanner');
  if (banner) banner.style.display = 'flex';
}

function cancelCommitPerformance() {
  var banner = document.getElementById('perfConfirmBanner');
  if (banner) banner.style.display = 'none';
}

function executeCommitPerformance() {
  cancelCommitPerformance();
  var btn = document.getElementById('commitPerfBtn');
  var status = document.getElementById('commitPerfStatus');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = 'Committing...';
    status.style.color = 'var(--text-muted)';
  }

  var cached = _loadScoresCache();
  var allScores = (cached && cached.scores) || [];
  var committable = allScores.filter(function (s) {
    return s.role !== 'tank' && !s.manual && !s.noData && s.recent !== null && s.recent !== undefined;
  });

  var season = window.DATA && DATA.seasonName ? seasonCodeForDisplay(DATA.seasonName.trim()) : '';
  var rows = committable.map(function (s) {
    return {
      player_id: s.playerId,
      season: season,
      recent_score: s.recent,
      trend_score: s.trend,
      best_score: s.best,
      performance_score: s.recent
    };
  });

  if (rows.length === 0) {
    if (btn) btn.disabled = false;
    if (status) {
      status.textContent = 'Nothing to commit.';
      status.style.color = 'var(--text-muted)';
    }
    return;
  }

  supabaseClient
    .from('scoring')
    .upsert(rows, { onConflict: 'player_id,season' })
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Performance Scores Committed', null, null, rows.length + ' players');
    })
    .then(function () {
      if (btn) btn.disabled = false;
      if (status) {
        status.textContent = rows.length + ' player(s) committed to Performance column.';
        status.style.color = 'var(--heal)';
      }
      allScores.forEach(function (s) {
        if (!s.manual && !s.noData && s.recent !== null) s.committed = true;
      });
      _saveScoresCache(allScores, cached.status);
      renderScoresTable(allScores);
      // A committed performance change can move a player in or out of a
      // saved priority order's top 3 -- check now so the Priority nav badge
      // reflects it immediately, same reasoning as tab-loot-import.js's
      // post-import refreshPriorityStaleBadge() call.
      if (typeof refreshPriorityDriftBadge === 'function') refreshPriorityDriftBadge();
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      if (status) {
        status.textContent = 'Error: ' + err.message;
        status.style.color = 'var(--melee)';
      }
    });
}
