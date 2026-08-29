import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Officer view: flag a ranked player who already received the exact item
// being ranked, so officers can weigh that when exercising discretion.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox() {
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
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  // Real DATA.lootCounts is keyed by normalise(name_realm), not first name
  // alone (#359) -- both fixtures below share the "Raz" first name on
  // different realms, matching the shape that exposed the bug.
  sandbox.DATA = {
    lootCounts: {
      'fxhp-illidan': {
        count: 1,
        items: [{ name: 'Soulcoiler Ritual Vessel', difficulty: 'Heroic' }]
      },
      'raz-illidan': {
        count: 1,
        items: [{ name: 'Voracious Heart of Ula’tek', difficulty: 'Normal' }]
      },
      'raz-stormrage': {
        count: 1,
        items: [{ name: 'Voracious Heart of Ula’tek', difficulty: 'Heroic' }]
      }
    }
  };
  return sandbox;
}

describe('playerReceivedItem', () => {
  it('flags a player who already received this exact item on this exact difficulty', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp', nameRealm: 'Fxhp-Illidan' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(true);
  });

  it('does not flag the same item on a different difficulty', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp', nameRealm: 'Fxhp-Illidan' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Mythic')).toBe(false);
  });

  it('does not flag a different item', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp', nameRealm: 'Fxhp-Illidan' };
    expect(sandbox.playerReceivedItem(player, 'Some Other Trinket', 'Heroic')).toBe(false);
  });

  it('does not flag a player with no loot history', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Nobody', nameRealm: 'Nobody-Illidan' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(false);
  });

  it('handles a missing player gracefully', () => {
    const sandbox = makeSandbox();
    expect(sandbox.playerReceivedItem(null, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(false);
  });

  // Regression: two players sharing a first name on different realms used to
  // collapse into one loot record via getLootEntry()'s ambiguous first-name
  // fallback, which only triggers when the caller passes a bare first name
  // instead of the full name_realm identity.
  it('does not misattribute a same-first-name player on another realm’s Heroic drop', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Raz', nameRealm: 'Raz-Illidan' };
    expect(sandbox.playerReceivedItem(player, 'Voracious Heart of Ula’tek', 'Heroic')).toBe(false);
  });

  it('still flags the actual Heroic recipient sharing that first name', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Raz', nameRealm: 'Raz-Stormrage' };
    expect(sandbox.playerReceivedItem(player, 'Voracious Heart of Ula’tek', 'Heroic')).toBe(true);
  });
});
