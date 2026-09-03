import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sortTriggerTables, sortSchemaJson } from '../../scripts/ci/dbdoc-sort.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'dbdoc-sort.js');
const BS = String.fromCharCode(92);

// A table doc with its trigger rows in catalog order, which is what tbls doc
// writes on Windows despite `sort: true`, and the same doc with the rows in
// name order, which is what the committed docs carry and what CI's tbls diff
// compares against. Everything outside the Triggers table is deliberately
// out of order too, so the sorter is proved to leave it alone.
const MD_HEAD = [
  '# public.widgets',
  '',
  '## Columns',
  '',
  '| Name | Type |',
  '| ---- | ---- |',
  '| zeta | int |',
  '| alpha | text |',
  '',
  '## Triggers',
  '',
  '| Name | Definition |',
  '| ---- | ---------- |'
];
const MD_TAIL = ['', '## Relations', '', '```mermaid', 'erDiagram', '```', ''];
const ROWS = {
  updated:
    '| trg_widgets_updated_at | CREATE TRIGGER trg_widgets_updated_at BEFORE UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION set_updated_at() |',
  status:
    '| trg_widgets_status_transition | CREATE TRIGGER trg_widgets_status_transition BEFORE UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION check_status() |',
  team: '| trg_widgets_team_id_check | CREATE TRIGGER trg_widgets_team_id_check BEFORE INSERT OR UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION check_team() |'
};
const UNSORTED_MD = [...MD_HEAD, ROWS.updated, ROWS.status, ROWS.team, ...MD_TAIL].join('\n');
const SORTED_MD = [...MD_HEAD, ROWS.status, ROWS.team, ROWS.updated, ...MD_TAIL].join('\n');

describe('sortTriggerTables', () => {
  it('orders the Triggers table rows by name and touches nothing else', () => {
    expect(sortTriggerTables(UNSORTED_MD)).toBe(SORTED_MD);
  });

  it('returns a sorted doc byte for byte', () => {
    expect(sortTriggerTables(SORTED_MD)).toBe(SORTED_MD);
  });

  it('returns a doc with no Triggers section byte for byte', () => {
    const noTriggers = [...MD_HEAD.slice(0, 9), ...MD_TAIL].join('\n');
    expect(sortTriggerTables(noTriggers)).toBe(noTriggers);
  });
});

// schema.json is Go's output: two-space indent, a trailing newline, and the
// HTML-safe escapes encoding/json applies to <, > and &. A sorter that parsed
// and re-serialized with plain JSON.stringify would rewrite every trigger and
// function definition in the file, so the escaping is part of the contract.
const schema = (triggers) =>
  JSON.stringify(
    { name: 'postgres', tables: [{ name: 'public.widgets', triggers }], driver: { name: 'postgres' } },
    null,
    2
  ) + '\n';
const T = (name, def) => ({ name, def });
const UNSORTED_JSON = schema([T('trg_z', 'CREATE TRIGGER trg_z'), T('trg_a', 'CREATE TRIGGER trg_a')]);
const SORTED_JSON = schema([T('trg_a', 'CREATE TRIGGER trg_a'), T('trg_z', 'CREATE TRIGGER trg_z')]);

describe('sortSchemaJson', () => {
  it('orders each table triggers array by name', () => {
    expect(sortSchemaJson(UNSORTED_JSON)).toBe(SORTED_JSON);
  });

  it('returns sorted input byte for byte, trailing newline included', () => {
    expect(sortSchemaJson(SORTED_JSON)).toBe(SORTED_JSON);
  });

  it("writes <, > and & the way Go does, and keeps a backslash as JSON's own escape", () => {
    const goEscaped =
      '{\n  "tables": [\n    {\n      "name": "public.widgets",\n      "triggers": [\n        {\n          "name": "trg_a",\n          "def": "a \\u003c b \\u003e c \\u0026 d ' +
      BS +
      BS +
      ' e"\n        }\n      ]\n    }\n  ]\n}\n';
    expect(sortSchemaJson(goEscaped)).toBe(goEscaped);
    const plain =
      JSON.stringify(
        { tables: [{ name: 'public.widgets', triggers: [T('trg_a', 'a < b > c & d ' + BS + ' e')] }] },
        null,
        2
      ) + '\n';
    expect(sortSchemaJson(plain)).toBe(goEscaped);
  });

  it('leaves a table with no triggers key alone', () => {
    const none = JSON.stringify({ tables: [{ name: 'public.plain' }] }, null, 2) + '\n';
    expect(sortSchemaJson(none)).toBe(none);
  });
});

// The committed docs are the real test. tbls diff in CI compares the live
// schema against these files without sorting either side, so the committed
// order is the only thing that keeps the check green, and this is what would
// have failed on 2026-09-02 before the trigger rows were sorted by hand.
describe('the committed dbdoc/ is already in sorted form', () => {
  const dir = join(ROOT, 'dbdoc');

  it('schema.json round-trips through the sorter byte for byte', () => {
    const text = readFileSync(join(dir, 'schema.json'), 'utf8');
    expect(text.length).toBeGreaterThan(1000);
    expect(sortSchemaJson(text)).toBe(text);
  });

  it('every table doc round-trips through the sorter byte for byte', () => {
    const files = readdirSync(dir).filter((f) => f.startsWith('public.') && f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(20);
    const changed = files.filter((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      return sortTriggerTables(text) !== text;
    });
    expect(changed).toEqual([]);
  });
});

describe('the command line', () => {
  it('rewrites only the files that were out of order and names them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbdoc-sort-'));
    try {
      writeFileSync(join(dir, 'public.widgets.md'), UNSORTED_MD);
      writeFileSync(join(dir, 'public.plain.md'), SORTED_MD);
      writeFileSync(join(dir, 'schema.json'), UNSORTED_JSON);
      writeFileSync(join(dir, 'README.md'), '# untouched\n');
      const out = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(out).toContain('public.widgets.md');
      expect(out).toContain('schema.json');
      expect(out).not.toContain('public.plain.md');
      expect(readFileSync(join(dir, 'public.widgets.md'), 'utf8')).toBe(SORTED_MD);
      expect(readFileSync(join(dir, 'schema.json'), 'utf8')).toBe(SORTED_JSON);
      expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# untouched\n');
      const again = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(again).toContain('already sorted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
