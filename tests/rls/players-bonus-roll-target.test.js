// RLS assertions for the Bonus Roll target self-service update
// (20260809220657_players_bonus_roll_target.sql): a raider can UPDATE
// bonus_roll_encounter_id on their own players row via is_own_player(id),
// but the restrict_players_self_update_to_bonus_roll trigger blocks them
// from touching any other column through that same policy -- an officer
// updating other columns (via the pre-existing "Officers write players"
// policy) is unaffected. Same withTxn/savepoint harness as
// tests/rls/item-preferences.test.js, since both share is_own_player().
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint pbrt_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint pbrt_call');
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

// Player 1 (Seedraider-Illidan, team 1, seed.sql) has no team_member_id link
// by default -- same "link ephemerally within the test's own rolled-back
// transaction" shape item-preferences.test.js/notifications.test.js use.
const linkPlayer1ToRaider = (q) => q('update public.players set team_member_id = 3 where id = 1');

async function seedEncounter(q, id) {
  await q("insert into public.raid_zones (id, wcl_zone_id, name, season) values ($1, $1, 'Seed Zone', 'seed-season')", [
    id
  ]);
  await q("insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name) values ($1, $1, $1, 'Seed Boss')", [
    id
  ]);
}

describe('players.bonus_roll_encounter_id self-service', () => {
  it('a linked raider can set their own bonus_roll_encounter_id', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await seedEncounter(q, 901);

      await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = 901 where id = 1');
      const row = (await q('select bonus_roll_encounter_id from public.players where id = 1')).rows[0];
      expect(row.bonus_roll_encounter_id).toBe(901);
    });
  });

  it('a linked raider can clear their own bonus_roll_encounter_id back to null', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await seedEncounter(q, 902);
      await q('update public.players set bonus_roll_encounter_id = 902 where id = 1');

      await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = null where id = 1');
      const row = (await q('select bonus_roll_encounter_id from public.players where id = 1')).rows[0];
      expect(row.bonus_roll_encounter_id).toBeNull();
    });
  });

  it('a raider cannot use this policy to change another column on their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await expect(asUser(RAIDER_T1, "update public.players set nickname = 'Sneaky' where id = 1")).rejects.toThrow(
        /bonus_roll_encounter_id/
      );
      const row = (await q('select nickname from public.players where id = 1')).rows[0];
      expect(row.nickname).toBeNull();
    });
  });

  it('an unlinked raider cannot update a player row they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Player 1 stays unlinked (no linkPlayer1ToRaider call). RLS's USING
      // clause silently matches 0 rows rather than erroring, so this just
      // confirms the seeded value survives untouched.
      await seedEncounter(q, 903);
      await q('update public.players set bonus_roll_encounter_id = 903 where id = 1');
      await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = null where id = 1');
      const row = (await q('select bonus_roll_encounter_id from public.players where id = 1')).rows[0];
      expect(row.bonus_roll_encounter_id).toBe(903);
    });
  });

  it('an officer can still update other columns on a players row unaffected by the restrict trigger', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, "update public.players set nickname = 'OfficerSet' where id = 1");
      const row = (await q('select nickname from public.players where id = 1')).rows[0];
      expect(row.nickname).toBe('OfficerSet');
    });
  });
});

afterAll(() => pool.end());
