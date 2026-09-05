// migration-ledger-check.js
// Compares supabase/migrations/ filenames against the versions prod's
// supabase_migrations.schema_migrations ledger actually holds. The two drift
// whenever a migration's SQL is applied through the dashboard SQL Editor,
// which runs the statements but never writes the ledger row: the schema
// moves, the record does not, and enough of that blocks `supabase db push`
// outright (LegacyDbPushMissingRemoteError on the first out-of-order
// version). On 2026-08-31 the ledger was 22 migrations behind the live
// schema for exactly this reason and had to be repaired by hand.
//
// A local-only version means a committed migration nobody has pushed through
// the CLI: the fix is `supabase db push` (which both applies it if needed and
// writes the ledger row). A remote-only version means the ledger names a
// migration the repo no longer carries, which should never happen and needs a
// human.
//
// Two more rules ride along, both about the 14-digit prefix rather than the
// ledger (#927). Order: a pending file may not sort below the newest version
// already applied on prod, because `supabase db push` refuses the whole run
// when one does, and the fix is a rename rather than a push. Clock: a file
// added in this event may not carry a stamp ahead of the Eastern wall clock at
// the commit that added it, which is what a `supabase migration new` UTC stamp
// and a hand-typed round number both look like. The clock rule judges the
// files named by --new rather than the pending ones, so it keeps working after
// someone has run `db push`.
//
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage:
//   psql "$DB_URL" -tAc "select version from supabase_migrations.schema_migrations" > ledger.txt
//   node scripts/ci/migration-ledger-check.js [migrations-dir] [--new <path>]... < ledger.txt
//
// The ledger read and the comparison are deliberately separate commands: in a
// pipeline the pipe's exit code is node's, so a failed psql would feed an
// empty ledger downstream and misreport every local migration as drift.
// Exit codes: 0 agreement, 1 drift, 2 usage error.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { easternStamp, readableStamp } from './migration-new.js';

const MIGRATION_FILE = /^(\d{14})_.+\.sql$/;

export function versionsFromFilenames(filenames) {
  return filenames
    .map((name) => name.match(MIGRATION_FILE))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
}

export function parseLedger(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export function compareLedger(localVersions, remoteVersions) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);
  return {
    localOnly: [...local].filter((v) => !remote.has(v)).sort(),
    remoteOnly: [...remote].filter((v) => !local.has(v)).sort()
  };
}

/** Pending versions that sort below the newest one already applied on prod. */
export function outOfOrder(pendingVersions, remoteVersions) {
  if (remoteVersions.length === 0) return [];
  const newestRemote = [...remoteVersions].sort().at(-1);
  return pendingVersions.filter((version) => version < newestRemote).sort();
}

// A 14-digit stamp read as a count of seconds, so two of them can be compared
// with a tolerance. Both sides are Eastern wall clocks, so the arithmetic
// happens in wall-clock space and the UTC constructor is only the parser.
function wallSeconds(version) {
  return (
    Date.UTC(
      Number(version.slice(0, 4)),
      Number(version.slice(4, 6)) - 1,
      Number(version.slice(6, 8)),
      Number(version.slice(8, 10)),
      Number(version.slice(10, 12)),
      Number(version.slice(12, 14))
    ) / 1000
  );
}

/** True when the stamp runs ahead of the Eastern wall clock at `addedAtIso`, past the allowed skew. */
export function aheadOfWallClock(version, addedAtIso, skewMinutes = 5) {
  return wallSeconds(version) > wallSeconds(easternStamp(addedAtIso)) + skewMinutes * 60;
}

function gitAuthorDates(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/**
 * The author date of the oldest commit touching `path`, which is the last line
 * git prints, or null when git knows nothing about it. A squash merge rewrites
 * this to merge time, so the PR run is where the clock rule has teeth.
 */
export function addedAt(path, run = gitAuthorDates) {
  let output;
  try {
    output = run(['log', '--format=%aI', '--', path]);
  } catch {
    return null;
  }
  const dates = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const positional = [];
  const newFiles = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--new') {
      const value = args[++i];
      if (value) newFiles.push(value);
    } else {
      positional.push(args[i]);
    }
  }
  const dir = positional[0] ?? 'supabase/migrations';
  let filenames;
  try {
    filenames = readdirSync(dir);
  } catch {
    console.error(`Cannot read migrations directory: ${dir}`);
    process.exit(2);
  }
  const local = versionsFromFilenames(filenames);
  const remote = parseLedger(readFileSync(0, 'utf8'));
  const { localOnly, remoteOnly } = compareLedger(local, remote);

  const nameOf = new Map();
  for (const filename of filenames) {
    const match = filename.match(MIGRATION_FILE);
    if (match) nameOf.set(match[1], filename);
  }

  const pendingBelow = outOfOrder(localOnly, remote);
  const newestRemote = remote.length > 0 ? [...remote].sort().at(-1) : null;

  const stampedAhead = [];
  const noHistory = [];
  for (const file of newFiles) {
    const match = basename(file).match(MIGRATION_FILE);
    if (!match) continue;
    const anchor = addedAt(file);
    if (anchor === null) {
      noHistory.push(file);
      continue;
    }
    if (aheadOfWallClock(match[1], anchor)) stampedAhead.push({ file, version: match[1], anchor });
  }

  // Order first: a file that trips both rules is unblocked by the rename, and
  // the push message below would otherwise be the first thing read.
  if (pendingBelow.length > 0) {
    console.log(
      `Sorts before the newest migration applied on prod (${newestRemote}), so supabase db push refuses the run:`
    );
    for (const version of pendingBelow) {
      const filename = nameOf.get(version) ?? version;
      console.log(`  ${filename}`);
      console.log(`  Rename: npm run migration:new -- --rename ${dir}/${filename}`);
    }
  }
  if (stampedAhead.length > 0) {
    console.log(
      'Stamped ahead of the Eastern wall clock at the commit that added it, so it came from UTC or from a keyboard:'
    );
    for (const { file, version, anchor } of stampedAhead) {
      console.log(
        `  ${basename(file)} stamped ${readableStamp(version)}, added ${readableStamp(easternStamp(anchor))}`
      );
      console.log(`  Rename: npm run migration:new -- --rename ${file}`);
    }
  }
  if (noHistory.length > 0) {
    console.log('Skipped by the clock rule, no commit history for them yet:');
    for (const file of noHistory) console.log(`  ${basename(file)}`);
  }
  if (localOnly.length > 0) {
    console.log(`Committed but not recorded as applied on prod (run supabase db push):`);
    for (const v of localOnly) console.log(`  ${v}`);
  }
  if (remoteOnly.length > 0) {
    console.log(`Recorded on prod but missing from ${dir} (needs a human):`);
    for (const v of remoteOnly) console.log(`  ${v}`);
  }

  const failed = pendingBelow.length > 0 || stampedAhead.length > 0 || localOnly.length > 0 || remoteOnly.length > 0;
  if (!failed) console.log(`Ledger and ${dir} agree (${local.length} versions).`);
  console.log(`Rules: checked ${localOnly.length} pending for order, ${newFiles.length} new for clock.`);
  process.exit(failed ? 1 : 0);
}
