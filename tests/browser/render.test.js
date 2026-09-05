import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, REPO_ROOT, NARROW } from './harness.js';
import { STATES } from './states.js';

// The layer under the accessibility checks: did the page actually render?
//
// This exists because a clean axe report on a blank page is indistinguishable
// from a clean axe report on a correct one, and this project has shipped the
// blank version three times (the guild.html#boe deep link, the #790 stream
// truncation, and #811, which this suite found). Every state here has to reach
// a selector that only appears after its heavy reads land, make no request
// nobody planned for, and throw nothing.
//
// It runs before a11y.test.js has any meaning, so keep it passing first: a
// failure here says the fixtures or the render chain broke, not that the page
// became inaccessible.

let server;
let browser;

beforeAll(async () => {
  server = await startServer(REPO_ROOT);
  browser = await launchBrowser();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

describe.each(STATES)('$label renders', (state) => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, state);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('reaches its sentinel with content behind it', async () => {
    // openState() already waited for the sentinel, so reaching here is most of
    // the assertion. The count guards the other direction: a selector that
    // matches an empty container would satisfy the wait and prove nothing.
    const count = await opened.page.locator(state.sentinel).count();
    expect(count).toBeGreaterThan(0);
  });

  it('makes no request the harness did not plan for', () => {
    // Everything the pages fetch is either same-origin, a stub, or a fixture.
    // Anything else was aborted, which means the suite would otherwise be
    // reaching the live internet and quietly depending on it.
    expect(opened.unexpected).toEqual([]);
  });

  it('throws nothing while rendering', () => {
    // Both boot chains wrap their work in a .catch(), so an uncaught error
    // here is the difference between a page that failed and a page that
    // silently stopped halfway.
    expect(opened.pageErrors).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });
});

// The report form is a 420px column inside a 1100px page. Capped by max-width
// as a stretch flex item, it sat hard against the left edge with the
// full-width lifecycle section right under it, so the gap read as a mistake
// (#930).
//
// Both halves of the assertion carry weight. Equal gaps alone are also true of
// a form filling the whole width, at zero each, so the left gap has to be
// above zero for "centred" to mean anything.
describe('the BoE report form is centred', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATES.find((s) => s.label === 'boe'));
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  // Measured off #boeTeamSelect's parent rather than a class this PR adds, so
  // the red run fails on the gap being zero and not on a selector that does
  // not exist yet.
  const gaps = (page) =>
    page.evaluate(() => {
      const section = document.getElementById('boe-report').getBoundingClientRect();
      const form = document.getElementById('boeTeamSelect').parentElement.getBoundingClientRect();
      return { left: form.left - section.left, right: section.right - form.right };
    });

  it('sits centred in its section at desktop width', async () => {
    const g = await gaps(opened.page);
    expect(g.left).toBeGreaterThan(0);
    expect(Math.abs(g.left - g.right)).toBeLessThan(2);
  });

  it('stays centred at 480px, where the page padding drops', async () => {
    await opened.page.setViewportSize(NARROW);
    await opened.page.waitForTimeout(300);
    const g = await gaps(opened.page);
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(Math.abs(g.left - g.right)).toBeLessThan(2);
  });
});
