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
  sandbox.DATA = {
    lootCounts: {
      fxhp: {
        count: 1,
        items: [{ name: 'Soulcoiler Ritual Vessel', difficulty: 'Heroic' }]
      }
    }
  };
  return sandbox;
}

describe('playerReceivedItem', () => {
  it('flags a player who already received this exact item on this exact difficulty', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(true);
  });

  it('does not flag the same item on a different difficulty', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Mythic')).toBe(false);
  });

  it('does not flag a different item', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Fxhp' };
    expect(sandbox.playerReceivedItem(player, 'Some Other Trinket', 'Heroic')).toBe(false);
  });

  it('does not flag a player with no loot history', () => {
    const sandbox = makeSandbox();
    const player = { firstName: 'Nobody' };
    expect(sandbox.playerReceivedItem(player, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(false);
  });

  it('handles a missing player gracefully', () => {
    const sandbox = makeSandbox();
    expect(sandbox.playerReceivedItem(null, 'Soulcoiler Ritual Vessel', 'Heroic')).toBe(false);
  });
});
