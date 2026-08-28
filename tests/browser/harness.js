import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Request routing for the accessibility suite (#810).
//
// One page.route('**/*') handler owns every request the page makes, so there
// is no route-precedence question and the whole policy reads as one block
// below. Same-origin requests go to the static server; the handful of
// third-party assets the pages load are answered with stubs; Supabase reads
// are answered from tests/browser/fixtures/. Anything else is aborted AND
// recorded, and the tests assert the recorded list is empty. That is what
// makes "this suite is hermetic" a checked claim rather than a hope, and it
// means a new third-party dependency shows up as a failing test instead of a
// silent network call.

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
const FIXTURES = join(HERE, 'fixtures');

const SUPABASE_UMD = join(REPO_ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');

// A 1x1 transparent PNG. index.html and officer.html load three
// www.google.com/s2/favicons images each inside a fixed width/height; aborting
// them would leave broken-image glyphs in a layout the suite then measures.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// No CORS headers anywhere below, and no OPTIONS handler, which is worth a
// note because the opposite is what you would expect. supabase-js sends apikey
// and authorization on every read, so against a real server these are all
// preflighted cross-origin requests. A route handler answers before the
// network stack, though, so Chromium never sends the preflight and never
// CORS-checks the reply: measured by stripping the headers and confirming the
// page still renders all six roster rows and its progression card. They are
// left out rather than shipped as insurance, since a header nothing reads
// invites the next person to believe it matters. If a Playwright release ever
// starts enforcing this, every read fails at once and the sentinel assertions
// in a11y.test.js say so loudly.

const fixtureCache = new Map();

/** Reads tests/browser/fixtures/<name>.json, defaulting to `fallback`. */
export function fixture(name, fallback) {
  if (!fixtureCache.has(name)) {
    const path = join(FIXTURES, name + '.json');
    fixtureCache.set(name, existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
  }
  const value = fixtureCache.get(name);
  return value === undefined ? fallback : value;
}

function jsonResponse(body, status, extraHeaders) {
  return {
    status: status || 200,
    contentType: 'application/json; charset=utf-8',
    headers: extraHeaders || {},
    body: JSON.stringify(body)
  };
}

// PostgREST answers a .single()/.maybeSingle() with a bare object rather than
// an array, signalled by the Accept header supabase-js sends for them.
// checkMaintenanceMode() (js/common.js) is on every page's boot path and uses
// maybeSingle(), so getting this wrong gates every state to a blank page.
function wantsSingleObject(headers) {
  return /vnd\.pgrst\.object/.test(headers['accept'] || '');
}

function restResponse(rows, headers) {
  if (wantsSingleObject(headers)) {
    return jsonResponse(rows.length ? rows[0] : null);
  }
  // fetchAllPaged() (js/common.js) stops on a short page with or without a
  // count, so no Content-Range arithmetic is needed for the loop to terminate.
  return jsonResponse(rows, 200, {
    'content-range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0'
  });
}

/**
 * Installs the dispatcher on a page and starts recording the three things a
 * state assertion needs: requests nobody planned for, uncaught page errors,
 * and console errors.
 *
 * @param {import('playwright').Page} page
 * @param {number} port port the static server is listening on
 * @returns {{ unexpected: string[], pageErrors: string[], consoleErrors: string[] }}
 */
export function installRoutes(page, port) {
  const unexpected = [];
  const pageErrors = [];
  const consoleErrors = [];

  // The #790 truncation was a throw swallowed by a boot-path .catch(), which
  // left three sections unrendered while every test stayed green. A page that
  // threw is not a page worth running axe over, so record it and let the
  // per-state assertions fail on it.
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    const host = url.hostname;

    // Served by tests/browser/static-server.js.
    if (host === '127.0.0.1' && url.port === String(port)) return route.continue();

    // The pages load supabase-js from jsdelivr. It is already a devDependency
    // here (js/globals.d.ts imports its types), and its UMD build defines the
    // same `supabase` global the CDN copy does.
    if (host === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: readFileSync(SUPABASE_UMD, 'utf8')
      });
    }

    // Stubbed rather than fetched. Fonts are the one with a consequence: text
    // renders in the platform fallback, which is why the baseline is
    // authoritative on the Linux CI runner (see CONTRIBUTING.md).
    if (host === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    if (host === 'fonts.gstatic.com') {
      return route.fulfill({ status: 200, contentType: 'font/woff2', body: '' });
    }
    // The Wowhead tooltip widget.
    if (host === 'wow.zamimg.com') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    }
    if (host === 'www.google.com' && url.pathname.startsWith('/s2/favicons')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
    }
    // The stream embeds. axe does not descend into a cross-origin frame, so
    // the document only has to exist.
    if (host.endsWith('twitch.tv') || host.endsWith('ttvnw.net')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>stream</title>'
      });
    }

    if (host.endsWith('.supabase.co')) {
      // Phase A is the public pages, so there is never a session. Everything
      // under /auth/v1 answers "signed out" rather than erroring, which is the
      // state a first-time visitor is in.
      if (url.pathname.startsWith('/auth/v1')) {
        return route.fulfill(jsonResponse(null));
      }

      const rest = url.pathname.split('/rest/v1/')[1];
      if (rest !== undefined) {
        if (rest.startsWith('rpc/')) {
          const rpc = fixture('rpc', {});
          const name = rest.slice(4);
          return route.fulfill(jsonResponse(name in rpc ? rpc[name] : null));
        }
        // One fixture per table, carrying the union of every column any select
        // asks for: `players` alone is read nine times with nine different
        // selects, and an extra property is harmless to render code. Filters
        // and ordering are ignored, so a fixture is a render input rather than
        // a database.
        const rows = fixture(rest, []);
        return route.fulfill(restResponse(Array.isArray(rows) ? rows : [rows], headers));
      }
    }

    unexpected.push(request.method() + ' ' + request.url());
    return route.abort();
  });

  return { unexpected, pageErrors, consoleErrors };
}

// The suite runs axe at desktop width and measures reflow at 480px, which is
// the narrowest width WCAG 2.1 1.4.10 asks a page to survive without a
// sideways scroll. Both are page-level rather than per-state, so they live
// here next to the routing they share.
export const DESKTOP = { width: 1280, height: 800 };
export const NARROW = { width: 480, height: 800 };

export function launchBrowser() {
  return chromium.launch();
}

/**
 * Opens one state in its own browser context and waits for its sentinel.
 *
 * A fresh context per state, not a shared page: IS_COLD_LANDING reads
 * sessionStorage.wga_team (js/common.js) and initTeamUI() writes it, so a
 * reused context would carry one state's team choice into the next.
 *
 * @param {import('playwright').Browser} browser
 * @param {number} port
 * @param {{ label: string, path: string, sentinel: string, click?: string }} state
 */
export async function openState(browser, port, state) {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const recorded = installRoutes(page, port);
  await page.goto('http://127.0.0.1:' + port + state.path, { waitUntil: 'load' });
  if (state.click) await page.click(state.click);
  try {
    await page.waitForSelector(state.sentinel, { timeout: 20000 });
  } catch {
    await context.close();
    throw new Error(
      state.label +
        ' never rendered its sentinel (' +
        state.sentinel +
        '). Either a fixture stopped matching what the page reads, or the render' +
        ' chain threw and something swallowed it: ' +
        (recorded.pageErrors.join(' | ') || 'no page error was recorded') +
        '.'
    );
  }
  return { context, page, ...recorded };
}
