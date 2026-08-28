import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './static-server.js';
import { launchBrowser, openState, NARROW, REPO_ROOT } from './harness.js';
import { STATES } from './states.js';

// Accessibility measurements over the states in states.js (#810).
//
// The baseline is the point. Every violation the site has today is recorded in
// a11y-baseline.json, and the assertion is exact equality, so the suite fails
// on a new violation AND on a fixed one that nobody removed from the file.
// That makes the file the accessibility milestone's scoreboard rather than a
// list someone is trusted to keep current, which is the same reasoning as the
// backup coverage map in #699: assert the map, do not nudge someone to update
// it. A PR that closes a milestone issue deletes its own entries, and the diff
// shows exactly what it bought.
//
// Counts rather than selectors: axe reports targets like
// `.roster-table > tbody > tr:nth-child(3)`, which churn on any unrelated
// markup edit and would make the baseline unreadable. The live targets are
// printed in the failure message instead, so the detail is there when it is
// needed and absent when it is not.
//
// Refresh with: UPDATE_A11Y_BASELINE=1 npm run test:a11y

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'a11y-baseline.json');
const UPDATING = process.env.UPDATE_A11Y_BASELINE === '1';

// The four tag sets that make up WCAG 2.1 level AA. axe has plenty of rules
// outside them (best-practice, experimental); those are opinions this project
// has not adopted, and folding them in would bury the conformance signal.
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const observed = {};
const targets = {};

let server;
let browser;

beforeAll(async () => {
  server = await startServer(REPO_ROOT);
  browser = await launchBrowser();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  if (UPDATING) {
    // Written in state order rather than whatever order the runs finished in,
    // so the file diffs cleanly.
    const ordered = {};
    for (const state of STATES) if (observed[state.label]) ordered[state.label] = observed[state.label];
    writeFileSync(BASELINE_PATH, JSON.stringify(ordered, null, 2) + '\n');
  }
});

/** Renders the live axe targets for a rule, for the failure message only. */
function describeTargets(label) {
  const found = targets[label] || {};
  const rules = Object.keys(found).sort();
  if (!rules.length) return label + ': axe found no WCAG 2.1 AA violations.';
  return (
    label +
    ' live violations:\n' +
    rules.map((rule) => '  ' + rule + '\n' + found[rule].map((t) => '    ' + t).join('\n')).join('\n')
  );
}

describe.each(STATES)('$label', (state) => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, state);

    const result = await new AxeBuilder({ page: opened.page }).withTags(WCAG_21_AA).analyze();
    const found = {};
    const tally = (list) => {
      const counts = {};
      for (const entry of list) {
        counts[entry.id] = entry.nodes.length;
        found[entry.id] = entry.nodes.map((node) => node.target.join(' '));
      }
      return counts;
    };
    const counts = tally(result.violations);
    // Recorded alongside the violations, not dropped. axe returns a check it
    // could not decide as `incomplete` rather than a violation, and the whole
    // colour-contrast story on these pages lands there: the header text sits
    // on a pseudo-element background axe cannot resolve. Left out of the file,
    // "no contrast violations" would read as "contrast is fine" when what it
    // means is "contrast is fine everywhere axe could measure it". These are
    // the ones that still need a human eye.
    const incomplete = tally(result.incomplete);
    targets[state.label] = found;

    // WCAG 2.1 AA 1.4.10 Reflow: content has to survive 320 CSS pixels wide
    // without a second scroll direction. 480 is the width the site's own
    // breakpoints target and the width #807 shipped an overflow at, measured
    // by resizing the viewport rather than the window, because a window resize
    // leaves the page reporting the old innerWidth.
    await opened.page.setViewportSize(NARROW);
    // Let any resize-driven layout settle before measuring.
    await opened.page.waitForTimeout(300);
    const fits = await opened.page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );

    observed[state.label] = { axe: counts, axeIncomplete: incomplete, reflow480: fits ? 'ok' : 'overflow' };
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('matches the recorded accessibility baseline', () => {
    // Not it.skipIf(UPDATING): vitest skips a describe's beforeAll when every
    // test in it is skipped, so the refresh run would measure nothing and
    // write an empty file. The branch has to be inside the body, and the
    // measurement check above still means something on a refresh run.
    const measured = observed[state.label];
    expect(measured, 'nothing was measured for this state').toBeDefined();
    if (UPDATING) return;
    expect(measured, describeTargets(state.label)).toEqual(baseline[state.label]);
  });
});

it('has a baseline entry for every state and no entry for anything else', () => {
  // The per-state assertion above cannot see a baseline entry for a state that
  // was renamed or deleted, because nothing looks it up any more. This can.
  // Skipped on a refresh run, where the file is about to be rewritten.
  if (UPDATING) return;
  expect(Object.keys(baseline).sort()).toEqual(STATES.map((s) => s.label).sort());
});
