// optional-rsvp-reminders (#895, part of #640, Phase 4): DMs any roster
// member -- bench included, see below -- who hasn't RSVP'd to an upcoming
// optional raid night by 24h and again by 2h before it starts.
//
// Runs on a pg_cron schedule (see the sibling cron migration), same
// no-logged-in-caller shape as blizzard-gear-sync/twitch-live-check:
// x-cron-secret header check against OPTIONAL_RSVP_REMINDERS_SECRET, then
// a service-role client for everything else. Deploy with --no-verify-jwt.
//
// Bench players are deliberately included in the roster scan here, unlike
// every other place in this schema that filters players to is_bench=false.
// On a normal raid night bench has nothing to RSVP about (there's no
// default-Present for them to override) -- but an optional night has no
// default for *anyone*, and is exactly the kind of night a bench player
// might get pulled in for. See is_optional_raid_night()'s migration
// comment and js/calendar.js's canPick/dayCanPick handling for the same
// bench exception on the frontend side.
//
// "Has responded" is answered by a raid_rsvps row existing for the
// player/raid_date -- NOT by raid_rsvp_reminders_sent, which is a pure
// dedup log recording that a reminder was already sent for a checkpoint so
// this function doesn't re-DM the same player every 15-minute tick.
//
// Date/timezone math: raid_schedule carries a per-row timezone (defaults
// 'America/New_York', never actually overridden by any team today);
// raid_schedule_exceptions has no timezone column at all, so an 'added'
// exception night is assumed to use that same default -- matching every
// other place in this schema/frontend that treats America/New_York as the
// implicit single timezone. zonedTimeToUtc() below is the standard
// "format the guess, diff against the wall-clock target, correct once"
// technique for turning a wall-clock date+time in a named zone into a UTC
// instant without a datetime library.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

const DEFAULT_TIMEZONE = 'America/New_York';
const CHECKPOINTS: { key: '24h' | '2h'; hoursBefore: number }[] = [
  { key: '24h', hoursBefore: 24 },
  { key: '2h', hoursBefore: 2 }
];
// Matches the cron cadence: a window this wide means a slightly-late tick
// still catches a checkpoint, and a tick can't double-fire the same one.
const TOLERANCE_MINUTES = 15;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function zonedTimeToUtc(raidDate: string, time: string, timeZone: string): Date {
  const [year, month, day] = raidDate.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(guessUtcMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asIfUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asIfUtcMs - guessUtcMs;
  return new Date(guessUtcMs - offsetMs);
}

interface ScheduleRow {
  team_id: number;
  weekday: number;
  start_time: string;
  timezone: string;
  is_optional: boolean;
}

interface ExceptionRow {
  team_id: number;
  raid_date: string;
  exception_type: 'cancelled' | 'added';
  start_time: string | null;
  is_optional: boolean;
}

interface OptionalNight {
  teamId: number;
  raidDate: string;
  startsAt: Date;
}

function computeOptionalNights(
  scheduleRows: ScheduleRow[],
  exceptionRows: ExceptionRow[],
  dateRange: string[]
): OptionalNight[] {
  const cancelledByTeamDate = new Set<string>();
  const addedByTeamDate = new Map<string, ExceptionRow>();
  for (const ex of exceptionRows) {
    const key = ex.team_id + '|' + ex.raid_date;
    if (ex.exception_type === 'cancelled') cancelledByTeamDate.add(key);
    else if (ex.exception_type === 'added') addedByTeamDate.set(key, ex);
  }

  const nights: OptionalNight[] = [];
  for (const dateStr of dateRange) {
    const weekday = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    const teamIds = new Set(scheduleRows.map((r) => r.team_id).concat(exceptionRows.map((r) => r.team_id)));
    for (const teamId of teamIds) {
      const key = teamId + '|' + dateStr;
      const added = addedByTeamDate.get(key);
      if (added) {
        if (added.is_optional && added.start_time) {
          nights.push({
            teamId,
            raidDate: dateStr,
            startsAt: zonedTimeToUtc(dateStr, added.start_time, DEFAULT_TIMEZONE)
          });
        }
        continue;
      }
      if (cancelledByTeamDate.has(key)) continue;
      const rule = scheduleRows.find((r) => r.team_id === teamId && r.weekday === weekday);
      if (rule && rule.is_optional) {
        nights.push({ teamId, raidDate: dateStr, startsAt: zonedTimeToUtc(dateStr, rule.start_time, rule.timezone) });
      }
    }
  }
  return nights;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const cronSecret = Deno.env.get('OPTIONAL_RSVP_REMINDERS_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const now = new Date();
    const dateRange = [0, 1, 2].map((offset) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + offset);
      return isoDate(d);
    });

    const [
      { data: teams, error: teamsErr },
      { data: scheduleRows, error: scheduleErr },
      { data: exceptionRows, error: exErr }
    ] = await Promise.all([
      supabase.from('teams').select('id, slug'),
      supabase.from('raid_schedule').select('team_id, weekday, start_time, timezone, is_optional').eq('active', true),
      supabase
        .from('raid_schedule_exceptions')
        .select('team_id, raid_date, exception_type, start_time, is_optional')
        .in('raid_date', dateRange)
    ]);
    if (teamsErr) return jsonResponse({ success: false, error: teamsErr.message }, 500);
    if (scheduleErr) return jsonResponse({ success: false, error: scheduleErr.message }, 500);
    if (exErr) return jsonResponse({ success: false, error: exErr.message }, 500);

    const teamSlugById = new Map((teams || []).map((t) => [t.id, t.slug as string]));
    const nights = computeOptionalNights(scheduleRows || [], (exceptionRows || []) as ExceptionRow[], dateRange);

    let reminded = 0;
    for (const night of nights) {
      for (const checkpoint of CHECKPOINTS) {
        const checkpointAt = new Date(night.startsAt.getTime() - checkpoint.hoursBefore * 60 * 60 * 1000);
        const windowStart = checkpointAt.getTime();
        const windowEnd = windowStart + TOLERANCE_MINUTES * 60 * 1000;
        if (now.getTime() < windowStart || now.getTime() >= windowEnd) continue;

        const teamSlug = teamSlugById.get(night.teamId);
        if (!teamSlug) continue;

        const [
          { data: roster, error: rosterErr },
          { data: rsvps, error: rsvpErr },
          { data: reminders, error: remErr }
        ] = await Promise.all([
          supabase
            .from('players')
            .select('id, name_realm, team_member_id, team_members!inner(discord_id)')
            .eq('team_id', night.teamId)
            .is('archived_at', null),
          supabase.from('raid_rsvps').select('player_id').eq('team_id', night.teamId).eq('raid_date', night.raidDate),
          supabase
            .from('raid_rsvp_reminders_sent')
            .select('player_id')
            .eq('team_id', night.teamId)
            .eq('raid_date', night.raidDate)
            .eq('checkpoint', checkpoint.key)
        ]);
        if (rosterErr || rsvpErr || remErr) {
          console.error('optional-rsvp-reminders roster/rsvp query error:', rosterErr, rsvpErr, remErr);
          continue;
        }

        const responded = new Set((rsvps || []).map((r) => r.player_id));
        const alreadyReminded = new Set((reminders || []).map((r) => r.player_id));

        for (const player of roster || []) {
          if (responded.has(player.id) || alreadyReminded.has(player.id)) continue;
          const discordId = (player as { team_members?: { discord_id?: string } }).team_members?.discord_id;
          if (!discordId) continue;

          const res = await fetch(supabaseUrl + '/functions/v1/discord-bot-webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'optionalReminder',
              team: teamSlug,
              payload: {
                discordId,
                charName: player.name_realm,
                checkpoint: checkpoint.key,
                raidDate: night.raidDate,
                startTime: night.startsAt.toISOString(),
                timezone: DEFAULT_TIMEZONE
              }
            })
          }).catch((err) => {
            console.error('optional-rsvp-reminders relay fetch failed:', err);
            return null;
          });
          if (!res || !res.ok) continue;

          const { error: insertErr } = await supabase
            .from('raid_rsvp_reminders_sent')
            .upsert(
              { team_id: night.teamId, player_id: player.id, raid_date: night.raidDate, checkpoint: checkpoint.key },
              { onConflict: 'team_id,player_id,raid_date,checkpoint', ignoreDuplicates: true }
            );
          if (insertErr) console.error('optional-rsvp-reminders dedup insert failed:', insertErr);
          else reminded++;
        }
      }
    }

    return jsonResponse({ success: true, remindersSent: reminded });
  } catch (err) {
    console.error('optional-rsvp-reminders error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
