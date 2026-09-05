// migration-new.js
// Creates a migration file whose 14-digit prefix comes from the Eastern wall
// clock, and re-stamps an existing one with --rename.
//
// Supabase applies migrations in numeric order of that prefix and `supabase db
// push` refuses the whole run when a not-yet-applied local file sorts below the
// newest version already on prod. The prefix is therefore a sort key shared
// between two machines, so it has to come from one clock. CONTRIBUTING has
// asked for the real local timestamp since #761, but nothing produced one:
// `supabase migration new` stamps UTC (four hours ahead of Eastern in summer,
// five in winter) and the alternative was typing a round number by hand. 30 of
// the repo's 161 migrations sort below a migration that was added in an earlier
// commit, and two of those became push refusals (2026-08-26 and 2026-09-03).
//
// Eastern rather than UTC because that is what CONTRIBUTING already asks for,
// what the repo treats as canonical (#803), and what most of the recent files
// already use. The database is unaffected either way: Postgres never parses
// this prefix and it touches no stored value.
//
// No external dependencies, so it runs without npm ci. Node 18+ ships full ICU,
// which is what makes the time zone conversion below work with no library.
//
// Usage:
//   node scripts/ci/migration-new.js <slug> [--dir <path>]
//   node scripts/ci/migration-new.js --rename <path>
//
// Exit codes: 0 written, 1 refused, 2 usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DIR = 'supabase/migrations';
const SLUG = /^[a-z0-9_]+$/;
const MIGRATION_FILE = /^(\d{14})_(.+)\.sql$/;

// First line names the issue and what the migration does, then a blank comment
// line, then why. Cite a prior migration by filename when patching one.
const HEADER = `-- #NNN: <what this migration does>.
--
-- <Why it is needed, and what breaks without it.>
`;

/** The Eastern wall clock at `date`, as the 14 digits a migration filename carries. */
export function easternStamp(date = new Date()) {
  const at = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
    .formatToParts(at)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/** A stamp written back out for a human to read. */
export function readableStamp(version) {
  const [y, mo, d, h, mi, s] = [
    version.slice(0, 4),
    version.slice(4, 6),
    version.slice(6, 8),
    version.slice(8, 10),
    version.slice(10, 12),
    version.slice(12, 14)
  ];
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/** The highest-sorting migration in a list of filenames, or null when there is none. */
export function newestMigration(filenames) {
  return (
    filenames
      .map((name) => ({ name, match: name.match(MIGRATION_FILE) }))
      .filter((entry) => entry.match)
      .map((entry) => ({ name: entry.name, version: entry.match[1] }))
      .sort((a, b) => a.version.localeCompare(b.version))
      .at(-1) ?? null
  );
}

function readDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    console.error(`Cannot read migrations directory: ${dir}`);
    process.exit(2);
  }
}

/** Refuses when something already sorts at or above `stamp`, since Supabase would not apply the new file. */
function refuseIfNotNewest(stamp, existing) {
  const newest = newestMigration(existing);
  if (!newest || stamp > newest.version) return;
  console.error(`A migration already sorts at or above ${stamp}:`);
  console.error(`  ${newest.name} (${readableStamp(newest.version)} Eastern)`);
  console.error('Nothing can be stamped past it until the clock does. Wait, or re-stamp that file:');
  console.error('  npm run migration:new -- --rename <path to that file>');
  process.exit(1);
}

function create(slug, dir) {
  if (!SLUG.test(slug)) {
    console.error(`Slug must be lowercase letters, digits and underscores. Got: ${JSON.stringify(slug)}`);
    console.error('Name it after the object changed: <table>_<column>, or <function>_<what changed>. No dates.');
    process.exit(1);
  }
  const existing = readDir(dir);
  const stamp = easternStamp();
  refuseIfNotNewest(stamp, existing);
  const target = join(dir, `${stamp}_${slug}.sql`);
  writeFileSync(target, HEADER);
  console.log(target);
}

function rename(path) {
  if (!existsSync(path)) {
    console.error(`No such file: ${path}`);
    process.exit(1);
  }
  const match = basename(path).match(MIGRATION_FILE);
  if (!match) {
    console.error(`Not a migration filename (expected <14 digits>_<slug>.sql): ${basename(path)}`);
    process.exit(1);
  }
  const dir = dirname(path);
  const stamp = easternStamp();
  refuseIfNotNewest(
    stamp,
    readDir(dir).filter((name) => name !== basename(path))
  );
  const target = join(dir, `${stamp}_${match[2]}.sql`);
  try {
    // git mv keeps the rename visible as one change rather than a delete and
    // an add. It fails on a file git does not track, which is fine: then a
    // plain rename is all there is to do.
    execFileSync('git', ['mv', path, target], { stdio: 'pipe' });
  } catch {
    renameSync(path, target);
  }
  console.log(target);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const positional = [];
  let dir = DEFAULT_DIR;
  let renamePath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') dir = args[++i];
    else if (args[i] === '--rename') renamePath = args[++i];
    else positional.push(args[i]);
  }

  if (renamePath) {
    rename(renamePath);
  } else if (positional.length === 1) {
    create(positional[0], dir);
  } else {
    console.error('Usage: npm run migration:new -- <slug>');
    console.error('       npm run migration:new -- --rename <path>');
    process.exit(2);
  }
}
