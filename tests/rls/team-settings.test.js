// set_team_setting/archive_current_season/unarchive_season (#221, Phase 6) --
// season config moved off Script Properties onto team_settings.config. All
// three are SECURITY INVOKER, so the "Team leaders write settings" RLS
// policy is the only gate: a team-1 officer (not team_leader) can call the
// function, but the underlying UPDATE touches 0 rows, same shape as the
// existing direct-update assertions in write-policies.test.js.
//
// Several scenarios need setup as one role (e.g. team leader seeding a
// season) followed by an assertion as another role (e.g. an officer trying
// to archive it) within the SAME transaction, since writes never commit
// across separate pool connections here -- withActors() runs a whole
// scenario on one connection/transaction, switching `request.jwt.claims`
// and `role` between statements, then rolls back at the end.
import { describe, it, expect } from 'vitest';
import { pool, queryAs, TEAM_LEADER_T1, OFFICER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

async function withActors(fn) {
  const client = await pool.connect();
  const as = async (role, uid) => {
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
  };
  try {
    await client.query('begin');
    return await fn(client, as);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('set_team_setting', () => {
  const sql = `select public.set_team_setting(1, '{"seasonName":"Test Season"}'::jsonb) as config`;

  it('team 1 team leader merges the update into config', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rows[0].config.seasonName).toBe('Test Season');
  });

  it('site admin merges the update into config', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rows[0].config.seasonName).toBe('Test Season');
  });

  it('team 1 officer gets a Not authorized error (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', OFFICER_T1);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('raider gets a Not authorized error', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', RAIDER_T1);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('team 2 officer cannot affect team 1 settings', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', OFFICER_T2);
      await expect(client.query(sql)).rejects.toThrow(/not authorized/i);
    });
  });

  it('anon cannot execute the function at all', async () => {
    await expect(queryAs('anon', null, sql)).rejects.toThrow(/permission denied/i);
  });
});

describe('archive_current_season', () => {
  const archiveSql = `select public.archive_current_season(1, '[{"nameRealm":"Test-Realm","role":"Melee"}]'::jsonb) as config`;

  it('moves the active season into seasonHistory and clears the active fields', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(
        `select public.set_team_setting(1, '{"seasonName":"Archive Me","seasonStart":"2026-01-01","raidProgression":[{"name":"Test Raid"}]}'::jsonb)`
      );
      const res = await client.query(archiveSql);
      const config = res.rows[0].config;
      expect(config.seasonName).toBe('');
      expect(config.raidProgression).toEqual([]);
      expect(config.seasonHistory).toHaveLength(1);
      expect(config.seasonHistory[0]).toMatchObject({
        name: 'Archive Me',
        start: '2026-01-01',
        raids: [{ name: 'Test Raid' }],
        roster: [{ nameRealm: 'Test-Realm', role: 'Melee' }]
      });
    });
  });

  it('raises when there is no active season name to archive', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":""}'::jsonb)`);
      await expect(client.query(archiveSql)).rejects.toThrow(/no active season/i);
    });
  });

  it('team 1 officer cannot archive (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":"Archive Me"}'::jsonb)`);
      await as('authenticated', OFFICER_T1);
      await expect(client.query(archiveSql)).rejects.toThrow(/not authorized/i);
    });
  });

  // #498: a new tier is almost always a different loot table, so bis_items
  // rows are dead weight once archived -- snapshot everything (placeholders
  // included) into history, then wipe the whole table for the active roster.
  // Placeholders (M+/Crafted/Catalyst "Other Sources" tags) are wiped too,
  // not just real items (20260806210047) -- every BiS list/wishlist is
  // per-season, and what a raider wants from M+ or has crafted can change
  // slot/target entirely next tier, so there's no reason to carry those
  // forward either. M+ exclusion means "doesn't need gear right now," which
  // a new tier invalidates, so it resets for the whole active roster too.
  // Bench resets the same way; trial status is deliberately left alone
  // (still a Trial Promotions call). A submitted BiS link is cleared
  // unconditionally too (20260731135713) -- it's effectively per-tier
  // regardless of which site it points to.
  it('snapshots bis_items (placeholders included) into history, wipes all of it plus BiS link, and resets m+ exclusion and bench', async () => {
    await withActors(async (client, as) => {
      // items has no authenticated write policy (read-only shared catalog) --
      // seed as the unrestricted connection before dropping to a PostgREST role.
      await client.query(
        `insert into public.items (id, wow_item_id, name, slot, armor_type, is_placeholder) values
           (900, null, 'M+', 'Placeholder', null, true)`
      );
      await client.query(
        `insert into public.bis_items (id, player_id, item_id, obtained, slot) values
           (900, 1, 900, true, 'ring1')`
      );
      await client.query(
        `update public.players set m_plus_excluded = true, m_plus_note = 'needs a break', is_bench = true, is_trial = true, bis_link = 'https://example.com/old-sim' where id = 1`
      );

      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":"Archive Me 2"}'::jsonb)`);
      const res = await client.query(archiveSql);
      const config = res.rows[0].config;
      const entry = config.seasonHistory[config.seasonHistory.length - 1];

      expect(entry.bis).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nameRealm: 'Seedraider-Illidan',
            item: 'Seed Test Staff',
            obtained: false,
            isPlaceholder: false
          }),
          expect.objectContaining({
            nameRealm: 'Seedraider-Illidan',
            item: 'M+',
            obtained: true,
            isPlaceholder: true
          })
        ])
      );

      // Both the real item (seed row, item 1) and the placeholder (item 900) are gone.
      const remaining = await client.query(`select item_id from public.bis_items where player_id = 1 order by item_id`);
      expect(remaining.rows.map((r) => r.item_id)).toEqual([]);

      const player = await client.query(
        `select m_plus_excluded, m_plus_note, is_bench, is_trial, bis_link from public.players where id = 1`
      );
      expect(player.rows[0]).toEqual({
        m_plus_excluded: false,
        m_plus_note: null,
        is_bench: false,
        is_trial: true,
        bis_link: null
      });
    });
  });

  it('does not touch bis_items, m+ exclusion, bench, or bis_link for a different team', async () => {
    await withActors(async (client, as) => {
      await client.query(
        `insert into public.items (id, wow_item_id, name, slot, armor_type, is_placeholder) values
           (901, null, 'Seed Team 2 Item', 'Head', null, false)`
      );
      await client.query(`insert into public.bis_items (id, player_id, item_id, obtained) values (901, 3, 901, false)`);
      await client.query(
        `update public.players set m_plus_excluded = true, is_bench = true, bis_link = 'https://example.com/team2-sim' where id = 3`
      );

      await as('authenticated', TEAM_LEADER_T1);
      await client.query(`select public.set_team_setting(1, '{"seasonName":"Archive Me 3"}'::jsonb)`);
      await client.query(archiveSql);

      const remaining = await client.query(`select item_id from public.bis_items where player_id = 3`);
      expect(remaining.rows.map((r) => r.item_id)).toEqual([901]);

      const player = await client.query(`select m_plus_excluded, is_bench, bis_link from public.players where id = 3`);
      expect(player.rows[0]).toEqual({
        m_plus_excluded: true,
        is_bench: true,
        bis_link: 'https://example.com/team2-sim'
      });
    });
  });
});

describe('unarchive_season', () => {
  async function seedHistory(client) {
    await client.query(
      `select public.set_team_setting(1, '{"seasonName":"","seasonHistory":[{"name":"Old Season","start":"2025-01-01","end":"2025-06-01","raids":[],"roster":[]}]}'::jsonb)`
    );
  }

  it('restores the season at the given index and removes it from history', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      const res = await client.query('select public.unarchive_season(1, 0) as result');
      const result = res.rows[0].result;
      expect(result.season.name).toBe('Old Season');
      expect(result.config.seasonName).toBe('Old Season');
      expect(result.config.seasonHistory).toEqual([]);
    });
  });

  it('raises on an out-of-range index', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      await expect(client.query('select public.unarchive_season(1, 5) as result')).rejects.toThrow(
        /invalid season index/i
      );
    });
  });

  it('team 1 officer cannot unarchive (RLS blocks the underlying update)', async () => {
    await withActors(async (client, as) => {
      await as('authenticated', TEAM_LEADER_T1);
      await seedHistory(client);
      await as('authenticated', OFFICER_T1);
      await expect(client.query('select public.unarchive_season(1, 0) as result')).rejects.toThrow(/not authorized/i);
    });
  });
});
