// #925: `players` carries a `Public read players` policy with `qual = true`
// and a table-level grant to anon, so three officer-written columns
// (officer_notes, archived_reason, archived_reason_detail) came back with the
// publishable key and to every signed-in raider. `polroles` on that policy is
// PUBLIC, not a role list, which is why a raider read the same rows an
// anonymous visitor did. They live on player_officer_notes now, whose own
// policies are the boundary; the columns are gone from `players` entirely, so
// there is nothing left for a future public select to name by accident.
//
// m_plus_note deliberately stayed behind: renderProfile() shows it on the
// public profile beside the Excluded badge (js/common.js), so it is not an
// officer-only column. It holds no rows and #945 prunes it.
//
// archive_player() exists because archived_at stays on `players` while the
// reason moves. Two tables, one officer action: without the function the
// client would issue two writes with a window between them where a player is
// archived and the reason never landed.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  queryAs,
  countAs,
  withRole,
  RLS_DENIED,
  OFFICER_T1,
  OFFICER_T2,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  GUILD_OFFICER
} from './helpers.js';

// Player 2 is on team 1 and unarchived in the seed; player 1 carries the
// seeded note row, so inserts target 2 to avoid the primary key.
const INSERT_T1 = "insert into public.player_officer_notes (player_id, team_id, officer_notes) values (2, 1, 'note')";

async function expectDenied(role, uid, sql) {
  await expect(queryAs(role, uid, sql)).rejects.toMatchObject({ code: RLS_DENIED });
}

describe('the three columns are gone from players', () => {
  it('pg_attribute no longer lists them', async () => {
    const res = await queryAs(
      'authenticated',
      OFFICER_T1,
      `select attname from pg_catalog.pg_attribute
        where attrelid = 'public.players'::regclass and attnum > 0 and not attisdropped
          and attname in ('officer_notes', 'archived_reason', 'archived_reason_detail')`
    );
    expect(res.rows).toEqual([]);
  });

  // The whole point of the move: a column that is not there cannot be
  // re-exposed by a later select, however the public read policy evolves.
  it('an anon select of officer_notes on players errors as an unknown column', async () => {
    await expect(queryAs('anon', null, 'select officer_notes from public.players')).rejects.toMatchObject({
      code: '42703'
    });
  });

  it('m_plus_note is still there, and still public', async () => {
    expect(await countAs('anon', null, 'players', 'm_plus_note is null')).toBeGreaterThan(0);
  });
});

describe('player_officer_notes is officer-scoped', () => {
  it('anon sees no rows', async () => {
    expect(await countAs('anon', null, 'player_officer_notes')).toBe(0);
  });

  it('a raider sees no rows', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'player_officer_notes')).toBe(0);
  });

  it('a team 1 officer sees team 1 rows', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'player_officer_notes', 'team_id = 1')).toBeGreaterThan(0);
  });

  it('a team 2 officer sees no team 1 rows', async () => {
    expect(await countAs('authenticated', OFFICER_T2, 'player_officer_notes', 'team_id = 1')).toBe(0);
  });

  // The columns lived under `Officers write players`, which OR's in both of
  // these, so the side table admits exactly the same people.
  it('a team leader, a guild officer and a site admin all read them', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'player_officer_notes', 'team_id = 1')).toBeGreaterThan(0);
    expect(await countAs('authenticated', GUILD_OFFICER, 'player_officer_notes', 'team_id = 1')).toBeGreaterThan(0);
    expect(await countAs('authenticated', SITE_ADMIN, 'player_officer_notes', 'team_id = 1')).toBeGreaterThan(0);
  });
});

describe('player_officer_notes write policy', () => {
  it('a team 1 officer can insert', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, INSERT_T1);
    expect(res.rowCount).toBe(1);
  });

  it('a team 1 team leader can insert', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, INSERT_T1);
    expect(res.rowCount).toBe(1);
  });

  it('a raider cannot insert', async () => {
    await expectDenied('authenticated', RAIDER_T1, INSERT_T1);
  });

  it('anon cannot insert', async () => {
    await expectDenied('anon', null, INSERT_T1);
  });

  it('a team 2 officer cannot insert a team 1 row', async () => {
    await expectDenied('authenticated', OFFICER_T2, INSERT_T1);
  });
});

describe('player_officer_notes constraints', () => {
  it('the guard trigger rejects a team_id that is not the player of record', async () => {
    await expect(
      queryAs(
        'authenticated',
        SITE_ADMIN,
        "insert into public.player_officer_notes (player_id, team_id, officer_notes) values (2, 2, 'wrong team')"
      )
    ).rejects.toThrow(/does not match players.team_id/);
  });

  // The same fixed vocabulary the dropdown offers (#476), carried over from
  // players_archived_reason_check rather than relaxed in the move.
  it('archived_reason keeps its fixed vocabulary', async () => {
    await expect(
      queryAs(
        'authenticated',
        SITE_ADMIN,
        "insert into public.player_officer_notes (player_id, team_id, archived_reason) values (2, 1, 'nonsense')"
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('archive_player', () => {
  const call = "select public.archive_player(2, 'other', 'left for another guild') as archived_at";

  it('sets archived_at and writes the reason in one call', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      const res = await q(call);
      expect(res.rows[0].archived_at).toBeInstanceOf(Date);

      const player = await q('select archived_at from public.players where id = 2');
      expect(player.rows[0].archived_at).toEqual(res.rows[0].archived_at);

      const side = await q(
        'select archived_reason, archived_reason_detail from public.player_officer_notes where player_id = 2'
      );
      expect(side.rows[0]).toEqual({
        archived_reason: 'other',
        archived_reason_detail: 'left for another guild'
      });
    });
  });

  // The note and the archive reason share a row, so archiving a player who
  // already has a note must not blank it.
  it('keeps an existing officer note on the row it updates', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await q(INSERT_T1);
      await q(call);
      const side = await q(
        'select officer_notes, archived_reason from public.player_officer_notes where player_id = 2'
      );
      expect(side.rows[0]).toEqual({ officer_notes: 'note', archived_reason: 'other' });
    });
  });

  it('refuses a second archive rather than rewriting the reason', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await q(call);
      await expect(q("select public.archive_player(2, 'drama', 'second call')")).rejects.toThrow(/already archived/i);
    });
  });

  it('a raider cannot call it', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, call)).rejects.toThrow(/Not authorized/);
  });

  it('a team 2 officer cannot archive a team 1 player', async () => {
    await expect(queryAs('authenticated', OFFICER_T2, call)).rejects.toThrow(/Not authorized/);
  });

  it('anon cannot call it', async () => {
    await expect(queryAs('anon', null, call)).rejects.toThrow(/permission denied|Not authorized/i);
  });
});

afterAll(() => pool.end());
