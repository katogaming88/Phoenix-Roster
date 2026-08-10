// RLS assertions for item_preferences (#515 Phase 1, the raider wishlist):
// no public read (unlike bis_items), a raider manages only their own rows
// via is_own_player(), and officers can read but not write directly. Same
// withTxn harness as tests/rls/notifications.test.js, since both tables
// share the is_own_player() self-service predicate.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1, OFFICER_T2, RLS_DENIED } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint ip_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint ip_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    const asAnon = (text, params) => asRole('anon', null)(text, params);
    return await fn({ q, asUser, asAnon });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// Seed player 1 (Seedraider-Illidan, team 1) has no team_member_id link
// (supabase/seed.sql) -- same starting state notifications.test.js relies
// on, linked ephemerally within each test's own rolled-back transaction.
const linkPlayer1ToRaider = (q) => q('update public.players set team_member_id = 3 where id = 1');

describe('anon has no read access to item_preferences', () => {
  it('anon sees no rows even once one exists', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis')");
      const res = await asAnon('select id from public.item_preferences');
      expect(res.rows.length).toBe(0);
    });
  });
});

describe('a raider manages only their own item_preferences', () => {
  it('an unlinked raider cannot see a row for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis')");
      const res = await asUser(RAIDER_T1, 'select id from public.item_preferences where player_id = 1');
      expect(res.rows.length).toBe(0);
    });
  });

  it('a linked raider can insert, read, update, and delete their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);

      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'my first pick') returning id"
      );
      const id = inserted.rows[0].id;

      const seen = await asUser(RAIDER_T1, 'select status, note from public.item_preferences where id = $1', [id]);
      expect(seen.rows[0]).toMatchObject({ status: 'bis', note: 'my first pick' });

      await asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id]);
      const afterUpdate = (await q('select status from public.item_preferences where id = $1', [id])).rows[0];
      expect(afterUpdate.status).toBe('pass');

      await asUser(RAIDER_T1, 'delete from public.item_preferences where id = $1', [id]);
      const afterDelete = (await q('select id from public.item_preferences where id = $1', [id])).rows;
      expect(afterDelete.length).toBe(0);
    });
  });

  it('a raider cannot insert a row for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'bis')"
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('the status CHECK constraint rejects an unrecognised tier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'major_upgrade')"
        )
      ).rejects.toThrow();
    });
  });
});

describe('officers can read but not directly write item_preferences', () => {
  it('a team 1 officer sees a row a raider owns', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis')"
      );
      const res = await asUser(OFFICER_T1, 'select id from public.item_preferences where player_id = 1');
      expect(res.rows.length).toBe(1);
    });
  });

  it("a team 2 officer cannot see a team 1 raider's row", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis')"
      );
      const res = await asUser(OFFICER_T2, 'select id from public.item_preferences where player_id = 1');
      expect(res.rows.length).toBe(0);
    });
  });

  it('an officer cannot insert a row for a raider directly (no officer write policy)', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis')"
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

describe('officers can clear (but not otherwise edit) a raider note', () => {
  it('a team 1 officer can null out a note on a team 1 raider row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'redundant note') returning id"
      );
      const id = inserted.rows[0].id;

      await asUser(OFFICER_T1, 'update public.item_preferences set note = null where id = $1', [id]);
      const after = (await q('select note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after.note).toBeNull();
    });
  });

  it('an officer cannot set a note to a non-null value', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'original note') returning id"
      );
      const id = inserted.rows[0].id;

      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set note = 'rewritten' where id = $1", [id])
      ).rejects.toThrow();
    });
  });

  it('an officer cannot change status/item_id/slot via this path', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'a note') returning id"
      );
      const id = inserted.rows[0].id;

      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id])
      ).rejects.toThrow();
      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set slot = 'Neck' where id = $1", [id])
      ).rejects.toThrow();
    });
  });

  it("a team 2 officer cannot clear a team 1 raider's note", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'a note') returning id"
      );
      const id = inserted.rows[0].id;

      const res = await asUser(
        OFFICER_T2,
        'update public.item_preferences set note = null where id = $1 returning id',
        [id]
      );
      expect(res.rows.length).toBe(0);
      const after = (await q('select note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after.note).toBe('a note');
    });
  });

  it("a raider's own unrestricted self-update still works (owner exemption regression guard)", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, 1, 1, 'bis', 'a note') returning id"
      );
      const id = inserted.rows[0].id;

      await asUser(
        RAIDER_T1,
        "update public.item_preferences set status = 'good', note = 'edited by me' where id = $1",
        [id]
      );
      const after = (await q('select status, note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after).toMatchObject({ status: 'good', note: 'edited by me' });
    });
  });
});

describe('the slot-override unique index allows the same placeholder item once per slot', () => {
  it('a raider can tag the same item_id with two different slots but not the same slot twice', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkPlayer1ToRaider(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 1, 1, 'bis', 'Neck')"
      );
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 1, 1, 'good', 'Ring')"
      );
      const rows = (await q('select slot, status from public.item_preferences where player_id = 1 order by slot')).rows;
      expect(rows).toEqual([
        { slot: 'Neck', status: 'bis' },
        { slot: 'Ring', status: 'good' }
      ]);

      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 1, 1, 'ok', 'Neck')"
        )
      ).rejects.toThrow();
    });
  });
});

afterAll(() => pool.end());
