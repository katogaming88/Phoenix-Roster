// One-time Sheets-to-Supabase import SQL generator (#320).
//
// Reads a team's tab CSV exports from data/<team>/ and writes one
// transactional, idempotent SQL file to data/sql/import-<team>.sql.
// Re-running the file reconciles the roster to the export (players upsert
// their sheet-owned fields and departed actives are archived, #208) and
// inserts only new rows everywhere else (natural-key ON CONFLICT targets).
// That re-apply is the roster refresh path until Phase 5 moves roster writes
// off the sheet. Apply it with psql:
//
//   psql "<local or service= connection>" -f data/sql/import-<team>.sql
//
// The BoE sheets are guild-wide and do not fit the per-team shape here; they
// have their own entry point, scripts/import/boe.js (#749).
//
// --- Roster refresh (#208) ---
// To refresh only the roster after sheet-side edits, point --data at a
// directory holding just a fresh Roster.csv:
//
//   node scripts/import/generate.js --team phoenix --data data/phoenix-refresh --out data/sql/refresh-phoenix.sql
//
// Missing tabs are skipped, so the output is the players reconciliation
// alone. Do not regenerate from a full export after players left the
// roster: history tabs name players in spellings (bare first names) that
// only resolve against the roster, so a departed player would come back as
// a new archived stub instead of matching their existing row.
//
// --- How to run ---
//   node scripts/import/generate.js --team phoenix --season "Season 3"
//
// Options:
//   --team <slug>      phoenix | hellfire (maps to teams.id 1 | 2)
//   --season <name>    current season string for scoring rows (NOT NULL)
//   --data <dir>       CSV directory (default data/<team>)
//   --out <file>       output (default data/sql/import-<team>.sql)
//   --mplus-manual <a,b>  manual M+ exclusion overrides (Script Properties
//                         list; names as First-Realm)
//   --tz <zone>        spreadsheet timezone for wall-clock timestamps
//                      (default America/New_York -- confirm on #320)
//   --seasons <file>   season ranges JSON [{name, start, end?}] used to
//                      derive legacy loot seasons (default data/seasons.json)
//
// Expected CSV filenames in the data directory (missing tabs are skipped
// with a note so exports can arrive incrementally):
//   Roster.csv, Scoring.csv, Item Lookup.csv, M+ Exclusion Requests.csv,
//   Attendance.csv, BiS List.csv, Priority Order.csv, Pasted Loot.csv,
//   Loot Data.csv (full-width A:V export), Officer Audit Log.csv,
//   Self Received Requests.csv, Discord Claims.csv

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadCsvIfPresent } from './lib/csv.js';
import { normName } from './lib/names.js';
import { buildPlayerRegistry } from './lib/registry.js';
import { parseItems, itemsSql, diffItemRegistries } from './tables/items.js';
import { parsePlayers, parseApprovedMplus, playersSql } from './tables/players.js';
import { parseScoring, scoringSql } from './tables/scoring.js';
import { parseAttendance, attendanceSql } from './tables/attendance.js';
import { parseBis, bisSql } from './tables/bis.js';
import { parsePriority, prioritySql } from './tables/priority.js';
import { parsePastedLoot, parseLegacyLoot, lootSql } from './tables/loot.js';
import { parseMplusRequests, mplusSql } from './tables/mplus.js';
import { parseSelfReceived, selfReceivedSql } from './tables/self-received.js';
import { parseAudit, auditSql } from './tables/audit.js';
import { parseDiscordClaims, discordClaimsSql } from './tables/discord-claims.js';

const TEAM_IDS = { phoenix: 1, hellfire: 2 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const team = arg('team');
if (!TEAM_IDS[team]) {
  console.error(`--team must be one of: ${Object.keys(TEAM_IDS).join(', ')}`);
  process.exit(1);
}
const teamId = TEAM_IDS[team];
const dataDir = arg('data', join('data', team));
const outFile = arg('out', join('data', 'sql', `import-${team}.sql`));
const season = arg('season', '');
const mplusManual = (arg('mplus-manual', '') || '').split(',').filter(Boolean);
const tz = arg('tz', 'America/New_York');
const seasonsFile = arg('seasons', join('data', 'seasons.json'));
const seasons = existsSync(seasonsFile) ? JSON.parse(readFileSync(seasonsFile, 'utf8')) : null;

const sections = [];
const summary = [];
const notes = [];

function section(title, sql) {
  sections.push(`-- === ${title} ===\n${sql}`);
}

// --- Item Lookup -> items + item_bosses (global tables, idempotent both runs)
const itemRows = loadCsvIfPresent(join(dataDir, 'Item Lookup.csv'));
let itemCount = 0;
let knownItems = null; // normName(item) set for validating item references
if (itemRows) {
  const { items, warnings } = parseItems(itemRows, `${team} Item Lookup`);
  for (const w of warnings) notes.push(`items: ${w}`);
  section('items + item_bosses', itemsSql(items));
  itemCount = items.length;
  knownItems = new Set(items.map((i) => normName(i.name)));
  summary.push(`items: ${items.length} (bosses on ${items.filter((i) => i.boss).length})`);

  const otherTeam = team === 'phoenix' ? 'hellfire' : 'phoenix';
  const otherRows = loadCsvIfPresent(join('data', otherTeam, 'Item Lookup.csv'));
  if (otherRows) {
    const other = parseItems(otherRows, `${otherTeam} Item Lookup`);
    for (const line of diffItemRegistries(items, team, other.items, otherTeam)) {
      notes.push(`item registry mismatch: ${line}`);
    }
  }
} else {
  notes.push('Item Lookup.csv missing -- items section skipped');
}

// --- Player-referencing tabs. Everything that can name a departed player is
// parsed BEFORE the players section is emitted, so the registry's archived
// stubs land in that insert; sections are then emitted in FK order.
const rosterRows = loadCsvIfPresent(join(dataDir, 'Roster.csv'));
if (rosterRows) {
  const players = parsePlayers(rosterRows, `${team} Roster`);
  const registry = buildPlayerRegistry(players.map((p) => p.nameRealm));

  let scoringResult = null;
  const scoringRows = loadCsvIfPresent(join(dataDir, 'Scoring.csv'));
  if (scoringRows) {
    scoringResult = scoringSql(teamId, parseScoring(scoringRows, `${team} Scoring`), registry, season);
  } else {
    notes.push('Scoring.csv missing -- scoring section skipped');
  }

  let attendanceResult = null;
  const attendanceRows = loadCsvIfPresent(join(dataDir, 'Attendance.csv'));
  if (attendanceRows) {
    const parsed = parseAttendance(attendanceRows, `${team} Attendance`);
    for (const w of parsed.warnings) notes.push(`attendance: ${w}`);
    attendanceResult = attendanceSql(teamId, parsed.entries, registry);
  } else {
    notes.push('Attendance.csv missing -- attendance section skipped');
  }

  let bisResult = null;
  const bisRows = loadCsvIfPresent(join(dataDir, 'BiS List.csv'));
  if (bisRows) {
    const { cells } = parseBis(bisRows, `${team} BiS List`);
    bisResult = bisSql(teamId, cells, registry, knownItems);
    for (const w of bisResult.warnings) notes.push(`bis_items: ${w}`);
  } else {
    notes.push('BiS List.csv missing -- bis_items section skipped');
  }

  let priorityResult = null;
  const priorityRows = loadCsvIfPresent(join(dataDir, 'Priority Order.csv'));
  if (priorityRows) {
    priorityResult = prioritySql(
      teamId,
      parsePriority(priorityRows, `${team} Priority Order`),
      registry,
      season,
      knownItems
    );
    for (const w of priorityResult.warnings) notes.push(`priority_order: ${w}`);
  } else {
    notes.push('Priority Order.csv missing -- priority_order section skipped');
  }

  let lootResult = null;
  const pastedRows = loadCsvIfPresent(join(dataDir, 'Pasted Loot.csv'));
  const legacyRows = loadCsvIfPresent(join(dataDir, 'Loot Data.csv'));
  if (pastedRows || legacyRows) {
    const entries = [
      ...(pastedRows ? parsePastedLoot(pastedRows, `${team} Pasted Loot`) : []),
      ...(legacyRows ? parseLegacyLoot(legacyRows, `${team} Loot Data`) : [])
    ];
    if (legacyRows && !seasons) notes.push(`no ${seasonsFile} -- legacy loot seasons import as null`);
    lootResult = lootSql(teamId, entries, registry, { knownItems, seasons, tz });
    for (const w of lootResult.warnings) notes.push(`rclc_loot: ${w}`);
  } else {
    notes.push('Pasted Loot.csv / Loot Data.csv missing -- rclc_loot section skipped');
  }

  const mplusRows = loadCsvIfPresent(join(dataDir, 'M+ Exclusion Requests.csv'));
  if (!mplusRows) notes.push('M+ Exclusion Requests.csv missing -- m_plus_excluded imports as false');
  const approved = parseApprovedMplus(mplusRows);

  let mplusResult = null;
  if (mplusRows) {
    mplusResult = mplusSql(teamId, parseMplusRequests(mplusRows, `${team} M+ Exclusion Requests`), registry, tz);
  }

  let claimsResult = null;
  const claimsRows = loadCsvIfPresent(join(dataDir, 'Discord Claims.csv'));
  if (claimsRows) {
    const parsed = parseDiscordClaims(claimsRows, `${team} Discord Claims`);
    for (const w of parsed.warnings) notes.push(`team_members: ${w}`);
    claimsResult = discordClaimsSql(teamId, parsed.claims, registry);
    for (const w of claimsResult.warnings) notes.push(`team_members: ${w}`);
  } else {
    notes.push('Discord Claims.csv missing -- team_members section skipped');
  }

  let selfReceivedResult = null;
  const selfReceivedRows = loadCsvIfPresent(join(dataDir, 'Self Received Requests.csv'));
  if (selfReceivedRows) {
    selfReceivedResult = selfReceivedSql(
      teamId,
      parseSelfReceived(selfReceivedRows, `${team} Self Received Requests`),
      registry,
      tz,
      knownItems
    );
    for (const w of selfReceivedResult.warnings) notes.push(`self_received_requests: ${w}`);
  } else {
    notes.push('Self Received Requests.csv missing -- self_received_requests section skipped');
  }

  const stubs = registry.stubNames();
  const playersResult = playersSql(teamId, players, approved, mplusManual, stubs);
  section('players', playersResult.sql);
  summary.push(`players: ${players.length} roster + ${stubs.length} archived stubs`);
  for (const w of playersResult.warnings) notes.push(`players: ${w}`);
  if (stubs.length) notes.push(`archived stubs for departed players: ${stubs.join(', ')}`);

  if (scoringResult) {
    section('scoring', scoringResult.sql);
    summary.push(`scoring: ${scoringResult.count} rows (season ${JSON.stringify(season)})`);
  }
  if (attendanceResult) {
    section('attendance', attendanceResult.sql);
    summary.push(`attendance: ${attendanceResult.count} rows`);
  }
  if (bisResult) {
    section('bis_items', bisResult.sql);
    summary.push(`bis_items: ${bisResult.count} rows (${bisResult.collapsed} duplicate cells collapsed)`);
  }
  if (priorityResult) {
    section('priority_order', priorityResult.sql);
    summary.push(`priority_order: ${priorityResult.count} rows (season ${JSON.stringify(season)})`);
  }
  if (mplusResult) {
    section('mplus_exclusion_requests', mplusResult.sql);
    summary.push(`mplus_exclusion_requests: ${mplusResult.count} rows`);
  }
  if (selfReceivedResult) {
    section('self_received_requests', selfReceivedResult.sql);
    summary.push(`self_received_requests: ${selfReceivedResult.count} rows`);
  }
  if (claimsResult) {
    section('team_members (discord claims)', claimsResult.sql);
    summary.push(`team_members: ${claimsResult.count} claims`);
  }
  if (lootResult) {
    section('rclc_loot', lootResult.sql);
    summary.push(
      `rclc_loot: ${lootResult.counts.pasted} pasted + ${lootResult.counts.legacy} legacy rows` +
        (lootResult.newItemCount ? ` (+${lootResult.newItemCount} old-tier items)` : '')
    );
  }
} else {
  notes.push('Roster.csv missing -- player-referencing sections skipped');
}

// --- Officer Audit Log (needs no roster; actor lives in the detail jsonb)
const auditRows = loadCsvIfPresent(join(dataDir, 'Officer Audit Log.csv'));
if (auditRows) {
  const auditResult = auditSql(teamId, parseAudit(auditRows, `${team} Officer Audit Log`), tz);
  section('audit_log', auditResult.sql);
  summary.push(`audit_log: ${auditResult.count} rows`);
} else {
  notes.push('Officer Audit Log.csv missing -- audit_log section skipped');
}

if (!sections.length) {
  console.error(`No CSVs found under ${dataDir} -- nothing to generate.`);
  process.exit(1);
}

const header =
  `-- Generated by scripts/import/generate.js for team ${team} (id ${teamId})\n` +
  `-- Source: ${dataDir}  (#320 one-time data migration)\n` +
  `-- Idempotent: re-applying reconciles players to the export and inserts\n` +
  `-- only new rows elsewhere.\n`;
const sql = `${header}\nbegin;\n\n${sections.join('\n')}\ncommit;\n`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, sql, 'utf8');

console.log(`Wrote ${outFile}`);
for (const s of summary) console.log(`  ${s}`);
if (itemCount || summary.length) console.log('Verify counts after apply against the numbers above.');
for (const n of notes) console.log(`  NOTE: ${n}`);
