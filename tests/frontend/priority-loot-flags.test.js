import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #360: DATA.lootCounts keys are diacritic-stripped (normalise()), but
// prioEditLootFlags() used to look up `lootCounts[firstName.toLowerCase()]`,
// which keeps accents -- so an accented roster name never matched its own loot.
// The player then showed no "has Heroic version" badge and, worse, was never
// blocked by prioEditIsBlocked(), so someone who already received the item
// could be ranked for it again.
//
// This loads the real js/common.js (for the real normalise()/getLootEntry())
// alongside tab-priority.js rather than stubbing them -- the whole bug is in
// the normalisation semantics, so a stub would test nothing.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

// The loot map as mapSupabaseLoot() emits it: keys are normalise()d, so the
// accented character "Katorrí" is stored under the stripped key "katorri".
function lootCounts() {
  return {
    katorri: {
      count: 2,
      items: [
        { name: 'Signet of the Starved Beast', difficulty: 'Mythic' },
        { name: 'Bond of Light', difficulty: 'Heroic' }
      ]
    },
    snarge: {
      count: 1,
      items: [{ name: 'Signet of the Starved Beast', difficulty: 'Heroic' }]
    },
    fxhp: {
      count: 1,
      items: [{ name: 'Signet of the Starved Beast', difficulty: 'Normal' }]
    }
  };
}

function makeSandbox({ item, difficulty }) {
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
  sandbox.DATA = { lootCounts: lootCounts() };
  sandbox.PRIO_EDIT.item = item;
  sandbox.PRIO_EDIT.difficulty = difficulty;
  return sandbox;
}

describe('prioEditLootFlags accent handling (#360)', () => {
  it('finds an accented player mythic loot entry (was silently missed)', () => {
    const sandbox = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Mythic' });
    expect(sandbox.prioEditLootFlags('Katorrí')).toEqual({ hasNormal: false, hasHeroic: false, hasMythic: true });
  });

  it('finds an accented player heroic loot entry', () => {
    const sandbox = makeSandbox({ item: 'Bond of Light', difficulty: 'Mythic' });
    expect(sandbox.prioEditLootFlags('Katorrí')).toEqual({ hasNormal: false, hasHeroic: true, hasMythic: false });
  });

  it('still blocks an accented mythic recipient from being re-ranked (the fairness bug)', () => {
    const sandbox = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Mythic' });
    // Before the fix this returned false: the lookup missed, so a player who
    // already had the mythic item could be added to the mythic list again.
    expect(sandbox.prioEditIsBlocked('Katorrí')).toBe(true);
  });

  it('unaccented names keep working exactly as before', () => {
    const sandbox = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Mythic' });
    expect(sandbox.prioEditLootFlags('Snarge')).toEqual({ hasNormal: false, hasHeroic: true, hasMythic: false });
    // Heroic recipient is still eligible (penalized) for mythic, per the
    // generate_priority_order() exclusion rule.
    expect(sandbox.prioEditIsBlocked('Snarge')).toBe(false);
    // ...but blocked from the heroic track.
    const heroic = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Heroic' });
    expect(heroic.prioEditIsBlocked('Snarge')).toBe(true);
  });

  it('a player with no loot at all is unblocked', () => {
    const sandbox = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Mythic' });
    expect(sandbox.prioEditLootFlags('Nobody')).toEqual({ hasNormal: false, hasHeroic: false, hasMythic: false });
    expect(sandbox.prioEditIsBlocked('Nobody')).toBe(false);
  });

  // Champion/Normal is informational only -- it never blocks a Heroic or
  // Mythic rank, unlike hasHeroic/hasMythic (Champion loot sits outside the
  // priority system entirely, docs/database-decisions.md 2026-07-07).
  it('flags a Champion (Normal) recipient without blocking either track', () => {
    const mythic = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Mythic' });
    expect(mythic.prioEditLootFlags('Fxhp')).toEqual({ hasNormal: true, hasHeroic: false, hasMythic: false });
    expect(mythic.prioEditIsBlocked('Fxhp')).toBe(false);
    const heroic = makeSandbox({ item: 'Signet of the Starved Beast', difficulty: 'Heroic' });
    expect(heroic.prioEditIsBlocked('Fxhp')).toBe(false);
  });
});
