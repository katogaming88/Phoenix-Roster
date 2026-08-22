// wcl-sync (#223): ports WarcraftLogs API access out of Apps Script
// (gs/WCL.gs, gs/Attendance.gs, gs/wgaWebApp.gs) into a Supabase Edge
// Function. Stage 1: the two read-only WCL proxies behind Season Settings'
// raid progression picker (getZoneEncounters, fetchProgression). Stage 2:
// the Scoring tab's "Refresh from WCL" read (refreshPerformance). Stage 3:
// the Attendance tab's "Refresh from WCL" write (refreshAttendance) -- see
// js/tabs/tab-scoring.js and js/tabs/tab-attendance.js for why the commit/
// manual-edit steps in both features stay direct Supabase writes rather
// than more actions here. fetchSeasonPerf (#264) is a later addition: an
// officer-triggered, once-per-season fetch of previous-season character-page
// performance into player_wcl_season_perf, the baseline heroic priority
// generation reads before the new season has report data of its own.
//
// No service-role key: officers already have full RLS write access to
// attendance/scoring via their own session (docs/RLS.md), so this function
// forwards the caller's JWT (auto-attached by supabase.functions.invoke())
// and lets RLS gate everything, same as every direct-write call site
// elsewhere in this app. The only real secret is WCL_CLIENT_ID/
// WCL_CLIENT_SECRET, needed purely to keep the WarcraftLogs OAuth
// credentials off the client -- configured in Project Settings > Edge
// Functions > Secrets per #205.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// GAS formatted every WCL-derived date via Utilities.formatDate(ts,
// Session.getScriptTimeZone(), 'yyyy-MM-dd') -- America/New_York throughout
// this app (js/common.js, migrations, docs/database-decisions.md). Report
// startTime is a UTC epoch ms; a raid starting evening US time can already
// be past midnight UTC, so a naive `.toISOString().slice(0,10)` silently
// shifts it to the wrong calendar day -- this reproduces GAS's timezone-
// correct date instead.
const REPORT_TIME_ZONE = 'America/New_York';
// A raid that runs past midnight still belongs to the night it started, not
// the calendar day its report timestamp technically falls on -- reports
// starting in the small hours (before this cutoff, local time) are dated as
// the previous day instead.
const EARLY_MORNING_CUTOFF_HOUR = 6;

function formatReportDate(ms: number): string {
  // en-CA formats as YYYY-MM-DD, conveniently matching the date column format.
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(new Date(ms));
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TIME_ZONE, hourCycle: 'h23', hour: '2-digit' }).format(
      new Date(ms)
    ),
    10
  );
  if (localHour >= EARLY_MORNING_CUTOFF_HOUR) return localDate;
  // Pure calendar-date arithmetic (not ms/DST math) to step back one day.
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── WCL API helpers (ported from gs/WCL.gs) ─────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('WCL_CLIENT_ID');
  const clientSecret = Deno.env.get('WCL_CLIENT_SECRET');
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!data.access_token) {
    console.error('WCL token response:', JSON.stringify(data));
    return null;
  }
  return data.access_token;
}

async function wclQuery(token: string, query: string): Promise<any | null> {
  try {
    const response = await fetch('https://www.warcraftlogs.com/api/v2/client', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    if (data.errors) {
      console.error('WCL GraphQL errors:', JSON.stringify(data.errors));
      return null;
    }
    return data;
  } catch (err) {
    console.error('WCL request failed:', err);
    return null;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────

// Ported from gs/wgaWebApp.gs's getWclZoneEncounters handler. Not
// guild-scoped -- world data, same for every team.
async function getZoneEncounters(zoneId: number) {
  const token = await getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');

  const query = `query { worldData { zone(id: ${zoneId}) { name encounters { id name } } } }`;
  const result = await wclQuery(token, query);
  const zone = result?.data?.worldData?.zone;
  if (!zone) throw new Error('Zone not found');
  return { success: true, zoneName: zone.name, encounters: zone.encounters || [] };
}

// Ported from gs/wgaWebApp.gs's fetchWclProgressionData (lines 2919-2985).
// Guild-scoped -- needs the calling team's wcl_guild_id.
async function fetchProgression(zoneId: number, guildId: number) {
  const token = await getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');

  const query = `
    query {
      reportData {
        reports(guildID: ${guildId}, zoneID: ${zoneId}, limit: 100) {
          data {
            startTime
            fights(killType: Kills) {
              encounterID
              name
              difficulty
            }
          }
        }
      }
    }
  `;
  const result = await wclQuery(token, query);
  if (!result) throw new Error('WCL query returned no data');

  const reports = result.data?.reportData?.reports?.data || [];
  const firstKills: Record<number, { name: string; mythicMs: number | null; heroicMs: number | null }> = {};

  for (const report of reports) {
    const fights = report.fights || [];
    for (const fight of fights) {
      const encId = fight.encounterID;
      const diff = fight.difficulty;
      const name = fight.name || '';
      const ts = report.startTime;

      if (!firstKills[encId]) firstKills[encId] = { name, mythicMs: null, heroicMs: null };
      if (name && !firstKills[encId].name) firstKills[encId].name = name;

      if (diff === 5) {
        if (firstKills[encId].mythicMs === null || ts < firstKills[encId].mythicMs!) firstKills[encId].mythicMs = ts;
      } else if (diff === 4) {
        if (firstKills[encId].heroicMs === null || ts < firstKills[encId].heroicMs!) firstKills[encId].heroicMs = ts;
      }
    }
  }

  const encIds = Object.keys(firstKills)
    .map((id) => parseInt(id, 10))
    .sort((a, b) => a - b);

  function formatDate(ms: number | null): string {
    if (!ms) return '';
    return formatReportDate(ms);
  }

  const bosses = encIds.map((encId) => {
    const k = firstKills[encId];
    return {
      encounterID: encId,
      name: k.name,
      mythicDate: formatDate(k.mythicMs),
      heroicDate: formatDate(k.heroicMs)
    };
  });

  const aotcDate = bosses.length > 0 ? bosses[bosses.length - 1].heroicDate || '' : '';

  return { success: true, bosses, aotcDate };
}

// Ported from gs/WCL.gs's refreshWclPerformanceCore + collectPlayerData +
// writeDualScores. Guild-scoped -- needs the calling team's wcl_guild_id.
// Read-only: unlike GAS (which writes "draft" cells the app never reads
// back), this just returns the computed scores -- the frontend already
// treats the response as the draft state (sessionStorage cache), and the
// actual commit is a direct Supabase write from the client (see
// js/tabs/tab-scoring.js), not another Edge Function round trip.
const RECENT_REPORTS = 2;
const TREND_REPORTS = 8;
const BEST_REPORTS = 20;
const MYTHIC_DIFF = 5;
const HEROIC_DIFF = 4;

type Role = 'tank' | 'healer' | 'dps';

function classRoleToScoringRole(role: string | null | undefined): Role {
  if (role === 'Tank') return 'tank';
  if (role === 'Heal') return 'healer';
  return 'dps';
}

async function fetchReportFights(token: string, reportCode: string): Promise<any[]> {
  async function fightsForDifficulty(difficulty: number): Promise<any[]> {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            rankings(difficulty: ${difficulty})
          }
        }
      }
    `;
    const result = await wclQuery(token, query);
    const rankingsRaw = result?.data?.reportData?.report?.rankings;
    if (!rankingsRaw) return [];
    try {
      const rankings = typeof rankingsRaw === 'string' ? JSON.parse(rankingsRaw) : rankingsRaw;
      return rankings?.data || [];
    } catch (err) {
      console.error('Failed to parse rankings JSON:', err);
      return [];
    }
  }

  let fights = await fightsForDifficulty(MYTHIC_DIFF);
  if (!fights || fights.length === 0) fights = await fightsForDifficulty(HEROIC_DIFF);
  return fights;
}

async function refreshPerformance(
  token: string,
  guildId: number,
  teamId: number,
  supabase: ReturnType<typeof createClient>
) {
  const reportsQuery = `
    query {
      reportData {
        reports(guildID: ${guildId}, limit: ${BEST_REPORTS}) {
          data { code title startTime endTime }
        }
      }
    }
  `;
  const reportsResult = await wclQuery(token, reportsQuery);
  const reports = reportsResult?.data?.reportData?.reports?.data || [];
  if (reports.length === 0) throw new Error('No reports found for this guild.');

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name_realm, classes_specs(role)')
    .eq('team_id', teamId)
    .is('archived_at', null);
  if (playersError) throw new Error(playersError.message);

  const roleByFirstName = new Map<string, Role>();
  const rosterByFirstName = new Map<string, { playerId: number; displayName: string }>();
  for (const p of players || []) {
    const displayName = String(p.name_realm).split('-')[0].trim();
    const firstName = displayName.toLowerCase();
    if (!firstName) continue;
    const classSpec = Array.isArray(p.classes_specs) ? p.classes_specs[0] : p.classes_specs;
    roleByFirstName.set(firstName, classRoleToScoringRole(classSpec?.role));
    rosterByFirstName.set(firstName, { playerId: p.id, displayName });
  }

  // recent(2)/trend(8)/best(20) are prefixes of the same 20-report window,
  // so each report's rankings are fetched exactly once here and bucketed
  // into all three accumulators it belongs to -- GAS refetches per window
  // (up to 3x per report), which isn't viable under an Edge Function's
  // execution time limit.
  const recentData = new Map<string, number[]>();
  const trendData = new Map<string, number[]>();
  const bestData = new Map<string, number[]>();

  for (let i = 0; i < reports.length; i++) {
    const fights = await fetchReportFights(token, reports[i].code);
    for (const fight of fights) {
      if (!fight.roles) continue;
      for (const roleKey of ['dps', 'healers', 'tanks'] as const) {
        const entries = fight.roles[roleKey]?.characters || [];
        for (const character of entries) {
          const name = character.name;
          const ilvlPct = character.bracketPercent;
          if (!name || ilvlPct == null || ilvlPct === 0) continue;

          const firstName = String(name).trim().toLowerCase();
          const expectedRole = roleByFirstName.get(firstName) || 'dps';
          if (expectedRole === 'tank') continue;
          if (expectedRole === 'healer') continue;
          if (expectedRole === 'dps' && roleKey !== 'dps') continue;

          if (i < RECENT_REPORTS) {
            if (!recentData.has(firstName)) recentData.set(firstName, []);
            recentData.get(firstName)!.push(ilvlPct);
          }
          if (i < TREND_REPORTS) {
            if (!trendData.has(firstName)) trendData.set(firstName, []);
            trendData.get(firstName)!.push(ilvlPct);
          }
          if (!bestData.has(firstName)) bestData.set(firstName, []);
          bestData.get(firstName)!.push(ilvlPct);
        }
      }
    }
  }

  function calcScore(pcts: number[] | undefined): number | null {
    if (!pcts || pcts.length === 0) return null;
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    return Math.round((avg / 10) * 100) / 100;
  }

  let updated = 0;
  const scores: Array<{
    playerId: number;
    name: string;
    role: Role;
    recent: number | null;
    trend: number | null;
    best: number | null;
    noData: boolean;
    usedTrend: boolean;
    manual: boolean;
  }> = [];

  for (const [firstName, { playerId, displayName }] of rosterByFirstName) {
    const role = roleByFirstName.get(firstName) || 'dps';

    if (role === 'tank' || role === 'healer') {
      scores.push({
        playerId,
        name: displayName,
        role,
        recent: null,
        trend: null,
        best: null,
        noData: false,
        usedTrend: false,
        manual: true
      });
      continue;
    }

    const recentScore = calcScore(recentData.get(firstName));
    const trendScore = calcScore(trendData.get(firstName));
    const bestPcts = bestData.get(firstName) || [];
    const bestScore = bestPcts.length > 0 ? Math.round((Math.max(...bestPcts) / 10) * 100) / 100 : null;

    if (recentScore !== null) updated++;

    scores.push({
      playerId,
      name: displayName,
      role,
      recent: recentScore !== null ? recentScore : trendScore,
      trend: trendScore,
      best: bestScore,
      noData: recentScore === null && trendScore === null,
      usedTrend: recentScore === null && trendScore !== null,
      manual: false
    });
  }

  return {
    success: true,
    updated,
    recentReports: Math.min(RECENT_REPORTS, reports.length),
    trendReports: Math.min(TREND_REPORTS, reports.length),
    scores
  };
}

// Ported from gs/Attendance.gs's refreshAttendanceCore + helpers. Guild-
// scoped -- needs the calling team's wcl_guild_id. Writes attendance rows
// directly (source='WCL'/'Auto (Bench)') rather than a sheet -- see the
// attendance.source migration comment for why that column exists. The
// commit step (weighted score/pct into scoring) stays a direct client
// write, same reasoning as refreshPerformance/js/tabs/tab-scoring.js: no
// WCL secret is needed to aggregate rows that are already in the table.
const SEASON_REPORT_LIMIT = 50;
const ALT_RUN_KEYWORD = 'Alt';

async function getReportZone(token: string, reportCode: string): Promise<number | null> {
  const query = `query { reportData { report(code: "${reportCode}") { zone { id } } } }`;
  const result = await wclQuery(token, query);
  return result?.data?.reportData?.report?.zone?.id ?? null;
}

// A report's single top-level `zone` field reflects whatever zone WCL
// considers primary for the report as a whole -- reliable for a
// dungeons-only or raid-only log, but a raid night that also has M+ keys
// logged in the same continuous session (before pull, during a break, etc.)
// can come back tagged with the dungeon's zone instead of the raid's,
// silently excluding a real raid night that has boss pulls in it. Checked as
// a fallback only (one extra query, just for reports the zone check already
// rejected) rather than replacing the zone check outright, since it needs
// `raidProgression` to actually have bosses configured with wclEncounterId
// and a zone-only report (wipes on a brand-new boss with no ranked kill yet)
// wouldn't show up here either.
async function getReportEncounterIds(token: string, reportCode: string): Promise<Set<number>> {
  const query = `
    query {
      reportData {
        report(code: "${reportCode}") {
          fights(killType: Kills) { encounterID }
        }
      }
    }
  `;
  const result = await wclQuery(token, query);
  const fights = result?.data?.reportData?.report?.fights || [];
  return new Set(fights.map((f: any) => f.encounterID).filter((id: any) => typeof id === 'number'));
}

// Ported from gs/Attendance.gs's getReportParticipants: combines ranked-fight
// characters (mythic->heroic fallback, unlike refreshPerformance this is NOT
// role-filtered -- any character in the log counts as present) with a
// masterData.actors combatant dump, to also catch players present on nights
// with no ranked boss kill (wipes-only, non-kill logs).
async function getReportParticipants(token: string, reportCode: string): Promise<Set<string>> {
  const names = new Set<string>();

  const fights = await fetchReportFights(token, reportCode);
  for (const fight of fights) {
    if (!fight.roles) continue;
    for (const roleKey of ['dps', 'healers', 'tanks'] as const) {
      const entries = fight.roles[roleKey]?.characters || [];
      for (const character of entries) {
        if (character.name) names.add(String(character.name).split('-')[0].trim().toLowerCase());
      }
    }
  }

  const combatantsQuery = `
    query {
      reportData {
        report(code: "${reportCode}") {
          masterData { actors(type: "Player") { name } }
        }
      }
    }
  `;
  const combatantsResult = await wclQuery(token, combatantsQuery);
  const actors = combatantsResult?.data?.reportData?.report?.masterData?.actors || [];
  for (const actor of actors) {
    if (actor.name) names.add(String(actor.name).split('-')[0].trim().toLowerCase());
  }

  return names;
}

// Late-arrival detection (#633 follow-up): who was present for the raid's
// first actual boss pull of the night, as opposed to getReportParticipants'
// report-wide "present at all" set. Deliberately a *separate* query rather
// than reusing fetchReportFights' `rankings` data -- rankings only include
// ranked kills, so a progression night that wipes repeatedly before its
// first kill would make the first *ranked* fight far later than the raid
// actually started, silently flagging on-time players as late. The raw
// `fights` list includes wipes too and is already in chronological order by
// fight ID, so the first difficulty-tagged (real pull, not trash) entry is
// the actual first pull regardless of whether it was a kill.
//
// `difficulty` alone isn't enough to tell a real raid pull from an M+
// dungeon pull -- both carry a difficulty value, so a session that also has
// keys logged before the raid (the same mixed-log shape the isMain zone
// fallback above handles) picked the first *dungeon* pull as "the first
// pull," and flagged everyone not in that 5-person key as late. Filtering to
// `validEncounterIds` (the configured raid's own boss list) when it's
// populated rules dungeon pulls out the same way the zone fallback does.
async function getFirstPullParticipants(
  token: string,
  reportCode: string,
  validEncounterIds: Set<number>
): Promise<Set<string> | null> {
  const fightsQuery = `
    query {
      reportData {
        report(code: "${reportCode}") {
          fights { id startTime difficulty encounterID }
        }
      }
    }
  `;
  const fightsResult = await wclQuery(token, fightsQuery);
  const fights = fightsResult?.data?.reportData?.report?.fights || [];
  const firstPull = fights
    .filter((f: any) => f.difficulty != null && (validEncounterIds.size === 0 || validEncounterIds.has(f.encounterID)))
    .sort((a: any, b: any) => a.startTime - b.startTime)[0];
  if (!firstPull) return null;

  const detailsQuery = `
    query {
      reportData {
        report(code: "${reportCode}") {
          playerDetails(fightIDs: [${firstPull.id}])
        }
      }
    }
  `;
  const detailsResult = await wclQuery(token, detailsQuery);
  const raw = detailsResult?.data?.reportData?.report?.playerDetails;
  if (!raw) return null;
  let details: any;
  try {
    details = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error('Failed to parse playerDetails JSON:', err);
    return null;
  }

  const roleGroups = details?.data?.playerDetails || {};
  const names = new Set<string>();
  for (const roleKey of ['dps', 'healers', 'tanks'] as const) {
    const entries = roleGroups[roleKey] || [];
    for (const character of entries) {
      if (character.name) names.add(String(character.name).split('-')[0].trim().toLowerCase());
    }
  }
  return names;
}

async function refreshAttendance(
  token: string,
  guildId: number,
  teamId: number,
  supabase: ReturnType<typeof createClient>
) {
  const { data: settingsRow } = await supabase
    .from('team_settings')
    .select('config')
    .eq('team_id', teamId)
    .maybeSingle();
  const config: any = (settingsRow as any)?.config || {};
  const seasonStart: string | null = config.seasonStart || null;
  const raidProgression: any[] = Array.isArray(config.raidProgression) ? config.raidProgression : [];
  const validZoneIds = new Set(
    raidProgression.map((r) => parseInt(r.wclZoneId, 10)).filter((id) => !Number.isNaN(id))
  );
  const validEncounterIds = new Set(
    raidProgression
      .flatMap((r) => (Array.isArray(r.bosses) ? r.bosses : []))
      .map((b: any) => parseInt(b.wclEncounterId, 10))
      .filter((id) => !Number.isNaN(id))
  );
  const startTimeMs = seasonStart && !Number.isNaN(Date.parse(seasonStart)) ? Date.parse(seasonStart) : null;

  const reportsQuery = `
    query {
      reportData {
        reports(guildID: ${guildId}, limit: ${SEASON_REPORT_LIMIT}${startTimeMs ? `, startTime: ${startTimeMs}` : ''}) {
          data { code title startTime }
        }
      }
    }
  `;
  const reportsResult = await wclQuery(token, reportsQuery);
  const reports = (reportsResult?.data?.reportData?.reports?.data || []).filter((r: any) => r.title);
  if (reports.length === 0) return { success: true, mainNights: 0, excluded: 0 };

  // A report already recorded (some attendance row references its code) is
  // trusted as a known main night and skipped entirely -- no zone or
  // participant re-fetch. Excluded reports never get attendance rows, so
  // they're re-classified every refresh; that's a cheap single zone-fetch
  // each, not the 3x-per-report cost stage 2 had to solve for.
  const { data: existingReportRows, error: existingReportsError } = await supabase
    .from('attendance')
    .select('report_id')
    .eq('team_id', teamId)
    .not('report_id', 'is', null);
  if (existingReportsError) throw new Error(existingReportsError.message);
  const cachedReportIds = new Set((existingReportRows || []).map((r: any) => r.report_id));

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name_realm, is_bench, join_date')
    .eq('team_id', teamId)
    .is('archived_at', null);
  if (playersError) throw new Error(playersError.message);

  const roster = (players || [])
    .map((p: any) => ({
      playerId: p.id as number,
      firstName: String(p.name_realm).split('-')[0].trim().toLowerCase(),
      isBench: !!p.is_bench,
      joinDate: p.join_date as string | null
    }))
    .filter((p) => p.firstName);

  // Rows already set by an officer are never touched by a refresh -- same
  // "Auto sources are always recomputed, Officer sources are sticky" rule
  // gs/Attendance.gs's readExistingAttendance enforced via the sheet.
  const { data: existingStatusRows, error: existingStatusError } = await supabase
    .from('attendance')
    .select('player_id, raid_date, source, report_excluded')
    .eq('team_id', teamId);
  if (existingStatusError) throw new Error(existingStatusError.message);
  const officerLocked = new Set(
    (existingStatusRows || [])
      .filter((r: any) => r.source === 'Officer')
      .map((r: any) => `${r.raid_date}|${r.player_id}`)
  );
  // toggleReportExcluded marks a whole raid_date excluded team-wide, but a
  // later sync run (e.g. a player added to the roster after the toggle, or
  // any re-sync of that date) used to hardcode report_excluded: false on
  // every row it upserted, silently un-excluding the night for just that
  // row -- one straggler row with report_excluded: false was enough to make
  // _teamRaidNightsByMonth() (js/common.js) still count the whole night.
  // Any existing row with the flag set means an officer excluded this date,
  // so new rows for that date must preserve it rather than default to false.
  const excludedDates = new Set(
    (existingStatusRows || []).filter((r: any) => r.report_excluded).map((r: any) => r.raid_date)
  );

  let mainNights = 0;
  let excluded = 0;
  let latestNewZoneId: number | null = null;
  // Keyed by player_id|raid_date rather than a plain array: attendance's
  // unique constraint is (team_id, player_id, raid_date), not report_id, so
  // two reports landing on the same calendar date would otherwise produce
  // two rows for the same conflict target in one upsert batch -- Postgres
  // rejects that ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"). A Map collapses same-date duplicates to one row (last report
  // processed wins), which is the same "one report per date" limitation
  // this table already has via toggleReportExcluded/setPlayerStatus.
  const rowsToUpsert = new Map<string, any>();

  const sorted = [...reports].sort((a: any, b: any) => b.startTime - a.startTime);

  for (const report of sorted) {
    const date = formatReportDate(report.startTime);

    if (cachedReportIds.has(report.code)) {
      mainNights++;
      continue;
    }

    if (String(report.title).includes(ALT_RUN_KEYWORD)) {
      excluded++;
      continue;
    }

    const zoneId = await getReportZone(token, report.code);

    // Classification, matching gs/Attendance.gs's refreshAttendanceCore:
    // raid-progression zones take priority; a season-start filter with no
    // progression trusts every report the query already returned; with
    // neither configured, fall back to comparing against the most recent
    // *new* report's zone (a non-persisted stand-in for GAS's script-
    // property-backed "current zone" heuristic).
    let isMain: boolean;
    if (validZoneIds.size > 0) {
      isMain = zoneId != null && validZoneIds.has(zoneId);
      // The report-level zone can come back as a M+ dungeon's zone instead
      // of the raid's when a night's log also has keys pushed in the same
      // continuous session -- a real raid boss kill in the log is a more
      // reliable signal than that single top-level field, so a
      // zone-mismatch gets one more check before being excluded.
      if (!isMain && validEncounterIds.size > 0) {
        const encounterIds = await getReportEncounterIds(token, report.code);
        isMain = [...encounterIds].some((id) => validEncounterIds.has(id));
      }
    } else if (startTimeMs) {
      isMain = true;
    } else {
      if (latestNewZoneId === null) latestNewZoneId = zoneId;
      isMain = zoneId === latestNewZoneId;
    }

    if (!isMain) {
      excluded++;
      continue;
    }

    mainNights++;
    const participants = await getReportParticipants(token, report.code);
    // null (not an empty set) means detection failed/found no real pulls --
    // fail open to the normal Present/WCL path rather than flagging anyone,
    // same "don't let a detection gap silently penalize someone" principle
    // as computeSeasonAttendancePct's treatment of an unset status.
    const firstPullParticipants = await getFirstPullParticipants(token, report.code, validEncounterIds);

    for (const player of roster) {
      if (officerLocked.has(`${date}|${player.playerId}`)) continue;

      const base = {
        team_id: teamId,
        player_id: player.playerId,
        raid_date: date,
        report_id: report.code,
        report_title: report.title,
        report_excluded: excludedDates.has(date)
      };

      const key = `${player.playerId}|${date}`;
      if (participants.has(player.firstName)) {
        const missedFirstPull = firstPullParticipants !== null && !firstPullParticipants.has(player.firstName);
        if (missedFirstPull) {
          // Flagged, not classified -- the sync doesn't know whether this
          // was Late (with notice) or Late (no notice), only that they
          // weren't there for the first pull but were present later. Status
          // stays unset for an officer to fill in via the grid.
          rowsToUpsert.set(key, { ...base, status: null, source: 'WCL (Late?)' });
        } else {
          rowsToUpsert.set(key, { ...base, status: 'Present', source: 'WCL' });
        }
      } else if (player.isBench) {
        rowsToUpsert.set(key, { ...base, status: 'Bench', source: 'Auto (Bench)' });
      } else if (player.joinDate && date < player.joinDate) {
        rowsToUpsert.set(key, { ...base, status: 'Not on Roster', source: 'WCL' });
      }
      // else: left unset -- officer fills the status in manually via the grid.
    }
  }

  if (rowsToUpsert.size > 0) {
    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert([...rowsToUpsert.values()], { onConflict: 'team_id,player_id,raid_date' });
    if (upsertError) throw new Error(upsertError.message);
  }

  return { success: true, mainNights, excluded };
}

// Ported from #264: officer-triggered fetch of each roster DPS player's
// *previous* season heroic/mythic character-page performance, written to
// player_wcl_season_perf as the baseline heroic priority reads before the
// current season has enough of its own report data (see refreshPerformance
// above for that ongoing-season path).
//
// Queries each character directly (characterData.character(name, serverSlug,
// serverRegion)) rather than guildData.guild(id).members() -- confirmed live
// that guild-membership silently misses real roster players who are
// currently tagged to a different guild on WCL's side (e.g. a large parent/
// community guild rather than the specific raid-team guild stored in
// teams.wcl_guild_id). A direct character lookup doesn't care what guild WCL
// thinks someone is in.
//
// No `difficulty` argument on zoneRankings -- confirmed live that omitting
// it resolves to whichever difficulty the character actually has the
// highest data for that zone (mythic if they have any mythic kills logged,
// heroic otherwise), matching the character page's own "Highest Difficulty"
// filter exactly.
function realmToServerSlug(realm: string): string {
  const r = String(realm).trim();
  // An apostrophe is just dropped, not hyphenated (e.g. Mal'Ganis -> malganis
  // -- confirmed live; a uniform "punctuation becomes a hyphen" rule gets
  // this one wrong, returning no character at all).
  if (r.indexOf("'") !== -1) {
    return r.replace(/'/g, '').toLowerCase();
  }
  return r
    .replace(/([a-z])([A-Z])/g, '$1-$2') // EarthenRing -> Earthen-Ring
    .replace(/([a-zA-Z])(\d)/g, '$1-$2') // Area52 -> Area-52
    .replace(/\s+/g, '-') // Area 52 / Argent Dawn -> hyphenated
    .toLowerCase();
}

// Batched via GraphQL aliases (confirmed live) rather than one request per
// character -- keeps this to a handful of round trips for a normal-sized
// roster instead of one per player.
const CHARACTERS_PER_QUERY = 10;

async function fetchSeasonPerf(teamId: number, season: string, zoneId: number, supabase: ReturnType<typeof createClient>) {
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name_realm, classes_specs(role)')
    .eq('team_id', teamId)
    .is('archived_at', null);
  if (playersError) throw new Error(playersError.message);

  // Tanks/healers are excluded from WCL-derived performance everywhere else
  // in this app (refreshPerformance's classRoleToScoringRole skip) -- their
  // Performance score is always officer-set manually, never WCL-sourced.
  const roster: Array<{ playerId: number; displayName: string; firstName: string; serverSlug: string }> = [];
  for (const p of players || []) {
    const classSpec = Array.isArray(p.classes_specs) ? p.classes_specs[0] : p.classes_specs;
    const role = classSpec?.role;
    if (role !== 'Melee' && role !== 'Ranged') continue;
    const parts = String(p.name_realm).split('-');
    const displayName = (parts[0] || '').trim();
    const realm = parts.slice(1).join('-').trim();
    if (!displayName || !realm) continue;
    roster.push({ playerId: p.id, displayName, firstName: displayName, serverSlug: realmToServerSlug(realm) });
  }
  if (roster.length === 0) {
    return { success: true, updated: 0, noData: 0, players: [] };
  }

  const token = await getAccessToken();
  if (!token) throw new Error('Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');

  const matched: Array<{ playerId: number; name: string; bestPerfAvg: number; medianPerfAvg: number }> = [];
  let noData = 0;

  for (let i = 0; i < roster.length; i += CHARACTERS_PER_QUERY) {
    const chunk = roster.slice(i, i + CHARACTERS_PER_QUERY);
    const aliasedFields = chunk
      .map(
        (p, j) =>
          `p${j}: character(name: ${JSON.stringify(p.firstName)}, serverSlug: ${JSON.stringify(p.serverSlug)}, serverRegion: "US") { zoneRankings(zoneID: ${zoneId}, metric: dps) }`
      )
      .join('\n');
    const query = `query { characterData { ${aliasedFields} } }`;
    const result = await wclQuery(token, query);
    const characterData = result?.data?.characterData || {};

    chunk.forEach((p, j) => {
      const bestPerfAvg = characterData[`p${j}`]?.zoneRankings?.bestPerformanceAverage;
      if (bestPerfAvg == null) {
        noData++;
        return;
      }
      matched.push({
        playerId: p.playerId,
        name: p.displayName,
        bestPerfAvg,
        medianPerfAvg: characterData[`p${j}`]?.zoneRankings?.medianPerformanceAverage ?? bestPerfAvg
      });
    });
  }

  if (matched.length > 0) {
    const rows = matched.map((m) => ({
      player_id: m.playerId,
      team_id: teamId,
      season,
      best_perf_avg: m.bestPerfAvg,
      median_perf_avg: m.medianPerfAvg,
      fetched_at: new Date().toISOString()
    }));
    const { error: upsertError } = await supabase
      .from('player_wcl_season_perf')
      .upsert(rows, { onConflict: 'player_id,season' });
    if (upsertError) throw new Error(upsertError.message);
  }

  return {
    success: true,
    updated: matched.length,
    noData,
    players: matched.map((m) => ({
      playerId: m.playerId,
      name: m.name,
      bestPerfAvg: m.bestPerfAvg,
      medianPerfAvg: m.medianPerfAvg
    }))
  };
}

// ── Entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Every response is HTTP 200 with a { success, error } body, matching the
  // GAS jsonpResponse convention this replaces -- callers check `.success`/
  // `.error` themselves rather than unpacking supabase-js's FunctionsHttpError
  // (which requires reading error.context separately to get this same body).
  try {
    const { action, teamId, zoneId, season } = await req.json();

    if (!action || !teamId) {
      return jsonResponse({ success: false, error: 'Missing action or teamId' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Not signed in' });
    }

    // Forwards the caller's own JWT rather than using the service role, so
    // RLS/my_team_role resolve exactly as they would for a direct frontend
    // call -- see the file header comment for why.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const [{ data: role }, { data: isSiteAdmin }] = await Promise.all([
      supabase.rpc('my_team_role', { p_team_id: teamId }),
      supabase.rpc('is_site_admin')
    ]);
    const authorized = role === 'officer' || role === 'team_leader' || isSiteAdmin === true;
    if (!authorized) {
      return jsonResponse({ success: false, error: 'Not authorized' });
    }

    if (action === 'getZoneEncounters') {
      if (!zoneId) return jsonResponse({ success: false, error: 'Missing zoneId' });
      const result = await getZoneEncounters(zoneId);
      return jsonResponse(result);
    }

    if (action === 'fetchProgression') {
      if (!zoneId) return jsonResponse({ success: false, error: 'Missing zoneId' });
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const result = await fetchProgression(zoneId, team.wcl_guild_id);
      return jsonResponse(result);
    }

    if (action === 'refreshPerformance') {
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const token = await getAccessToken();
      if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.' });
      const result = await refreshPerformance(token, team.wcl_guild_id, teamId, supabase);
      return jsonResponse(result);
    }

    if (action === 'refreshAttendance') {
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('wcl_guild_id')
        .eq('id', teamId)
        .maybeSingle();
      if (teamError) return jsonResponse({ success: false, error: teamError.message });
      if (!team?.wcl_guild_id) {
        return jsonResponse({ success: false, error: 'No WCL guild ID configured for this team' });
      }
      const token = await getAccessToken();
      if (!token) return jsonResponse({ success: false, error: 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.' });
      const result = await refreshAttendance(token, team.wcl_guild_id, teamId, supabase);
      return jsonResponse(result);
    }

    if (action === 'fetchSeasonPerf') {
      if (!zoneId) return jsonResponse({ success: false, error: 'Missing zoneId' });
      if (!season) return jsonResponse({ success: false, error: 'Missing season' });
      // No wcl_guild_id lookup here -- unlike every other action in this
      // file, fetchSeasonPerf queries each character directly rather than
      // through guild membership, so it has no guild-ID dependency at all.
      const result = await fetchSeasonPerf(teamId, season, zoneId, supabase);
      return jsonResponse(result);
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('wcl-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
