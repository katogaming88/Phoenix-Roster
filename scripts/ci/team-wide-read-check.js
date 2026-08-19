// team-wide-read-check.js
// Fails a team-wide Supabase read that does not page (#694, #707).
//
// PostgREST caps a response at max-rows (1000 on this project) and returns
// the truncated page as HTTP 200 with error: null. Nothing in supabase-js
// surfaces the Content-Range partial-content signal, so a truncated array is
// indistinguishable from a complete one at the call site. Five call sites
// were found this way in #694, and js/common.js already documented the bug on
// the exact table a function a few hundred lines below it still had it on.
// Knowledge in a comment did not protect the function beside it, which is the
// whole argument for a static check.
//
// The invariant is architectural, not symptom-level: team-wide reads go
// through fetchAllPaged, rather than "every team-wide select carries
// .range()". These chains are routinely built across statements (fetchAllPaged's
// own callers assign to a var, then conditionally .gt()), so judging a
// .range()/.limit() rule correctly needs real dataflow analysis, while this
// one is close to mechanical. It also enforces the thing actually wanted
// instead of one symptom of not having it.
//
// A read is exempt when it cannot grow past the cap and says so. Three ways:
//   - .single() / .maybeSingle(), which is one row by construction
//   - .eq('player_id', ...), bounded by one player's own history
//   - .select(cols, { head: true }), a count with no rows to truncate
//   - .limit(n) with a literal n, an explicitly bounded read
//   - a `// team-read-guard: <reason>` comment on or just above the read
// The comment form is also the escape hatch for a makeQuery callback declared
// as a named function rather than inline, which this check cannot follow.
//
// Usage: node scripts/ci/team-wide-read-check.js [file ...]
// With no arguments it walks js/. Prints one line per finding and exits 1.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const TEAM_COLUMN = 'team_id';
// A read narrowed to one player is bounded by that player's own history, not
// by the size of the team's table, so it is not what "team-wide" means here.
const PLAYER_COLUMNS = ['player_id', 'id'];
const HELPER = 'fetchAllPaged';
const ANNOTATION = /team-read-guard:/;
// How far above a read its annotation may sit. Enough for a wrapped chain or
// a short explanation, not so far that it silently covers the next read too.
const ANNOTATION_REACH = 3;

function literalValue(node) {
  return node && node.type === 'Literal' ? node.value : undefined;
}

// Descends a member-call chain from its outermost call, so
// x.from('t').select(c).eq('team_id', id) yields [from, select, eq].
function flattenChain(node) {
  const methods = [];
  let cur = node;
  while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
    const prop = cur.callee.property;
    const name = prop.type === 'Identifier' ? prop.name : String(literalValue(prop));
    methods.unshift({ name, node: cur });
    cur = cur.callee.object;
  }
  return methods;
}

function isChildNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

/**
 * Every team-wide read in `source` that neither pages nor declares why it
 * does not need to.
 * @returns {{line: number, table: string, reason: string}[]}
 */
export function findUnguardedTeamWideReads(source, filename = '<source>') {
  const comments = [];
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 2022, locations: true, onComment: comments });
  } catch (err) {
    throw new Error('Could not parse ' + filename + ': ' + err.message);
  }

  const annotationLines = new Set();
  for (const c of comments) {
    if (ANNOTATION.test(c.value)) annotationLines.add(c.loc.start.line);
  }

  const findings = [];
  const consumed = new Set();

  function visit(node, insideHelper) {
    if (!isChildNode(node)) return;

    let helperHere = insideHelper;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === HELPER) {
      helperHere = true;
    }

    if (node.type === 'CallExpression' && !consumed.has(node)) {
      const methods = flattenChain(node);
      if (methods.length && methods[0].name === 'from') {
        // Inner calls belong to this chain, not to chains of their own.
        for (const m of methods) consumed.add(m.node);
        check(node, methods, helperHere);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item, helperHere);
      } else if (isChildNode(value)) {
        visit(value, helperHere);
      }
    }
  }

  function check(node, methods, insideHelper) {
    const names = methods.map((m) => m.name);
    if (!names.includes('select')) return; // writes are not truncated reads
    if (names.includes('single') || names.includes('maybeSingle')) return;

    // .select(cols, { head: true }) asks for the count and no rows at all, so
    // there is nothing for the cap to truncate.
    const headOnly = methods.some((m) => {
      if (m.name !== 'select') return false;
      const opts = m.node.arguments[1];
      if (!opts || opts.type !== 'ObjectExpression') return false;
      return opts.properties.some(
        (prop) =>
          prop.type === 'Property' &&
          ((prop.key.type === 'Identifier' && prop.key.name === 'head') ||
            (prop.key.type === 'Literal' && prop.key.value === 'head')) &&
          literalValue(prop.value) === true
      );
    });
    if (headOnly) return;

    const teamFiltered = methods.some((m) => m.name === 'eq' && literalValue(m.node.arguments[0]) === TEAM_COLUMN);
    if (!teamFiltered) return;

    const perPlayer = methods.some(
      (m) => m.name === 'eq' && PLAYER_COLUMNS.includes(String(literalValue(m.node.arguments[0])))
    );
    if (perPlayer) return;

    // A literal .limit(n) is a bounded read by construction. A .limit(limit)
    // is the helper's own page size, which is not a bound on the whole read.
    const literalLimit = methods.some(
      (m) => m.name === 'limit' && typeof literalValue(m.node.arguments[0]) === 'number'
    );
    if (literalLimit) return;

    if (insideHelper) return;

    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    for (let line = startLine - ANNOTATION_REACH; line <= endLine; line++) {
      if (annotationLines.has(line)) return;
    }

    const fromCall = methods[0].node;
    const table = literalValue(fromCall.arguments[0]);
    findings.push({
      line: startLine,
      table: typeof table === 'string' ? table : '<computed>',
      reason: 'team-wide select on ' + (table || 'a table') + ' does not page through ' + HELPER
    });
  }

  visit(ast, false);
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

export function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

export function checkFiles(files) {
  const all = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const finding of findUnguardedTeamWideReads(source, file)) {
      all.push({ ...finding, file });
    }
  }
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const files = args.length ? args : listJsFiles('js');
  const findings = checkFiles(files);
  for (const f of findings) {
    console.log(f.file + ':' + f.line + ': ' + f.reason);
  }
  if (findings.length) {
    console.log('');
    console.log(findings.length + ' team-wide read(s) do not page.');
    console.log('Route them through ' + HELPER + ', bound them with a literal .limit(),');
    console.log('or annotate with `// team-read-guard: <why this cannot exceed 1000 rows>`.');
    process.exit(1);
  }
  console.log('All team-wide reads page or declare why they do not.');
}
