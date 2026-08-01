// generate_priority_order() bench/trial tiering (#622 follow-up, see
// docs/database-decisions.md 2026-07-31): status (full/trial/bench) sorts
// as a tier ahead of role/score, rather than discounting weighted_total via
// a second multiplier. Regression coverage for the original complaint --
// a trial DPS outranking a full-status healer -- plus the fixed ordering
// invariants: no bench/trial raider of any role can outrank a full-status
// raider, and role ordering (dps > heal > tank) still holds within each
// tier. Same withTxn/savepoint harness as
// tests/rls/priority-wishlist-ranking.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint ptbt_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint ptbt_call');
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

const SEASON = 'tier-bench-trial-test';
const ITEM_ID = 2; // Seed Test Robe -- no bis_items rows seeded against it.

function generate(asUser, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [
    1,
    SEASON,
    ITEM_ID,
    track
  ]);
}

async function seedPlayer(q, { id, role, isBench = false, isTrial = false, performance, attendance }) {
  const specId = await q("insert into public.classes_specs (class, spec, role) values ('Seed', $1, $2) returning id", [
    `Spec${id}`,
    role
  ]);
  await q(
    'insert into public.players (id, team_id, name_realm, class_spec_id, is_bench, is_trial) values ($1, 1, $2, $3, $4, $5)',
    [id, `Seedplayer${id}-Illidan`, specId.rows[0].id, isBench, isTrial]
  );
  await q('insert into public.bis_items (player_id, item_id, obtained) values ($1, $2, false)', [id, ITEM_ID]);
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [id, SEASON, performance, attendance]
  );
}

describe('generate_priority_order bench/trial tiering', () => {
  it('a trial dps no longer outranks a full-status healer (the original complaint)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedPlayer(q, { id: 101, role: 'Heal', performance: 0, attendance: 100 });
      await seedPlayer(q, { id: 102, role: 'Ranged', isTrial: true, performance: 100, attendance: 100 });

      const res = await generate(asUser);
      const heal = res.rows.find((r) => r.player_id === 101);
      const trialDps = res.rows.find((r) => r.player_id === 102);
      expect(heal).toBeTruthy();
      expect(trialDps).toBeTruthy();
      // Trial dps still scores higher in isolation (100.0 vs 75.0) -- the
      // fix is the sort order, not the score itself.
      expect(Number(trialDps.weighted_total)).toBeGreaterThan(Number(heal.weighted_total));
      const healIdx = res.rows.findIndex((r) => r.player_id === 101);
      const trialDpsIdx = res.rows.findIndex((r) => r.player_id === 102);
      expect(healIdx).toBeLessThan(trialDpsIdx);
    });
  });

  it('no trial or bench raider of any role outranks a full-status tank', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedPlayer(q, { id: 111, role: 'Tank', performance: 0, attendance: 100 });
      await seedPlayer(q, { id: 112, role: 'Ranged', isTrial: true, performance: 100, attendance: 100 });
      await seedPlayer(q, { id: 113, role: 'Heal', isTrial: true, performance: 0, attendance: 100 });
      await seedPlayer(q, { id: 114, role: 'Ranged', isBench: true, performance: 100, attendance: 100 });

      const res = await generate(asUser);
      const tankIdx = res.rows.findIndex((r) => r.player_id === 111);
      expect(tankIdx).toBeLessThan(res.rows.findIndex((r) => r.player_id === 112));
      expect(tankIdx).toBeLessThan(res.rows.findIndex((r) => r.player_id === 113));
      expect(tankIdx).toBeLessThan(res.rows.findIndex((r) => r.player_id === 114));
    });
  });

  it('role ordering (dps > heal > tank) still holds within the trial tier, with no score discount', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedPlayer(q, { id: 121, role: 'Ranged', isTrial: true, performance: 100, attendance: 100 });
      await seedPlayer(q, { id: 122, role: 'Heal', isTrial: true, performance: 0, attendance: 100 });
      await seedPlayer(q, { id: 123, role: 'Tank', isTrial: true, performance: 0, attendance: 100 });

      const res = await generate(asUser);
      const dps = res.rows.find((r) => r.player_id === 121);
      const heal = res.rows.find((r) => r.player_id === 122);
      const tank = res.rows.find((r) => r.player_id === 123);
      // Same role_mult math as full status -- no separate bench/trial
      // multiplier applied anymore.
      expect(dps.weighted_total).toBe('100.0');
      expect(heal.weighted_total).toBe('75.0');
      expect(tank.weighted_total).toBe('50.0');
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(121)).toBeLessThan(idx(122));
      expect(idx(122)).toBeLessThan(idx(123));
    });
  });
});

afterAll(() => pool.end());
