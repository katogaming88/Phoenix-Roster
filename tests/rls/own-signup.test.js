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

  // Confirmed live (2026-08-12): an officer renamed a roster player directly
  // (Noctrana -> Raintotem) after their signup had already been added --
  // the raider then opened "Edit signup" and it still showed the old,
  // pre-rename name/class/spec instead of what's actually on the roster now.
  it("for an added signup, returns the live player's current name/class/spec instead of the signup's stale stored snapshot", async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await q(
        "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
      );
      const { rows } = await insertSignup(q, { status: 'added', approved_player_id: player.rows[0].id });
      const warriorFury = await q(
        "insert into public.classes_specs (class, spec, role) values ('Warrior', 'Fury', 'Melee') returning id"
      );
      // Officer manually renames/reclasses the player directly -- bypasses
      // signups entirely, same as a Roster tab edit.
      await q('update public.players set name_realm = $1, class_spec_id = $2 where id = $3', [
        'Renamedplayer-Illidan',
        warriorFury.rows[0].id,
        player.rows[0].id
      ]);
      const res = await getOwn(asUser, SIGNUP_OWNER_T1, 1);
      expect(res.rows[0].signup_name_realm).toBe('Renamedplayer-Illidan');
      expect(res.rows[0].class).toBe('Warrior');
      expect(res.rows[0].spec).toBe('Fury');
    });
  });

  it("for a pending signup (no linked player yet), still returns the signup's own stored name/class/spec", async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertSignup(q, {});
      const res = await getOwn(asUser, SIGNUP_OWNER_T1, 1);
      expect(res.rows[0].signup_name_realm).toBe('Ownsignup-Illidan');
      expect(res.rows[0].class).toBe('Mage');
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

  // Confirmed live (2026-08-12): Khaosmagi (Mage/Arcane, already on the
  // roster as Mage/Arcane) opened their already-added signup and hit Submit
  // without changing anything -- it still bounced back to 'pending' and had
  // to be manually denied since there was nothing to review.
  describe('no-op edits (#noop)', () => {
    it('re-submitting an added signup with identical values leaves status/approval untouched', async () => {
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
        await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, {
          p_name_realm: 'Ownsignuproster-Illidan',
          p_class: 'Mage',
          p_spec: 'Frost',
          p_player_note: null
        });
        const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
        expect(signup.status).toBe('added');
        expect(signup.approved_player_id).toBe(player.rows[0].id);
        expect(signup.reviewed_at).not.toBeNull();
        expect(signup.reviewed_by).toBe(1);
        expect(signup.signup_officer_note).toBe('looked fine');
      });
    });

    it('re-submitting an approved-not-yet-added signup with identical values leaves status untouched', async () => {
      await withTxn(async ({ q, asUser }) => {
        const { rows } = await insertSignup(q, {
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: 1,
          signup_officer_note: 'looked fine'
        });
        await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, {
          p_name_realm: 'Ownsignup-Illidan',
          p_class: 'Mage',
          p_spec: 'Frost',
          p_player_note: null
        });
        const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
        expect(signup.status).toBe('approved');
        expect(signup.reviewed_at).not.toBeNull();
      });
    });

    it('changing even one field (e.g. the note) still counts as a real edit and resets status', async () => {
      await withTxn(async ({ q, asUser }) => {
        const player = await q(
          "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
        );
        const { rows } = await insertSignup(q, {
          status: 'added',
          approved_player_id: player.rows[0].id,
          reviewed_at: new Date().toISOString(),
          reviewed_by: 1
        });
        await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, {
          p_name_realm: 'Ownsignuproster-Illidan',
          p_class: 'Mage',
          p_spec: 'Frost',
          p_player_note: 'actually a real change'
        });
        const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
        expect(signup.status).toBe('pending');
        expect(signup.approved_player_id).toBeNull();
      });
    });

    // The mirror image of the get_own_signup live-truth test above: an
    // officer renamed/reclassed the linked player directly after the signup
    // was added, so the signup's own stored snapshot is now stale. Matching
    // that stale snapshot is NOT a no-op (it would silently contradict the
    // officer's manual roster change); matching the player's actual current
    // state IS a no-op.
    it("matching the signup's stale stored snapshot (not the live, officer-edited player) still counts as a real edit", async () => {
      await withTxn(async ({ q, asUser }) => {
        const player = await q(
          "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
        );
        const { rows } = await insertSignup(q, {
          status: 'added',
          approved_player_id: player.rows[0].id,
          reviewed_at: new Date().toISOString(),
          reviewed_by: 1
        });
        await q("update public.players set name_realm = 'Renamedplayer-Illidan' where id = $1", [player.rows[0].id]);
        await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, {
          p_name_realm: 'Ownsignuproster-Illidan', // the OLD, now-stale name
          p_class: 'Mage',
          p_spec: 'Frost',
          p_player_note: null
        });
        const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
        expect(signup.status).toBe('pending');
      });
    });

    it("matching the live, officer-edited player's current name IS treated as a no-op", async () => {
      await withTxn(async ({ q, asUser }) => {
        const player = await q(
          "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Ownsignuproster-Illidan', 1) returning id"
        );
        const { rows } = await insertSignup(q, {
          status: 'added',
          approved_player_id: player.rows[0].id,
          reviewed_at: new Date().toISOString(),
          reviewed_by: 1
        });
        await q("update public.players set name_realm = 'Renamedplayer-Illidan' where id = $1", [player.rows[0].id]);
        await updateOwn(asUser, SIGNUP_OWNER_T1, rows[0].id, {
          p_name_realm: 'Renamedplayer-Illidan', // matches the live player
          p_class: 'Mage',
          p_spec: 'Frost',
          p_player_note: null
        });
        const signup = (await q('select * from public.season_signups where id = $1', [rows[0].id])).rows[0];
        expect(signup.status).toBe('added');
        expect(signup.reviewed_at).not.toBeNull();
      });
    });
  });
});

afterAll(() => pool.end());
