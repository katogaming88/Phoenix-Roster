// generate_priority_order() tier-token bis_match ranking (#651 follow-up,
// see docs/database-decisions.md): a raider who has the dropping tier token
// tagged as their actual BiS (or holds a bis_items pick for it with no
// wishlist row at all -- same "untagged reads as BiS" treatment the wishlist
// multiplier already gives that case) now outranks anyone who only tagged it
// as a sidegrade (Good/OK/Catalyst Only), regardless of tier-piece count.
// tier_rank (piece count, 20260804140751_tier_pieces_priority_weighting.sql)
// only breaks ties among raiders who are equally "really keeping this."
// Same withTxn/savepoint harness as tests/rls/priority-tier-bench-trial.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint ptbm_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint ptbm_call');
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

const SEASON = 'tier-bis-match-test';
const TOKEN_ITEM_ID = 8801;
const RESOLVED_ITEM_ID = 8802;

async function seedTierToken(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 880100, 'Seed Tier Token', 'Chest')", [
    TOKEN_ITEM_ID
  ]);
  await q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 880200, 'Seed Resolved Tier Piece', 'Chest')",
    [RESOLVED_ITEM_ID]
  );
  await q('insert into public.tier_token_map (token_item_id, class, resolved_item_id) values ($1, $2, $3)', [
    TOKEN_ITEM_ID,
    'TestClass',
    RESOLVED_ITEM_ID
  ]);
}

function generate(asUser, itemId, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

async function seedPlayer(q, { id, tierPiecesEquipped = null }) {
  const specId = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', $1, 'Ranged') returning id",
    [`Spec${id}`]
  );
  await q(
    'insert into public.players (id, team_id, name_realm, class_spec_id, tier_pieces_equipped) values ($1, 1, $2, $3, $4)',
    [id, `Seedplayer${id}-Illidan`, specId.rows[0].id, tierPiecesEquipped]
  );
}

describe('generate_priority_order tier-token bis_match ranking', () => {
  it('a true-BiS tagger outranks a sidegrade tagger even with a worse tier_rank', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedTierToken(q);
      // Player 201: 0/5 pieces (tier_rank 2 -- becomes 1/5, no bonus) but
      // tagged this token as actual BiS.
      await seedPlayer(q, { id: 201, tierPiecesEquipped: 0 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 201, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);
      // Player 202: 1/5 pieces (tier_rank 1 -- becomes 2/5, the 2pc bonus,
      // objectively the best tier_rank) but only tagged this token Good.
      await seedPlayer(q, { id: 202, tierPiecesEquipped: 1 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 202, $1, 'good')", [
        TOKEN_ITEM_ID
      ]);

      const res = await generate(asUser, TOKEN_ITEM_ID);
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(201)).toBeGreaterThanOrEqual(0);
      expect(idx(202)).toBeGreaterThanOrEqual(0);
      expect(idx(201)).toBeLessThan(idx(202));
    });
  });

  it('an untagged bis_items pick counts as BiS-match, same as an explicit wishlist bis tag', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedTierToken(q);
      // Player 211: no wishlist row at all, just a curated bis_items pick,
      // and a worse tier_rank (2/5 -> 3/5, no bonus).
      await seedPlayer(q, { id: 211, tierPiecesEquipped: 2 });
      await q('insert into public.bis_items (player_id, item_id, obtained) values (211, $1, false)', [TOKEN_ITEM_ID]);
      // Player 212: better tier_rank (1/5 -> 2/5, the 2pc bonus) but only
      // tagged this token OK on their wishlist.
      await seedPlayer(q, { id: 212, tierPiecesEquipped: 1 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 212, $1, 'ok')", [
        TOKEN_ITEM_ID
      ]);

      const res = await generate(asUser, TOKEN_ITEM_ID);
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(211)).toBeLessThan(idx(212));
    });
  });

  it('among two true-BiS holders, tier_rank still breaks the tie (2pc completion beats 4pc completion)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedTierToken(q);
      await seedPlayer(q, { id: 221, tierPiecesEquipped: 1 }); // -> 2/5, rank 1
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 221, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);
      await seedPlayer(q, { id: 222, tierPiecesEquipped: 3 }); // -> 4/5, rank 3
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 222, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);

      const res = await generate(asUser, TOKEN_ITEM_ID);
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(221)).toBeLessThan(idx(222));
    });
  });

  it('bis_match is a no-op on a non-tier item -- no tier_token_map row means the sidegrade tagger is unaffected', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Seed Test Robe (item 2) has no tier_token_map row.
      await seedPlayer(q, { id: 231 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 231, 2, 'good')");
      await seedPlayer(q, { id: 232 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 232, 2, 'bis')");

      const res = await generate(asUser, 2);
      // Both remain candidates; ordering here falls back to score (both
      // null/tied), not a bis_match-driven reordering -- just confirms
      // neither errors out and both are still present.
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(231)).toBeGreaterThanOrEqual(0);
      expect(idx(232)).toBeGreaterThanOrEqual(0);
    });
  });
});

afterAll(() => pool.end());
