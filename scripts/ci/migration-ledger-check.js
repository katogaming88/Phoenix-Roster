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
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage:
//   psql "$DB_URL" -tAc "select version from supabase_migrations.schema_migrations" > ledger.txt
//   node scripts/ci/migration-ledger-check.js [migrations-dir] < ledger.txt
//
// The ledger read and the comparison are deliberately separate commands: in a
// pipeline the pipe's exit code is node's, so a failed psql would feed an
// empty ledger downstream and misreport every local migration as drift.
// Exit codes: 0 agreement, 1 drift, 2 usage error.

import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

function readStdin() {
  const chunks = [];
  return new Promise((resolve, reject) => {
    process.stdin
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'supabase/migrations';
  let filenames;
  try {
    filenames = readdirSync(dir);
  } catch {
    console.error(`Cannot read migrations directory: ${dir}`);
    process.exit(2);
  }
  const local = versionsFromFilenames(filenames);
  const remote = parseLedger(await readStdin());
  const { localOnly, remoteOnly } = compareLedger(local, remote);

  if (localOnly.length === 0 && remoteOnly.length === 0) {
    console.log(`Ledger and ${dir} agree (${local.length} versions).`);
    process.exit(0);
  }
  if (localOnly.length > 0) {
    console.log(`Committed but not recorded as applied on prod (run supabase db push):`);
    for (const v of localOnly) console.log(`  ${v}`);
  }
  if (remoteOnly.length > 0) {
    console.log(`Recorded on prod but missing from ${dir} (needs a human):`);
    for (const v of remoteOnly) console.log(`  ${v}`);
  }
  process.exit(1);
}
