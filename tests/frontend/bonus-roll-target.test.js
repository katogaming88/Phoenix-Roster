import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression coverage for a bug caught live: fetchSupabaseRaidEncounters()
// originally filtered its query to CURRENT_SEASON.code (a hardcoded
// item-catalog-tier constant), which doesn't match a team's actual
// raid_zones.season -- the Bonus Roll dropdown rendered with only "-- None
// --" in it, no bosses. Fixed by fetching every season's encounters
// unfiltered and filtering client-side (js/bonusRoll.js) against
// resolveSeasonView(), the same "fetch once, filter at use time" split
// isItemInSeasonScope()/currentZoneIdsForSeason() already use.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const BONUS_ROLL_JS = readFileSync(path.join(HERE, '../../js/bonusRoll.js'), 'utf8');

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
  vm.runInContext(BONUS_ROLL_JS, sandbox, { filename: 'bonusRoll.js' });
  sandbox.DATA = DATA;
  return sandbox;
}

describe('mapSupabaseRaidEncounters', () => {
  it('carries the embedded raid_zones.season through onto each encounter', () => {
    const sandbox = makeSandbox({});
    const rows = [
      { id: 1, name: 'Boss A', sort_index: 0, raid_zones: { name: 'Zone', season: 'Midnight Season 2', sort_index: 0 } }
    ];
    expect(sandbox.mapSupabaseRaidEncounters(rows)).toEqual([
      { id: 1, name: 'Boss A', sortIndex: 0, season: 'Midnight Season 2', zoneName: 'Zone', zoneSortIndex: 0 }
    ]);
  });

  it('sorts by zone sort_index first, then encounter sort_index within a zone', () => {
    const sandbox = makeSandbox({});
    const rows = [
      { id: 3, name: 'Zone2 Boss2', sort_index: 1, raid_zones: { name: 'Zone2', season: 'S', sort_index: 1 } },
      { id: 1, name: 'Zone1 Boss1', sort_index: 0, raid_zones: { name: 'Zone1', season: 'S', sort_index: 0 } },
      { id: 2, name: 'Zone1 Boss2', sort_index: 1, raid_zones: { name: 'Zone1', season: 'S', sort_index: 0 } }
    ];
    expect(sandbox.mapSupabaseRaidEncounters(rows).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('does not filter by season -- that happens at render time, not here', () => {
    const sandbox = makeSandbox({});
    const rows = [
      {
        id: 1,
        name: 'Old Boss',
        sort_index: 0,
        raid_zones: { name: 'Old Zone', season: 'Midnight Season 1', sort_index: 0 }
      },
      {
        id: 2,
        name: 'New Boss',
        sort_index: 0,
        raid_zones: { name: 'New Zone', season: 'Midnight Season 2', sort_index: 1 }
      }
    ];
    expect(sandbox.mapSupabaseRaidEncounters(rows)).toHaveLength(2);
  });
});

describe('ownBonusRollSectionHTML -- season filtering at render time', () => {
  const player = { id: 1, firstName: 'Kat', nameRealm: 'Kat-Illidan', bonusRollEncounterId: null };

  function withSession(sandbox) {
    sandbox.getDiscordSession = () => ({ nameRealm: 'Kat-Illidan' });
    return sandbox;
  }

  it('only lists encounters matching the resolved season view', () => {
    const sandbox = withSession(
      makeSandbox({
        seasonView: 'Midnight Season 2',
        raidEncounters: [
          { id: 1, name: 'S1 Boss', season: 'Midnight Season 1' },
          { id: 2, name: 'S2 Boss', season: 'Midnight Season 2' }
        ]
      })
    );
    const html = sandbox.ownBonusRollSectionHTML(player, 'landing');
    expect(html).toContain('S2 Boss');
    expect(html).not.toContain('S1 Boss');
  });

  it('fails open (shows every seeded boss) when no season is configured at all', () => {
    const sandbox = withSession(
      makeSandbox({
        seasonName: '',
        raidEncounters: [
          { id: 1, name: 'S1 Boss', season: 'Midnight Season 1' },
          { id: 2, name: 'S2 Boss', season: 'Midnight Season 2' }
        ]
      })
    );
    const html = sandbox.ownBonusRollSectionHTML(player, 'landing');
    expect(html).toContain('S1 Boss');
    expect(html).toContain('S2 Boss');
  });
});
