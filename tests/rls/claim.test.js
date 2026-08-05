// Behavior tests for claim_character() and the team_members self-read policy
// (#212), plus the on_auth_user_created trigger capture (#211 login link).
// Lives in the RLS suite because it needs the live local stack: the function
// is SECURITY DEFINER, its authorization is RLS-shaped, and the trigger fires
// on auth.users.
//
// Each test runs in one rolled-back transaction: fixture writes happen as
// postgres (bypasses RLS), the claim happens as the impersonated caller, and
// assertions happen back as postgres. A savepoint wraps each impersonated call
// so an expected raise does not abort the whole transaction (and does not mask
// the real error when the role reset runs inside an aborted transaction).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, RAIDER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): player 1 is team 1
// 'Seedraider-Illidan', player 2 is team 1 'Seedplayertwo-Illidan', player 3
// is team 2. team_members 3 is the team 1 raider (auth_user_id = RAIDER_T1,
// name_realm 'Seedraider-Illidan'). The migration's one-time name_realm
// backfill is a no-op on a fresh DB (it runs before seed.sql loads), so every
// seeded player starts unlinked.
async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint claim_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint claim_call');
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

const claim = (asUser, uid, teamId, nameRealm) =>
  asUser(uid, 'select * from public.claim_character($1, $2)', [teamId, nameRealm]);

// Inserts an auth.users row (firing on_auth_user_created) and returns nothing;
// callers pass a distinct uuid and provider_id per test.
const addAuthUser = (q, uid, providerId) =>
  q('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [
    uid,
    JSON.stringify({ provider_id: providerId })
  ]);

describe('team_members self-read policy', () => {
  it('a raider sees exactly their own row', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, 'select id, team_id from public.team_members');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].team_id).toBe(1);
    });
  });

  it("a raider does not see another team's members", async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, 'select id from public.team_members where team_id = 2');
      expect(res.rows).toHaveLength(0);
    });
  });

  it('anon sees no team_members', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon('select id from public.team_members');
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe('claim_character rejects invalid claims', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select * from public.claim_character(1, $1)', ['Seedplayertwo-Illidan'])).rejects.toThrow();
    });
  });

  it('a character not on the roster is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(claim(asUser, RAIDER_T1, 1, 'Ghost-Illidan')).rejects.toThrow(/not found on roster/);
    });
  });

  it('an archived character is rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.players (team_id, name_realm, class_spec_id, archived_at) values (1, 'Archived-Illidan', 1, now())"
      );
      await expect(claim(asUser, RAIDER_T1, 1, 'Archived-Illidan')).rejects.toThrow(/not found on roster/);
    });
  });

  it('an already-claimed character is rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = 1 where id = 2');
      await expect(claim(asUser, RAIDER_T1, 1, 'Seedplayertwo-Illidan')).rejects.toThrow(/already claimed/);
    });
  });
});

describe('claim_character links a character to the caller', () => {
  it('a brand-new user gets a raider team_members row and the player link', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000aa';
      await addAuthUser(q, uid, 'discord-brandnew');

      const res = await claim(asUser, uid, 1, 'Seedplayertwo-Illidan');
      expect(res.rows[0].name_realm).toBe('Seedplayertwo-Illidan');
      expect(res.rows[0].role).toBe('raider');

      const members = (await q('select * from public.team_members where auth_user_id = $1', [uid])).rows;
      expect(members).toHaveLength(1);
      expect(members[0].discord_id).toBe('discord-brandnew');
      expect(members[0].role).toBe('raider');
      expect(members[0].team_id).toBe(1);

      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(members[0].id);
    });
  });

  it('reuses an unlinked Discord-id row instead of inserting a duplicate', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000bb';
      // Insert the auth user first so the login trigger runs before the
      // team_members row exists. That leaves the row unlinked, which is the
      // case claim_character's discord_id fallback covers -- a blind insert
      // here would violate team_members_team_id_discord_id_key.
      await addAuthUser(q, uid, 'discord-late');
      await q(
        "insert into public.team_members (team_id, discord_id, role, name_realm) values (1, 'discord-late', 'raider', 'Latecomer-Illidan')"
      );

      await claim(asUser, uid, 1, 'Seedplayertwo-Illidan');

      const rows = (await q("select id, auth_user_id from public.team_members where discord_id = 'discord-late'")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].auth_user_id).toBe(uid);
      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(rows[0].id);
    });
  });

  it('an existing member claiming a second character reuses their row (alts)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const before = (await q('select count(*)::int as n from public.team_members')).rows[0].n;
      await claim(asUser, RAIDER_T1, 1, 'Seedplayertwo-Illidan');
      const after = (await q('select count(*)::int as n from public.team_members')).rows[0].n;
      expect(after).toBe(before);

      const memberId = (await q('select id from public.team_members where auth_user_id = $1', [RAIDER_T1])).rows[0].id;
      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(memberId);
    });
  });
});

describe('the one-time name_realm backfill links matching players', () => {
  it('sets team_member_id where a team_members.name_realm matches a player', async () => {
    await withTxn(async ({ q }) => {
      // player 1 matches team_members 3 by name_realm but starts unlinked (the
      // migration backfill ran before seed.sql loaded this row).
      const before = (
        await q("select team_member_id from public.players where name_realm = 'Seedraider-Illidan' and team_id = 1")
      ).rows[0];
      expect(before.team_member_id).toBeNull();

      await q(`update public.players p
                  set team_member_id = tm.id
                 from public.team_members tm
                where p.team_id = tm.team_id
                  and p.name_realm = tm.name_realm
                  and p.team_member_id is null`);

      const after = (
        await q("select team_member_id from public.players where name_realm = 'Seedraider-Illidan' and team_id = 1")
      ).rows[0];
      const member3 = (await q("select id from public.team_members where discord_id = 'discord-raider-1'")).rows[0].id;
      expect(after.team_member_id).toBe(member3);
    });
  });
});

describe('on_auth_user_created backfills auth_user_id (trigger capture)', () => {
  it('links a team_members row by Discord provider_id on user insert', async () => {
    await withTxn(async ({ q }) => {
      const uid = '00000000-0000-0000-0000-0000000000cc';
      await q(
        "insert into public.team_members (team_id, discord_id, role, name_realm) values (1, 'discord-trig', 'raider', 'Trig-Illidan')"
      );
      await addAuthUser(q, uid, 'discord-trig');
      const member = (await q("select auth_user_id from public.team_members where discord_id = 'discord-trig'"))
        .rows[0];
      expect(member.auth_user_id).toBe(uid);
    });
  });

  it('links a site_admins row by Discord provider_id on user insert', async () => {
    await withTxn(async ({ q }) => {
      const uid = '00000000-0000-0000-0000-0000000000dd';
      await q("insert into public.site_admins (discord_id) values ('discord-admin-trig')");
      await addAuthUser(q, uid, 'discord-admin-trig');
      const admin = (await q("select auth_user_id from public.site_admins where discord_id = 'discord-admin-trig'"))
        .rows[0];
      expect(admin.auth_user_id).toBe(uid);
    });
  });
});

// #512: permanent "I don't have a character yet" opt-out. Global (no
// team_id), keyed on auth_user_id -- mirrors notifications.test.js's shape
// for a simple is_own_player()-style self-service table, except this one's
// RLS predicate is the raw column check inline (auth_user_id = auth.uid()),
// not a helper function, since there's no join involved.
describe('no_character_dismissals self-service RLS', () => {
  it('a raider can insert and then read their own dismissal row', async () => {
    await withTxn(async ({ asUser }) => {
      await asUser(RAIDER_T1, 'insert into public.no_character_dismissals (auth_user_id) values ($1)', [RAIDER_T1]);
      const res = await asUser(RAIDER_T1, 'select auth_user_id from public.no_character_dismissals');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].auth_user_id).toBe(RAIDER_T1);
    });
  });

  it('a raider cannot insert a dismissal row for a different account', async () => {
    await withTxn(async ({ asUser }) => {
      const other = '00000000-0000-0000-0000-0000000000ee';
      await expect(
        asUser(RAIDER_T1, 'insert into public.no_character_dismissals (auth_user_id) values ($1)', [other])
      ).rejects.toThrow();
    });
  });

  it("a raider does not see another account's dismissal row", async () => {
    await withTxn(async ({ q, asUser }) => {
      const other = '00000000-0000-0000-0000-0000000000ff';
      await addAuthUser(q, other, 'discord-other-dismissal');
      await q('insert into public.no_character_dismissals (auth_user_id) values ($1)', [other]);
      const res = await asUser(RAIDER_T1, 'select id from public.no_character_dismissals where auth_user_id = $1', [
        other
      ]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it('anon cannot insert or read any dismissal row', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await q('insert into public.no_character_dismissals (auth_user_id) values ($1)', [RAIDER_T1]);
      await expect(
        asAnon('insert into public.no_character_dismissals (auth_user_id) values ($1)', [RAIDER_T1])
      ).rejects.toThrow();
      const res = await asAnon('select id from public.no_character_dismissals');
      expect(res.rows).toHaveLength(0);
    });
  });
});

afterAll(() => pool.end());
