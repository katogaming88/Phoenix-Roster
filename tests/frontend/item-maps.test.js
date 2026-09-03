import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// buildItemMaps() in js/common.js feeds the BiS grid, the wishlist, the
// Priority tab, the boss filters and the equipped-gear lookup from one items
// read. #875 puts the season's BoEs into the same table under is_boe, and the
// whole point of the flag is that none of those views ever sees one. Nothing
// tested this function before, so the "unchanged" half is asserted as a deep
// equality rather than by picking maps.

const ROWS = [
  {
    id: 1,
    wow_item_id: 100001,
    name: 'Seed Test Staff',
    slot: 'Two-Hand',
    armor_type: null,
    is_placeholder: false,
    icon: 'inv_staff',
    wcl_zone_id: 46,
    secondary_stats: { crit: true },
    main_stats: null,
    weapon_subtype: 'Staff',
    is_ptr: false
  },
  {
    id: 2,
    wow_item_id: 100002,
    name: 'Seed Test Robe',
    slot: 'Chest',
    armor_type: 'Cloth',
    is_placeholder: false,
    icon: null,
    wcl_zone_id: null,
    secondary_stats: null,
    main_stats: { intellect: true },
    weapon_subtype: null,
    is_ptr: true
  }
];
const BOE = {
  id: 3,
  wow_item_id: 100003,
  name: 'Seed Test BoE Belt',
  slot: 'Waist',
  armor_type: 'Leather',
  is_placeholder: false,
  icon: 'inv_belt',
  wcl_zone_id: 53,
  secondary_stats: null,
  main_stats: null,
  weapon_subtype: null,
  is_ptr: false,
  is_boe: true
};

describe('buildItemMaps and BoEs (#875)', () => {
  const sandbox = loadCommonJs(quietConsole);

  it('collects a BoE into boeItems and into no other map', () => {
    const maps = sandbox.buildItemMaps(ROWS.concat([BOE]));
    expect(maps.boeItems).toEqual([
      { id: 3, name: 'Seed Test BoE Belt', slot: 'Waist', armorType: 'Leather', icon: 'inv_belt', wclZoneId: 53 }
    ]);
    for (const key of Object.keys(maps)) {
      if (key === 'boeItems') continue;
      expect(maps[key]).not.toHaveProperty('Seed Test BoE Belt');
    }
    expect(maps.itemNamesByWowId).not.toHaveProperty('100003');
  });

  it('leaves every other map exactly as it is without the BoE', () => {
    const without = sandbox.buildItemMaps(ROWS);
    const withBoe = sandbox.buildItemMaps(ROWS.concat([BOE]));
    expect(without.boeItems).toEqual([]);
    delete without.boeItems;
    delete withBoe.boeItems;
    expect(withBoe).toEqual(without);
    expect(Object.keys(without).sort()).toEqual([
      'itemArmorTypes',
      'itemIcons',
      'itemIds',
      'itemIsPtr',
      'itemMainStats',
      'itemNamesByWowId',
      'itemPlaceholders',
      'itemSecondaryStats',
      'itemSlots',
      'itemWeaponSubtypes',
      'itemWowIds',
      'itemZones'
    ]);
  });

  it('sorts BoEs by name and reads a missing zone or icon as null', () => {
    const maps = sandbox.buildItemMaps([
      Object.assign({}, BOE, { id: 4, name: 'Zzz Belt' }),
      Object.assign({}, BOE, { id: 5, name: 'Aaa Belt', wcl_zone_id: null, icon: null })
    ]);
    expect(maps.boeItems.map((b) => b.name)).toEqual(['Aaa Belt', 'Zzz Belt']);
    expect(maps.boeItems[0]).toMatchObject({ wclZoneId: null, icon: null });
  });

  it('skips a BoE with a blank name, like any other row', () => {
    const maps = sandbox.buildItemMaps([Object.assign({}, BOE, { name: '  ' })]);
    expect(maps.boeItems).toEqual([]);
  });
});
