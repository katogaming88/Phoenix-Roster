import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/common.js is a plain browser script (no exports); this loads it into a
// vm sandbox with just enough of the browser globals stubbed for its
// top-level statements, so the tests can reach seasonDisplayName()/
// seasonCodeForDisplay() directly (#341).

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

describe('seasonDisplayName / seasonCodeForDisplay (#341)', () => {
  it('translates MID1 without any SEASON_LABELS entry', () => {
    const sandbox = loadCommonJs();
    expect(sandbox.SEASON_LABELS).toEqual({});
    expect(sandbox.seasonDisplayName('MID1')).toBe('Midnight Season 1');
    expect(sandbox.seasonCodeForDisplay('Midnight Season 1')).toBe('MID1');
  });

  it('translates seasons that have never been hardcoded (MID2, MID7)', () => {
    const sandbox = loadCommonJs();
    expect(sandbox.seasonDisplayName('MID2')).toBe('Midnight Season 2');
    expect(sandbox.seasonDisplayName('MID7')).toBe('Midnight Season 7');
    expect(sandbox.seasonCodeForDisplay('Midnight Season 2')).toBe('MID2');
    expect(sandbox.seasonCodeForDisplay('Midnight Season 7')).toBe('MID7');
  });

  it('round-trips symmetrically for an arbitrary season number', () => {
    const sandbox = loadCommonJs();
    expect(sandbox.seasonCodeForDisplay(sandbox.seasonDisplayName('MID42'))).toBe('MID42');
    expect(sandbox.seasonDisplayName(sandbox.seasonCodeForDisplay('Midnight Season 42'))).toBe('Midnight Season 42');
  });

  it('falls through unchanged for a code/name that matches neither the pattern nor an override', () => {
    const sandbox = loadCommonJs();
    expect(sandbox.seasonDisplayName('DF3')).toBe('DF3');
    expect(sandbox.seasonCodeForDisplay('Dragonflight Season 3')).toBe('Dragonflight Season 3');
  });

  it('SEASON_LABELS overrides the pattern when a season needs an exception', () => {
    const sandbox = loadCommonJs();
    sandbox.SEASON_LABELS.MID3 = 'The Renamed Season';
    expect(sandbox.seasonDisplayName('MID3')).toBe('The Renamed Season');
    expect(sandbox.seasonCodeForDisplay('The Renamed Season')).toBe('MID3');
    // Unaffected seasons still fall through to the pattern.
    expect(sandbox.seasonDisplayName('MID4')).toBe('Midnight Season 4');
  });

  it('reads the prefix from the hardcoded SEASON_CODE_PREFIX/SEASON_DISPLAY_PREFIX constants, ignoring DATA', () => {
    const sandbox = loadCommonJs();
    // A future expansion boundary updates the constants themselves (in the
    // same commit as CURRENT_SEASON), not a per-team DATA setting -- setting
    // DATA here must have no effect.
    sandbox.DATA = { seasonCodePrefix: 'DF', seasonDisplayPrefix: 'Dragonflight Season' };
    expect(sandbox.seasonDisplayName('MID9')).toBe('Midnight Season 9');
    expect(sandbox.seasonCodeForDisplay('Midnight Season 9')).toBe('MID9');
  });

  it('treats prefix values as literal text, not regex syntax', () => {
    const sandbox = loadCommonJs();
    sandbox.SEASON_CODE_PREFIX = 'M.D';
    sandbox.SEASON_DISPLAY_PREFIX = 'Mid+Season';
    expect(sandbox.seasonDisplayName('M.D1')).toBe('Mid+Season 1');
    // A code that would match if the '.' were a real regex wildcard must not.
    expect(sandbox.seasonDisplayName('MXD1')).toBe('MXD1');
  });
});
