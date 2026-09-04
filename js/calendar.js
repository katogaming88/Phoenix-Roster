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
// #893 (Phase 2) adds the signed-in raider's own override: clicking a raid
// day on the full page (calendar.html only, not the Home widget) opens a
// status picker calling set_own_rsvp(), and the grid shows that override
// in place of the computed default (Present, or No Response on an optional
// night -- #895/Phase 4) once one exists. Bench raiders get no picker on a
// normal night (Bench is never raider-editable there, enforced server-side
// too) -- but DO get one on an optional night (#895), since an optional
// night has no default for anyone and bench is exactly who might get
// pulled in for it. See dayCanPick below and set_own_rsvp()'s relaxed
// bench guard.

var _CAL_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var _CAL_STATUS_LABELS = { present: 'Present', pending: 'No Response' };
// The four raider-facing override statuses offered on every raid night
// (#893). 'Attending' (#895) is also a valid raid_rsvps.status value, but
// only offered -- and accepted by set_own_rsvp() -- on an optional night;
// see _renderRsvpStatusOptions().
var _CAL_RSVP_STATUSES = ['Late', 'Leaving Early', 'Tentative', 'Absent'];

var _calDataCache = {};
var _calViewYear = null;
var _calViewMonth = null;
var _calModalDate = null;
var _calModalStatus = null;
var _calModalIsOptional = false;

// '?date=YYYY-MM-DD' deep link (#900) -- the signup-sheet embed's "View on
// Site" button lands here. Read once at load time; calendar.html jumps the
// initial month view to it before the first buildCalendarWidget('full')
// call, and _resolveDeepLinkDate() (below) opens the RSVP modal for it once
// Discord login state is known (_openRsvpModal needs _calResolveMyPlayer(),
// which isn't reliable until then -- same reasoning as #517's
// #profile/<name> deep link in js/roster.js's _resolveHashProfile()).
var _pendingDeepLinkDate = new URLSearchParams(location.search).get('date');

function _resolveDeepLinkDate() {
  if (!_pendingDeepLinkDate) return;
  var target = _pendingDeepLinkDate;
  _pendingDeepLinkDate = null;
  _openRsvpModal(target);
}

// Callbacks invoked by discord.js once login state is known. calendar.html
// also loads js/officer-quick-actions.js, which defines onDiscordInitNoSession
// (calls _qaRefresh()) but deliberately not onDiscordSessionRestored -- this
// file loads after it, so a same-named declaration here wins/shadows it
// (#371), same collision js/roster.js's own onDiscordSessionRestored already
// documents. Call _qaRefresh() ourselves in both so officer-quick-actions.js's
// UI still reacts on this page.
function onDiscordSessionRestored(session) {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  _resolveDeepLinkDate();
}
function onDiscordInitNoSession() {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  _resolveDeepLinkDate();
}

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

// Returns every RSVP row an officer viewer can see (their own team's), not
// just the caller's own -- buildCalendarWidget() filters to the caller's
// own player_id since RLS widens for officers ("Officers read raid_rsvps").
function fetchSupabaseRaidRsvps(rangeStart, rangeEnd) {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: bounded to the one visible month below, same shape
  // as fetchSupabaseRaidScheduleExceptions above.
  return supabaseClient
    .from('raid_rsvps')
    .select('player_id, raid_date, status, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .gte('raid_date', _calIsoDate(rangeStart))
    .lte('raid_date', _calIsoDate(rangeEnd))
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_rsvps query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_rsvps query failed.', err);
        return [];
      }
    );
}

// The signed-in raider's own claimed roster character for this team, or
// null if signed out / unclaimed. Mirrors js/boe.js's session.nameRealm ->
// DATA.roster lookup -- no dedicated "who am I" resolver exists yet.
function _calResolveMyPlayer() {
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || !window.DATA || !DATA.roster) return null;
  for (var i = 0; i < DATA.roster.length; i++) {
    if (DATA.roster[i].nameRealm === session.nameRealm) return DATA.roster[i];
  }
  return null;
}

// The recurring schedule is cached across the whole page view (rarely
// changes mid-session); exceptions and RSVPs are cached per visible month,
// since a new month means a new bounded fetch anyway.
function _loadCalendarScheduleData(rangeStart, rangeEnd) {
  var monthKey = rangeStart.getFullYear() + '-' + rangeStart.getMonth();
  if (_calDataCache[monthKey]) return _calDataCache[monthKey];
  var schedulePromise = (_calDataCache._schedule = _calDataCache._schedule || fetchSupabaseRaidSchedule());
  var promise = Promise.all([
    schedulePromise,
    fetchSupabaseRaidScheduleExceptions(rangeStart, rangeEnd),
    fetchSupabaseRaidRsvps(rangeStart, rangeEnd)
  ]).then(function (results) {
    return { scheduleRows: results[0], exceptionRows: results[1], rsvpRows: results[2] };
  });
  _calDataCache[monthKey] = promise;
  return promise;
}

function _calInvalidateMonthCache(rangeStart) {
  var monthKey = rangeStart.getFullYear() + '-' + rangeStart.getMonth();
  delete _calDataCache[monthKey];
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

// css class + aria label for an override status -- Absent gets its own
// color (red-ish, --melee), Attending (#895, optional nights only) reads
// as the same green/present style as the computed default, and the
// remaining three share the existing amber "tentative" treatment (still
// attending, just flagged).
function _calOverrideClass(status) {
  if (status === 'Absent') return 'absent';
  if (status === 'Attending') return 'present';
  return 'tentative';
}

/**
 * Renders one month grid into containerEl. opts.compact suppresses the
 * "(mock ...)" style extras that don't fit a Home-page glance -- currently
 * just controls whether the "View full calendar" link is appended, and
 * whether raid days are clickable (RSVP picking only happens on the full
 * page, calendar.html). opts.myOverridesByDate is {dateStr: {status, note}}
 * for the signed-in raider's own raid_rsvps rows; opts.myPlayer is their
 * DATA.roster entry (or null if signed out / unclaimed).
 */
function _renderCalGrid(containerEl, year, month, nights, opts) {
  opts = opts || {};
  var myOverridesByDate = opts.myOverridesByDate || {};
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
    var dayCanPick = false;
    if (isRaidDay) {
      var myOverride = myOverridesByDate[dateStr];
      var anyOptional = dayNights.some(function (n) {
        return n.isOptional;
      });
      // Bench raiders can only pick on an optional night -- see the file
      // header comment and set_own_rsvp()'s matching server-side gate.
      dayCanPick = !opts.compact && opts.myPlayer && (!opts.myPlayer.isBench || anyOptional);
      var statusClass, statusLabel;
      if (myOverride) {
        statusClass = _calOverrideClass(myOverride.status);
        statusLabel = myOverride.status;
      } else {
        statusClass = anyOptional ? 'tentative' : 'present';
        statusLabel = anyOptional ? _CAL_STATUS_LABELS.pending : _CAL_STATUS_LABELS.present;
      }
      usedStatuses[statusLabel] = statusClass;
      statusHtml =
        '<span class="calendar-status calendar-status-' +
        statusClass +
        '" role="img" aria-label="' +
        statusLabel +
        '" title="' +
        statusLabel +
        '"></span>';
      if (rosterCount && !myOverride && !anyOptional) {
        countHtml = '<span class="mini-cal-daycount">' + attending + '/' + rosterCount + '</span>';
      }
    }
    cellsHtml +=
      '<div class="mini-cal-day' +
      (isRaidDay ? ' mini-cal-day-raid' : '') +
      (isToday ? ' mini-cal-day-today' : '') +
      (isRaidDay && dayCanPick ? ' mini-cal-day-clickable" onclick="_openRsvpModal(\'' + dateStr + "')" : '') +
      '"><span class="mini-cal-daynum">' +
      day +
      '</span>' +
      countHtml +
      statusHtml +
      '</div>';
  }

  var legendHtml = Object.keys(usedStatuses)
    .map(function (label) {
      return (
        '<span class="calendar-legend-item"><span class="calendar-status calendar-status-' +
        usedStatuses[label] +
        '" aria-hidden="true"></span>' +
        label +
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
  var myPlayer = _calResolveMyPlayer();
  _loadCalendarScheduleData(rangeStart, rangeEnd).then(function (data) {
    var nights = computeRaidNights(data.scheduleRows, data.exceptionRows, rangeStart, rangeEnd);
    var myOverridesByDate = {};
    if (myPlayer) {
      (data.rsvpRows || []).forEach(function (row) {
        if (row.player_id === myPlayer.id) myOverridesByDate[row.raid_date] = row;
      });
    }
    _renderCalGrid(el, year, month, nights, {
      compact: mode !== 'full',
      myPlayer: myPlayer,
      myOverridesByDate: myOverridesByDate
    });
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

// --- RSVP modal (#893) -- calendar.html only; the Home widget deep-links
// here instead of duplicating the picker. Static markup lives in
// calendar.html (#rsvpModal, .officer-prompt/.active convention, same as
// officer.html's existing prompts) rather than being built as an HTML
// string, matching every other modal in this codebase.

function _openRsvpModal(dateStr) {
  var myPlayer = _calResolveMyPlayer();
  if (!myPlayer) return;
  _calModalDate = dateStr;
  _calModalStatus = null;
  _calModalIsOptional = false;
  var titleEl = document.getElementById('rsvpModalTitle');
  if (titleEl) {
    var d = new Date(dateStr + 'T00:00:00');
    titleEl.textContent =
      'Your status for ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  var noteEl = document.getElementById('rsvpNote');
  if (noteEl) noteEl.value = '';
  var errEl = document.getElementById('rsvpError');
  if (errEl) errEl.style.display = 'none';
  var monthKey = new Date(dateStr + 'T00:00:00');
  var rangeStart = new Date(monthKey.getFullYear(), monthKey.getMonth(), 1);
  var rangeEnd = new Date(monthKey.getFullYear(), monthKey.getMonth() + 1, 0);
  _loadCalendarScheduleData(rangeStart, rangeEnd).then(function (data) {
    var nights = computeRaidNights(data.scheduleRows, data.exceptionRows, rangeStart, rangeEnd);
    var night = nights.find(function (n) {
      return n.date === dateStr;
    });
    _calModalIsOptional = !!(night && night.isOptional);
    // Defense in depth -- the grid only makes a bench player's cell
    // clickable on an optional night (see dayCanPick in _renderCalGrid),
    // but don't trust that alone; set_own_rsvp() enforces this too.
    if (myPlayer.isBench && !_calModalIsOptional) {
      _closeRsvpModal();
      return;
    }
    var existing = (data.rsvpRows || []).find(function (row) {
      return row.player_id === myPlayer.id && row.raid_date === dateStr;
    });
    if (existing) {
      _calModalStatus = existing.status;
      if (noteEl) noteEl.value = existing.note || '';
    }
    _renderRsvpStatusOptions();
  });
  var modal = document.getElementById('rsvpModal');
  if (modal) modal.classList.add('active');
}

function _closeRsvpModal() {
  var modal = document.getElementById('rsvpModal');
  if (modal) modal.classList.remove('active');
  _calModalDate = null;
  _calModalStatus = null;
  _calModalIsOptional = false;
}

function _renderRsvpStatusOptions() {
  var el = document.getElementById('rsvpStatusOptions');
  if (!el) return;
  var statuses = _calModalIsOptional ? ['Attending'].concat(_CAL_RSVP_STATUSES) : _CAL_RSVP_STATUSES;
  el.innerHTML = statuses
    .map(function (status) {
      return (
        '<button type="button" class="filter-chip' +
        (status === _calModalStatus ? ' active' : '') +
        '" onclick="_selectRsvpStatus(\'' +
        status +
        '\')">' +
        status +
        '</button>'
      );
    })
    .join('');
}

function _selectRsvpStatus(status) {
  _calModalStatus = status;
  _renderRsvpStatusOptions();
}

function _saveRsvpStatus() {
  if (!_calModalDate || !_calModalStatus) return;
  var noteEl = document.getElementById('rsvpNote');
  var errEl = document.getElementById('rsvpError');
  var saveBtn = document.getElementById('rsvpSaveBtn');
  var note = (noteEl && noteEl.value.trim()) || '';
  if (_calModalStatus !== 'Attending' && !note) {
    if (errEl) {
      errEl.textContent = 'A note is required so officers know why.';
      errEl.style.display = '';
    }
    return;
  }
  if (saveBtn) saveBtn.disabled = true;
  supabaseClient
    .rpc('set_own_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_raid_date: _calModalDate,
      p_status: _calModalStatus,
      p_note: note
    })
    .then(function (result) {
      if (saveBtn) saveBtn.disabled = false;
      if (result.error) {
        if (errEl) {
          errEl.textContent = result.error.message;
          errEl.style.display = '';
        }
        return;
      }
      _notifyRsvpBot(_calModalDate, _calModalStatus, note);
      _syncSignupSheet(_calModalDate);
      var monthDate = new Date(_calModalDate + 'T00:00:00');
      _calInvalidateMonthCache(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
      _closeRsvpModal();
      buildCalendarWidget('full');
    });
}

function _clearRsvpStatus() {
  if (!_calModalDate) return;
  var saveBtn = document.getElementById('rsvpSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  supabaseClient
    .rpc('set_own_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_raid_date: _calModalDate,
      p_status: null,
      p_note: null
    })
    .then(function (result) {
      if (saveBtn) saveBtn.disabled = false;
      if (result.error) {
        var errEl = document.getElementById('rsvpError');
        if (errEl) {
          errEl.textContent = result.error.message;
          errEl.style.display = '';
        }
        return;
      }
      _syncSignupSheet(_calModalDate);
      var monthDate = new Date(_calModalDate + 'T00:00:00');
      _calInvalidateMonthCache(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
      _closeRsvpModal();
      buildCalendarWidget('full');
    });
}

// Fire-and-forget, same pattern as js/signup.js -- the Supabase write above
// is already committed and is the record of truth; a failed/slow Discord
// notification is not something the raider needs to see or wait on.
function _notifyRsvpBot(raidDate, status, note) {
  if (!supabaseClient || !window.DATA || !DATA.roster) return;
  var myPlayer = _calResolveMyPlayer();
  if (!myPlayer) return;
  supabaseClient.functions
    .invoke('discord-bot-webhook', {
      body: {
        action: 'rsvp',
        team: TEAM_SLUG,
        payload: { charName: myPlayer.nameRealm, raidDate: raidDate, status: status, note: note }
      }
    })
    .then(
      function () {},
      function () {}
    );
}

// Fire-and-forget trigger for the bot-owned aggregated signup sheet (#900,
// part of #640) -- fully separate from _notifyRsvpBot above, which is the
// existing per-status-change ping and stays untouched. All the actual
// grouping/embed/message-bookkeeping logic lives bot-side
// (wga-raid-bot's src/signupSheet.ts); this just tells it "the RSVP picture
// for this date changed, go re-sync." No player/status data needed in the
// payload -- the bot re-queries the full roster/RSVP state itself.
function _syncSignupSheet(raidDate) {
  if (!supabaseClient) return;
  supabaseClient.functions
    .invoke('discord-bot-webhook', {
      body: { action: 'signupSheetSync', team: TEAM_SLUG, payload: { raidDate: raidDate } }
    })
    .then(
      function () {},
      function () {}
    );
}
