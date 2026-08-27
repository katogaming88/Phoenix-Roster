import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PAGES,
  isValidVersion,
  readVersion,
  stampCommonJs,
  stampHtml,
  stampAll
} from '../../scripts/ci/stamp-version.js';

// Every version bump has to re-stamp the ?v= cache-bust tag on every local
// css/js asset across every page (#431), and there are 39 of them. Doing that
// by hand is the kind of mechanical sweep that misses one, and
// tests/ci/asset-version-check.test.js only tells you afterwards. This is the
// sweep as a script; these tests are what stop it from eating a file.

const FIXTURE_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700" rel="stylesheet">',
  '<link rel="stylesheet" href="css/styles.css?v=1.0.0">',
  '</head>',
  '<body>',
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="js/common.js?v=1.0.0"></script>',
  '<script src="js/guild.js"></script>',
  '</body>',
  '</html>'
].join('\n');

const FIXTURE_COMMON = [
  '// @ts-check',
  "var TEAM_SLUG = 'phoenix';",
  "var VERSION = '1.0.0';",
  'var DATA = null;'
].join('\n');

describe('isValidVersion', () => {
  it('accepts x.y.z', () => {
    expect(isValidVersion('3.66.0')).toBe(true);
    expect(isValidVersion('10.0.12')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of ['3.66', 'v3.66.0', '3.66.0-rc1', '3.66.0 ', '', 'latest', '3.66.0.1']) {
      expect(isValidVersion(bad)).toBe(false);
    }
  });
});

describe('stampCommonJs', () => {
  it('rewrites the VERSION line and nothing else', () => {
    const out = stampCommonJs(FIXTURE_COMMON, '2.1.3');
    expect(out).toContain("var VERSION = '2.1.3';");
    expect(out).not.toContain("'1.0.0'");
    expect(out.split('\n').length).toBe(FIXTURE_COMMON.split('\n').length);
    // Every other line survives byte for byte.
    const before = FIXTURE_COMMON.split('\n');
    const after = out.split('\n');
    before.forEach((line, i) => {
      if (line.startsWith('var VERSION')) return;
      expect(after[i]).toBe(line);
    });
  });

  it('throws when there is no VERSION line to replace', () => {
    expect(() => stampCommonJs('var DATA = null;', '2.1.3')).toThrow(/VERSION/);
  });

  it('is a no-op when the version already matches', () => {
    expect(stampCommonJs(FIXTURE_COMMON, '1.0.0')).toBe(FIXTURE_COMMON);
  });
});

describe('stampHtml', () => {
  it('rewrites every local css/js tag', () => {
    const { html, count } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('href="css/styles.css?v=2.1.3"');
    expect(html).toContain('src="js/common.js?v=2.1.3"');
    expect(count).toBe(3);
  });

  it('adds a tag to a local asset that has none', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('src="js/guild.js?v=2.1.3"');
  });

  it('leaves external URLs alone', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700"');
    expect(html).toContain('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"');
    expect(html).toContain('href="https://fonts.googleapis.com"');
  });

  it('changes nothing but the tags: same line count, same non-asset lines', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    const before = FIXTURE_HTML.split('\n');
    const after = html.split('\n');
    expect(after.length).toBe(before.length);
    before.forEach((line, i) => {
      if (/(?:href|src)="(?:css|js)\//.test(line)) return;
      expect(after[i]).toBe(line);
    });
  });

  it('throws on a page with no local assets, rather than reporting a silent success', () => {
    expect(() => stampHtml('<html><body>nothing here</body></html>', '2.1.3')).toThrow(/no local/i);
  });

  it('is idempotent', () => {
    const once = stampHtml(FIXTURE_HTML, '2.1.3').html;
    expect(stampHtml(once, '2.1.3').html).toBe(once);
  });
});

describe('PAGES', () => {
  it('is the shared registry the asset version check also reads', () => {
    expect(PAGES).toContain('index.html');
    expect(PAGES).toContain('officer.html');
    expect(PAGES).toContain('admin.html');
  });

  it('names pages that actually exist in the repo', () => {
    const root = join(import.meta.dirname, '..', '..');
    for (const page of PAGES) {
      expect(() => readFileSync(join(root, page), 'utf8')).not.toThrow();
    }
  });
});

describe('stampAll', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wga-stamp-'));
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    writeFileSync(join(dir, 'js', 'common.js'), FIXTURE_COMMON, 'utf8');
    writeFileSync(join(dir, 'css', 'styles.css'), 'body{}', 'utf8');
    writeFileSync(join(dir, 'index.html'), FIXTURE_HTML, 'utf8');
    writeFileSync(join(dir, 'officer.html'), FIXTURE_HTML, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites VERSION and every page, and reports the per-page counts', () => {
    const result = stampAll({ root: dir, version: '2.1.3', pages: ['index.html', 'officer.html'] });

    expect(result.version).toBe('2.1.3');
    expect(result.previous).toBe('1.0.0');
    expect(result.pages).toEqual([
      { page: 'index.html', count: 3 },
      { page: 'officer.html', count: 3 }
    ]);

    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toContain("var VERSION = '2.1.3';");
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('src="js/guild.js?v=2.1.3"');
    expect(readFileSync(join(dir, 'officer.html'), 'utf8')).toContain('href="css/styles.css?v=2.1.3"');
  });

  it('writes LF only, never CRLF', () => {
    stampAll({ root: dir, version: '2.1.3', pages: ['index.html'] });
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).not.toContain('\r\n');
    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).not.toContain('\r\n');
  });

  it('rejects a malformed version before touching anything', () => {
    expect(() => stampAll({ root: dir, version: 'v2.1.3', pages: ['index.html'] })).toThrow(/x\.y\.z/);
    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toBe(FIXTURE_COMMON);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(FIXTURE_HTML);
  });

  it('leaves every file untouched when one page would fail', () => {
    writeFileSync(join(dir, 'officer.html'), '<html><body>no assets</body></html>', 'utf8');

    expect(() => stampAll({ root: dir, version: '2.1.3', pages: ['index.html', 'officer.html'] })).toThrow(/no local/i);

    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toBe(FIXTURE_COMMON);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(FIXTURE_HTML);
  });
});

describe('readVersion', () => {
  it('reads the live VERSION out of js/common.js', () => {
    const version = readVersion(join(import.meta.dirname, '..', '..'));
    expect(isValidVersion(version)).toBe(true);
  });
});
