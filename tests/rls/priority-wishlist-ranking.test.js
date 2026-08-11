// generate_priority_order() wishlist integration (#515, final piece):
// item_preferences now contributes to the candidate pool and weighted_total
// alongside bis_items, per 20260720165552_priority_wishlist_ranking.sql.
// Same withTxn/savepoint harness as tests/rls/item-preferences.test.js, since
// these tests need both a direct (RLS-bypassing) seed insert and an
// officer-role RPC call inside one rolled-back transaction.
//
// The wishlist tier used to be baked into status_label as pre-formatted
// text ("Wishlist: Good") -- 20260811122020_priority_order_raw_wishlist_status.sql
// split it into its own raw `wishlist_status` column instead, so the client
// can build the display label from the team's own custom status label
// overrides. Assertions below check wishlist_status directly.
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
      expect(row.wishlist_status).toBe('good');
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
      expect(row.wishlist_status).toBeNull();
    });
  });

  it('a raider tagged BiS via wishlist gets the unchanged 1.0 multiplier, same as bis_items', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'bis')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('100.0');
      expect(row.wishlist_status).toBe('bis');
    });
  });

  it('OK applies the 0.60 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'ok')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('60.0');
      expect(row.wishlist_status).toBe('ok');
    });
  });

  it('Catalyst Only applies the 0.75 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'catalyst')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('75.0');
      expect(row.wishlist_status).toBe('catalyst');
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
      expect(row.wishlist_status).toBe('good');
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
      expect(row.wishlist_status).toBe('bis');
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
      expect(row.wishlist_status).toBe('good');
    });
  });
});

// Wishlist status used to only apply as a MULTIPLIER on raw_score, so a
// well-performing Good/OK/Catalyst raider could out-rank a lower-performing
// BiS raider on a regular (non-tier-token) item -- reported live as
// "Torbjorn (2nd Choice) ranked above Katorri (BiS) on Gebbo's Bottomless
// Bag." 20260811122020_priority_order_raw_wishlist_status.sql generalized
// tier tokens' existing bis_match_rank into a `wishlist_rank` hard sort
// tier applied to every item: BiS > Good > OK/Catalyst (tied), checked
// ahead of weighted_total, so score only breaks ties within a tier.
describe('generate_priority_order wishlist status is a hard tier, not just a score multiplier', () => {
  it('a lower-scored BiS raider still outranks a higher-scored Good raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 20, 20); // player 1: BiS via seed.sql bis_items row, low score
      await seedScoring(q, 2, 100, 100); // player 2: Good, high score
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'good')");

      const res = await generate(asUser, 1);
      const order = res.rows.map((r) => r.player_id);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
    });
  });

  it('OK and Catalyst tie for wishlist_rank -- a higher score wins between them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 50, 50);
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'ok')");
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'catalyst')");

      const res = await generate(asUser, 2);
      const order = res.rows.map((r) => r.player_id);
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
    });
  });

  it('a Good raider outranks an OK raider regardless of score', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 10, 10);
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'good')");
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'ok')");

      const res = await generate(asUser, 2);
      const order = res.rows.map((r) => r.player_id);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
    });
  });
});

afterAll(() => pool.end());
