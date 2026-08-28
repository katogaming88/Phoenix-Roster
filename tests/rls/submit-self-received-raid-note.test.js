// submit_self_received() rejects a note that mentions "raid" as its own
// word, regardless of which source was picked -- raiders kept using the
// 'Other' source to describe an actual raid drop, which double-counts once
// the officer's RCLootCouncil import processes the same drop
// (20260828125630_submit_self_received_block_raid_note.sql).
//
// Same withTxn harness as tests/rls/self-received-corrections.test.js.
// Seed player 1 is team 1 'Seedraider-Illidan'; item 1 is 'Seed Test Staff'.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRaider = async (text, params) => {
      await q('savepoint raid_note_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: RAIDER_T1, role: 'authenticated' })
      ]);
      await q('set local role authenticated');
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint raid_note_call');
        throw err;
      }
    };
    return await fn(q, asRaider);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const submit = (asRaider, note) =>
  asRaider(
    "select * from public.submit_self_received(1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', 'Other', $1)",
    [note]
  );

describe('submit_self_received: self-reported raid loot', () => {
  it('rejects a note mentioning "raid" as its own word', async () => {
    await withTxn(async (q, asRaider) => {
      await expect(submit(asRaider, 'got it in raid last night')).rejects.toThrow(/does not get self reported/);
    });
  });

  it('rejects case-insensitively and mid-sentence', async () => {
    await withTxn(async (q, asRaider) => {
      await expect(submit(asRaider, 'Raid drop, boss killed it')).rejects.toThrow(/does not get self reported/);
    });
  });

  it('does not false-positive on a word that merely contains "raid" as a substring', async () => {
    await withTxn(async (q, asRaider) => {
      const res = await submit(asRaider, 'saw it on raidbots beforehand');
      expect(res.rows[0].id).toBeTypeOf('number');
    });
  });

  it('still accepts a normal note with no mention of raid', async () => {
    await withTxn(async (q, asRaider) => {
      const res = await submit(asRaider, 'got it from my weekly vault');
      expect(res.rows[0].id).toBeTypeOf('number');
    });
  });
});
