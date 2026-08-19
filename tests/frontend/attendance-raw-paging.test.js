import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

// fetchSupabaseAttendanceRaw pages through the shared helper (#707 item 3).
//
// This is the read behind every attendance percentage in the app. It had its
// own OFFSET loop, advancing by page size and stopping on a short page, so a
// row count that is an exact multiple of the page size cost a request past the
// end. It also had no timeout at all, unlike every other fetchSupabaseX():
// the rationale for that was that substituting a stale GAS payload on mere
// slowness would swap correct data for confidently-wrong data. GAS is retired
// (#225) and there is nothing to substitute, and since #705 an unknown
// attendance renders as unknown rather than as zero, so a bounded read that
// fails cleanly is now strictly better than one that can hang forever.

function attendanceRows(total, startId = 1) {
  const rows = [];
  for (let i = 0; i < total; i++) {
    rows.push({
      id: startId + i,
      player_id: (i % 25) + 1,
      raid_date: '2026-01-01',
      status: 'Present',
      report_excluded: false
    });
  }
  return rows;
}

function load(client) {
  const sandbox = loadCommonJs(quietConsole);
  sandbox.supabaseClient = client;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  return sandbox;
}

describe('fetchSupabaseAttendanceRaw (#707)', () => {
  it('collects every row across pages, each exactly once', async () => {
    const { client } = keysetClient(attendanceRows(2400));
    const rows = await load(client).fetchSupabaseAttendanceRaw();
    expect(rows).toHaveLength(2400);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2400);
  });

  it('selects id, which the keyset cursor needs, alongside the mapped columns', async () => {
    const { client, calls } = keysetClient(attendanceRows(5));
    await load(client).fetchSupabaseAttendanceRaw();
    expect(calls.selects[0].select).toContain('id');
    expect(calls.selects[0].select).toContain('player_id');
    expect(calls.selects[0].select).toContain('raid_date');
    expect(calls.selects[0].select).toContain('status');
    expect(calls.selects[0].select).toContain('report_excluded');
  });

  it('asks for an exact count on the first page only', async () => {
    const { client, calls } = keysetClient(attendanceRows(1500));
    await load(client).fetchSupabaseAttendanceRaw();
    expect(calls.selects[0].countRequested).toBe(true);
    expect(calls.selects.slice(1).every((s) => !s.countRequested)).toBe(true);
  });

  it('does not spend a request past the end when the total is an exact multiple of the page size', async () => {
    const { client, calls } = keysetClient(attendanceRows(2000));
    const rows = await load(client).fetchSupabaseAttendanceRaw();
    expect(rows).toHaveLength(2000);
    expect(calls.selects).toHaveLength(2);
  });

  it('orders by id ascending so paging is deterministic', async () => {
    const { client, calls } = keysetClient(attendanceRows(5));
    await load(client).fetchSupabaseAttendanceRaw();
    expect(calls.orders).toContain('id');
  });

  it('resolves an empty array for a team with no attendance yet', async () => {
    const { client } = keysetClient([]);
    await expect(load(client).fetchSupabaseAttendanceRaw()).resolves.toEqual([]);
  });

  it('resolves null on a failed read rather than the rows it managed to collect', async () => {
    const { client } = failingClient('attendance boom');
    await expect(load(client).fetchSupabaseAttendanceRaw()).resolves.toBeNull();
  });

  it('resolves null rather than hanging when a page never comes back', async () => {
    const client = {
      from() {
        const b = {
          select() {
            return b;
          },
          eq() {
            return b;
          },
          order() {
            return b;
          },
          gt() {
            return b;
          },
          limit() {
            return b;
          },
          then() {
            return new Promise(() => {}); // never settles
          }
        };
        return b;
      }
    };
    const sandbox = load(client);
    // Compressed clock: the helper's real per-page budget is 20s, and what is
    // being proved here is that a budget exists at all. With no timer the read
    // never settles however long the test waits.
    sandbox.setTimeout = (fn, ms) => {
      const t = setTimeout(fn, Math.min(ms, 20));
      if (t.unref) t.unref();
      return t;
    };
    const raced = await Promise.race([
      sandbox.fetchSupabaseAttendanceRaw(),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 500))
    ]);
    expect(raced).toBeNull();
  });
});
