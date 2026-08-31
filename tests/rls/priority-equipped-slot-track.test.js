// generate_priority_order() equipped-slot-track fairness factor
// (20260831173500_generate_priority_order_equipped_slot_track.sql): the
// existing recip CTE only ever compared a candidate's loot-award history for
// the EXACT item being generated. It had no way to see "this raider already
// has a Hero-equivalent item equipped in this slot, just a different one" --
// e.g. a Hero belt from an earlier boss shouldn't leave someone first
// priority on a different Hero belt drop. public.player_equipped_gear
// (synced from the Blizzard API, keyed on its own positional slot
// vocabulary) is the new source for that, joined on the target item's
// items.slot mapped to the matching equipment_slot key(s).
//
// The comparison is deliberately raw item_level >= the season's officer-set
// Hero/Myth ilvl floor (team_settings.config.trackIlvlThresholds), NOT the
// row's own `track` label -- Kat-confirmed (#845) that a Mythic+/crafted/
// catalyst piece at Hero-equivalent ilvl should count the same as an actual
// raid drop, so several cases below deliberately seed a null/irrelevant
// `track` to prove the multiplier follows item_level, not the label.
//
// Same withTxn/savepoint harness as tests/rls/priority-existing-load.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint pest_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint pest_call');
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

const SEASON = 'equipped-slot-track-test';
const BELT_ITEM_ID = 8910;
const RING_ITEM_ID = 8911;
const OFFHAND_ITEM_ID = 8912;
const HERO_FLOOR = 660;
const MYTH_FLOOR = 675;

async function seedItems(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 891000, 'Seed Slot Belt', 'Waist')", [
    BELT_ITEM_ID
  ]);
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 891100, 'Seed Slot Ring', 'Finger')", [
    RING_ITEM_ID
  ]);
  await q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 891200, 'Seed Slot Off Hand', 'Off Hand')",
    [OFFHAND_ITEM_ID]
  );
}

async function seedThresholds(q, hero = HERO_FLOOR, myth = MYTH_FLOOR) {
  await q(
    `update public.team_settings
     set config = config || jsonb_build_object('trackIlvlThresholds', jsonb_build_object('Hero', $1::int, 'Myth', $2::int))
     where team_id = 1`,
    [hero, myth]
  );
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

async function seedBoth1And2Bis(q, itemId) {
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, $1, 'bis')", [
    itemId
  ]);
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, $1, 'bis')", [
    itemId
  ]);
}

function generate(asUser, itemId, track) {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

describe('generate_priority_order equipped-slot-track fairness factor', () => {
  it('deprioritizes a candidate whose equipped item_level in the same slot meets the Hero floor, even with no track label', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedThresholds(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, BELT_ITEM_ID);
      // Player 1 has a different item equipped in the waist slot at exactly
      // the Hero floor, with no track label at all -- must still count.
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'WAIST', 999901, $1, null)`,
        [HERO_FLOOR]
      );

      const res = await generate(asUser, BELT_ITEM_ID, 'Hero');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(Number(byId[2].weighted_total)).toBeGreaterThan(Number(byId[1].weighted_total));
      expect(byId[1].status_label).toContain('Hero ilvl Equipped (Slot)');
    });
  });

  it('does not apply the Hero multiplier when the equipped item is below the configured Hero floor', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedThresholds(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, BELT_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'WAIST', 999901, $1, 'Champion')`,
        [HERO_FLOOR - 1]
      );

      const res = await generate(asUser, BELT_ITEM_ID, 'Hero');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(byId[2].weighted_total);
    });
  });

  it('an item between the Hero and Myth floor only affects a Hero-track generation, not Myth', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedThresholds(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, BELT_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'WAIST', 999901, $1, 'Hero')`,
        [HERO_FLOOR]
      );

      const myth = await generate(asUser, BELT_ITEM_ID, 'Myth');
      const mythById = Object.fromEntries(myth.rows.map((r) => [r.player_id, r]));
      expect(mythById[1].weighted_total).toBe(mythById[2].weighted_total);

      const hero = await generate(asUser, BELT_ITEM_ID, 'Hero');
      const heroById = Object.fromEntries(hero.rows.map((r) => [r.player_id, r]));
      expect(Number(heroById[2].weighted_total)).toBeGreaterThan(Number(heroById[1].weighted_total));
    });
  });

  it('has no effect when no thresholds are configured for the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      // Deliberately no seedThresholds() call.
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, BELT_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'WAIST', 999901, 999, 'Myth')`
      );

      const res = await generate(asUser, BELT_ITEM_ID, 'Hero');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(byId[2].weighted_total);
    });
  });

  it('fans a Finger item out to both FINGER_1 and FINGER_2 equipment slots', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedThresholds(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      // Equipped in the second ring slot specifically, not the first.
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'FINGER_2', 999902, $1, 'Myth')`,
        [MYTH_FLOOR]
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(Number(byId[2].weighted_total)).toBeGreaterThan(Number(byId[1].weighted_total));
    });
  });

  it('does not treat an equipped MAIN_HAND item as satisfying an Off Hand item slot', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await seedThresholds(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, OFFHAND_ITEM_ID);
      // Player 1 has a Myth-floor mainhand equipped -- should have zero
      // bearing on an Off Hand drop's generation.
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'MAIN_HAND', 999903, $1, 'Myth')`,
        [MYTH_FLOOR]
      );

      const res = await generate(asUser, OFFHAND_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(byId[2].weighted_total);
    });
  });
});

afterAll(async () => {
  await pool.end();
});
