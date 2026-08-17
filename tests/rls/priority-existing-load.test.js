// generate_priority_order() avg_existing_rank tiebreaker
// (20260817135343_generate_priority_order_existing_load.sql): Suggest
// Order's re-click fix (js/tabs/tab-priority.js) only ever nudged the #1
// slot away from someone already holding rank 1 elsewhere, and only on a
// manual re-click. Every other rank, and every first click, still ignored
// how much priority a candidate already carries across the rest of the
// priority order -- and nothing ever gave a boost to someone who's
// consistently ranked low (10+) everywhere, since two candidates with
// equally little current stacking just fell back to raw score.
//
// This adds one hard sort tier, avg_existing_rank: each candidate's average
// `rank` across every OTHER item/track they're currently placed on this
// season (excludes the row for the exact item/track being generated).
// Sorted descending with nulls first -- a great average (near 1) sorts
// later here (deprioritized against further stacking), a poor average
// (10+) sorts earlier (boosted), and no placements at all (null) sorts
// earliest of all. Slotted right after tier-piece catch-up and before raw
// performance score, so it only breaks ties among candidates who are
// already equally deserving.
//
// Same withTxn/savepoint harness as tests/rls/priority-tier-bis-match.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint pel_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint pel_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    return await fn({ q, asUser });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const SEASON = 'existing-load-test';
const TARGET_ITEM_ID = 8901;
const OTHER_ITEM_ID = 8902;
const OTHER_ITEM_ID_2 = 8903;

async function seedItems(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 890100, 'Seed Load Target', 'Chest')", [
    TARGET_ITEM_ID
  ]);
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 890200, 'Seed Load Other', 'Chest')", [
    OTHER_ITEM_ID
  ]);
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 890300, 'Seed Load Other 2', 'Chest')", [
    OTHER_ITEM_ID_2
  ]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

async function seedBoth1And2Bis(q) {
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, $1, 'bis')", [
    TARGET_ITEM_ID
  ]);
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, $1, 'bis')", [
    TARGET_ITEM_ID
  ]);
}

function generate(asUser, itemId = TARGET_ITEM_ID, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

describe('generate_priority_order avg_existing_rank tiebreaker', () => {
  it('a player with no existing priority elsewhere outranks an equally-deserving one who already holds rank 1 elsewhere', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q);
      // Player 1 already holds rank 1 on a different item this season;
      // player 2 has no other placements at all.
      await q(
        "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, $2, 'Hero', 1, 1)",
        [SEASON, OTHER_ITEM_ID]
      );

      const res = await generate(asUser);
      const ids = res.rows.map((r) => r.player_id);
      expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(1));
    });
  });

  it('a habitually low-ranked candidate (poor average) gets boosted over one averaging a great rank', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q);
      // Player 1 averages rank 1.5 elsewhere (great); player 2 averages
      // rank 10 elsewhere (poor) -- player 2 should come out ahead here.
      await q(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
          (1, $1, $2, 'Hero', 1, 1),
          (1, $1, $3, 'Hero', 2, 1),
          (1, $1, $2, 'Hero', 9, 2),
          (1, $1, $3, 'Hero', 11, 2)`,
        [SEASON, OTHER_ITEM_ID, OTHER_ITEM_ID_2]
      );

      const res = await generate(asUser);
      const ids = res.rows.map((r) => r.player_id);
      expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(1));
    });
  });

  it('does not count a stale row for the exact item/track being generated against its own holder', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q);
      // Player 1's only priority_order row is for THIS exact item/track --
      // should not count as existing load against them (would otherwise
      // read as a great avg_existing_rank of 1 and deprioritize them).
      await q(
        "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, $2, 'Hero', 1, 1)",
        [SEASON, TARGET_ITEM_ID]
      );

      const res = await generate(asUser);
      expect(res.rows[0].player_id).toBe(1);
    });
  });

  it('never overrides an actual wishlist-tier need -- a BiS pick with heavy existing load still outranks a Good-tier pick with none', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, $1, 'bis')", [
        TARGET_ITEM_ID
      ]);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, $1, 'good')", [
        TARGET_ITEM_ID
      ]);
      // Heavily load down the BiS holder -- should still come out first.
      await q(
        "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, $2, 'Hero', 1, 1)",
        [SEASON, OTHER_ITEM_ID]
      );

      const res = await generate(asUser);
      expect(res.rows[0].player_id).toBe(1);
      expect(res.rows[0].wishlist_status).toBe('bis');
    });
  });
});

afterAll(async () => {
  await pool.end();
});
