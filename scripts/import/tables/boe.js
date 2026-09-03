// BoE history import: the Google Form response sheet (found events) and the
// sold-BoE sheets -> boe_items (#749). The sheets are guild-wide, so this
// module has its own entry point (scripts/import/boe.js) rather than a slot
// in generate.js, which is one team per run.
//
// Both sheets were typed by raiders and officers rather than produced by a
// form with fixed vocabularies, so everything here is header-located and
// tolerant. The track lives inside the Item cell in a dozen placements
// ("Heroic X", "(Hero) X", "X - Hero 3/6", "X-Champ", "(Mythic 279) X",
// "Champion: X"). Finder spellings differ between the two sheets (realm added
// or dropped, diacritics, one-letter typos), and item spellings differ by one
// letter in a handful of rows. Every fuzzy acceptance warns with both
// spellings, so the generate-time NOTE list is the review surface.
//
// Sales match finds by finder plus item, never by team: the first nine form
// rows predate the Team question. The sold sheet is the payout record, so
// where the two disagree its spelling, team and track win.
//
// No unique key on boe_items: idempotency via NOT EXISTS on
// (team_id, found_at). item_name is deliberately not part of the key, since a
// find that sells between two runs changes spelling to the sold sheet's.
// boeSql() throws on a duplicate key inside one batch, because NOT EXISTS
// checks the table, not the VALUES list.

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, sqlNumber, insertWhereNotExists } from '../lib/sql.js';
import { parseSheetTimestamp, sqlTimestampAtZone, seasonForDate } from '../lib/dates.js';
import { itemIdSql } from '../lib/registry.js';

// Legacy team strings -> teams.id. "Ashrend" is the former name of Hellfire
// Rollers (renamed this season; 14 of the 48 sold rows use it). Wrathless is
// a real team row since #767 rather than a mapping onto another team.
export const TEAM_MAP = {
  phoenix: 1,
  ashrend: 2,
  hellfire: 2,
  'hellfire rollers': 2,
  immolation: 3,
  wrathless: 4,
  'team wrathless': 4
};

// Sheet difficulty words -> the boe_items.track vocabulary. Normal drops
// Champion-track loot (same call as tables/self-received.js).
export const TRACK = {
  normal: 'Champion',
  champ: 'Champion',
  champion: 'Champion',
  hero: 'Hero',
  heroic: 'Hero',
  myth: 'Myth',
  mythic: 'Myth'
};

// Form rows that are not finds. Keyed on the raw Timestamp cell; the value is
// the reason, which the warning repeats.
export const SKIP_FORM_TIMESTAMPS = {
  '5/20/2026 11:00:55': 'bot test submission (finder and item both read "bot test")'
};

const TRACK_GROUP_RE = /[([]\s*(heroic|hero|champion|champ|mythic|myth|normal)\b[^)\]]*[)\]]/i;
const TRACK_WORD_RE = /\b(heroic|hero|champion|champ|mythic|myth|normal)\b/i;
const UPGRADE_RE = /\b\d+\/\d+\b/g;
const LEVEL_RE = /(^|[^0-9])([0-9]{3})([^0-9]|$)/;
const BRACKET_RE = /\([^)]*\)|\[[^\]]*\]/g;
const DUPLICATE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function teamIdFor(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return Object.prototype.hasOwnProperty.call(TEAM_MAP, key) ? TEAM_MAP[key] : null;
}

function tidy(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:]+|[\s\-:]+$/g, '')
    .trim();
}

// Pull the track word out of a free-text item cell. A bracket group holding
// the word goes entirely (it also carries item levels: "(Mythic 279)");
// otherwise the word alone goes and the separators around it are tidied
// away. "N/6" upgrade fragments go too. No word means a null track.
export function splitTrack(text) {
  let s = String(text || '').trim();
  if (!s) return { track: null, itemName: '' };
  let track = null;
  const group = s.match(TRACK_GROUP_RE);
  if (group) {
    track = TRACK[group[1].toLowerCase()];
    s = s.slice(0, group.index) + ' ' + s.slice(group.index + group[0].length);
  } else {
    const word = s.match(TRACK_WORD_RE);
    if (word) {
      track = TRACK[word[1].toLowerCase()];
      s = s.slice(0, word.index) + ' ' + s.slice(word.index + word[0].length);
    }
  }
  s = s.replace(UPGRADE_RE, ' ');
  return { track, itemName: tidy(s) };
}

// The same split, keeping what a person typed beside the name (#865): the
// first "N/N" as the upgrade rank, and a three-digit number inside the track
// bracket group ("(Mythic 279)") as the item level. There is no level column,
// so parseFound() carries the level into the note rather than dropping it.
export function splitItemCell(text) {
  const s = String(text || '');
  const ranks = s.match(UPGRADE_RE);
  const upgradeRank = ranks ? ranks[0] : null;
  const group = s.match(TRACK_GROUP_RE);
  const level = group ? group[0].match(LEVEL_RE) : null;
  const itemLevel = level ? Number(level[2]) : null;
  return { ...splitTrack(s), upgradeRank, itemLevel };
}

// Item comparison key: folded, bracket groups and upgrade fragments dropped,
// alphanumerics only ("Infernal Greatlock Girdle (Socket)" and
// "infernal greatlock girdle" agree).
export function normItem(s) {
  return normName(s)
    .replace(BRACKET_RE, ' ')
    .replace(UPGRADE_RE, ' ')
    .replace(/[^a-z0-9]/g, '');
}

// Finder comparison keys. `full` and `first` fold diacritics for sheet-to-
// sheet matching. `sqlKey` drops non-ASCII instead of folding it, which is
// exactly what the apply-time subselect does to players.name_realm with
// regexp_replace, so the two sides agree on accented names.
export function finderKey(raw) {
  const s = String(raw || '').trim();
  const alnum = (x) => x.replace(/[^a-z0-9]/g, '');
  const full = alnum(normName(s));
  const first = alnum(normName(s.split('-')[0]));
  return {
    full,
    first,
    hasRealm: s.includes('-') && full.length > first.length,
    sqlKey: alnum(s.toLowerCase())
  };
}

// Optimal string alignment distance: substitutions, insertions, deletions
// and adjacent transpositions each cost one.
export function osaDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

// Open rows keep the form's spelling; an all-lowercase one gets title-cased
// so it sits beside the sold sheet's names in the manager view.
export function titleCaseIfLower(s) {
  const str = String(s || '');
  if (str !== str.toLowerCase()) return str;
  return str.replace(/(^|\s)([a-z])/g, (whole, space, ch) => space + ch.toUpperCase());
}

// "First - Realm" -> "First-Realm"; realms with spaces ("Argent Dawn") keep them.
function cleanFinder(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s*-\s*/g, '-');
}

// 0 for an exact match, 1 for one edit away, null for no match.
function stringMatch(a, b) {
  if (!a || !b) return null;
  if (a === b) return 0;
  return osaDistance(a, b) <= 1 ? 1 : null;
}

function finderMatch(a, b) {
  if (!a.full || !b.full) return null;
  if (a.hasRealm && b.hasRealm) return stringMatch(a.full, b.full);
  return stringMatch(a.first, b.first);
}

function parseGold(value) {
  const s = String(value || '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseFound(rows, label = 'BoE Form Responses') {
  assertHeader(rows, 0, { 0: 'timestamp', 1: 'character', 2: 'team', 3: 'item', 4: 'note' }, label);
  const entries = [];
  const warnings = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const timestamp = String(row[0] || '').trim();
    const itemRaw = String(row[3] || '').trim();
    if (!timestamp && !itemRaw) continue;
    const rowNo = i + 1;
    if (Object.prototype.hasOwnProperty.call(SKIP_FORM_TIMESTAMPS, timestamp)) {
      warnings.push(`${label} row ${rowNo} (${timestamp}): skipped, ${SKIP_FORM_TIMESTAMPS[timestamp]}`);
      skipped++;
      continue;
    }
    const { track, itemName, upgradeRank: cellRank, itemLevel } = splitItemCell(itemRaw);
    if (!itemName) {
      warnings.push(`${label} row ${rowNo}: no item name in ${JSON.stringify(itemRaw)}, skipped`);
      skipped++;
      continue;
    }
    const teamRaw = String(row[2] || '').trim();
    const teamId = teamIdFor(teamRaw);
    if (teamRaw && teamId === null) {
      warnings.push(`${label} row ${rowNo}: unknown team ${JSON.stringify(teamRaw)} (treated as blank)`);
    }
    // A note that is only a rank ("2/6") is the rank, not a note (#865); a
    // level from the item cell lands in the note, since nothing else keeps it.
    let note = String(row[4] || '').trim();
    let upgradeRank = cellRank;
    const noteRanks = note.match(UPGRADE_RE);
    if (!upgradeRank && noteRanks && noteRanks[0] === note) {
      upgradeRank = note;
      note = '';
    }
    if (itemLevel !== null) {
      note = [note, 'ilvl ' + itemLevel].filter(Boolean).join(' | ');
    }
    entries.push({
      label,
      rowNo,
      timestamp,
      finderRaw: String(row[1] || '').trim(),
      teamRaw,
      teamId,
      track,
      upgradeRank,
      itemRaw,
      itemName,
      note
    });
  }
  return { entries, warnings, skipped };
}

const SOLD_HEADER = {
  0: 'date',
  1: 'finder',
  2: 'team',
  3: 'item',
  4: 'quality',
  5: 'sold',
  6: 'sale date',
  7: 'sale price',
  8: 'finder cut',
  9: 'guild cut',
  10: 'notes'
};

export function parseSold(rows, label = 'BoE sold sheet') {
  assertHeader(rows, 0, SOLD_HEADER, label);
  const entries = [];
  const warnings = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const dateSubmitted = String(row[0] || '').trim();
    const finderRaw = String(row[1] || '').trim();
    const itemName = String(row[3] || '').trim();
    // The sheet ships hundreds of blank formula rows (Sold=FALSE, Guild Cut=0)
    // and a Total row among them; none carries a date, finder or item.
    if (!dateSubmitted && !finderRaw && !itemName) continue;
    const rowNo = i + 1;
    const where = `${label} row ${rowNo}`;
    const skip = (why) => {
      warnings.push(`${where}: ${why}, skipped`);
      skipped++;
    };
    if (
      String(row[5] || '')
        .trim()
        .toUpperCase() !== 'TRUE'
    ) {
      skip('not marked sold');
      continue;
    }
    const saleDate = String(row[6] || '').trim();
    if (!saleDate) {
      skip('no sale date');
      continue;
    }
    const salePrice = parseGold(row[7]);
    if (salePrice === null) {
      skip(`no sale price (${JSON.stringify(String(row[7] || ''))})`);
      continue;
    }
    const finderCut = parseGold(row[8]);
    const guildCut = parseGold(row[9]);
    if (finderCut === null || guildCut === null) {
      skip('finder cut or guild cut missing');
      continue;
    }
    const teamRaw = String(row[2] || '').trim();
    const teamId = teamIdFor(teamRaw);
    if (teamId === null) {
      skip(teamRaw ? `unknown team ${JSON.stringify(teamRaw)}` : 'no team');
      continue;
    }
    const quality = String(row[4] || '').trim();
    const track = Object.prototype.hasOwnProperty.call(TRACK, quality.toLowerCase())
      ? TRACK[quality.toLowerCase()]
      : null;
    if (quality && !track) {
      warnings.push(`${where}: unknown quality ${JSON.stringify(quality)}, track left null`);
    }
    entries.push({
      label,
      rowNo,
      dateSubmitted,
      finderRaw,
      teamRaw,
      teamId,
      itemName,
      track,
      saleDate,
      salePrice,
      finderCut,
      guildCut,
      notes: String(row[10] || '').trim()
    });
  }
  return { entries, warnings, skipped };
}

function paidRow(sold, found) {
  const note = [found ? found.note : '', sold.notes].filter(Boolean).join(' | ');
  let track = sold.track;
  if (!track && found) track = found.track;
  return {
    status: 'paid',
    standalone: !found,
    teamId: sold.teamId,
    finderName: sold.finderRaw,
    itemName: sold.itemName,
    track,
    upgradeRank: found ? found.upgradeRank : null,
    note,
    foundAt: found ? found.timestamp : sold.dateSubmitted,
    soldAt: sold.saleDate,
    salePrice: sold.salePrice,
    finderCut: sold.finderCut,
    guildCut: sold.guildCut,
    soldRef: `${sold.label} row ${sold.rowNo}`,
    formRef: found ? `${found.label} row ${found.rowNo}` : null
  };
}

function millis(localTimestamp) {
  return Date.parse(localTimestamp.replace(' ', 'T') + 'Z');
}

// Pair every sold row with a form submission where one exists. Candidates
// share a finder (full name-realm when both sides carry a realm, first name
// otherwise) and an item, each exact or one edit away. Exact/exact wins,
// then the earliest submission (FIFO). A tie with no ordering is ambiguous
// and the sale imports standalone so no money is lost.
export function matchSales(found, sold) {
  const warnings = [];
  const rows = [];
  const claimed = new Set();
  const keyed = found.map((f) => ({
    f,
    fk: finderKey(f.finderRaw),
    ik: normItem(f.itemName),
    ts: parseSheetTimestamp(f.timestamp)
  }));

  for (const s of sold) {
    const sk = finderKey(s.finderRaw);
    const sik = normItem(s.itemName);
    const label = `${s.label} row ${s.rowNo} (${s.finderRaw} / ${s.itemName})`;
    const candidates = [];
    for (const c of keyed) {
      if (claimed.has(c.f.rowNo)) continue;
      const fm = finderMatch(c.fk, sk);
      if (fm === null) continue;
      const im = stringMatch(c.ik, sik);
      if (im === null) continue;
      candidates.push({ ...c, score: fm + im });
    }
    if (!candidates.length) {
      rows.push(paidRow(s, null));
      warnings.push(`${label}: no form submission matches; imported as a standalone paid row dated ${s.dateSubmitted}`);
      continue;
    }
    candidates.sort((a, b) => a.score - b.score || a.ts.localeCompare(b.ts) || a.f.rowNo - b.f.rowNo);
    const best = candidates[0];
    const next = candidates[1];
    if (next && next.score === best.score && next.ts === best.ts) {
      rows.push(paidRow(s, null));
      warnings.push(
        `${label}: ambiguous, form rows ${best.f.rowNo} and ${next.f.rowNo} match equally; ` +
          'imported as a standalone paid row and both submissions left open'
      );
      continue;
    }
    claimed.add(best.f.rowNo);
    const f = best.f;
    if (best.score > 0) {
      warnings.push(
        `${s.label} row ${s.rowNo}: fuzzy match, form row ${f.rowNo} ${JSON.stringify(f.finderRaw)} / ` +
          `${JSON.stringify(f.itemName)} vs sold ${JSON.stringify(s.finderRaw)} / ${JSON.stringify(s.itemName)}`
      );
    }
    if (f.teamId !== null && f.teamId !== s.teamId) {
      warnings.push(
        `${label}: team disagrees with form row ${f.rowNo} (${JSON.stringify(f.teamRaw)} vs sold ` +
          `${JSON.stringify(s.teamRaw)}); sold team ${s.teamId} kept`
      );
    }
    if (f.track && s.track && f.track !== s.track) {
      warnings.push(
        `${label}: track disagrees with form row ${f.rowNo} (${f.track} vs sold ${s.track}); sold track kept`
      );
    }
    rows.push(paidRow(s, f));
  }

  for (const c of keyed) {
    if (claimed.has(c.f.rowNo)) continue;
    const f = c.f;
    if (f.teamId === null) {
      warnings.push(
        `${f.label} row ${f.rowNo}: ${f.finderRaw} / ${f.itemName} has no team and no matching sale, skipped`
      );
      continue;
    }
    rows.push({
      status: 'found',
      standalone: false,
      teamId: f.teamId,
      finderName: cleanFinder(f.finderRaw),
      itemName: titleCaseIfLower(f.itemName),
      track: f.track,
      upgradeRank: f.upgradeRank,
      note: f.note,
      foundAt: f.timestamp,
      soldAt: null,
      salePrice: null,
      finderCut: null,
      guildCut: null,
      soldRef: null,
      formRef: `${f.label} row ${f.rowNo}`
    });
  }

  // Suspected re-submissions: same finder, item, track and rank inside 48
  // hours. Imported anyway (two real finds a minute apart exist), flagged for
  // review. Two ranks that differ are two items (#865), not a re-submission.
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const a = keyed[i];
      const b = keyed[j];
      if (a.f.track !== b.f.track) continue;
      if (a.f.upgradeRank && b.f.upgradeRank && a.f.upgradeRank !== b.f.upgradeRank) continue;
      if (finderMatch(a.fk, b.fk) === null || stringMatch(a.ik, b.ik) === null) continue;
      if (Math.abs(millis(a.ts) - millis(b.ts)) > DUPLICATE_WINDOW_MS) continue;
      warnings.push(
        `${b.f.label} row ${b.f.rowNo}: possible duplicate of row ${a.f.rowNo} ` +
          `(${a.f.finderRaw} / ${a.f.itemName} within 48h); both imported`
      );
    }
  }

  return { rows, warnings };
}

// The split pinned on #745: finder gets least(sale, greatest(floor,
// round(sale * floor / pivot))), guild gets the rest. Sheet values are kept;
// a mismatch is a warning for review, not a correction.
export function checkCut(sale, finderCut, guildCut, floor, pivot) {
  const warnings = [];
  const expected = Math.min(sale, Math.max(floor, Math.round((sale * floor) / pivot)));
  if (finderCut !== expected) {
    warnings.push(
      `finder cut ${finderCut} differs from the policy formula (${expected}) at floor ${floor} / pivot ${pivot}; sheet value kept`
    );
  }
  if (finderCut + guildCut !== sale) {
    warnings.push(`finder cut ${finderCut} + guild cut ${guildCut} do not sum to the sale price ${sale}`);
  }
  return warnings;
}

const COLUMNS = [
  'team_id',
  'player_id',
  'finder_name',
  'item_id',
  'item_name',
  'track',
  'upgrade_rank',
  'season',
  'note',
  'status',
  'found_at',
  'sold_at',
  'payout_paid_at',
  'sale_price',
  'finder_payout',
  'guild_cut',
  'payout_floor',
  'payout_pivot'
];

// Apply-time player link. Compares alphanumerics only, the same reduction
// finderKey().sqlKey makes, so realm spacing and punctuation differences
// ("Area 52" / "Area52", "Mal'Ganis" / "MalGanis") do not matter. Archived
// players are eligible: this is history.
function playerIdSql(teamId, sqlKey) {
  return (
    `(select p.id from players p where p.team_id = ${teamId} and ` +
    `lower(regexp_replace(p.name_realm, '[^A-Za-z0-9]', '', 'g')) = ${sqlString(sqlKey)} ` +
    'order by p.archived_at nulls first limit 1)'
  );
}

export function boeSql(rows, opts = {}) {
  const { tz = 'America/New_York', seasons = null, floor = 20000, pivot = 100000 } = opts;
  const warnings = [];
  if (!seasons) warnings.push('no season ranges supplied (--seasons); season column left null');
  const counts = {
    open: 0,
    paid: 0,
    standalone: 0,
    total: 0,
    salePrice: 0,
    finderPayout: 0,
    guildCut: 0,
    byTeam: {},
    playerLinks: 0
  };
  const seen = new Map();

  const valueRows = rows.map((r) => {
    const foundLocal = parseSheetTimestamp(r.foundAt);
    const key = `${r.teamId}|${foundLocal}`;
    if (seen.has(key)) {
      const other = seen.get(key);
      throw new Error(
        `duplicate (team_id, found_at) key ${r.teamId} / ${foundLocal}: ${other.finderName} / ${other.itemName} and ` +
          `${r.finderName} / ${r.itemName} would both insert and the NOT EXISTS guard cannot tell them apart`
      );
    }
    seen.set(key, r);

    const fk = finderKey(r.finderName);
    let playerSql = 'null::integer';
    if (fk.hasRealm && fk.sqlKey) {
      playerSql = playerIdSql(r.teamId, fk.sqlKey);
      counts.playerLinks++;
    }
    const season = seasons ? seasonForDate(foundLocal, seasons) : null;
    counts.byTeam[r.teamId] = (counts.byTeam[r.teamId] || 0) + 1;
    counts.total++;

    const base = [
      String(r.teamId),
      playerSql,
      sqlString(r.finderName),
      itemIdSql(r.itemName),
      sqlString(r.itemName),
      sqlString(r.track),
      r.upgradeRank ? sqlString(r.upgradeRank) : 'null::text',
      sqlString(season),
      sqlString(r.note),
      sqlString(r.status),
      sqlTimestampAtZone(r.foundAt, tz)
    ];

    if (r.status === 'paid') {
      counts.paid++;
      if (r.standalone) counts.standalone++;
      counts.salePrice += r.salePrice;
      counts.finderPayout += r.finderCut;
      counts.guildCut += r.guildCut;
      for (const w of checkCut(r.salePrice, r.finderCut, r.guildCut, floor, pivot)) {
        warnings.push(`${r.soldRef} (${r.finderName} / ${r.itemName}): ${w}`);
      }
      const soldAt = sqlTimestampAtZone(r.soldAt, tz);
      return [
        ...base,
        soldAt,
        soldAt,
        sqlNumber(r.salePrice),
        sqlNumber(r.finderCut),
        sqlNumber(r.guildCut),
        String(floor),
        String(pivot)
      ];
    }

    counts.open++;
    return [
      ...base,
      'null::timestamptz',
      'null::timestamptz',
      'null::bigint',
      'null::bigint',
      'null::bigint',
      'null::bigint',
      'null::bigint'
    ];
  });

  const sql = insertWhereNotExists(
    'boe_items',
    COLUMNS,
    valueRows,
    't.team_id = v.team_id and t.found_at = v.found_at'
  );
  return { sql, counts, warnings };
}

// The data directory holds Google's own export names ("BOE Tracking - Form
// Responses 1.csv", "BOE Tracking - Midnight S1.csv"). The Form Responses
// file is the found sheet; every other CSV is a sold sheet.
export function classifyInputs(filenames) {
  const csvs = filenames.filter((f) => /\.csv$/i.test(f)).sort();
  const found = csvs.filter((f) => /form responses/i.test(f));
  if (found.length !== 1) {
    throw new Error(`expected exactly one "Form Responses" CSV in the data directory, found ${found.length}`);
  }
  return { found: found[0], sold: csvs.filter((f) => f !== found[0]) };
}
