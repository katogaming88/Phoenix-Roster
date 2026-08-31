// priority_order_confirmed_empty (20260831190443): save_priority_order()
// upserts a marker row when an officer saves a priority list with nobody
// ranked -- a legitimate outcome ("nobody wants this item"), not an
// unfinished one -- and clears any leftover marker the next time that same
// item/track is saved with a real roster. Same withTxn/savepoint harness as
// tests/rls/priority-order-drift-check.test.js.
import { describe, it, expect } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint poce_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint poce_call');
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

const SEASON = 'confirmed-empty-test';

function save(asUser, itemId, track, playerIds, uid = OFFICER_T1) {
  return asUser(uid, 'select public.save_priority_order($1, $2, $3, $4, $5)', [
    1,
    SEASON,
    itemId,
    track,
    JSON.stringify(playerIds)
  ]);
}

async function markRow(q, itemId, track) {
  const res = await q(
    'select * from public.priority_order_confirmed_empty where team_id = 1 and season = $1 and item_id = $2 and track = $3',
    [SEASON, itemId, track]
  );
  return res.rows[0];
}

describe('save_priority_order confirmed-empty marker', () => {
  it('upserts a marker row when saved with zero players', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, 1, 'Hero', []);
      const row = await markRow(q, 1, 'Hero');
      expect(row).toBeTruthy();
    });
  });

  it('clears an existing marker when the same item/track is saved with a real roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, 1, 'Hero', []);
      expect(await markRow(q, 1, 'Hero')).toBeTruthy();

      await save(asUser, 1, 'Hero', [1, 2]);
      expect(await markRow(q, 1, 'Hero')).toBeFalsy();
    });
  });

  it('re-marks empty on a later save after players are removed again', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, 1, 'Hero', [1]);
      expect(await markRow(q, 1, 'Hero')).toBeFalsy();

      await save(asUser, 1, 'Hero', []);
      expect(await markRow(q, 1, 'Hero')).toBeTruthy();
    });
  });

  it('keeps Heroic and Mythic markers independent for the same item', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, 1, 'Hero', []);
      await save(asUser, 1, 'Myth', [1]);
      expect(await markRow(q, 1, 'Hero')).toBeTruthy();
      expect(await markRow(q, 1, 'Myth')).toBeFalsy();
    });
  });

  it('does not let a raider save (and thus cannot mark) a priority order', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, 1, 'Hero', [], RAIDER_T1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('is publicly readable, matching priority_order itself', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, 1, 'Hero', []);
      const res = await asUser(
        RAIDER_T1,
        'select * from public.priority_order_confirmed_empty where team_id = 1 and season = $1',
        [SEASON]
      );
      expect(res.rows.length).toBe(1);
    });
  });
});
