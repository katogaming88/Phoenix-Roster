// Audit Log tab (#378, split from #215). Reads live from Supabase's
// audit_log instead of the legacy GAS ?action=getAuditLog JSONP endpoint.
// Columns collapse the old From/To pair into a single human-readable
// DETAIL column (#214/#377 write the summary string convention detail
// already holds, plus the jsonb objects set_team_setting() started writing
// with #232); CHANGED BY resolves actor_id through resolve_actor_name()
// (#376) instead of a raw uuid.
var _auditEntries = [];

// Known short keys that don't title-case cleanly on their own (bis -> BiS,
// not Bis; mplus -> M+, not Mplus).
var AUDIT_DETAIL_LABELS = { bis: 'BiS', mplus: 'M+' };

function humanizeAuditKey(key) {
  if (AUDIT_DETAIL_LABELS[key]) return AUDIT_DETAIL_LABELS[key];
  var spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeAuditValue(v) {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  // A diff value that's an array (bios lists, seasonHistory, raidProgression,
  // etc.) isn't meaningful to spell out item-by-item in a one-line summary --
  // String() on an array of objects renders "[object Object]" per element,
  // which is what this used to fall through to.
  if (Array.isArray(v)) return v.length + ' item' + (v.length === 1 ? '' : 's');
  return String(v);
}

// Flattens nested objects to just their leaf key/value pairs -- a feature
// flag diff like {features: {bench: false}} renders as "Bench: Off" rather
// than repeating the (here, uninformative) parent key name.
function humanizeAuditEntries(obj, out) {
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      humanizeAuditEntries(v, out);
    } else {
      out.push(humanizeAuditKey(k) + ': ' + humanizeAuditValue(v));
    }
  });
}

function formatAuditDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  var out = [];
  humanizeAuditEntries(detail, out);
  return out.join(', ');
}

function buildAuditTab() {
  var container = document.getElementById('auditContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading audit log...</p>';
  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  var teamId = _teamCfg.supabaseTeamId;
  // audit_log only ever grows: every officer action appends a row and nothing
  // prunes it. Team 1 was at 944 of the 1000-row cap when this was paged
  // (#707), so the oldest entries were about to start disappearing from the
  // log with no error. Keyset paging orders by id, so the newest-first order
  // this view wants is applied to the collected rows below.
  fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('audit_log')
        .select(
          'id, actor_id, action, target_type, target_id, detail, created_at',
          afterId === null ? { count: 'exact' } : undefined
        )
        .eq('team_id', teamId)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'audit log' }
  ).then(function (collected) {
    if (collected === null) {
      container.innerHTML =
        '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Could not load the audit log.</p>';
      return;
    }
    var rows = collected.slice().sort(function (a, b) {
      if (a.created_at === b.created_at) return b.id - a.id;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return Promise.all([resolveAuditActorNames(rows, teamId), resolveAuditTargetNames(rows, teamId)]).then(
      function (maps) {
        var actorNames = maps[0];
        var targetNames = maps[1];
        _auditEntries = rows.map(function (row) {
          return {
            ts: row.created_at,
            changedBy: row.actor_id ? actorNames[row.actor_id] || '' : '',
            action: row.action || '',
            target: auditTargetName(row, targetNames),
            detail: formatAuditDetail(row.detail)
          };
        });
        renderAuditLog();
      }
    );
  });
}

// Resolves each distinct actor_id through resolve_actor_name() (#376). A
// failed lookup (e.g. the caller isn't authorized for this team, or the
// actor no longer resolves to anything) degrades to a blank name rather
// than blocking the rest of the tab from rendering.
function resolveAuditActorNames(rows, teamId) {
  var ids = auditUniqueNonNull(
    rows.map(function (r) {
      return r.actor_id;
    })
  );
  if (!ids.length) return Promise.resolve({});
  return Promise.all(
    ids.map(function (id) {
      return supabaseClient.rpc('resolve_actor_name', { p_actor_id: id, p_team_id: teamId }).then(function (result) {
        return { id: id, name: result.error ? '' : result.data || '' };
      });
    })
  ).then(function (results) {
    var map = {};
    results.forEach(function (r) {
      map[r.id] = r.name;
    });
    return map;
  });
}

// TARGET only resolves for target_type = 'players' today -- no officer
// write flow calls write_audit_log() with any other target_type yet
// (Phase 5 work). Extend this when a new target_type shows up in practice
// instead of guessing at a generic resolver now.
function resolveAuditTargetNames(rows, teamId) {
  var ids = auditUniqueNonNull(
    rows
      .filter(function (r) {
        return r.target_type === 'players' && r.target_id != null;
      })
      .map(function (r) {
        return r.target_id;
      })
  );
  if (!ids.length) return Promise.resolve({});
  // team-read-guard: one row per roster member, 80 on the largest team.
  return supabaseClient
    .from('players')
    .select('id, name_realm')
    .eq('team_id', teamId)
    .in('id', ids)
    .then(function (result) {
      var map = {};
      (result.data || []).forEach(function (p) {
        map[p.id] = p.name_realm;
      });
      return map;
    });
}

function auditTargetName(row, targetNames) {
  if (row.target_type === 'players' && row.target_id != null) {
    return targetNames[row.target_id] || '';
  }
  return '';
}

function auditUniqueNonNull(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function (v) {
    if (v == null || seen[v]) return;
    seen[v] = true;
    out.push(v);
  });
  return out;
}

function renderAuditLog() {
  var search = (document.getElementById('auditSearch') || {}).value || '';
  var searchLow = search.trim().toLowerCase();
  var container = document.getElementById('auditContainer');
  if (!container) return;

  var entries = searchLow
    ? _auditEntries.filter(function (e) {
        return (
          (e.changedBy || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.action || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.target || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.detail || '').toLowerCase().indexOf(searchLow) !== -1
        );
      })
    : _auditEntries;

  if (!entries.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">' +
      (searchLow ? 'No entries match your search.' : 'No audit log entries yet.') +
      '</p>';
    return;
  }

  var rows = entries
    .map(function (e) {
      return (
        '<tr>' +
        '<td class="audit-ts">' +
        escHtml(auditFormatTs(e.ts)) +
        '</td>' +
        '<td class="audit-changedby">' +
        escHtml(e.changedBy) +
        '</td>' +
        '<td class="audit-action">' +
        escHtml(e.action) +
        '</td>' +
        '<td class="audit-target">' +
        escHtml(e.target) +
        '</td>' +
        '<td class="audit-detail">' +
        escHtml(e.detail) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  container.innerHTML =
    '<div style="font-size:1rem;color:var(--text-muted);margin-bottom:0.75rem;">' +
    entries.length +
    ' entr' +
    (entries.length !== 1 ? 'ies' : 'y') +
    '</div>' +
    '<div style="overflow-x:auto;">' +
    '<table class="roster-table audit-table" style="width:100%;">' +
    '<thead><tr>' +
    '<th style="white-space:nowrap;">Time</th>' +
    '<th>Changed By</th>' +
    '<th>Action</th>' +
    '<th>Target</th>' +
    '<th>Detail</th>' +
    '</tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody>' +
    '</table></div>';
}

// created_at arrives as an ISO timestamptz string; format it the same
// 'yyyy-MM-dd HH:mm' shape the old sheet-backed getAuditLog() used, in the
// viewer's local time.
function auditFormatTs(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}
