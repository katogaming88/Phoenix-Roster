// Behavior tests for set_own_rsvp() and raid_rsvps' RLS (#893, part of
// #640): a raider's self-service override for one raid night. Mirrors
// own-signup.test.js's withTxn shape -- fixture writes as postgres (bypasses
// RLS), the call happens as the impersonated caller, assertions happen back
// as postgres, everything rolled back at the end.
import { describe, it, expect } from 'vitest';
import { pool, RAIDER_T1, OFFICER_T1, OFFICER_T2 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint rsvp_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint rsvp_call');
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

// Links RAIDER_T1's existing team_members row (id 3, seed.sql) to a
// team-1 players row so is_own_player()/set_own_rsvp() can resolve it.
// isBench toggles public.players.is_bench on that same row.
async function linkRaiderT1ToPlayer(q, { isBench = false } = {}) {
  await q('update public.players set team_member_id = 3, is_bench = $1 where id = 1', [isBench]);
}

// No raid_schedule/raid_schedule_exceptions rows are seeded for team 1, so
// every date is non-optional by default -- these tests only need an
// exception row when they actually want an optional night (#895).
async function markOptionalNight(q, teamId, raidDate) {
  await q(
    "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type, start_time, is_optional) values ($1, $2, 'added', '20:00', true)",
    [teamId, raidDate]
  );
}

const setOwn = (asUser, uid, teamId, raidDate, status, note = null) =>
  asUser(uid, 'select * from public.set_own_rsvp($1, $2, $3, $4)', [teamId, raidDate, status, note]);

describe('set_own_rsvp()', () => {
  it("inserts a new RSVP for the caller's own linked player", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late', 'traffic');
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].player_id).toBe(1);
      expect(rows[0].status).toBe('Late');
      expect(rows[0].note).toBe('traffic');
    });
  });

  it('upserts on a second call for the same team/player/date', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Tentative');
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Absent', 'sick');
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('Absent');
      expect(rows[0].note).toBe('sick');
    });
  });

  it('a null status clears an existing override back to the default', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late');
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', null);
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(0);
    });
  });

  it('rejects a caller with no active roster character on that team', async () => {
    await withTxn(async ({ asUser }) => {
      // RAIDER_T1's team_members row is never linked to a players row here.
      await expect(setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late')).rejects.toThrow(/No active roster character/);
    });
  });

  it('rejects a benched player on a normal (non-optional) night', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q, { isBench: true });
      await expect(setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late')).rejects.toThrow(/Bench players/);
    });
  });

  it('rejects a status outside the five raider-facing options', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await expect(setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Sick')).rejects.toThrow(/Invalid RSVP status/);
    });
  });

  it('rejects an archived player as having no active roster character', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await q('update public.players set archived_at = now() where id = 1');
      await expect(setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late')).rejects.toThrow(/No active roster character/);
    });
  });

  it("rejects 'Attending' on a normal (non-optional) night", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await expect(setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Attending')).rejects.toThrow(
        /Attending is only valid on an optional raid night/
      );
    });
  });

  it("accepts 'Attending' on an optional night (#895)", async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await markOptionalNight(q, 1, '2026-09-10');
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Attending');
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('Attending');
    });
  });

  it('accepts a benched player on an optional night (#895)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q, { isBench: true });
      await markOptionalNight(q, 1, '2026-09-10');
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Attending');
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('Attending');
    });
  });

  it('a benched player can also set a non-Attending status on an optional night', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q, { isBench: true });
      await markOptionalNight(q, 1, '2026-09-10');
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Tentative');
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and raid_date = $1', ['2026-09-10']))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('Tentative');
    });
  });
});

describe('is_optional_raid_night()', () => {
  it('is false for a date with no matching schedule or exception row', async () => {
    await withTxn(async ({ q }) => {
      const res = await q('select public.is_optional_raid_night(1, $1) as result', ['2026-09-10']);
      expect(res.rows[0].result).toBe(false);
    });
  });

  it("is true for a date with an 'added' exception flagged is_optional", async () => {
    await withTxn(async ({ q }) => {
      await markOptionalNight(q, 1, '2026-09-10');
      const res = await q('select public.is_optional_raid_night(1, $1) as result', ['2026-09-10']);
      expect(res.rows[0].result).toBe(true);
    });
  });

  it("a 'cancelled' exception wins over an active recurring rule for the same date", async () => {
    await withTxn(async ({ q }) => {
      // Thursday = weekday 4.
      await q(
        "insert into public.raid_schedule (team_id, weekday, start_time, is_optional) values (1, 4, '20:00', true)"
      );
      await q(
        "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type) values (1, '2026-09-10', 'cancelled')"
      );
      const res = await q('select public.is_optional_raid_night(1, $1) as result', ['2026-09-10']);
      expect(res.rows[0].result).toBe(false);
    });
  });
});

describe('raid_rsvps RLS', () => {
  it('the owning raider can read their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late');
      const res = await asUser(RAIDER_T1, 'select * from public.raid_rsvps where team_id = 1');
      expect(res.rows).toHaveLength(1);
    });
  });

  it('an officer on the same team can read every row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late');
      const res = await asUser(OFFICER_T1, 'select * from public.raid_rsvps where team_id = 1');
      expect(res.rows).toHaveLength(1);
    });
  });

  it('an officer on a different team cannot read it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await setOwn(asUser, RAIDER_T1, 1, '2026-09-10', 'Late');
      const res = await asUser(OFFICER_T2, 'select * from public.raid_rsvps where team_id = 1');
      expect(res.rows).toHaveLength(0);
    });
  });

  it('has no direct INSERT policy -- even an officer cannot write around set_own_rsvp()', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linkRaiderT1ToPlayer(q);
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.raid_rsvps (team_id, player_id, raid_date, status) values (1, 1, '2026-09-10', 'Absent')"
        )
      ).rejects.toThrow();
    });
  });
});
