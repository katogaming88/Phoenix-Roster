// raid_rsvp_reminders_sent (#895, part of #640, Phase 4): pure dedup log for
// the optional-night 24h/2h DM reminder sweep, written only by the
// optional-rsvp-reminders Edge Function via the service role. RLS is
// enabled with no read policy for anyone -- not even an officer or site
// admin, unlike most other tables -- so this just asserts every ordinary
// caller sees zero rows, same shape as write-policies.test.js's denial
// checks but for SELECT (RLS makes a non-matching SELECT return empty
// rather than error, since base table grants already exist per #284).
import { describe, it, expect, afterEach } from 'vitest';
import { pool, countAs, RAIDER_T1, OFFICER_T1, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

async function seedReminderRow() {
  await pool.query(
    "insert into public.raid_rsvp_reminders_sent (team_id, player_id, raid_date, checkpoint) values (1, 1, '2026-09-10', '24h') on conflict do nothing"
  );
}

afterEach(async () => {
  await pool.query("delete from public.raid_rsvp_reminders_sent where team_id = 1 and raid_date = '2026-09-10'");
});

describe('raid_rsvp_reminders_sent RLS', () => {
  it('a raider sees zero rows', async () => {
    await seedReminderRow();
    const n = await countAs('authenticated', RAIDER_T1, 'raid_rsvp_reminders_sent', 'team_id = 1');
    expect(n).toBe(0);
  });

  it('an officer on the same team sees zero rows', async () => {
    await seedReminderRow();
    const n = await countAs('authenticated', OFFICER_T1, 'raid_rsvp_reminders_sent', 'team_id = 1');
    expect(n).toBe(0);
  });

  it('a site admin sees zero rows', async () => {
    await seedReminderRow();
    const n = await countAs('authenticated', SITE_ADMIN, 'raid_rsvp_reminders_sent', 'team_id = 1');
    expect(n).toBe(0);
  });

  it('a guild officer sees zero rows', async () => {
    await seedReminderRow();
    const n = await countAs('authenticated', GUILD_OFFICER, 'raid_rsvp_reminders_sent', 'team_id = 1');
    expect(n).toBe(0);
  });

  it('an anonymous caller sees zero rows', async () => {
    await seedReminderRow();
    const n = await countAs('anon', null, 'raid_rsvp_reminders_sent', 'team_id = 1');
    expect(n).toBe(0);
  });
});
