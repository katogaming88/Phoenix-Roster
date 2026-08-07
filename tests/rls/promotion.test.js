// Behavior tests for add_signup_to_roster(): the three upsert cases (new
// character, returning archived character, already-active member), main
// swaps, status guards, and the season_signups_player_only_when_added
// CHECK. Lives in the RLS suite because it needs the live local stack and
// the function's authorization is RLS-driven.
//
// Each test runs in one rolled-back transaction: fixture writes happen as
// postgres (bypasses RLS), the function call happens as the team 1 officer,
// assertions happen back as postgres.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): signup 1 is team 1
// status pending; signup 2 is team 1 'Seedapproved-Illidan' status approved;
// player 2 is team 1 'Seedplayertwo-Illidan'; player 3 is team 2.
const APPROVED_SIGNUP = 2;
const APPROVED_NAME = 'Seedapproved-Illidan';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    // Runs one statement as the team 1 officer, then restores postgres.
    // A savepoint per call keeps an expected failure from aborting the
    // whole test transaction (and from masking the real error when the
    // role reset itself fails inside an aborted transaction).
    const asOfficer = async (text, params) => {
      await q('savepoint officer_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: OFFICER_T1, role: 'authenticated' })
      ]);
      await q('set local role authenticated');
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint officer_call');
        throw err;
      }
    };
    return await fn(q, asOfficer);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const promote = (asOfficer, signupId, isTrial = true, archiveId = null) =>
  asOfficer('select public.add_signup_to_roster($1, $2, $3) as player_id', [signupId, isTrial, archiveId]);

describe('promotion of an approved signup', () => {
  it('creates the player and completes the signup', async () => {
    await withTxn(async (q, asOfficer) => {
      const res = await promote(asOfficer, APPROVED_SIGNUP);
      const playerId = res.rows[0].player_id;

      const player = (await q('select * from public.players where id = $1', [playerId])).rows[0];
      expect(player.name_realm).toBe(APPROVED_NAME);
      expect(player.team_id).toBe(1);
      expect(player.is_trial).toBe(true);
      expect(player.class_spec_id).toBe(1);
      expect(player.archived_at).toBeNull();

      const signup = (await q('select * from public.season_signups where id = $1', [APPROVED_SIGNUP])).rows[0];
      expect(signup.status).toBe('added');
      expect(signup.approved_player_id).toBe(playerId);
    });
  });

  it("sets a new character's join_date to today in America/New_York, not the session's UTC current_date (20260806230556)", async () => {
    await withTxn(async (q, asOfficer) => {
      const res = await promote(asOfficer, APPROVED_SIGNUP);
      const playerId = res.rows[0].player_id;

      const player = (await q('select join_date::text as join_date_text from public.players where id = $1', [playerId]))
        .rows[0];
      const expected = (await q(`select (now() at time zone 'America/New_York')::date::text as today`)).rows[0].today;
      expect(player.join_date_text).toBe(expected);
    });
  });

  it('removes the signup from pending_roster and incoming_roster', async () => {
    await withTxn(async (q, asOfficer) => {
      const before = await asOfficer('select count(*)::int as n from public.pending_roster where signup_id = $1', [
        APPROVED_SIGNUP
      ]);
      expect(before.rows[0].n).toBe(1);
      const beforeIncoming = await q('select count(*)::int as n from public.incoming_roster where signup_id = $1', [
        APPROVED_SIGNUP
      ]);
      expect(beforeIncoming.rows[0].n).toBe(1);

      await promote(asOfficer, APPROVED_SIGNUP);

      const after = await asOfficer('select count(*)::int as n from public.pending_roster where signup_id = $1', [
        APPROVED_SIGNUP
      ]);
      expect(after.rows[0].n).toBe(0);
      const afterIncoming = await q('select count(*)::int as n from public.incoming_roster where signup_id = $1', [
        APPROVED_SIGNUP
      ]);
      expect(afterIncoming.rows[0].n).toBe(0);
    });
  });

  it('rejects signups that are not approved', async () => {
    await withTxn(async (q, asOfficer) => {
      await expect(promote(asOfficer, 1)).rejects.toThrow(/not in approved status/);
    });
  });

  it('rejects a second promotion of the same signup', async () => {
    await withTxn(async (q, asOfficer) => {
      await promote(asOfficer, APPROVED_SIGNUP);
      await expect(promote(asOfficer, APPROVED_SIGNUP)).rejects.toThrow(/not in approved status/);
    });
  });
});

describe('upsert cases on (team_id, name_realm)', () => {
  it('returning archived character: unarchives and refreshes trial/join_date', async () => {
    await withTxn(async (q, asOfficer) => {
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date, archived_at)
         values (1, $1, 1, false, '2025-01-01', now()) returning id`,
        [APPROVED_NAME]
      );
      const oldId = old.rows[0].id;

      const res = await promote(asOfficer, APPROVED_SIGNUP);
      expect(res.rows[0].player_id).toBe(oldId);

      const player = (await q('select *, join_date::text as join_date_text from public.players where id = $1', [oldId]))
        .rows[0];
      expect(player.archived_at).toBeNull();
      expect(player.is_trial).toBe(true);
      expect(player.join_date_text).not.toBe('2025-01-01');
    });
  });

  it('already-active member: links without resetting trial or join_date', async () => {
    await withTxn(async (q, asOfficer) => {
      const active = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date)
         values (1, $1, 1, false, '2025-01-01') returning id`,
        [APPROVED_NAME]
      );
      const activeId = active.rows[0].id;

      const res = await promote(asOfficer, APPROVED_SIGNUP);
      expect(res.rows[0].player_id).toBe(activeId);

      const player = (
        await q('select *, join_date::text as join_date_text from public.players where id = $1', [activeId])
      ).rows[0];
      expect(player.is_trial).toBe(false);
      expect(player.join_date_text).toBe('2025-01-01');
      expect(player.archived_at).toBeNull();

      const signup = (await q('select approved_player_id from public.season_signups where id = $1', [APPROVED_SIGNUP]))
        .rows[0];
      expect(signup.approved_player_id).toBe(activeId);
    });
  });
});

describe('main swap archiving', () => {
  it('archives the old character on the same team', async () => {
    await withTxn(async (q, asOfficer) => {
      await promote(asOfficer, APPROVED_SIGNUP, true, 2);
      const old = (await q('select archived_at from public.players where id = 2')).rows[0];
      expect(old.archived_at).not.toBeNull();
    });
  });

  it("cannot archive another team's player", async () => {
    await withTxn(async (q, asOfficer) => {
      await promote(asOfficer, APPROVED_SIGNUP, true, 3);
      const other = (await q('select archived_at from public.players where id = 3')).rows[0];
      expect(other.archived_at).toBeNull();
    });
  });

  it("carries the old character's join_date to the new one instead of resetting to today", async () => {
    await withTxn(async (q, asOfficer) => {
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;

      const res = await promote(asOfficer, APPROVED_SIGNUP, true, oldId);
      const newId = res.rows[0].player_id;

      const newPlayer = (await q('select join_date::text as join_date_text from public.players where id = $1', [newId]))
        .rows[0];
      expect(newPlayer.join_date_text).toBe('2024-03-15');
    });
  });

  it("swap onto a reactivated same-name-realm alt still carries the swapped-from join_date, not the alt's own pre-archive date", async () => {
    // The on-conflict reactivation path (see 'returning archived character'
    // above) already refreshes join_date to today on its own, discarding
    // whatever the alt's own original date was -- so there's no "restore the
    // alt's own history" behavior to preserve here. The swap-carry logic then
    // overwrites that today's-date with the swapped-from character's date,
    // same as the plain-insert case, keeping "main swap = continuation of
    // tenure" true even when the destination happens to be a known alt.
    await withTxn(async (q, asOfficer) => {
      const old = await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date)
         values (1, 'Oldmain2-Illidan', 1, '2024-03-15') returning id`
      );
      const oldId = old.rows[0].id;
      await q(
        `insert into public.players (team_id, name_realm, class_spec_id, join_date, archived_at)
         values (1, $1, 1, '2023-06-01', now())`,
        [APPROVED_NAME]
      );

      const res = await promote(asOfficer, APPROVED_SIGNUP, true, oldId);
      const newId = res.rows[0].player_id;

      const newPlayer = (await q('select join_date::text as join_date_text from public.players where id = $1', [newId]))
        .rows[0];
      expect(newPlayer.join_date_text).toBe('2024-03-15');
    });
  });
});

describe('season_signups_player_only_when_added CHECK', () => {
  it('rejects a player link on a non-added signup', async () => {
    await withTxn(async (q) => {
      // 23514 = check_violation
      await expect(q('update public.season_signups set approved_player_id = 1 where id = 1')).rejects.toMatchObject({
        code: '23514'
      });
    });
  });
});

afterAll(() => pool.end());
