// Raid calendar (#892, part of #640). Phase 1: schedule schema + a
// real-data, read-only calendar. Replaces the mock buildCalendarPreview()
// that lived on the redesign/visual-style-layout branch (js/roster.js,
// #864) -- same .mini-cal-* markup/CSS, real data instead of hardcoded
// weekdays and deterministic fake statuses.
//
// Raid nights are computed on the fly from raid_schedule (the recurring
// weekly rule) + raid_schedule_exceptions (one-off cancel/add), not stored
// as per-instance rows -- see the migration's header comment and
// docs/database-decisions.md for why.
//
// There is no per-viewer RSVP yet (that's #893/Phase 2), so each raid
// night's status dot represents the night as a whole, not "your" reply:
// Present (mandatory night, everyone but bench is assumed attending) or
// No Response (an optional night -- #895/Phase 4 -- where nobody has a
// default and every non-bench raider must explicitly respond once that
// phase ships). Once #893 lands, the compact/full widgets should start
// reading the signed-in raider's own raid_rsvps row here instead.

var _CAL_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var _CAL_STATUS_LABELS = { present: 'Present', pending: 'No Response' };

var _calDataCache = {};
var _calViewYear = null;
var _calViewMonth = null;

function _calIsoDate(d) {
  var mm = String(d.getMonth() + 1);
  if (mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function fetchSupabaseRaidSchedule() {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: raid_schedule is one row per weekday/time slot a team
  // raids (UNIQUE on team_id/weekday/start_time), nowhere near the 1000-row cap.
  return supabaseClient
    .from('raid_schedule')
    .select('weekday, start_time, duration_minutes, active, is_optional')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('active', true)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_schedule query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_schedule query failed.', err);
        return [];
      }
    );
}

function fetchSupabaseRaidScheduleExceptions(rangeStart, rangeEnd) {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: bounded to the one visible month below (rangeStart/
  // rangeEnd), well under the 1000-row cap -- unlike raid_schedule above,
  // this table is not bounded on its own (one row per exceptional date ever).
  return supabaseClient
    .from('raid_schedule_exceptions')
    .select('raid_date, exception_type, start_time, duration_minutes, is_optional, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .gte('raid_date', _calIsoDate(rangeStart))
    .lte('raid_date', _calIsoDate(rangeEnd))
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_schedule_exceptions query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_schedule_exceptions query failed.', err);
        return [];
      }
    );
}

// The recurring schedule is cached across the whole page view (rarely
// changes mid-session); exceptions are cached per visible month, since a
// new month means a new bounded fetch anyway.
function _loadCalendarScheduleData(rangeStart, rangeEnd) {
  var monthKey = rangeStart.getFullYear() + '-' + rangeStart.getMonth();
  if (_calDataCache[monthKey]) return _calDataCache[monthKey];
  var schedulePromise = (_calDataCache._schedule = _calDataCache._schedule || fetchSupabaseRaidSchedule());
  var promise = Promise.all([schedulePromise, fetchSupabaseRaidScheduleExceptions(rangeStart, rangeEnd)]).then(
    function (results) {
      return { scheduleRows: results[0], exceptionRows: results[1] };
    }
  );
  _calDataCache[monthKey] = promise;
  return promise;
}

/**
 * Computes the list of raid nights between rangeStart and rangeEnd
 * (inclusive, local dates) from a recurring weekly rule plus one-off
 * exceptions. A date can produce more than one night (multiple same-day
 * recurring rules, or a recurring night plus an added extra one), and a
 * 'cancelled' exception suppresses that date's recurring night(s) without
 * touching an 'added' one on the same date.
 * @param {any[]} scheduleRows
 * @param {any[]} exceptionRows
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {any[]} nights, each {date, startTime, durationMinutes, isOptional, isException, note}
 */
function computeRaidNights(scheduleRows, exceptionRows, rangeStart, rangeEnd) {
  var cancelledDates = {};
  var addedByDate = {};
  (exceptionRows || []).forEach(function (ex) {
    if (ex.exception_type === 'cancelled') cancelledDates[ex.raid_date] = true;
    else if (ex.exception_type === 'added') addedByDate[ex.raid_date] = ex;
  });

  var nights = [];
  var cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  var end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  while (cur <= end) {
    var dateStr = _calIsoDate(cur);
    var weekday = cur.getDay();
    if (!cancelledDates[dateStr]) {
      (scheduleRows || []).forEach(function (rule) {
        if (rule.weekday === weekday) {
          nights.push({
            date: dateStr,
            startTime: rule.start_time,
            durationMinutes: rule.duration_minutes,
            isOptional: !!rule.is_optional,
            isException: false
          });
        }
      });
    }
    var added = addedByDate[dateStr];
    if (added) {
      nights.push({
        date: dateStr,
        startTime: added.start_time,
        durationMinutes: added.duration_minutes,
        isOptional: !!added.is_optional,
        isException: true,
        note: added.note || ''
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return nights;
}

function _calNightsByDate(nights) {
  var byDate = {};
  nights.forEach(function (n) {
    (byDate[n.date] = byDate[n.date] || []).push(n);
  });
  return byDate;
}

/**
 * Renders one month grid into containerEl. opts.compact suppresses the
 * "(mock ...)" style extras that don't fit a Home-page glance -- currently
 * just controls whether the "View full calendar" link is appended, since
 * the mock's month-nav didn't exist at all yet for either mode in Phase 1.
 */
function _renderCalGrid(containerEl, year, month, nights, opts) {
  opts = opts || {};
  var today = new Date();
  var monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + year;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var firstWeekday = new Date(year, month, 1).getDay();
  var nightsByDate = _calNightsByDate(nights);
  var rosterCount = (window.DATA && DATA.roster && DATA.roster.length) || 0;
  var benchCount =
    (window.DATA &&
      DATA.roster &&
      DATA.roster.filter(function (p) {
        return p.isBench;
      }).length) ||
    0;
  var attending = Math.max(0, rosterCount - benchCount);

  var weekdayHtml = _CAL_WEEKDAY_LABELS
    .map(function (d) {
      return '<span class="mini-cal-weekday">' + d + '</span>';
    })
    .join('');

  var cellsHtml = '';
  for (var pad = 0; pad < firstWeekday; pad++) {
    cellsHtml += '<div class="mini-cal-day mini-cal-day-pad"></div>';
  }
  var usedStatuses = {};
  for (var day = 1; day <= daysInMonth; day++) {
    var cellDate = new Date(year, month, day);
    var dateStr = _calIsoDate(cellDate);
    var dayNights = nightsByDate[dateStr] || [];
    var isRaidDay = dayNights.length > 0;
    var isToday = _calIsoDate(today) === dateStr;
    var statusHtml = '';
    var countHtml = '';
    if (isRaidDay) {
      var anyOptional = dayNights.some(function (n) {
        return n.isOptional;
      });
      var status = anyOptional ? 'pending' : 'present';
      usedStatuses[status] = true;
      statusHtml =
        '<span class="calendar-status calendar-status-' +
        (status === 'pending' ? 'tentative' : 'present') +
        '" role="img" aria-label="' +
        _CAL_STATUS_LABELS[status] +
        '" title="' +
        _CAL_STATUS_LABELS[status] +
        '"></span>';
      if (rosterCount && status === 'present') {
        countHtml = '<span class="mini-cal-daycount">' + attending + '/' + rosterCount + '</span>';
      }
    }
    cellsHtml +=
      '<div class="mini-cal-day' +
      (isRaidDay ? ' mini-cal-day-raid' : '') +
      (isToday ? ' mini-cal-day-today' : '') +
      '"><span class="mini-cal-daynum">' +
      day +
      '</span>' +
      countHtml +
      statusHtml +
      '</div>';
  }

  var legendHtml = Object.keys(_CAL_STATUS_LABELS)
    .filter(function (status) {
      return usedStatuses[status];
    })
    .map(function (status) {
      return (
        '<span class="calendar-legend-item"><span class="calendar-status calendar-status-' +
        (status === 'pending' ? 'tentative' : 'present') +
        '" aria-hidden="true"></span>' +
        _CAL_STATUS_LABELS[status] +
        '</span>'
      );
    })
    .join('');
  if (benchCount) {
    legendHtml +=
      '<span class="calendar-legend-item">' + benchCount + ' on Bench (excluded from the count above)</span>';
  }

  var navHtml = opts.compact
    ? ''
    : '<div class="mini-cal-nav">' +
      '<button type="button" class="btn btn-muted mini-cal-nav-btn" onclick="_calNavMonth(-1)" aria-label="Previous month">&#8249;</button>' +
      '<button type="button" class="btn btn-muted mini-cal-nav-btn" onclick="_calNavMonth(1)" aria-label="Next month">&#8250;</button>' +
      '</div>';

  containerEl.innerHTML =
    '<div class="pub-loot-title">Calendar' +
    (opts.compact ? '' : ' -- ' + TEAM_NAME) +
    '</div>' +
    '<div class="mini-cal">' +
    '<div class="mini-cal-header">' +
    navHtml +
    '<span>' +
    monthLabel +
    '</span>' +
    '</div>' +
    '<div class="mini-cal-weekdays">' +
    weekdayHtml +
    '</div>' +
    '<div class="mini-cal-grid">' +
    cellsHtml +
    '</div>' +
    '</div>' +
    '<div class="calendar-legend">' +
    legendHtml +
    '</div>' +
    (opts.compact
      ? '<a class="footer-link" href="calendar.html' +
        (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG : '') +
        '">View full calendar &#8250;</a>'
      : '');
}

/**
 * mode: 'compact' (Home widget, #landingCalendar) or 'full' (calendar.html,
 * #fullCalendar, with month prev/next via _calNavMonth()).
 */
function buildCalendarWidget(mode) {
  var containerId = mode === 'full' ? 'fullCalendar' : 'landingCalendar';
  var el = document.getElementById(containerId);
  if (!el) return;

  var today = new Date();
  if (_calViewYear === null) {
    _calViewYear = today.getFullYear();
    _calViewMonth = today.getMonth();
  }
  var year = mode === 'full' ? _calViewYear : today.getFullYear();
  var month = mode === 'full' ? _calViewMonth : today.getMonth();

  var rangeStart = new Date(year, month, 1);
  var rangeEnd = new Date(year, month + 1, 0);
  _loadCalendarScheduleData(rangeStart, rangeEnd).then(function (data) {
    var nights = computeRaidNights(data.scheduleRows, data.exceptionRows, rangeStart, rangeEnd);
    _renderCalGrid(el, year, month, nights, { compact: mode !== 'full' });
  });
}

function _calNavMonth(delta) {
  if (_calViewYear === null) {
    var today = new Date();
    _calViewYear = today.getFullYear();
    _calViewMonth = today.getMonth();
  }
  var next = new Date(_calViewYear, _calViewMonth + delta, 1);
  _calViewYear = next.getFullYear();
  _calViewMonth = next.getMonth();
  buildCalendarWidget('full');
}
