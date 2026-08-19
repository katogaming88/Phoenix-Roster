import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// Officer-side item_preferences reads and season scope (#707 item 1).
//
// archive_current_season() never touches item_preferences (its only delete is
// bis_items), so at a rollover the previous season's rows stay put and the new
// season's land beside them. The raider path filters on the row's own season
// (js/wishlist.js, via isItemInSeasonScope); the officer path never fetched the
// column, so every officer-side consumer saw season undefined and
// isItemInSeasonScope's placeholder branch failed open.
//
// bisMergeWishlistPrefs is where that bites: it is the funnel both officer
// consumers share (the profile BiS merge in renderProfile, and
// buildContestedItemMap in tab-conflicts.js), and the entries it synthesises
// from wishlist rows are concatenated onto bisItems *after* the caller's
// season filter has already run.

function sandboxWithCatalog() {
  const sandbox = loadCommonJs(quietConsole);
  sandbox.DATA = {
    itemIds: { 'M+': 9001, Crafted: 9002, 'Old Tier Helm': 101, 'New Tier Helm': 202 },
    itemSlots: { 'Old Tier Helm': 'Head', 'New Tier Helm': 'Head' },
    itemPlaceholders: { 'M+': true, Crafted: true },
    itemZones: { 'Old Tier Helm': 10, 'New Tier Helm': 20 },
    // currentZoneIdsForSeason reads wclZoneId, the camelCase name the
    // raid_zones fetch maps to -- not the raw column name.
    raidZones: [
      { wclZoneId: 10, season: 'Midnight Season 1' },
      { wclZoneId: 20, season: 'Midnight Season 2' }
    ],
    seasonName: 'Midnight Season 2'
  };
  return sandbox;
}

describe('officer item_preferences carry season (#707)', () => {
  it('drops a placeholder wishlist row tagged in a previous season', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [
      { player_id: 7, item_id: 9001, status: 'bis', slot: 'Trinket 1', season: 'Midnight Season 1' },
      { player_id: 7, item_id: 9002, status: 'bis', slot: 'Trinket 2', season: 'Midnight Season 2' }
    ];
    const merged = sandbox.bisMergeWishlistPrefs(prefs, [], 7);
    const items = merged.fromWishlist.map((e) => e.item);
    expect(items).toEqual(['Crafted']);
  });

  it('keeps a placeholder row with no season, which predates the column', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [{ player_id: 7, item_id: 9001, status: 'bis', slot: 'Trinket 1', season: null }];
    const merged = sandbox.bisMergeWishlistPrefs(prefs, [], 7);
    expect(merged.fromWishlist.map((e) => e.item)).toEqual(['M+']);
  });

  it('drops a real item whose zone belongs to a previous season', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [
      { player_id: 7, item_id: 101, status: 'bis', slot: null, season: 'Midnight Season 1' },
      { player_id: 7, item_id: 202, status: 'bis', slot: null, season: 'Midnight Season 2' }
    ];
    const merged = sandbox.bisMergeWishlistPrefs(prefs, [], 7);
    expect(merged.fromWishlist.map((e) => e.item)).toEqual(['New Tier Helm']);
  });

  it('an out-of-season wishlist row no longer suppresses the officer BiS pick for that slot', () => {
    const sandbox = sandboxWithCatalog();
    // The raider tagged a placeholder for Trinket 1 last season. The officer
    // has a real pick for it this season. The stale row must not hide it.
    const prefs = [{ player_id: 7, item_id: 9001, status: 'bis', slot: 'Trinket 1', season: 'Midnight Season 1' }];
    const officerBis = [{ item: 'M+', slot: 'Trinket 1', dbSlot: 'Trinket 1', obtained: false }];
    const merged = sandbox.bisMergeWishlistPrefs(prefs, officerBis, 7);
    expect(merged.fromWishlist).toEqual([]);
    expect(merged.officerSet.map((e) => e.item)).toEqual(['M+']);
  });
});
