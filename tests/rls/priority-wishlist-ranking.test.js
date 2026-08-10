// generate_priority_order() wishlist integration (#515, final piece):
// item_preferences now contributes to the candidate pool and weighted_total
// alongside bis_items, per 20260720165552_priority_wishlist_ranking.sql.
// Same withTxn/savepoint harness as tests/rls/item-preferences.test.js, since
// these tests need both a direct (RLS-bypassing) seed insert and an
// officer-role RPC call inside one rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint pwr_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint pwr_call');
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

// Season kept distinct from seed.sql's 'seed-season' so the seed rclc_loot
// row (player 1 already has item 1 at Myth, in 'seed-season') doesn't bleed
// into these scenarios via the has_myth exclusion. Track is 'Hero' unless a
// test needs 'Myth' specifically, since the Hero item-ownership branch only
// applies a multiplier when the player already has Champion loot -- none of
// these fixtures do, so it stays a no-op and expected weighted_total math
// stays simple (raw_score * wishlist multiplier only).
const SEASON = 'wishlist-rank-test';

function generate(asUser, itemId, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

describe('generate_priority_order wishlist integration', () => {
  it('a raider who tagged an item is a candidate even without a bis_items row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'good')");

      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('90.0');
      expect(row.status_label).toContain('Wishlist: Good');
    });
  });

  it('a bis_items-only player (no wishlist tag) is unaffected -- same math as before this change', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 100, 100);
      // Player 1 already has a bis_items row for item 1 from seed.sql --
      // no item_preferences row inserted here at all.
      const res = await generate(asUser, 1);
      const row = res.rows.find((r) => r.player_id === 1);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('100.0');
      expect(row.status_label == null || !row.status_label.includes('Wishlist')).toBe(true);
    });
  });

  it('a raider tagged BiS via wishlist gets the unchanged 1.0 multiplier, same as bis_items', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'bis')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('100.0');
      expect(row.status_label == null || !row.status_label.includes('Wishlist')).toBe(true);
    });
  });

  it('OK applies the 0.60 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'ok')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('60.0');
      expect(row.status_label).toContain('Wishlist: OK');
    });
  });

  it('Catalyst Only applies the 0.75 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'catalyst')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('75.0');
      expect(row.status_label).toContain('Wishlist: Catalyst Only');
    });
  });

  it('Pass excludes the raider from the suggested order entirely, even overriding an existing bis_items row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 100, 100);
      // Player 1 has a bis_items row for item 1 (seed.sql) -- tagging Pass
      // on the same item should still exclude them.
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'pass')");
      const res = await generate(asUser, 1);
      expect(res.rows.find((r) => r.player_id === 1)).toBeFalsy();
    });
  });

  it('a raider who never tagged anything and has no bis_items row is not a candidate', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      const res = await generate(asUser, 2);
      expect(res.rows.find((r) => r.player_id === 2)).toBeFalsy();
    });
  });
});

// #623 (Finger/Trinket) and #673 (Weapon/Off Hand dual-wield) started
// writing an explicit disambiguating slot on real-item item_preferences
// rows -- generate_priority_order() previously only matched slot = null
// rows, silently ignoring every status tagged on one of these rows
// (including 'pass'). 20260810163045_priority_order_wishlist_slot_aware.sql
// fixes this by matching on item_id alone and collapsing to the single best
// status across all of a player's rows for that item_id.
describe('generate_priority_order slot-aware wishlist matching (#623/#673 follow-up)', () => {
  it('a status tagged on an explicit-slot row (e.g. Weapon) is no longer ignored', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'good', 'Weapon')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('90.0');
      expect(row.status_label).toContain('Wishlist: Good');
    });
  });

  it("'pass' tagged on an explicit-slot row still excludes the raider", async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 100, 100);
      // Player 1 has a bis_items row for item 1 (seed.sql) -- Pass on an
      // explicit-slot row should still exclude them, same as the legacy
      // slot=null case above.
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 1, 1, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 1);
      expect(res.rows.find((r) => r.player_id === 1)).toBeFalsy();
    });
  });

  it('a dual-wielded one-hander tagged BiS in one hand and Pass in the other still counts the raider as BiS (best status wins)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'bis', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('100.0');
      expect(row.status_label == null || !row.status_label.includes('Wishlist')).toBe(true);
    });
  });

  it('a raider who passed on every disambiguated row for an item is excluded', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      expect(res.rows.find((r) => r.player_id === 2)).toBeFalsy();
    });
  });

  it('the better of two differing non-pass statuses (Good in one hand, OK in the other) wins', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'ok', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'good', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('90.0');
      expect(row.status_label).toContain('Wishlist: Good');
    });
  });
});

afterAll(() => pool.end());
