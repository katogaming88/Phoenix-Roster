// remove_player_priority_order() (20260828022325_remove_player_priority_order.sql):
// removing a player from the roster only ever soft-deleted their players
// row -- their existing priority_order rows for the current season were
// left untouched, so a departed raider kept showing up in the officer
// Priority tab, the RCLootCouncil export, and the addon's Full Priority
// Order panel until every item/track they were ranked on happened to get
// manually re-suggested. This RPC clears them out immediately, scoped to
// the given season only (past seasons are left alone as a historical
// record, same reasoning as rclc_loot/bis_items/attendance).
import { describe, it, expect } from 'vitest';
import { pool, withRole, OFFICER_T1, RAIDER_T1, OFFICER_T2 } from './helpers.js';

const SEASON = 'export-test';

async function seedPriority(q) {
  await q(
    `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
       (1, $1, 2, 'Hero', 1, 2),
       (1, $1, 2, 'Hero', 2, 1),
       (1, $1, 2, 'Myth', 1, 1)`,
    [SEASON]
  );
}

describe('remove_player_priority_order', () => {
  it("deletes only the given player's rows for that team/season, leaving other players' ranks alone", async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);

      const res = await q('select public.remove_player_priority_order(1, $1, 1) as removed', [SEASON]);
      expect(res.rows[0].removed).toBe(2);

      const remaining = await q(
        'select track, rank, player_id from public.priority_order where team_id = 1 and season = $1 order by track, rank',
        [SEASON]
      );
      expect(remaining.rows).toEqual([{ track: 'Hero', rank: 1, player_id: 2 }]);
    });
  });

  it('leaves other seasons for the same player untouched', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
           (1, 'some-other-season', 2, 'Hero', 1, 1)`
      );

      await q('select public.remove_player_priority_order(1, $1, 1)', [SEASON]);

      const otherSeason = await q(
        "select player_id from public.priority_order where team_id = 1 and season = 'some-other-season'"
      );
      expect(otherSeason.rows).toEqual([{ player_id: 1 }]);
    });
  });

  it('returns 0 when the player has no priority_order rows for that season', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      const res = await q('select public.remove_player_priority_order(1, $1, 1) as removed', [SEASON]);
      expect(res.rows[0].removed).toBe(0);
    });
  });

  it('a raider is not authorized', async () => {
    await withRole('authenticated', RAIDER_T1, async (q) => {
      await expect(q('select public.remove_player_priority_order(1, $1, 1)', [SEASON])).rejects.toThrow(
        'Not authorized'
      );
    });
  });

  it('an officer on another team is not authorized for team 1', async () => {
    await withRole('authenticated', OFFICER_T2, async (q) => {
      await expect(q('select public.remove_player_priority_order(1, $1, 1)', [SEASON])).rejects.toThrow(
        'Not authorized'
      );
    });
  });
});
