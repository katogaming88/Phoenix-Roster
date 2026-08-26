// Officer corrections for self-received decisions (#756):
// delete_self_received_request() plus the revert-to-pending UPDATE path.
//
// Delete is a SECURITY DEFINER RPC because self_received_requests has no
// DELETE policy for any role (the docs/RLS.md write contract). Revert needs
// no RPC at all: the existing "Officers update self_received_requests"
// policy carries a plain status UPDATE, which is why half of this file
// asserts behavior that exists before the migration lands. The delete tests
// also pin the audit entry the RPC writes (action, actor, target, and the
// #377 summary-string detail), and the sync tests pin that reverting an
// approval never unticks bis_items.obtained (the one-way decision in
// 20260725100000) while a later re-approve re-fires the sync.
//
// Same withTxn harness as tests/rls/boe.test.js (unique savepoint name),
// since these tests mix privileged fixture writes with impersonated calls
// and expected raises. Each test opens its own transaction, so seed rows
// (supabase/seed.sql: requests 1 pending, 2 approved, 3 rejected on team 1,
// 4 approved on team 2; bis_items 1 = player 1 / item 1 / unobtained) are
// pristine per test.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER,
  RLS_DENIED
} from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint src_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint src_call');
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

const del = (id) => `select public.delete_self_received_request(${id})`;

describe('delete_self_received_request', () => {
  it('team officer deletes an approved row and the RPC writes the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, del(2));
      const gone = await q('select id from public.self_received_requests where id = 2');
      expect(gone.rows.length).toBe(0);
      const audit = await q(
        "select actor_id, target_type, target_id, detail from public.audit_log where action = 'Self-Received Deleted'"
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].actor_id).toBe(OFFICER_T1);
      expect(audit.rows[0].target_type).toBe('players');
      expect(audit.rows[0].target_id).toBe(1);
      // #377 summary-string convention: detail is a JSON string, not an object.
      expect(typeof audit.rows[0].detail).toBe('string');
      expect(audit.rows[0].detail).toContain('Seed Test Staff');
      expect(audit.rows[0].detail).toContain('approved');
    });
  });

  it('team leader deletes a rejected row (any status is deletable)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(TEAM_LEADER_T1, del(3));
      expect((await q('select id from public.self_received_requests where id = 3')).rows.length).toBe(0);
    });
  });

  it('site admin deletes a team 2 row despite holding no team role anywhere', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, del(4));
      expect((await q('select id from public.self_received_requests where id = 4')).rows.length).toBe(0);
    });
  });

  it('a pending row is deletable too, without a reject-then-delete two-step', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, del(1));
      expect((await q('select id from public.self_received_requests where id = 1')).rows.length).toBe(0);
    });
  });

  it('an officer of another team is refused', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T2, del(2))).rejects.toThrow(/Not authorized/);
    });
  });

  it('a guild officer is refused (deliberately excluded, like every approval surface)', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(GUILD_OFFICER, del(2))).rejects.toThrow(/Not authorized/);
    });
  });

  it('a raider is refused, including on their own row', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(RAIDER_T1, del(2))).rejects.toThrow(/Not authorized/);
    });
  });

  it('anon cannot execute the function at all (no grant)', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(del(2))).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('an unknown id raises not found', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, del(999))).rejects.toThrow(/Self-received request not found/);
    });
  });

  it('a row whose player is gone (FK SET NULL) still deletes, with the audit marker', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.self_received_requests set player_id = null where id = 2');
      await asUser(OFFICER_T1, del(2));
      const audit = await q("select target_id, detail from public.audit_log where action = 'Self-Received Deleted'");
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].target_id).toBeNull();
      expect(audit.rows[0].detail).toContain('player no longer on roster');
    });
  });

  it('direct DELETE stays a dead end for officers and site admins alike', async () => {
    await withTxn(async ({ q, asUser }) => {
      const asOfficer = await asUser(OFFICER_T1, 'delete from public.self_received_requests where id = 2');
      expect(asOfficer.rowCount).toBe(0);
      const asAdmin = await asUser(SITE_ADMIN, 'delete from public.self_received_requests where id = 2');
      expect(asAdmin.rowCount).toBe(0);
      expect((await q('select id from public.self_received_requests where id = 2')).rows.length).toBe(1);
    });
  });
});

describe('revert to pending rides the existing officer UPDATE policy', () => {
  const revert = "update public.self_received_requests set status = 'pending' where id = 2 and team_id = 1";

  it('team officer reverts an approved row to pending', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await asUser(OFFICER_T1, revert);
      expect(res.rowCount).toBe(1);
      const row = await q('select status from public.self_received_requests where id = 2');
      expect(row.rows[0].status).toBe('pending');
    });
  });

  it('an officer of another team updates zero rows', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await asUser(OFFICER_T2, revert);
      expect(res.rowCount).toBe(0);
      expect((await q('select status from public.self_received_requests where id = 2')).rows[0].status).toBe(
        'approved'
      );
    });
  });

  it('a row whose player changed teams refuses to revert (team-check trigger re-fires)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_id = 2 where id = 1');
      await expect(asUser(OFFICER_T1, revert)).rejects.toThrow(/does not match players\.team_id/);
    });
  });

  it('reverting an approval never unticks bis_items.obtained (one-way sync)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.bis_items set obtained = true where id = 1');
      const res = await asUser(OFFICER_T1, revert);
      expect(res.rowCount).toBe(1);
      expect((await q('select obtained from public.bis_items where id = 1')).rows[0].obtained).toBe(true);
    });
  });

  it('a later re-approve re-fires the sync and flips an unobtained row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, revert);
      expect((await q('select obtained from public.bis_items where id = 1')).rows[0].obtained).toBe(false);
      const approve = "update public.self_received_requests set status = 'approved' where id = 2 and team_id = 1";
      await asUser(OFFICER_T1, approve);
      expect((await q('select obtained from public.bis_items where id = 1')).rows[0].obtained).toBe(true);
    });
  });
});

afterAll(() => pool.end());
