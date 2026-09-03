import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #905: an instant shown to a person goes through formatDateTime() (the
// viewer's local date and time), and every surface that shows one renders
// localTimeZoneNote() so the viewer knows which zone they are reading. This
// reads js/ as text, the way the asset-tag and team-wide-read checks catch
// their classes, so a new bare date render or a noteless timestamp surface
// fails here instead of shipping.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(HERE, '../../js');

function listJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) listJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(path.join(HERE, '../..'), p).split(path.sep).join('/');

// A toLocale*String call with no locale (or an explicit undefined) formats in
// the browser's default shape: a date only, or a date with seconds. The one
// place that is right is formatDateTime itself, which passes undefined on
// purpose so the viewer's own locale applies and fixes the shape with
// dateStyle/timeStyle. Calls that pass 'en-US' are gold formatting on a
// number or the calendar's month and weekday labels, both fine.
const BARE_FORMAT = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b)/;

export function findBareDateFormats(src, file) {
  const findings = [];
  src.split('\n').forEach((line, i) => {
    if (!BARE_FORMAT.test(line)) return;
    if (file === 'js/common.js' && line.includes('dateStyle')) return;
    findings.push({ file, line: i + 1, text: line.trim() });
  });
  return findings;
}

// Every file that formats a timestamp for display must render the zone note
// somewhere. A definition does not count; the note has to be placed.
const FORMATTER_CALL = /\b(?:formatDateTime|auditFormatTs)\(/;
const FORMATTER_DEF = /function (?:formatDateTime|auditFormatTs)\(/;
const NOTE_CALL = /(?<!function )\blocalTimeZoneNote\(\)/;

export function findNotelessTimestampFiles(src, file) {
  const formats = src.split('\n').some((line) => FORMATTER_CALL.test(line) && !FORMATTER_DEF.test(line));
  if (!formats) return [];
  return NOTE_CALL.test(src) ? [] : [{ file }];
}

describe('date-format-check (#905)', () => {
  const files = listJs(JS_DIR).map((p) => ({ file: rel(p), src: readFileSync(p, 'utf8') }));

  it('walks the js tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('formats every instant through formatDateTime, never a bare toLocale*String', () => {
    const findings = files.flatMap(({ file, src }) => findBareDateFormats(src, file));
    expect(
      findings.map((f) => `${f.file}:${f.line} ${f.text}`),
      'bare date formatting; render the instant with formatDateTime() (js/common.js)'
    ).toEqual([]);
  });

  it('renders the zone note in every file that shows a timestamp', () => {
    const findings = files.flatMap(({ file, src }) => findNotelessTimestampFiles(src, file));
    expect(
      findings.map((f) => f.file),
      'a timestamp surface without localTimeZoneNote(); place the note at the top of the region that shows the time'
    ).toEqual([]);
  });

  it('flags the shapes it exists to catch', () => {
    expect(
      findBareDateFormats('x = new Date(iso).toLocaleDateString();\ny = d.toLocaleString();', 'js/x.js')
    ).toHaveLength(2);
    expect(findBareDateFormats("gold.toLocaleString('en-US')", 'js/x.js')).toEqual([]);
    expect(findBareDateFormats("d.toLocaleString(undefined, { dateStyle: 'medium' })", 'js/common.js')).toEqual([]);
    expect(
      findNotelessTimestampFiles('function formatDateTime(iso) {}\nfunction localTimeZoneNote() {}', 'js/common.js')
    ).toEqual([]);
    expect(findNotelessTimestampFiles('html += formatDateTime(row.at);', 'js/x.js')).toEqual([{ file: 'js/x.js' }]);
    expect(findNotelessTimestampFiles('html += localTimeZoneNote() + formatDateTime(row.at);', 'js/x.js')).toEqual([]);
  });
});
