// Officer Raid Schedule admin tab (#894, part of #640, Phase 3). Direct
// authenticated .from(...).update()/.insert()/.delete() under RLS, matching
// updateRosterFieldSupabase()'s convention (js/tabs/tab-roster.js) rather
// than adding RPC wrappers -- writes here are officer-only table edits, the
// same shape as the rest of officer tooling.
//
// Two sub-sections: the recurring weekly rule (raid_schedule, one row per
// weekday/time this team normally raids) and one-off exceptions
// (raid_schedule_exceptions, cancel a normally-scheduled night or add an
// extra one). js/calendar.js's computeRaidNights() reads both tables
// straight from Supabase, so a save here shows up on the calendar on next
// load with no other change needed.

var SCHEDULE_RULES = [];
var SCHEDULE_EXCEPTIONS = [];

var _SCHED_WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Local copy of js/calendar.js's _calIsoDate -- officer.html doesn't load
// calendar.js (it's raider-facing, Home/calendar.html only), so this tab
// doesn't depend on it just for one date-formatting helper.
function _schedIsoDate(d) {
  var mm = String(d.getMonth() + 1);
  if (mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function buildScheduleTab() {
  var wrap = document.getElementById('scheduleRulesWrap');
  var excWrap = document.getElementById('scheduleExceptionsWrap');
  if (!wrap && !excWrap) return;
  if (wrap) wrap.innerHTML = '<p style="font-size:1rem;color:var(--text-muted);">Loading...</p>';
  if (excWrap) excWrap.innerHTML = '';

  // team-read-guard: one row per weekday/time slot a team raids (UNIQUE on
  // team_id/weekday/start_time), nowhere near the 1000-row cap.
  supabaseClient
    .from('raid_schedule')
    .select('id, weekday, start_time, timezone, duration_minutes, active, is_optional')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .order('weekday')
    .then(function (result) {
      if (result.error) {
        if (wrap)
          wrap.innerHTML =
            '<p style="color:var(--melee);">Error loading schedule: ' + _esc(result.error.message) + '</p>';
        return;
      }
      SCHEDULE_RULES = result.data || [];
      renderScheduleRules();
    });

  // Only exceptions from today forward -- past ones are dead weight for an
  // officer editing the schedule, and there's no cleanup job for them (v1
  // accepted gap, see docs/database-decisions.md).
  // team-read-guard: bounded to today-forward exceptions only, well under
  // the 1000-row cap for any team's realistic one-off schedule changes.
  supabaseClient
    .from('raid_schedule_exceptions')
    .select('id, raid_date, exception_type, start_time, duration_minutes, is_optional, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .gte('raid_date', _schedIsoDate(new Date()))
    .order('raid_date')
    .then(function (result) {
      if (result.error) {
        if (excWrap)
          excWrap.innerHTML =
            '<p style="color:var(--melee);">Error loading exceptions: ' + _esc(result.error.message) + '</p>';
        return;
      }
      SCHEDULE_EXCEPTIONS = result.data || [];
      renderScheduleExceptions();
    });
}

function _schedTimeInputValue(t) {
  // Postgres `time` comes back as "HH:MM:SS" -- <input type=time> wants "HH:MM".
  return (t || '').slice(0, 5);
}

function renderScheduleRules() {
  var wrap = document.getElementById('scheduleRulesWrap');
  if (!wrap) return;
  if (!SCHEDULE_RULES.length) {
    wrap.innerHTML = '<p style="font-size:1rem;color:var(--text-muted);">No weekly raid nights set yet.</p>';
  } else {
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.97rem;">';
    html +=
      '<thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">';
    html += '<th style="padding:0.2rem 0.5rem 0.2rem 0;">Day</th>';
    html += '<th style="padding:0.2rem 0.5rem;">Start Time</th>';
    html += '<th style="padding:0.2rem 0.5rem;">Duration (min)</th>';
    html += '<th style="padding:0.2rem 0.5rem;">Timezone</th>';
    html += '<th style="padding:0.2rem 0.5rem;">Optional</th>';
    html += '<th style="padding:0.2rem 0.5rem;">Active</th>';
    html += '<th style="padding:0.2rem 0;"></th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < SCHEDULE_RULES.length; i++) {
      var r = SCHEDULE_RULES[i];
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);" data-rule-id="' + r.id + '">';
      html += '<td style="padding:0.25rem 0.5rem 0.25rem 0;">';
      html += '<select class="add-player-input sched-rule-weekday" style="font-size:0.97rem;padding:0.25rem 0.4rem;">';
      for (var w = 0; w < 7; w++) {
        html +=
          '<option value="' +
          w +
          '"' +
          (w === r.weekday ? ' selected' : '') +
          '>' +
          _SCHED_WEEKDAY_LABELS[w] +
          '</option>';
      }
      html += '</select></td>';
      html +=
        '<td style="padding:0.25rem 0.5rem;"><input type="time" class="add-player-input sched-rule-start" value="' +
        _escAttr(_schedTimeInputValue(r.start_time)) +
        '" style="font-size:0.97rem;padding:0.25rem 0.4rem;"></td>';
      html +=
        '<td style="padding:0.25rem 0.5rem;"><input type="number" min="15" step="15" class="add-player-input sched-rule-duration" value="' +
        _escAttr(r.duration_minutes) +
        '" style="width:70px;font-size:0.97rem;padding:0.25rem 0.4rem;"></td>';
      html +=
        '<td style="padding:0.25rem 0.5rem;"><input type="text" class="add-player-input sched-rule-timezone" value="' +
        _escAttr(r.timezone) +
        '" style="width:150px;font-size:0.97rem;padding:0.25rem 0.4rem;"></td>';
      html +=
        '<td style="padding:0.25rem 0.5rem;"><input type="checkbox" class="sched-rule-optional"' +
        (r.is_optional ? ' checked' : '') +
        '></td>';
      html +=
        '<td style="padding:0.25rem 0.5rem;"><input type="checkbox" class="sched-rule-active"' +
        (r.active ? ' checked' : '') +
        '></td>';
      html += '<td style="padding:0.25rem 0;white-space:nowrap;">';
      html +=
        '<button class="btn btn-muted" style="font-size:0.91rem;padding:2px 10px;" onclick="saveScheduleRule(' +
        r.id +
        ')">Save</button> ';
      html +=
        '<button class="btn btn-danger" style="font-size:0.91rem;padding:2px 10px;" onclick="deleteScheduleRule(' +
        r.id +
        ')">Remove</button>';
      html += '</td></tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }
  var status = document.getElementById('scheduleRuleStatus');
  if (status) status.textContent = '';
}

function addScheduleRule() {
  var btn = document.getElementById('scheduleRuleAddBtn');
  var status = document.getElementById('scheduleRuleStatus');
  if (btn) btn.disabled = true;
  supabaseClient
    .from('raid_schedule')
    .insert({ team_id: _teamCfg.supabaseTeamId, weekday: 0, start_time: '20:00:00', duration_minutes: 180 })
    .select('id, weekday, start_time, timezone, duration_minutes, active, is_optional')
    .then(function (result) {
      if (btn) btn.disabled = false;
      if (result.error) {
        if (status) status.textContent = result.error.message;
        return;
      }
      SCHEDULE_RULES.push(result.data[0]);
      renderScheduleRules();
      writeAuditLog('Raid Schedule Added', 'raid_schedule', result.data[0].id, _SCHED_WEEKDAY_LABELS[0] + ' 8:00 PM');
    });
}

function saveScheduleRule(id) {
  var row = document.querySelector('tr[data-rule-id="' + id + '"]');
  if (!row) return;
  var weekday = parseInt(row.querySelector('.sched-rule-weekday').value, 10);
  var startTime = row.querySelector('.sched-rule-start').value;
  var duration = parseInt(row.querySelector('.sched-rule-duration').value, 10);
  var timezone = row.querySelector('.sched-rule-timezone').value.trim();
  var isOptional = row.querySelector('.sched-rule-optional').checked;
  var active = row.querySelector('.sched-rule-active').checked;
  var status = document.getElementById('scheduleRuleStatus');

  if (!startTime || !duration || !timezone) {
    if (status) status.textContent = 'Start time, duration, and timezone are all required.';
    return;
  }

  supabaseClient
    .from('raid_schedule')
    .update({
      weekday: weekday,
      start_time: startTime,
      duration_minutes: duration,
      timezone: timezone,
      is_optional: isOptional,
      active: active
    })
    .eq('id', id)
    .then(function (result) {
      if (result.error) {
        if (status) status.textContent = result.error.message;
        return;
      }
      var idx = SCHEDULE_RULES.findIndex(function (r) {
        return r.id === id;
      });
      if (idx !== -1) {
        SCHEDULE_RULES[idx] = {
          id: id,
          weekday: weekday,
          start_time: startTime,
          duration_minutes: duration,
          timezone: timezone,
          is_optional: isOptional,
          active: active
        };
      }
      if (status) {
        status.textContent = 'Saved.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
      writeAuditLog(
        'Raid Schedule Updated',
        'raid_schedule',
        id,
        _SCHED_WEEKDAY_LABELS[weekday] +
          ' ' +
          startTime +
          (isOptional ? ' (optional)' : '') +
          (active ? '' : ' (inactive)')
      );
    });
}

function deleteScheduleRule(id) {
  if (!confirm('Remove this weekly raid night? Raiders will stop seeing it on the calendar going forward.')) return;
  supabaseClient
    .from('raid_schedule')
    .delete()
    .eq('id', id)
    .then(function (result) {
      var status = document.getElementById('scheduleRuleStatus');
      if (result.error) {
        if (status) status.textContent = result.error.message;
        return;
      }
      SCHEDULE_RULES = SCHEDULE_RULES.filter(function (r) {
        return r.id !== id;
      });
      renderScheduleRules();
      writeAuditLog('Raid Schedule Removed', 'raid_schedule', id, null);
    });
}

function renderScheduleExceptions() {
  var wrap = document.getElementById('scheduleExceptionsWrap');
  if (!wrap) return;
  if (!SCHEDULE_EXCEPTIONS.length) {
    wrap.innerHTML =
      '<p style="font-size:1rem;color:var(--text-muted);">No upcoming cancellations or extra nights.</p>';
    return;
  }
  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.97rem;">';
  html += '<thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">';
  html += '<th style="padding:0.2rem 0.5rem 0.2rem 0;">Date</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Type</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Start Time</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Duration</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Optional</th>';
  html += '<th style="padding:0.2rem 0.5rem;">Note</th>';
  html += '<th style="padding:0.2rem 0;"></th>';
  html += '</tr></thead><tbody>';
  for (var i = 0; i < SCHEDULE_EXCEPTIONS.length; i++) {
    var ex = SCHEDULE_EXCEPTIONS[i];
    var isAdded = ex.exception_type === 'added';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
    html += '<td style="padding:0.2rem 0.5rem 0.2rem 0;color:var(--text);">' + _esc(ex.raid_date) + '</td>';
    html +=
      '<td style="padding:0.2rem 0.5rem;color:' +
      (isAdded ? 'var(--heal)' : 'var(--melee)') +
      ';">' +
      (isAdded ? 'Added' : 'Cancelled') +
      '</td>';
    html +=
      '<td style="padding:0.2rem 0.5rem;color:var(--text-muted);">' +
      (isAdded ? _esc(_schedTimeInputValue(ex.start_time)) : '-') +
      '</td>';
    html +=
      '<td style="padding:0.2rem 0.5rem;color:var(--text-muted);">' +
      (isAdded ? _esc(ex.duration_minutes) : '-') +
      '</td>';
    html +=
      '<td style="padding:0.2rem 0.5rem;color:var(--text-muted);">' +
      (isAdded && ex.is_optional ? 'Yes' : '-') +
      '</td>';
    html += '<td style="padding:0.2rem 0.5rem;color:var(--text-muted);">' + _esc(ex.note || '-') + '</td>';
    html +=
      '<td style="padding:0.2rem 0;"><button class="btn btn-danger" style="font-size:0.91rem;padding:2px 10px;" onclick="deleteScheduleException(' +
      ex.id +
      ')">Remove</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function addScheduleException(type) {
  var dateInput = document.getElementById('schedExcDateInput');
  var startInput = document.getElementById('schedExcStartInput');
  var durationInput = document.getElementById('schedExcDurationInput');
  var optionalInput = document.getElementById('schedExcOptionalInput');
  var noteInput = document.getElementById('schedExcNoteInput');
  var status = document.getElementById('scheduleExceptionStatus');

  var date = dateInput ? dateInput.value : '';
  if (!date) {
    if (status) status.textContent = 'Pick a date first.';
    return;
  }
  var isAdded = type === 'added';
  if (isAdded && (!startInput.value || !durationInput.value)) {
    if (status) status.textContent = 'Start time and duration are required for an added night.';
    return;
  }

  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var row = {
    team_id: _teamCfg.supabaseTeamId,
    raid_date: date,
    exception_type: type,
    start_time: isAdded ? startInput.value : null,
    duration_minutes: isAdded ? parseInt(durationInput.value, 10) : null,
    is_optional: isAdded && optionalInput ? optionalInput.checked : false,
    note: (noteInput && noteInput.value.trim()) || null,
    created_by: session && session.teamMemberId ? session.teamMemberId : null
  };

  supabaseClient
    .from('raid_schedule_exceptions')
    .insert(row)
    .select('id, raid_date, exception_type, start_time, duration_minutes, is_optional, note')
    .then(function (result) {
      if (result.error) {
        if (status) status.textContent = result.error.message;
        return;
      }
      SCHEDULE_EXCEPTIONS.push(result.data[0]);
      SCHEDULE_EXCEPTIONS.sort(function (a, b) {
        return a.raid_date < b.raid_date ? -1 : a.raid_date > b.raid_date ? 1 : 0;
      });
      renderScheduleExceptions();
      if (dateInput) dateInput.value = '';
      if (startInput) startInput.value = '';
      if (durationInput) durationInput.value = '';
      if (optionalInput) optionalInput.checked = false;
      if (noteInput) noteInput.value = '';
      if (status) {
        status.textContent = 'Saved.';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2000);
      }
      writeAuditLog(
        isAdded ? 'Raid Night Added' : 'Raid Night Cancelled',
        'raid_schedule_exceptions',
        result.data[0].id,
        date
      );
    });
}

function deleteScheduleException(id) {
  supabaseClient
    .from('raid_schedule_exceptions')
    .delete()
    .eq('id', id)
    .then(function (result) {
      var status = document.getElementById('scheduleExceptionStatus');
      if (result.error) {
        if (status) status.textContent = result.error.message;
        return;
      }
      SCHEDULE_EXCEPTIONS = SCHEDULE_EXCEPTIONS.filter(function (ex) {
        return ex.id !== id;
      });
      renderScheduleExceptions();
      writeAuditLog('Raid Schedule Exception Removed', 'raid_schedule_exceptions', id, null);
    });
}
