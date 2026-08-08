// Behavior tests for get_own_signup() and update_own_signup() (#500): a
// raider's self-service read/edit of their own season signup. Lives in the
// RLS suite because both are SECURITY DEFINER and their authorization is
// RLS-shaped (auth.uid()-scoped, not table-policy-scoped).
//
// Each test runs in one rolled-back transaction: fixture writes happen as
// postgres (bypasses RLS), the RPC call happens as the impersonated caller,
// and assertions happen back as postgres. Mirrors claim.test.js's withTxn
// shape (parameterized uid, since callers here vary -- the owner, a
// different raider, an officer, anon).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, RAIDER_T1, OFFICER_T1, SIGNUP_OWNER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint own_signup_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint own_signup_call');
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

// Inserts a season_signups row as postgres (bypasses RLS), owned by
// SIGNUP_OWNER_T1 unless overridden. team 1's active season is 'seed-season'
// (supabase/seed.sql); classes_specs id 1 is the only seeded row (Mage/Frost).
function insertSignup(q, overrides) {
  const row = {
    team_id: 1,
    signup_name_realm: 'Ownsignup-Illidan',
    class_spec_id: 1,
    season: 'seed-season',
    status: 'pending',
    auth_user_id: SIGNUP_OWNER_T1,
    ...overrides
  };
  return q(
    `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status, auth_user_id, approved_player_id, reviewed_at, reviewed_by, signup_officer_note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      row.team_id,
      row.signup_name_realm,
      row.class_spec_id,
      row.season,
      row.status,
      row.auth_user_id,
      row.approved_player_id ?? null,
      row.reviewed_at ?? null,
      row.reviewed_by ?? null,
      row.signup_officer_note ?? null
    ]
  );
}

const getOwn = (asUser, uid, teamId) => asUser(uid, 'select * from public.get_own_signup($1)', [teamId]);

const updateOwn = (asUser, uid, signupId, overrides = {}) => {
  const p = {
    p_signup_id: signupId,
    p_name_realm: 'Editedname-Illidan',
    p_class: 'Mage',
    p_spec: 'Frost',
    p_off_specs: '',
    p_main_swap: false,
    p_player_note: 'edited note',
    p_swap_from_name_realm: null,
    ...overrides
  };
  return asUser(uid, 'select * from public.update_own_signup($1, $2, $3, $4, $5, $6, $7, $8)', [
    p.p_signup_id,
    p.p_name_realm,
    p.p_class,
    p.p_spec,
    p.p_off_specs,
    p.p_main_swap,
    p.p_player_note,
    p.p_swap_from_name_realm
  ]);
};

describe('get_own_signup', () => {
  it("returns the caller's pending signup for the active season, with no officer-only columns", async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertSignup(q, {});
      const res = await getOwn(asUser, SIGNUP_OWNER_T1, 1);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].signup_name_realm).toBe('Ownsignup-Illidan');
      expect(res.rows[0].status).toBe('pending');
      expect(Object.prototype.hasOwnProperty.call(res.rows[0], 'signup_officer_note')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(res.rows[0], 'reviewed_by')).toBe(false);
    });
  });

  it("does not return another user's signup", async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertSignup(q, {});
      const res = await getOwn(asUser, RAIDER_T1, 1);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("does not return a different season's signup", async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertSignup(q, { season: 'not-the-active-season' });
      const res = await getOwn(asUser, SIGNUP_OWNER_T1, 1);
      expect(res.rows).toHaveLength(0);
    });
  });

  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select * from public.get_own_signup(1)')).rejects.toThrow();
    });
  });
});

describe('update_own_signup', () => {
  it('the owner can edit a pending signup, status stays pending', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { rows } = await insertSignup(q, {});
      await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, { p_player_note: 'fixed typo' });
      const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
      expect(signup.signup_name_realm).toBe('Editedname-Illidan');
      expect(signup.player_note).toBe('fixed typo');
      expect(signup.status).toBe('pending');
    });
  });

  it('editing an approved-not-yet-added signup reverts it to pending and clears the three review columns', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { rows } = await insertSignup(q, {
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 1,
        signup_officer_note: 'looked fine'
      });
      await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id);
      const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
      expect(signup.status).toBe('pending');
      expect(signup.reviewed_at).toBeNull();
      expect(signup.reviewed_by).toBeNull();
      expect(signup.signup_officer_note).toBeNull();
    });
  });

  it("an added signup can be edited while its season is still the team's active signup season, and reverts to pending for re-review", async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await q(
        "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
      );
      const { rows } = await insertSignup(q, {
        status: 'added',
        approved_player_id: player.rows[0].id,
        reviewed_at: new Date().toISOString(),
        reviewed_by: 1,
        signup_officer_note: 'looked fine'
      });
      await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id);
      const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
      const player_row = (
        await q('select name_realm, class_spec_id from public.players where id = $1', [player.rows[0].id])
      ).rows[0];
      expect(signup.status).toBe('pending');
      expect(signup.approved_player_id).toBeNull();
      expect(signup.reviewed_at).toBeNull();
      expect(signup.reviewed_by).toBeNull();
      expect(signup.signup_officer_note).toBeNull();
      expect(signup.signup_name_realm).toBe('Editedname-Illidan');
      // The live roster row is untouched -- the edit only re-queues the
      // signup for officer review, it does not write the roster directly.
      expect(player_row.name_realm).toBe('Ownsignuproster-Illidan');
    });
  });

  it("an added signup whose season is no longer the team's active signup season cannot be edited", async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await q(
        "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
      );
      const { rows } = await insertSignup(q, {
        status: 'added',
        approved_player_id: player.rows[0].id,
        season: 'not-the-active-season'
      });
      await expect(updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id)).rejects.toThrow(/already been added to the roster/);
    });
  });

  it('a rejected signup cannot be edited', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { rows } = await insertSignup(q, { status: 'rejected' });
      await expect(updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id)).rejects.toThrow(/was not approved/);
    });
  });

  it('a different raider (not the owner) cannot edit it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { rows } = await insertSignup(q, {});
      await expect(updateOwn(asUser, RAIDER_T1, rows[0].id)).rejects.toThrow(/not found/);
    });
  });

  it('an officer cannot bypass the self-edit RPC for a row it does not own', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { rows } = await insertSignup(q, {});
      await expect(updateOwn(asUser, OFFICER_T1, rows[0].id)).rejects.toThrow(/not found/);
    });
  });

  it('anon cannot execute the function', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const { rows } = await insertSignup(q, {});
      await expect(
        asAnon('select * from public.update_own_signup($1, $2, $3, $4, $5, $6, $7, $8)', [
          rows[0].id,
          'Anon-Illidan',
          'Mage',
          'Frost',
          '',
          false,
          null,
          null
        ])
      ).rejects.toThrow();
    });
  });
});

afterAll(() => pool.end());
