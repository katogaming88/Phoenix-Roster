import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, installRoutes, DESKTOP, REPO_ROOT } from './harness.js';

// prefers-reduced-motion, measured rather than assumed (#435).
//
// Every assertion here comes in a pair: the same property read under
// `reducedMotion: 'reduce'` and under the default. Only the pair is evidence.
// On its own, "the spinner does not animate under reduce" is equally true of a
// stylesheet with a working media query and of one with no animation at all,
// and the second reading is what tells them apart.
//
// The values are exact rather than "less than the default": the reduced-motion
// block sets 0.01ms deliberately (not 0) so animationend and transitionend
// still fire and nothing waiting on them hangs, which is a detail worth having
// a test notice if someone tidies it to 0.

// What css/styles.css authors as 0.01ms, getComputedStyle serialises as
// 1e-05s. Same duration, and this is the string the browser hands back.
const REDUCED = '1e-05s';
const SPINNER_DEFAULT = '0.8s';
// .site-nav-item transitions colour and border-color, so it reports two values
// normally. Under the reduced-motion block the !important universal rule
// overrides transition-duration outright and it collapses back to one.
const NAV_DEFAULT = '0.15s, 0.15s';

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

/** Loads index.html in its own context and reads the two durations back. */
async function readMotion(contextOptions) {
  const context = await browser.newContext({ viewport: DESKTOP, ...contextOptions });
  const page = await context.newPage();
  installRoutes(page, server.port);
  await page.goto('http://127.0.0.1:' + server.port + '/index.html?team=phoenix', { waitUntil: 'load' });
  await page.waitForSelector('#landingProgression .prog-wrap', { timeout: 20000 });
  const read = await page.evaluate(() => {
    // The spinner stays in the DOM after the load message is hidden, and a
    // computed style is readable through display:none, so it is the one
    // infinite animation every page state can be asked about.
    const spinner = document.querySelector('.spinner');
    const nav = document.getElementById('navRoster');
    return {
      queryMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      spinnerExists: !!spinner,
      spinnerAnimation: spinner ? getComputedStyle(spinner).animationDuration : null,
      spinnerIterations: spinner ? getComputedStyle(spinner).animationIterationCount : null,
      navTransition: nav ? getComputedStyle(nav).transitionDuration : null
    };
  });
  await context.close();
  return read;
}

describe('prefers-reduced-motion', () => {
  let reduce;
  let normal;

  beforeAll(async () => {
    reduce = await readMotion({ reducedMotion: 'reduce' });
    normal = await readMotion({});
  });

  it('reaches a page that really has the spinner on it', () => {
    // Guards the whole file against passing because the selector went stale:
    // querySelector returning null would make every duration null, and null
    // is not 0.8s either.
    expect(normal.spinnerExists).toBe(true);
    expect(reduce.spinnerExists).toBe(true);
  });

  it('is asked for by the reduce context and not by the default one', () => {
    expect(reduce.queryMatches).toBe(true);
    expect(normal.queryMatches).toBe(false);
  });

  it('stops the loading spinner when reduced motion is asked for', () => {
    expect(reduce.spinnerAnimation).toBe(REDUCED);
    expect(reduce.spinnerIterations).toBe('1');
  });

  it('leaves the spinner spinning when it is not', () => {
    expect(normal.spinnerAnimation).toBe(SPINNER_DEFAULT);
    expect(normal.spinnerIterations).toBe('infinite');
  });

  it('collapses transitions when reduced motion is asked for', () => {
    expect(reduce.navTransition).toBe(REDUCED);
  });

  it('leaves transitions alone when it is not', () => {
    expect(normal.navTransition).toBe(NAV_DEFAULT);
  });
});
