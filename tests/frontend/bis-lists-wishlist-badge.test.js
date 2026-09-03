import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// The tab renders timestamps through formatDateTime() and the zone note
// through localTimeZoneNote(), both js/common.js globals (#905); the real
// ones, so the suite cannot pin a shape the shipped helpers need not have.
const realCommon = loadCommonJs(quietConsole);

// #515: the BiS Lists sub-tab shows a per-row "Wishlist incomplete" badge
// (hover for which slots) instead of a standalone banner elsewhere on the
// page listing every raider's missing slots -- this replaced an earlier,
// too-noisy full breakdown banner. getIncompleteWishlists() itself is
// defined in tab-priority.js (loaded after tab-bis.js in officer.html, but
// that only matters for parse-time references -- by the time
// buildBisListsTab() actually runs, both are loaded), so it's stubbed here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const BIS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-bis.js'), 'utf8');

function makeSandbox({ roster, incompleteWishlists }) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  sandbox.formatDateTime = realCommon.formatDateTime;
  sandbox.localTimeZoneNote = realCommon.localTimeZoneNote;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(BIS_JS, sandbox, { filename: 'tab-bis.js' });

  sandbox.DATA = { roster, bisItems: {} };
  sandbox.getIncompleteWishlists = () => incompleteWishlists;

  const container = { innerHTML: '' };
  sandbox.document.getElementById = (id) => (id === 'bis-lists-container' ? container : null);
  return { sandbox, container };
}

describe('buildBisListsTab wishlist-incomplete badge (#515, item-level)', () => {
  it('shows a "Wishlist incomplete" badge with a hover title listing missing items per row', () => {
    const roster = [{ firstName: 'Kat', nameRealm: 'Kat-Illidan', role: 'Melee', isBench: false, class: 'Rogue' }];
    const incompleteWishlists = {
      count: 1,
      raiders: [{ nameRealm: 'Kat-Illidan', missingRows: ['Neck', 'Waist'], missingCounts: { Neck: 2, Waist: 1 } }]
    };
    const { sandbox, container } = makeSandbox({ roster, incompleteWishlists });

    sandbox.buildBisListsTab();

    expect(container.innerHTML).toContain('Wishlist incomplete (3)');
    expect(container.innerHTML).toContain('Wishlist missing: Neck (2), Waist (1)');
  });

  it('omits the badge for a raider with a complete wishlist', () => {
    const roster = [{ firstName: 'Kat', nameRealm: 'Kat-Illidan', role: 'Melee', isBench: false, class: 'Rogue' }];
    const incompleteWishlists = { count: 0, raiders: [] };
    const { sandbox, container } = makeSandbox({ roster, incompleteWishlists });

    sandbox.buildBisListsTab();

    expect(container.innerHTML).not.toContain('Wishlist incomplete');
  });
});
