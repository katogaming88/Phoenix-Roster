import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

const PAGES = ['index.html', 'officer.html', 'admin.html', 'guild.html', 'boe.html'];

// The pages born under the #777 bar, where every control carries a label.
// Widening this to PAGES is #436's job, once index.html, officer.html and
// admin.html get an accessible name for every control.
const LABELLED_PAGES = ['guild.html', 'boe.html'];

// Pages with no team of their own, and the scripts that boot them. A cold
// landing on index.html redirects to guild.html (#779), so a link from either
// page to a bare index.html is an infinite bounce rather than a cosmetic slip.
const TEAM_FREE = [
  { page: 'guild.html', script: 'js/guild.js' },
  { page: 'boe.html', script: 'js/boe-page.js' }
];

function read(page) {
  return readFileSync(join(ROOT, page), 'utf8');
}

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const labelTargets = (html) => [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
const controls = (html) => [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
const labelledBy = (html) => [...html.matchAll(/\saria-labelledby="([^"]+)"/g)].map((m) => m[1]);
const describedBy = (html) => [...html.matchAll(/\saria-describedby="([^"]+)"/g)].map((m) => m[1]);
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
  const boe = read('boe.html');

  it('finds ids, controls, aria-labelledby and aria-describedby on index.html', () => {
    expect(ids(index).length).toBeGreaterThan(20);
    expect(controls(index).length).toBeGreaterThan(0);
    expect(labelledBy(index).length).toBeGreaterThan(0);
    expect(describedBy(index).length).toBeGreaterThan(0);
  });

  // index.html carried the only <label for> on the page in its BoE form, and
  // that form moved to boe.html in #891. Proving the extractor against the
  // page that has labels keeps this a claim about extraction; index.html
  // having none of its own is the a11y debt #436 owns.
  it('finds labels on boe.html', () => {
    expect(labelTargets(boe).length).toBeGreaterThan(0);
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

  it('every aria-describedby points at an id that exists', () => {
    expect(describedBy(html).filter((r) => !r.split(/\s+/).every((id) => present.has(id)))).toEqual([]);
  });

  it('every in-page anchor points at an id that exists', () => {
    expect(hashLinks(html).filter((t) => !present.has(t))).toEqual([]);
  });

  it('every label points at a control that exists', () => {
    expect(labelTargets(html).filter((t) => !present.has(t))).toEqual([]);
  });
});

describe.each(LABELLED_PAGES)('%s controls (#777)', (page) => {
  const html = read(page);

  it('every form control has a label', () => {
    const labelled = new Set(labelTargets(html));
    expect(controls(html).filter((id) => !labelled.has(id))).toEqual([]);
  });
});

describe.each(TEAM_FREE)('$page never links to a bare index.html (#779)', ({ page, script }) => {
  it('in its markup', () => {
    expect(indexLinks(read(page)).filter((href) => !href.includes('team='))).toEqual([]);
  });

  it('and neither does its script', () => {
    // js/guild.js builds team links and must carry the param on every one;
    // js/boe-page.js links nowhere, and zero literals is the right answer for
    // it, so only the bare form is asserted against.
    const js = readFileSync(join(ROOT, script), 'utf8');
    const literals = [...js.matchAll(/'(index\.html[^']*)'/g)].map((m) => m[1]);
    expect(literals.filter((s) => !s.includes('team='))).toEqual([]);
  });
});

describe('guild.html specifics (#777)', () => {
  const html = read('guild.html');

  // One BoE item since #891, pointing at the page that both reports a find
  // and tracks it. The markup default covers the gap before the team settings
  // say whether the guild runs BoE at all, and it is the only thing covering
  // the CDN-failure path, where bootGuildPage() returns before js/guild.js
  // gets to it. The vm-sandbox suite cannot see this: its elements are stubbed
  // as `style: {}`, so they start with no display at all whatever the page says.
  it('has one BoE nav item, shipped hidden and pointing at boe.html (#891)', () => {
    const item = html.match(/<a[^>]*\sid="guildNavBoe"[^>]*>/);
    expect(item).not.toBeNull();
    expect(item[0]).toMatch(/style="display:\s*none;?"/);
    expect(item[0]).toMatch(/href="boe\.html"/);
    expect(html).not.toContain('guildNavBoeManage');
  });

  it('carries no Found a BoE section any more (#891)', () => {
    expect(new Set(ids(html)).has('guildBoeTeam')).toBe(false);
    expect(html).not.toContain('Found a BoE?');
  });

  it('js/guild.js links to index.html only with a team', () => {
    const js = readFileSync(join(ROOT, 'js', 'guild.js'), 'utf8');
    const literals = [...js.matchAll(/'(index\.html[^']*)'/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(0);
  });
});

describe('boe.html specifics (#864)', () => {
  const html = read('boe.html');

  it('carries the four lifecycle containers js/boe-manage.js writes into', () => {
    const present = new Set(ids(html));
    ['guildBoeSummary', 'guildBoeOpen', 'guildBoeAwaiting', 'guildBoeHistory', 'boeAccessNote'].forEach((id) =>
      expect(present.has(id), id).toBe(true)
    );
  });

  it('marks its own nav item as the current page', () => {
    expect(html).toMatch(/<a[^>]*href="boe\.html"[^>]*aria-current="page"/);
  });

  it('links back to the guild page', () => {
    expect(html).toMatch(/href="guild\.html"/);
  });
});

describe('index.html specifics', () => {
  const html = read('index.html');

  // The report form moved to boe.html (#891), beside the rows it creates.
  it('carries no BoE form any more', () => {
    const present = new Set(ids(html));
    ['boeViewWrap', 'boeTeamSelect', 'boeCharName', 'boeDonate', 'boeSubmitBtn'].forEach((id) =>
      expect(present.has(id), id).toBe(false)
    );
    expect(html).not.toMatch(/src="js\/boe\.js/);
  });
});

// The form left index.html for the page that tracks what it reports (#891).
// A stale reference to the view it lived in would throw on both pages.
describe('the BoE form moved (#891)', () => {
  const html = read('boe.html');
  const jsDir = join(ROOT, 'js');

  it('loads js/boe.js before js/boe-page.js, which nulls the team globals', () => {
    // The script tags, not the first mention: the section comment above them
    // names js/boe-page.js too.
    const form = html.indexOf('src="js/boe.js');
    const page = html.indexOf('src="js/boe-page.js');
    expect(form).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(-1);
    expect(form).toBeLessThan(page);
  });

  it('carries the form controls, each with a label', () => {
    const present = new Set(ids(html));
    ['boeTeamSelect', 'boeCharName', 'boeItemName', 'boeTrack', 'boeUpgradeRank', 'boeNote', 'boeDonate'].forEach(
      (id) => expect(present.has(id), id).toBe(true)
    );
  });

  // The donate checkbox (#862) briefly carried an explainer paragraph above it
  // (3.81.3). It was cut the same day: the label already says what the box
  // does, so the checkbox stands alone with its label and points at nothing.
  it('shows the donate option as a checkbox with its label and no explainer', () => {
    expect(new Set(ids(html)).has('boeDonateHelp')).toBe(false);
    const box = html.match(/<label for="boeDonate"[^>]*>\s*(<input[^>]*\sid="boeDonate"[^>]*>)\s*([^<]*)<\/label>/);
    expect(box).not.toBeNull();
    expect(box[1]).not.toMatch(/aria-describedby/);
    expect(box[2].trim()).toBe("I'd like to donate my finder's fee to the guild");
  });

  it('leaves no js/ file reaching for the view the form lived in', () => {
    const stale = readdirSync(jsDir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => {
        const src = readFileSync(join(jsDir, f), 'utf8');
        return src.includes('boeViewWrap') || src.includes('showBoeView');
      });
    expect(stale).toEqual([]);
  });
});
