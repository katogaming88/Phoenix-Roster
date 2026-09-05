import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, REPO_ROOT } from './harness.js';
import { STATES } from './states.js';

// Focus visibility, WCAG 2.1 AA 2.4.7 (#435). axe has no automated rule for
// this, so the accessibility baseline is silent about it and these assertions
// are the only thing checking it.
//
// Scripted focus, not a Tab walk, for two measured reasons. Once focus enters
// a stream embed, keyboard.press('Tab') goes to the cross-origin child
// document and never comes back: eight consecutive presses left the iframe
// active, and one state spent 22 of 40 presses there. And because the embeds
// lazy-load, whether a walk stalls depends on whether the iframe finished
// loading, so the same test would pass or hang depending on timing.
//
// One real Tab first is what makes scripted focus count. Chromium decides
// :focus-visible from the last interaction modality, so after a keyboard
// interaction an el.focus() still matches, and after a mouse click it does not
// for a button or a link. Both directions are asserted below, because that
// difference is the visual contract: Tab shows a ring, clicking does not.

const RING = { style: 'solid', width: '2px', color: 'rgb(214, 163, 68)' };

// iframe is deliberately absent. A focused cross-origin iframe matches
// nothing at all here: not :focus, not :focus-visible, not :focus-within, and
// neither does its wrapper. document.activeElement is the iframe, but as far
// as this document's CSS is concerned focus has left it, so no rule in
// css/styles.css can give it an indicator and asserting one would be asking
// for something unreachable. The embedded player draws its own inside.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Today's states carry 19 (the signed-out BoE Sales page: skip link, header
// link, six nav items, the sign-in button, eight form controls and two footer
// links) to 48 focusable elements. The example was written when that page had
// seven, before #891 moved the report form onto it and #930 gave it the guild
// nav. The floor is well under the range on purpose: it is here so a selector
// that stopped matching cannot pass every assertion below by having nothing
// to assert on.
const MIN_FOCUSABLE = 5;

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

/** Focuses every rendered focusable element and reads its outline back. */
function collectFocusStyles(page, selector) {
  return page.evaluate((sel) => {
    const rendered = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    const name = (el) =>
      el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const results = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!rendered(el)) continue;
      el.focus();
      const cs = getComputedStyle(el);
      results.push({
        name: name(el),
        focusVisible: el.matches(':focus-visible'),
        style: cs.outlineStyle,
        width: cs.outlineWidth,
        color: cs.outlineColor
      });
    }
    return results;
  }, selector);
}

describe.each(STATES)('$label focus indicators', (state) => {
  let opened;
  let found;

  beforeAll(async () => {
    opened = await openState(browser, server.port, state);
    await opened.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await opened.page.keyboard.press('Tab');
    found = await collectFocusStyles(opened.page, FOCUSABLE);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('has focusable elements to judge', () => {
    expect(found.length).toBeGreaterThanOrEqual(MIN_FOCUSABLE);
  });

  it('gives every one of them the designed focus ring', () => {
    // The exact value, not merely "an outline". Chromium's own default is
    // `auto 1px` and it is present on almost every element here already, so a
    // looser assertion would have passed before this rule existed and after,
    // and told nobody anything.
    const missing = found
      .filter((el) => !(el.style === RING.style && el.width === RING.width && el.color === RING.color))
      .map((el) => el.name + ' [' + el.style + ' ' + el.width + ' ' + el.color + ']');
    expect(missing).toEqual([]);
  });

  it('treats keyboard focus as focus-visible on every one of them', () => {
    expect(found.filter((el) => !el.focusVisible).map((el) => el.name)).toEqual([]);
  });
});

describe('the ring is for keyboard users', () => {
  // The contract in one place: Tab shows a ring, a click on a button or a link
  // does not, and a click into a text input or a select does, because a
  // control that takes keyboard input always matches :focus-visible by spec.
  // Written down as a test so it cannot drift after it has been agreed.
  let opened;
  let afterKeyboard;
  let afterMouse;

  const SAMPLE = {
    button: '#navRoster',
    link: 'a.header-link',
    textInput: '#lootSearchInput',
    select: '#teamSwitcherSelect'
  };

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATES[0]);

    const sample = () =>
      opened.page.evaluate((map) => {
        const out = {};
        for (const [key, sel] of Object.entries(map)) {
          const el = document.querySelector(sel);
          if (!el) {
            out[key] = null;
            continue;
          }
          el.focus();
          const cs = getComputedStyle(el);
          out[key] = { focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle };
        }
        return out;
      }, SAMPLE);

    await opened.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await opened.page.keyboard.press('Tab');
    afterKeyboard = await sample();

    await opened.page.mouse.click(400, 400);
    afterMouse = await sample();
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('found all four sample controls', () => {
    // Without this a renamed id would make the pair of assertions below
    // compare null to null and agree.
    expect(Object.entries(afterKeyboard).filter(([, v]) => v === null)).toEqual([]);
  });

  it('rings everything after a keyboard interaction', () => {
    for (const key of Object.keys(SAMPLE)) {
      expect(afterKeyboard[key], key).toEqual({ focusVisible: true, style: 'solid' });
    }
  });

  it('leaves buttons and links alone after a mouse click', () => {
    expect(afterMouse.button).toEqual({ focusVisible: false, style: 'none' });
    expect(afterMouse.link).toEqual({ focusVisible: false, style: 'none' });
  });

  it('still rings text inputs and selects after a mouse click', () => {
    expect(afterMouse.textInput).toEqual({ focusVisible: true, style: 'solid' });
    expect(afterMouse.select).toEqual({ focusVisible: true, style: 'solid' });
  });
});

describe('nav tooltips', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATES[0]);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  const tooltipOpacity = () =>
    opened.page.evaluate(() => {
      const nav = document.getElementById('navRoster');
      nav.focus();
      return getComputedStyle(nav, '::after').opacity;
    });

  it('appear on keyboard focus', async () => {
    await opened.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await opened.page.keyboard.press('Tab');
    expect(await tooltipOpacity()).toBe('1');
  });

  it('stay hidden when focus arrives by mouse', async () => {
    // The counterfactual. Without it this file would pass just as happily on a
    // rule that shows every tooltip all the time.
    await opened.page.mouse.click(400, 400);
    expect(await tooltipOpacity()).toBe('0');
  });
});
