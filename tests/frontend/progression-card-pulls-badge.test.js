import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// _renderPullsBadge() (js/roster.js) renders the Mythic pull count on a
// progression-card boss row, with _renderHeroicRow() rendering the separate
// Heroic line right below it. Before AOTC, a team hasn't touched Mythic at
// all, so every boss's Mythic progress row was 0 pulls, not killed -- but
// the badge rendered it anyway as a bare "0 pulls", reading as a duplicate
// of the real Heroic pull count directly beneath it (confirmed live: a boss
// with "H 2026-08-20 1 pull" below it also showed an unlabeled "0 pulls"
// above, with nothing distinguishing which difficulty either number was
// for). Fixed by suppressing the badge when there's genuinely nothing to
// report: 0 pulls and not killed.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/roster.js'), 'utf8');

function makeSandbox() {
  const sandbox = {
    console,
    document: {
      // roster.js wires a top-level 'change' listener onto #playerSelect at
      // load time (outside any function), so getElementById needs to return
      // a stub with addEventListener rather than null.
      getElementById: () => ({ addEventListener: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      addEventListener: () => {}
    },
    window: {},
    location: { search: '', pathname: '/' }
  };
  vm.createContext(sandbox);
  // roster.js self-boots at the bottom (bootRosterApp()), which needs a lot
  // more than this test cares about (checkMaintenanceMode, Supabase, DATA
  // loading...). Function declarations hoist, so _renderPullsBadge is
  // already defined on the sandbox by the time that boot call throws --
  // swallow it rather than stub out roster.js's entire boot chain just to
  // reach a pure rendering helper near the top of the file.
  try {
    vm.runInContext(ROSTER_JS, sandbox, { filename: 'roster.js' });
  } catch (err) {
    if (!/checkMaintenanceMode/.test(err.message)) throw err;
  }
  return sandbox;
}

describe('_renderPullsBadge', () => {
  it('renders nothing for a boss with 0 Mythic pulls and no kill', () => {
    const sandbox = makeSandbox();
    const html = sandbox._renderPullsBadge({ pulls: 0, bestPct: null }, false);
    expect(html).toBe('');
  });

  it('still renders when there are real Mythic pulls, even unkilled', () => {
    const sandbox = makeSandbox();
    const html = sandbox._renderPullsBadge({ pulls: 5, bestPct: 42.1 }, false);
    expect(html).toContain('5 pulls');
    expect(html).toContain('42.1%');
  });

  it('still renders a kill even at 0 recorded pulls (edge case, but never hide a real kill)', () => {
    const sandbox = makeSandbox();
    const html = sandbox._renderPullsBadge({ pulls: 0, bestPct: null }, true);
    expect(html).toContain('0 pulls');
  });

  it('uses singular "pull" for exactly 1', () => {
    const sandbox = makeSandbox();
    const html = sandbox._renderPullsBadge({ pulls: 1, bestPct: null }, false);
    expect(html).toContain('1 pull');
    expect(html).not.toContain('1 pulls');
  });

  it('returns empty when progress is entirely absent', () => {
    const sandbox = makeSandbox();
    expect(sandbox._renderPullsBadge(null, false)).toBe('');
  });
});
