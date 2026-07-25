import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// isItemInSeasonScope() scopes real catalog items via items.wcl_zone_id, but
// Other Sources placeholders (M+/Crafted/Catalyst) aren't tied to a raid
// zone at all -- they used to be unconditionally always-in-scope regardless
// of season, so an officer's "M+ - Head" pick made during Season 1 kept
// showing up forever, even after the team moved on to Season 2. Placeholder
// rows now carry their own `season` (bis_items.season / item_preferences.season,
// stamped at tag time), passed in as the second argument.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox(DATA) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  sandbox.DATA = DATA;
  return sandbox;
}

describe('isItemInSeasonScope -- placeholder rowSeason scoping', () => {
  it('shows a placeholder tagged for the currently-viewed season', () => {
    const sandbox = makeSandbox({
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2'
    });
    expect(sandbox.isItemInSeasonScope('M+', 'Midnight Season 2')).toBe(true);
  });

  it('hides a placeholder tagged for a different (older) season than the one being viewed', () => {
    const sandbox = makeSandbox({
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2'
    });
    expect(sandbox.isItemInSeasonScope('M+', 'Midnight Season 1')).toBe(false);
  });

  it('fails open for a legacy placeholder row with no season stamped at all', () => {
    const sandbox = makeSandbox({
      itemPlaceholders: { 'M+': true },
      seasonView: 'Midnight Season 2'
    });
    expect(sandbox.isItemInSeasonScope('M+', null)).toBe(true);
    expect(sandbox.isItemInSeasonScope('M+', undefined)).toBe(true);
  });

  it('still scopes real (non-placeholder) items by items.wcl_zone_id, ignoring rowSeason', () => {
    const sandbox = makeSandbox({
      itemPlaceholders: {},
      itemZones: { Helm: 1 },
      raidZones: [{ wclZoneId: '1', season: 'Midnight Season 1' }],
      seasonView: 'Midnight Season 2'
    });
    // rowSeason passed in shouldn't matter for real items -- zone-based check wins
    expect(sandbox.isItemInSeasonScope('Helm', 'Midnight Season 2')).toBe(false);
  });
});
