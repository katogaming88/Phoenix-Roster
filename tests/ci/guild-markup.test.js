import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Nothing in CI parses HTML. tests/frontend/ runs js/ files in a vm sandbox
// with stubbed elements, so it can assert what the code does and never what the
// markup says: no test anywhere asserts a label, a landmark or an
// aria-labelledby, which is why the accessibility debt in milestone #19 could
// accumulate silently. guild.html is new UI and ships born accessible (#777),
// so this is the check that keeps it that way.
//
// Deliberately regex-driven rather than pulling in a parser: scripts/ci/ tools
// here have no dependencies, and these are structural questions ("does this id
// exist", "does this anchor resolve") rather than ones needing a DOM. The risk
// with regex extraction is that a pattern silently matches nothing and the
// check passes vacuously, so every extractor below is proved against
// index.html, which is known to contain what is being looked for.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(page) {
  return readFileSync(join(ROOT, page), 'utf8');
}

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const labelTargets = (html) => [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
const controls = (html) => [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
const labelledBy = (html) => [...html.matchAll(/\saria-labelledby="([^"]+)"/g)].map((m) => m[1]);
const hashLinks = (html) => [...html.matchAll(/\shref="#([^"]+)"/g)].map((m) => m[1]);
const indexLinks = (html) => [...html.matchAll(/\shref="(index\.html[^"]*)"/g)].map((m) => m[1]);
const tagCount = (html, tag) => (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;

describe('the extractors can actually see markup', () => {
  // If these go quiet, every assertion below passes for the wrong reason.
  const index = read('index.html');

  it('finds ids, labels, controls and aria-labelledby on index.html', () => {
    expect(ids(index).length).toBeGreaterThan(20);
    expect(labelTargets(index).length).toBeGreaterThan(0);
    expect(controls(index).length).toBeGreaterThan(0);
    expect(labelledBy(index).length).toBeGreaterThan(0);
  });
});

describe('guild.html structure (#777)', () => {
  const html = read('guild.html');
  const present = new Set(ids(html));

  it('declares a language and a title', () => {
    expect(html).toMatch(/<html[^>]*\slang="en"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it('has exactly one main landmark, and it is the skip target', () => {
    expect(tagCount(html, 'main')).toBe(1);
    expect(html).toMatch(/<main[^>]*\sid="main-content"/);
  });

  it('has exactly one h1', () => {
    expect(tagCount(html, 'h1')).toBe(1);
  });

  it('has a real footer element rather than a div', () => {
    // index.html repeats <div class="footer"> ten times, which is what #437
    // exists to fix. A new page does not add an eleventh.
    expect(tagCount(html, 'footer')).toBe(1);
  });

  it('opens the body with a skip link pointing at main', () => {
    const body = html.slice(html.indexOf('<body'));
    const firstTag = body.slice(body.indexOf('>') + 1).trim();
    expect(firstTag).toMatch(/^<a[^>]*class="skip-link"[^>]*href="#main-content"/);
  });

  // js/guild.js reveals this item only for someone who may open the section it
  // points at, but the markup default is what covers the gap before the three
  // RPCs resolve -- and it is the only thing covering the CDN-failure path,
  // where bootGuildPage() returns before either render function runs. The
  // vm-sandbox suite cannot see this: its elements are stubbed as `style: {}`,
  // so they start with no display at all whatever the page says.
  it('ships the officer-gated nav item hidden', () => {
    const item = html.match(/<a[^>]*\sid="guildNavBoeManage"[^>]*>/);
    expect(item).not.toBeNull();
    expect(item[0]).toMatch(/style="display:\s*none;?"/);
  });

  it('does not skip a heading level', () => {
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i === 0) return;
      expect(level - Math.max(...levels.slice(0, i))).toBeLessThanOrEqual(1);
    });
  });
});

describe('guild.html references resolve (#777)', () => {
  const html = read('guild.html');
  const present = new Set(ids(html));

  it('every aria-labelledby points at an id that exists', () => {
    const refs = labelledBy(html);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !r.split(/\s+/).every((id) => present.has(id)))).toEqual([]);
  });

  it('every in-page anchor points at an id that exists', () => {
    const targets = hashLinks(html);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !present.has(t))).toEqual([]);
  });

  it('every label points at a control that exists', () => {
    expect(labelTargets(html).filter((t) => !present.has(t))).toEqual([]);
  });

  it('every form control has a label', () => {
    const labelled = new Set(labelTargets(html));
    expect(controls(html).filter((id) => !labelled.has(id))).toEqual([]);
  });
});

describe('guild.html links out with a team (#777)', () => {
  const html = read('guild.html');

  it('never links to a bare index.html', () => {
    // A cold landing on index.html redirects here (#779), so an index.html
    // link with no ?team= is an infinite bounce between the two pages.
    expect(indexLinks(html).filter((href) => !href.includes('team='))).toEqual([]);
  });

  it('and neither does js/guild.js', () => {
    const js = readFileSync(join(ROOT, 'js', 'guild.js'), 'utf8');
    const literals = [...js.matchAll(/'(index\.html[^']*)'/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter((s) => !s.includes('team='))).toEqual([]);
  });
});
