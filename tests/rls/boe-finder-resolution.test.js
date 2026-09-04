// resolve_boe_finder_discord_id (#918): who the sold ping notifies.
//
// The first live sold post missed its finder. The row carried no
// finder_discord_id (it predates #889's stamp) and no player_id, because
// submit_boe_found matches a finder's character within p_team_id only and
// that character sat on another team, removed from its roster a month
// earlier. boe-sold-webhook fell through to the bold name it renders when
// nobody can be found.
//
// This function owns all three resolution steps so the logic can be tested at
// all: nothing in CI parses supabase/functions, so the same code written
// inline in the edge function would ship unexercised. Shape copied from
// resolve_actor_name / resolve_discord_display_name.
//
// The two rules worth stating, because both look like bugs to a later reader:
// removed characters count (the case that prompted this is one), and the
// ambiguity check is on distinct Discord ids rather than on player rows,
// because a person with two character rows pointing at one member is the
// common shape and refusing it would help nobody.
//
// Same withTxn harness as tests/rls/boe.test.js with its own savepoint name:
// the gate cases assert a raise, and without a savepoint per call an expected
// failure aborts the shared transaction and masks the real error.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, OFFICER_T2, SITE_ADMIN } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint finder_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint finder_call');
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

// Seeded rows this file leans on (supabase/seed.sql):
//   team_members 1 = discord-officer-1 (OFFICER_T1, team 1, holds the only
//     boe_managers grant), 3 = discord-raider-1 (RAIDER_T1, team 1),
//     4 = discord-officer-2 (OFFICER_T2, team 2, no manager grant)
//   players 1 = Seedraider-Illidan, team 1, team_member_id null
//   boe_items 1 = found, team 1, player_id 1, finder_name Seedraider-Illidan
const TEAM_1 = 1;
const TEAM_2 = 2;
const TM_RAIDER_1 = 3;
const TM_OFFICER_2 = 4;
const DISCORD_RAIDER_1 = 'discord-raider-1';
const DISCORD_OFFICER_2 = 'discord-officer-2';

// A find with neither a stamped Discord id nor a player_id: the state every
// name-fallback case starts from, and the shape of the row that prompted this.
// Status is left at its default: the resolver never reads it, and inserting a
// sold row here would owe the four money columns that
// boe_items_money_complete_when_sold requires for nothing in return.
const unresolvedItem = (q, teamId, finderName) =>
  q(
    "insert into public.boe_items (team_id, item_name, finder_name) values ($1, 'Test Find', $2) returning id",
    [teamId, finderName]
  ).then((r) => r.rows[0].id);

// A character, optionally linked to a member row and optionally removed from
// the roster. players.team_id and team_members.team_id are not constrained to
// match, which is exactly the cross-team shape under test.
const newPlayer = (q, teamId, nameRealm, teamMemberId, archived) =>
  q(
    'insert into public.players (team_id, name_realm, team_member_id, archived_at) values ($1, $2, $3, $4) returning id',
    [teamId, nameRealm, teamMemberId || null, archived ? new Date().toISOString() : null]
  ).then((r) => r.rows[0].id);

const resolve = (asUser, uid, id) =>
  asUser(uid, 'select public.resolve_boe_finder_discord_id($1) as id', [id]).then((r) => r.rows[0].id);

describe('resolve_boe_finder_discord_id: the stamped id wins', () => {
  it('returns finder_discord_id even when the name would resolve to somebody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Stampedfinder-Illidan');
      await q('update public.boe_items set finder_discord_id = $1 where id = $2', [DISCORD_RAIDER_1, id]);
      // A name match pointing somewhere else, so a fallback that ran anyway
      // would return a different id rather than the same one by luck.
      await newPlayer(q, TEAM_2, 'Stampedfinder-Illidan', TM_OFFICER_2, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBe(DISCORD_RAIDER_1);
    });
  });
});

describe('resolve_boe_finder_discord_id: the player_id path', () => {
  it('resolves through players.team_member_id when nothing was stamped', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = $1 where id = 1', [TM_RAIDER_1]);

      expect(await resolve(asUser, OFFICER_T1, 1)).toBe(DISCORD_RAIDER_1);
    });
  });

  it('falls through to the name match when the linked player has no member row', async () => {
    await withTxn(async ({ q, asUser }) => {
      // players 1 stays unlinked, as the seed ships it.
      await newPlayer(q, TEAM_2, 'Seedraider-Windrunner', TM_OFFICER_2, false);

      expect(await resolve(asUser, OFFICER_T1, 1)).toBe(DISCORD_OFFICER_2);
    });
  });
});

describe('resolve_boe_finder_discord_id: the guild-wide name fallback', () => {
  it('resolves a find whose finder plays on another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Crossteam-Illidan');
      await newPlayer(q, TEAM_2, 'Crossteam-Illidan', TM_OFFICER_2, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBe(DISCORD_OFFICER_2);
    });
  });

  it('resolves a removed character, and matches a bare first name against a full one', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Row 66's own shape: the finder typed a bare name, and the character
      // it belongs to was removed from another team's roster a month before.
      const id = await unresolvedItem(q, TEAM_1, 'Removedfinder');
      await newPlayer(q, TEAM_2, 'Removedfinder-Windrunner', TM_OFFICER_2, true);

      expect(await resolve(asUser, OFFICER_T1, id)).toBe(DISCORD_OFFICER_2);
    });
  });

  it('matches case-insensitively', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'lowercasefinder-spirestone');
      await newPlayer(q, TEAM_2, 'LowercaseFinder-Windrunner', TM_OFFICER_2, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBe(DISCORD_OFFICER_2);
    });
  });

  it('resolves two character rows that point at one person', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Twinrows-Illidan');
      await newPlayer(q, TEAM_2, 'Twinrows-Illidan', TM_OFFICER_2, false);
      await newPlayer(q, TEAM_2, 'Twinrows-Windrunner', TM_OFFICER_2, true);

      expect(await resolve(asUser, OFFICER_T1, id)).toBe(DISCORD_OFFICER_2);
    });
  });

  it('refuses two character rows that point at two people', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Ambiguous-Illidan');
      await newPlayer(q, TEAM_2, 'Ambiguous-Illidan', TM_OFFICER_2, false);
      await newPlayer(q, TEAM_1, 'Ambiguous-Windrunner', TM_RAIDER_1, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBeNull();
    });
  });

  it('returns null when the name matches nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Nobodyatall-Illidan');

      expect(await resolve(asUser, OFFICER_T1, id)).toBeNull();
    });
  });

  it('returns null when the only match is an unlinked character', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Unlinked-Illidan');
      await newPlayer(q, TEAM_2, 'Unlinked-Illidan', null, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBeNull();
    });
  });

  it('does not match a name that merely starts the same way', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Murr-Dalaran');
      await newPlayer(q, TEAM_2, 'Murrloc-Windrunner', TM_OFFICER_2, false);

      expect(await resolve(asUser, OFFICER_T1, id)).toBeNull();
    });
  });

  it('returns null for a row id that does not exist', async () => {
    await withTxn(async ({ asUser }) => {
      expect(await resolve(asUser, OFFICER_T1, 999999)).toBeNull();
    });
  });
});

describe('resolve_boe_finder_discord_id: the gate', () => {
  it('admits a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Adminread-Illidan');
      await newPlayer(q, TEAM_2, 'Adminread-Illidan', TM_OFFICER_2, false);

      expect(await resolve(asUser, SITE_ADMIN, id)).toBe(DISCORD_OFFICER_2);
    });
  });

  it('refuses a team officer holding no manager grant', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_2, 'Officerread-Illidan');

      await expect(resolve(asUser, OFFICER_T2, id)).rejects.toThrow(/not authorized/i);
    });
  });

  it('refuses anon', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Anonread-Illidan');

      await expect(
        asAnon('select public.resolve_boe_finder_discord_id($1) as id', [id])
      ).rejects.toThrow(/permission denied/i);
    });
  });
});

// The manager grant seeded on OFFICER_T1 is what every value case above calls
// through, so a gate that admitted nobody would fail those first.
describe('resolve_boe_finder_discord_id: the grant is what admits the caller', () => {
  it('admits a manager who holds no officer role anywhere', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await unresolvedItem(q, TEAM_1, 'Grantonly-Illidan');
      await newPlayer(q, TEAM_2, 'Grantonly-Illidan', TM_OFFICER_2, false);
      // OFFICER_T2 is a plain officer on team 2 until the grant lands.
      await q('insert into public.boe_managers (discord_id, auth_user_id) values ($1, $2)', [
        DISCORD_OFFICER_2,
        OFFICER_T2
      ]);

      expect(await resolve(asUser, OFFICER_T2, id)).toBe(DISCORD_OFFICER_2);
    });
  });
});

afterAll(async () => {
  await pool.end();
});
