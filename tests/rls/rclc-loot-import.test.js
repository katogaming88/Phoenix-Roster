// Behavior tests for import_rclc_loot() (#219). Mainly exercises track
// (difficulty) parsing off the RCLC "instance" string -- including the
// Sporefall regression (20260806214054) where a Mythic Flex raid's instance
// string ("Sporefall-Mythic - Flexible Raiding") broke the old "everything
// after the last hyphen" parser and silently left every row's track null.
// Also covers dedupe-by-rclc_id and unknown-player/unresolved-item handling,
// since nothing in this repo tested this function before.
//
// Each test runs in one rolled-back transaction: the RPC call happens as the
// team 1 officer/leader, assertions happen back as postgres -- same pattern
// tests/rls/promotion.test.js uses, since writes never commit across
// separate pool connections here.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): item 1 is
// 'Seed Test Staff' (wow_item_id 100001); player 1 is team 1 'Seedraider-Illidan'.
const SEED_ITEM_WOW_ID = 100001;
const SEED_PLAYER_NAME = 'Seedraider-Illidan';

function row(overrides) {
  return {
    player: SEED_PLAYER_NAME,
    id: 'test-' + Math.random().toString(36).slice(2),
    itemID: SEED_ITEM_WOW_ID,
    itemName: 'Seed Test Staff',
    instance: 'The Voidspire-Heroic',
    boss: 'Some Boss',
    date: '2026/06/22',
    time: '22:00:00',
    ...overrides
  };
}

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = async (uid, text, params) => {
      await q('savepoint role_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' })
      ]);
      await q('set local role authenticated');
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint role_call');
        throw err;
      }
    };
    return await fn(q, asRole);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const importAs = (asRole, uid, rows) =>
  asRole(uid, 'select public.import_rclc_loot(1, $1, $2::jsonb) as result', ['MID1', JSON.stringify(rows)]);

describe('import_rclc_loot track parsing', () => {
  it('parses the classic "<Name>-<Difficulty>" instance format', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'track-hero', instance: 'The Voidspire-Heroic' }),
        row({ id: 'track-myth', instance: 'The Dreamrift-Mythic' }),
        row({ id: 'track-normal', instance: 'The Voidspire-Normal' })
      ]);
      expect(res.rows[0].result.inserted).toBe(3);

      const tracks = await q(
        `select rclc_id, track from public.rclc_loot where rclc_id in ('track-hero','track-myth','track-normal')`
      );
      const byId = Object.fromEntries(tracks.rows.map((r) => [r.rclc_id, r.track]));
      expect(byId['track-hero']).toBe('Hero');
      expect(byId['track-myth']).toBe('Myth');
      expect(byId['track-normal']).toBe('Champion');
    });
  });

  it('parses a Mythic Flex instance string with a trailing qualifier (regression, 20260806214054)', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'track-flex', instance: 'Sporefall-Mythic - Flexible Raiding' })
      ]);
      expect(res.rows[0].result.inserted).toBe(1);

      const track = await q(`select track from public.rclc_loot where rclc_id = 'track-flex'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('leaves track null for an unrecognized instance string rather than guessing', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'track-unknown', instance: 'Some Made Up Zone' })]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'track-unknown'`);
      expect(track.rows[0].track).toBeNull();
    });
  });
});

// 20260829200033: track is preferred from the item's own bonus IDs (baked in
// at generation, immune to drift) over the free-text instance string (which
// can go stale -- see the migration header comment for the live incident
// that prompted this: loot passed out after the raid had already moved to a
// different pull recorded the wrong instance/boss). Season MID2 bonus-ID
// ranges confirmed against Wowhead for the "Font of Venomous Rage" trinket;
// synthetic itemStrings below mirror the real RCLC export shape (verified
// against three real Season MID2 export entries) with just the bonus ID(s)
// swapped -- "item:<id>::::::::90:266::3:<numBonusIds>:<bonusId...>:1:28:<n>".
describe('import_rclc_loot track from bonus IDs (20260829200033)', () => {
  it('reads Champion track from a single bonus ID in the Champion range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-champion',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12835:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-champion'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });

  it('reads Hero track from a single bonus ID in the Hero range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-hero',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12843:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-hero'`);
      expect(track.rows[0].track).toBe('Hero');
    });
  });

  it('reads Myth track from a single bonus ID in the Myth range', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-myth',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12851:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-myth'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('reads Myth track from the 9/6 special-drop bonus ID (13848)', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-myth-special',
          instance: 'The Voidspire-Heroic',
          itemString: 'item:100001::::::::90:266::5:2:13335:13848:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-myth-special'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('prefers the bonus ID over a stale/misleading instance string (the live incident)', async () => {
    await withTxn(async (q, asRole) => {
      // Instance string claims Heroic (as if the drop came from a later
      // Heroic pull), but the item's own bonus ID says Champion -- bonus ID
      // must win, since it's what actually generated the item.
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-overrides-instance',
          instance: 'The Twin Fangs-Heroic',
          itemString: 'item:100001::::::::90:266::3:1:12836:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-overrides-instance'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });

  it('falls back to instance-string parsing when itemString has no recognized bonus ID', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [
        row({
          id: 'bonus-unmatched-fallback',
          instance: 'The Voidspire-Mythic',
          itemString: 'item:100001::::::::90:266::3:1:99999:1:28:1000'
        })
      ]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-unmatched-fallback'`);
      expect(track.rows[0].track).toBe('Myth');
    });
  });

  it('falls back to instance-string parsing when itemString is missing entirely', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'bonus-missing-fallback', instance: 'The Voidspire-Normal' })]);
      const track = await q(`select track from public.rclc_loot where rclc_id = 'bonus-missing-fallback'`);
      expect(track.rows[0].track).toBe('Champion');
    });
  });
});

describe('import_rclc_loot general behavior', () => {
  it('resolves item_id by wow_item_id and player_id by exact name match', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [row({ id: 'resolve-1' })]);
      expect(res.rows[0].result.unresolved_item).toBe(0);

      const inserted = await q(`select item_id, player_id from public.rclc_loot where rclc_id = 'resolve-1'`);
      const player = await q(`select id from public.players where team_id = 1 and name_realm = $1`, [SEED_PLAYER_NAME]);
      const item = await q(`select id from public.items where wow_item_id = $1`, [SEED_ITEM_WOW_ID]);
      expect(inserted.rows[0].item_id).toBe(item.rows[0].id);
      expect(inserted.rows[0].player_id).toBe(player.rows[0].id);
    });
  });

  it('creates an archived stub player for an unknown name instead of leaving player_id null', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'unknown-player', player: 'Totallynewperson-Illidan' })]);
      const player = await q(
        `select archived_at is not null as is_archived from public.players where team_id = 1 and name_realm = 'Totallynewperson-Illidan'`
      );
      expect(player.rows).toHaveLength(1);
      expect(player.rows[0].is_archived).toBe(true);
    });
  });

  it('counts an unresolvable item without failing the row', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, OFFICER_T1, [
        row({ id: 'unresolved-1', itemID: 999999999, itemName: 'Not A Real Item' })
      ]);
      expect(res.rows[0].result.inserted).toBe(1);
      expect(res.rows[0].result.unresolved_item).toBe(1);

      const inserted = await q(`select item_id from public.rclc_loot where rclc_id = 'unresolved-1'`);
      expect(inserted.rows[0].item_id).toBeNull();
    });
  });

  it('dedupes a second import of the same rclc_id', async () => {
    await withTxn(async (q, asRole) => {
      await importAs(asRole, OFFICER_T1, [row({ id: 'dupe-1' })]);
      const res = await importAs(asRole, OFFICER_T1, [row({ id: 'dupe-1' })]);
      expect(res.rows[0].result.inserted).toBe(0);
      expect(res.rows[0].result.skipped_duplicate).toBe(1);
    });
  });

  it('rejects a raider (not officer/team leader)', async () => {
    await withTxn(async (q, asRole) => {
      await expect(importAs(asRole, RAIDER_T1, [row({ id: 'raider-blocked' })])).rejects.toThrow(/not authorized/i);
    });
  });

  it('allows a team leader', async () => {
    await withTxn(async (q, asRole) => {
      const res = await importAs(asRole, TEAM_LEADER_T1, [row({ id: 'leader-ok' })]);
      expect(res.rows[0].result.inserted).toBe(1);
    });
  });
});

afterAll(() => pool.end());
