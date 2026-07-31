import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// _seasonPerfStatusLabel() (tab-season.js) turns a player_wcl_season_perf row
// count for the newest archived season into the status label shown next to
// the "Fetch WCL Performance" row -- added because the fetch step is easy to
// forget (it only appears for the newest history entry, no other reminder
// existed anywhere). Same load-common.js-then-the-tab-file sandbox pattern as
// tests/frontend/priority-boss-filter-order.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const SEASON_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-season.js'), 'utf8');

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
  vm.runInContext(SEASON_JS, sandbox, { filename: 'tab-season.js' });
  return sandbox;
}

describe('_seasonPerfStatusLabel', () => {
  it('flags zero rows as not yet fetched, in gold', () => {
    const sandbox = makeSandbox();
    expect(sandbox._seasonPerfStatusLabel(0)).toEqual({
      text: 'Not fetched yet -- do this before generating Heroic priority.',
      color: 'var(--gold)'
    });
  });

  it('singular player count', () => {
    const sandbox = makeSandbox();
    expect(sandbox._seasonPerfStatusLabel(1)).toEqual({
      text: 'Already fetched (1 player).',
      color: 'var(--heal)'
    });
  });

  it('plural player count', () => {
    const sandbox = makeSandbox();
    expect(sandbox._seasonPerfStatusLabel(12)).toEqual({
      text: 'Already fetched (12 players).',
      color: 'var(--heal)'
    });
  });
});
