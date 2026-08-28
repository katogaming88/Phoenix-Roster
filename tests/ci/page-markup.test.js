import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Nothing else in CI parses HTML. tests/frontend/ runs js/ files in a vm
// sandbox with stubbed elements, so it can assert what the code does and never
// what the markup says: no other test asserts a label, a landmark or an
// aria-labelledby, which is why the accessibility debt in milestone #19 could
// accumulate silently. This started as guild.html's own check (#777) and covers
// all four pages since #437 gave the other three the same structure.
//
// Deliberately regex-driven rather than pulling in a parser: scripts/ci/ tools
// here have no dependencies, and these are structural questions ("does this id
// exist", "does this anchor resolve") rather than ones needing a DOM. The risk
// with regex extraction is that a pattern silently matches nothing and the
// check passes vacuously, so every extractor below is proved against a page
// known to contain what it looks for before any page is judged by it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PAGES = ['index.html', 'officer.html', 'admin.html', 'guild.html'];

function read(page) {
  return readFileSync(join(ROOT, page), 'utf8');
}

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const labelTargets = (html) => [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
const controls = (html) => [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
const labelledBy = (html) => [...html.matchAll(/\saria-labelledby="([^"]+)"/g)].map((m) => m[1]);
// A bare href="#" is a no-op link paired with an onclick, not a navigation
// target. It is its own accessibility problem and #440 owns it; here it would
// only ever read as an anchor pointing at nothing.
const hashLinks = (html) => [...html.matchAll(/\shref="#([^"]+)"/g)].map((m) => m[1]).filter((t) => t !== '');
const indexLinks = (html) => [...html.matchAll(/\shref="(index\.html[^"]*)"/g)].map((m) => m[1]);
const tagCount = (html, tag) => (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
const headingLevels = (html) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

describe('the extractors can actually see markup', () => {
  // If these go quiet, every assertion below passes for the wrong reason. Each
  // extractor is proved against a page that is known to contain its subject,
  // which is a claim about extraction and not about that page being compliant.
  const index = read('index.html');
  const guild = read('guild.html');

  it('finds ids, labels, controls and aria-labelledby on index.html', () => {
    expect(ids(index).length).toBeGreaterThan(20);
    expect(labelTargets(index).length).toBeGreaterThan(0);
    expect(controls(index).length).toBeGreaterThan(0);
    expect(labelledBy(index).length).toBeGreaterThan(0);
  });

  it('finds headings and in-page anchors on guild.html', () => {
    expect(headingLevels(guild).length).toBeGreaterThan(1);
    expect(hashLinks(guild).length).toBeGreaterThan(0);
  });
});

describe.each(PAGES)('%s structure (#437)', (page) => {
  const html = read(page);

  it('declares a language and a title', () => {
    expect(html).toMatch(/<html[^>]*\slang="en"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it('has exactly one main landmark, and it is the focusable skip target', () => {
    expect(tagCount(html, 'main')).toBe(1);
    const main = html.match(/<main[^>]*>/)[0];
    expect(main).toMatch(/\sid="main-content"/);
    // Firefox and Safari do not move focus to a non-focusable anchor target, so
    // without this the skip link scrolls and leaves focus behind.
    expect(main).toMatch(/\stabindex="-1"/);
  });

  it('has exactly one h1', () => {
    expect(tagCount(html, 'h1')).toBe(1);
  });

  it('has a real footer element rather than a div', () => {
    expect(tagCount(html, 'footer')).toBe(1);
    expect(html).not.toMatch(/<div[^>]*\sclass="footer"/);
  });

  it('opens the body with a skip link pointing at main', () => {
    const body = html.slice(html.indexOf('<body'));
    const firstTag = body.slice(body.indexOf('>') + 1).trim();
    expect(firstTag).toMatch(/^<a[^>]*class="skip-link"[^>]*href="#main-content"/);
  });

  it('names every navigation landmark', () => {
    // More than one <nav> per page is normal here (site nav plus an officer or
    // admin sidebar). Unnamed, a screen reader lists them as interchangeable.
    const navs = [...html.matchAll(/<nav[^>]*>/g)].map((m) => m[0]);
    expect(navs.length).toBeGreaterThan(0);
    expect(navs.filter((n) => !/\saria-label(?:ledby)?="/.test(n))).toEqual([]);
  });

  it('does not skip a heading level', () => {
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i === 0) return;
      expect(level - Math.max(...levels.slice(0, i))).toBeLessThanOrEqual(1);
    });
  });
});

describe.each(PAGES)('%s references resolve (#437)', (page) => {
  const html = read(page);
  const present = new Set(ids(html));

  // Vacuity is handled by the extractor checks above rather than a per-page
  // minimum: officer.html and admin.html legitimately have no aria-labelledby
  // and no in-page anchors, and requiring one would be inventing a rule.
  it('every aria-labelledby points at an id that exists', () => {
    expect(labelledBy(html).filter((r) => !r.split(/\s+/).every((id) => present.has(id)))).toEqual([]);
  });

  it('every in-page anchor points at an id that exists', () => {
    expect(hashLinks(html).filter((t) => !present.has(t))).toEqual([]);
  });

  it('every label points at a control that exists', () => {
    expect(labelTargets(html).filter((t) => !present.has(t))).toEqual([]);
  });
});

describe('guild.html specifics (#777)', () => {
  const html = read('guild.html');

  // Scoped to guild.html until #436 gives the other three pages an accessible
  // name for every control. Widen this to PAGES in that issue's PR.
  it('every form control has a label', () => {
    const labelled = new Set(labelTargets(html));
    expect(controls(html).filter((id) => !labelled.has(id))).toEqual([]);
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
