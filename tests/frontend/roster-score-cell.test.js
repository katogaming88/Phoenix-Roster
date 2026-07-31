import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// _rosterScoreCellHtml() (tab-roster.js) renders the Roster tab's Recent
// Score column -- the exact committed value generate_priority_order() reads
// for DPS priority. Tank/Heal are excluded from that formula's performance
// blend entirely (Attendance only), so they always show "--" regardless of
// whatever's in the scoring column for them. Same load-common.js-then-the-
// tab-file sandbox pattern as tests/frontend/priority-boss-filter-order.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-roster.js'), 'utf8');

function makeSandbox() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'tab-roster.js' });
  return sandbox;
}

describe('_rosterScoreCellHtml', () => {
  it('shows "--" for Tank regardless of a stored score', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 1: 9.5 } };
    const html = sandbox._rosterScoreCellHtml({ id: 1, role: 'Tank' });
    expect(html).toContain('-');
    expect(html).toContain('Priority uses Attendance only for this role');
    expect(html).not.toContain('9.5');
  });

  it('shows "--" for Heal regardless of a stored score', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 2: 3 } };
    const html = sandbox._rosterScoreCellHtml({ id: 2, role: 'Heal' });
    expect(html).toContain('Priority uses Attendance only for this role');
  });

  it('shows a green DPS score at or above 7', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 3: 8.4 } };
    const html = sandbox._rosterScoreCellHtml({ id: 3, role: 'Ranged' });
    expect(html).toContain('8.40');
    expect(html).toContain('var(--heal)');
  });

  it('shows a gold DPS score between 5 and 7', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 4: 5.5 } };
    const html = sandbox._rosterScoreCellHtml({ id: 4, role: 'Melee' });
    expect(html).toContain('5.50');
    expect(html).toContain('var(--gold)');
  });

  it('shows a dim DPS score below 5', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 5: 2.1 } };
    const html = sandbox._rosterScoreCellHtml({ id: 5, role: 'Ranged' });
    expect(html).toContain('2.10');
    expect(html).toContain('var(--text-dim)');
  });

  it('shows a "no committed score yet" dash for a DPS player with no row in the cache', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: {} };
    const html = sandbox._rosterScoreCellHtml({ id: 6, role: 'Ranged' });
    expect(html).toContain('No committed score yet this season');
  });

  it('shows the same "not yet" dash when the cache has not loaded at all', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = null;
    const html = sandbox._rosterScoreCellHtml({ id: 7, role: 'Melee' });
    expect(html).toContain('No committed score yet this season');
  });
});
