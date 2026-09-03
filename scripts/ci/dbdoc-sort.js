// dbdoc-sort.js
// Puts every trigger listing under dbdoc/ into name order after `tbls doc`.
//
// .tbls.yml asks tbls to sort its output, and on Linux (where CI runs) it
// does. On Windows `tbls doc` writes each table's triggers in Postgres catalog
// order regardless, which is not stable across `supabase db reset` runs, so a
// regen here produced docs that failed the schema-docs workflow's `tbls diff`
// on five tables no migration had touched (2026-09-02, twice). That diff never
// sorts the live side either, so the committed files being in name order is
// the only thing that keeps the check green.
//
// Two pure functions, both idempotent, plus a main() that rewrites whatever
// under dbdoc/ they change. `npm run db:docs` runs this after tbls; run it
// alone after a by-hand `tbls doc`. tests/ci/dbdoc-sort.test.js asserts the
// committed docs already round-trip through both functions unchanged.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Built from the char code so a shell handoff cannot halve it.
const BS = String.fromCharCode(92);

// Byte order, which is what Go's sort gives tbls on the platforms where its
// sort setting works, so the two agree on the committed files.
function byteOrder(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The `## Triggers` section of a table doc is a pipe table: heading, blank,
// header row, separator row, one row per trigger. Rows are sorted by their
// first cell (the trigger name). A doc with no such section, or one whose
// rows are already in order, comes back byte for byte.
export function sortTriggerTables(md) {
  const lines = md.split('\n');
  const heading = lines.indexOf('## Triggers');
  if (heading < 0) return md;
  let header = heading + 1;
  while (header < lines.length && !lines[header].startsWith('|')) header++;
  const separator = header + 1;
  if (separator >= lines.length || !lines[separator].startsWith('|')) return md;
  let end = separator + 1;
  while (end < lines.length && lines[end].startsWith('|')) end++;
  const rows = lines.slice(separator + 1, end);
  const name = (row) => row.split('|')[1].trim();
  const sorted = rows.slice().sort((a, b) => byteOrder(name(a), name(b)));
  if (sorted.every((row, i) => row === rows[i])) return md;
  return [...lines.slice(0, separator + 1), ...sorted, ...lines.slice(end)].join('\n');
}

// schema.json is Go's encoding/json output: two-space indent, a trailing
// newline, and <, > and & written as <, > and & so the file is
// safe inside HTML. JSON.stringify gives the first two; the escapes are put
// back by hand, which is safe because none of the three ever appears outside
// a string in JSON. Key order survives the parse, so a sorted input comes back
// byte for byte.
function goJson(obj) {
  return (
    JSON.stringify(obj, null, 2)
      .split('<')
      .join(BS + 'u003c')
      .split('>')
      .join(BS + 'u003e')
      .split('&')
      .join(BS + 'u0026') + '\n'
  );
}

export function sortSchemaJson(text) {
  const schema = JSON.parse(text);
  for (const table of schema.tables || []) {
    if (Array.isArray(table.triggers)) {
      table.triggers.sort((a, b) => byteOrder(a.name, b.name));
    }
  }
  return goJson(schema);
}

export function main(dir = 'dbdoc') {
  const changed = [];
  for (const file of readdirSync(dir)) {
    const isTableDoc = file.startsWith('public.') && file.endsWith('.md');
    if (!isTableDoc && file !== 'schema.json') continue;
    const path = join(dir, file);
    const before = readFileSync(path, 'utf8');
    const after = file === 'schema.json' ? sortSchemaJson(before) : sortTriggerTables(before);
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(file);
    }
  }
  if (changed.length) {
    console.log('dbdoc-sort: reordered ' + changed.join(', '));
  } else {
    console.log('dbdoc-sort: already sorted');
  }
}

// Run only when executed directly, so tests can import the module.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] || 'dbdoc');
}
