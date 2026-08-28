import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// prefersReducedMotion() (#435), the JS half of the motion baseline.
//
// CSS can only reach scrolling that the CSS started. The two places this site
// scrolls (js/discord.js's team-switcher jump and js/tabs/tab-roster.js's
// inline profile row) pass `behavior: 'smooth'` as an argument, which
// overrides scroll-behavior and is invisible to the media query. So they ask
// this helper instead, and this is where it is checked.

/** Loads common.js and installs a matchMedia stand-in that reports `matches`. */
function withMatchMedia(matches) {
  const sandbox = loadCommonJs(quietConsole);
  const seen = [];
  sandbox.matchMedia = (query) => {
    seen.push(query);
    return { matches };
  };
  return { sandbox, seen };
}

describe('prefersReducedMotion', () => {
  it('is true when the browser reports the preference', () => {
    const { sandbox } = withMatchMedia(true);
    expect(sandbox.prefersReducedMotion()).toBe(true);
  });

  it('is false when it does not', () => {
    const { sandbox } = withMatchMedia(false);
    expect(sandbox.prefersReducedMotion()).toBe(false);
  });

  it('asks the query the CSS block is keyed on', () => {
    // A typo here fails open and silently: an unrecognised media query never
    // matches, so every caller would keep animating and nothing would say so.
    const { sandbox, seen } = withMatchMedia(true);
    sandbox.prefersReducedMotion();
    expect(seen).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('is false rather than throwing where matchMedia does not exist', () => {
    // The vm sandbox these suites run in has no matchMedia, and neither does
    // any other non-browser host. Throwing here would take down whichever
    // render path called it, which is the shape of the #790 truncation.
    const sandbox = loadCommonJs(quietConsole);
    expect(typeof sandbox.matchMedia).toBe('undefined');
    expect(sandbox.prefersReducedMotion()).toBe(false);
  });

  it('answers on every call rather than caching the first read', () => {
    // The preference can change while the page is open, and macOS and Windows
    // both let it. A cached read would leave the page animating until reload.
    const sandbox = loadCommonJs(quietConsole);
    let matches = false;
    sandbox.matchMedia = () => ({ matches });
    expect(sandbox.prefersReducedMotion()).toBe(false);
    matches = true;
    expect(sandbox.prefersReducedMotion()).toBe(true);
  });
});

describe('motionSafeScrollBehavior', () => {
  // Neither call site can be reached by the browser suite in Phase A: the
  // team-switcher jump sits behind the claim modal and the inline profile row
  // is officer-only. So the mapping is tested here rather than at the call
  // sites, which is most of why it is a shared function and not a ternary
  // written out twice, where one of the two could be inverted and still read
  // fine.
  it('is auto when the viewer asked for less motion', () => {
    const { sandbox } = withMatchMedia(true);
    expect(sandbox.motionSafeScrollBehavior()).toBe('auto');
  });

  it('is smooth when they did not', () => {
    const { sandbox } = withMatchMedia(false);
    expect(sandbox.motionSafeScrollBehavior()).toBe('smooth');
  });
});
