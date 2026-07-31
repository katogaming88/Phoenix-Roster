// check_priority_order_drift() (20260731023544_priority_order_drift_check.sql):
// flags a saved priority_order top-3 that no longer matches what
// generate_priority_order() would compute live, e.g. after a scoring
// commit. Same withTxn/savepoint harness as
// tests/rls/priority-wishlist-ranking.test.js, since these tests need both
// a direct (RLS-bypassing) seed insert and an officer-role RPC call inside
// one rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint podc_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint podc_call');
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

// Distinct from seed.sql's 'seed-season' so the seed rclc_loot row (player 1
// already has item 1 at Myth, in 'seed-season') doesn't bleed into these
// scenarios via generate_priority_order()'s has_myth exclusion.
const SEASON = 'drift-check-test';

function drift(asUser) {
  return asUser(OFFICER_T1, 'select * from public.check_priority_order_drift($1, $2)', [1, SEASON]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

describe('check_priority_order_drift', () => {
  it('no drift when the saved top 3 still matches the live computation', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Player 1 has a bis_items row for item 1 from seed.sql; player 2
      // needs an explicit wishlist tag to be a candidate too.
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'bis')");
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 50, 50);
      // Matches live order: player 1 (100) ranks above player 2 (50).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 1, $2, 1, 1), (1, $1, 1, $2, 2, 2)',
        [SEASON, 'Hero']
      );

      const res = await drift(asUser);
      expect(res.rows.find((r) => r.item_id === 1)).toBeFalsy();
    });
  });

  it('flags a swap within the top 3 after a scoring change', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'bis')");
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 50, 50);
      // Saved order has player 1 first -- but scoring above now ranks
      // player 2 higher (only the save is stale, not the scoring insert).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 1, $2, 1, 2), (1, $1, 1, $2, 2, 1)',
        [SEASON, 'Hero']
      );

      const res = await drift(asUser);
      const row = res.rows.find((r) => r.item_id === 1 && r.track === 'Hero');
      expect(row).toBeTruthy();
      expect(row.saved_top3).toEqual(['Seedplayertwo-Illidan', 'Seedraider-Illidan']);
      expect(row.current_top3).toEqual(['Seedraider-Illidan', 'Seedplayertwo-Illidan']);
    });
  });

  it('flags a player newly entering the top 3 from further down the list, not just an in-place swap', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Give item 2 three bis_items candidates: 1 and 2 direct, plus a
      // third player added purely for this test's roster.
      await q(
        "insert into public.players (id, team_id, name_realm, class_spec_id) values (101, 1, 'Thirdrunner-Illidan', 1)"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'bis'), (1, 2, 2, 'bis'), (1, 101, 2, 'bis')"
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 90, 90);
      await seedScoring(q, 101, 10, 10);
      // Saved order reflects the original ranking (1, 2, 101).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 2, $2, 1, 1), (1, $1, 2, $2, 2, 2), (1, $1, 2, $2, 3, 101)',
        [SEASON, 'Hero']
      );
      // Player 101 spikes past player 2 (but still below player 1).
      await q(
        'update public.scoring set performance_score = 95, attendance_score = 95 where player_id = 101 and season = $1',
        [SEASON]
      );

      const res = await drift(asUser);
      const row = res.rows.find((r) => r.item_id === 2 && r.track === 'Hero');
      expect(row).toBeTruthy();
      expect(row.saved_top3).toEqual(['Seedraider-Illidan', 'Seedplayertwo-Illidan', 'Thirdrunner-Illidan']);
      expect(row.current_top3).toEqual(['Seedraider-Illidan', 'Thirdrunner-Illidan', 'Seedplayertwo-Illidan']);
    });
  });

  it('a raider (non-officer) is not authorized', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(RAIDER_T1, 'select * from public.check_priority_order_drift($1, $2)', [1, SEASON])
      ).rejects.toThrow('Not authorized');
    });
  });
});

afterAll(() => pool.end());
