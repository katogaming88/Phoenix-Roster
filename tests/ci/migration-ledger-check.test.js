import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  versionsFromFilenames,
  parseLedger,
  compareLedger,
  outOfOrder,
  aheadOfWallClock,
  addedAt
} from '../../scripts/ci/migration-ledger-check.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ci', 'migration-ledger-check.js');

describe('versionsFromFilenames', () => {
  it('extracts the leading 14-digit version from migration filenames', () => {
    expect(
      versionsFromFilenames(['20260825225243_boe_tracker.sql', '20260831174200_blizzard_gear_sync_cron.sql'])
    ).toEqual(['20260825225243', '20260831174200']);
  });

  it('ignores files that are not timestamped .sql migrations', () => {
    expect(versionsFromFilenames(['.gitkeep', 'README.md', '20260825225243_boe_tracker.sql', 'notes.sql'])).toEqual([
      '20260825225243'
    ]);
  });
});

describe('parseLedger', () => {
  it('reads one version per line, ignoring blanks and surrounding whitespace', () => {
    expect(parseLedger(' 20260704204411 \n\n20260704205433\n')).toEqual(['20260704204411', '20260704205433']);
  });
});

describe('compareLedger', () => {
  it('reports no drift when both sides hold the same versions', () => {
    const both = ['20260704204411', '20260704205433'];
    expect(compareLedger(both, both)).toEqual({ localOnly: [], remoteOnly: [] });
  });

  it('names every local-only version (committed but never recorded as applied)', () => {
    const result = compareLedger(['20260704204411', '20260827144514', '20260828011851'], ['20260704204411']);
    expect(result.localOnly).toEqual(['20260827144514', '20260828011851']);
    expect(result.remoteOnly).toEqual([]);
  });

  it('names every remote-only version (recorded on prod but missing from the repo)', () => {
    const result = compareLedger(['20260704204411'], ['20260704204411', '20260812045902']);
    expect(result.localOnly).toEqual([]);
    expect(result.remoteOnly).toEqual(['20260812045902']);
  });

  it('reports both directions at once', () => {
    const result = compareLedger(['20260704204411', '20260827144514'], ['20260704204411', '20260812045902']);
    expect(result.localOnly).toEqual(['20260827144514']);
    expect(result.remoteOnly).toEqual(['20260812045902']);
  });

  it('treats an empty ledger as every local version drifting', () => {
    const result = compareLedger(['20260704204411', '20260704205433'], []);
    expect(result.localOnly).toEqual(['20260704204411', '20260704205433']);
    expect(result.remoteOnly).toEqual([]);
  });

  it('is order-independent and reports each direction sorted', () => {
    const result = compareLedger(
      ['20260828011851', '20260704204411', '20260827144514'],
      ['20260812045902', '20260704204411', '20260801032445']
    );
    expect(result.localOnly).toEqual(['20260827144514', '20260828011851']);
    expect(result.remoteOnly).toEqual(['20260801032445', '20260812045902']);
  });
});

describe('CLI', () => {
  function makeMigrationsDir(versions) {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-check-'));
    for (const v of versions) {
      writeFileSync(join(dir, `${v}_test_migration.sql`), '-- test\n');
    }
    return dir;
  }

  function run(dir, stdin) {
    try {
      const stdout = execFileSync('node', [SCRIPT, dir], { input: stdin, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (err) {
      return { status: err.status, stdout: err.stdout };
    }
  }

  it('exits 0 and reports the count when ledger and files agree', () => {
    const dir = makeMigrationsDir(['20260704204411', '20260704205433']);
    try {
      const result = run(dir, '20260704204411\n20260704205433\n');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('2 versions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and names the drifting versions in both directions', () => {
    const dir = makeMigrationsDir(['20260704204411', '20260827144514']);
    try {
      const result = run(dir, '20260704204411\n20260812045902\n');
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('20260827144514');
      expect(result.stdout).toContain('20260812045902');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when the migrations directory does not exist', () => {
    const result = run(join(tmpdir(), 'ledger-check-no-such-dir'), '');
    expect(result.status).toBe(2);
  });
});

// The two rules added by #927. Order: a pending file may not sort below the
// newest version already applied on prod, because `supabase db push` refuses
// the whole run when one does. Clock: a file added in this event may not carry
// a stamp ahead of the Eastern wall clock at the commit that added it, which
// catches a `supabase migration new` UTC stamp and a hand-typed round number
// with the same test.

describe('outOfOrder', () => {
  it('returns nothing when every pending version sorts above the newest applied', () => {
    expect(outOfOrder(['20260905120000'], ['20260904193807'])).toEqual([]);
  });

  it('names a pending version that sorts below the newest applied', () => {
    // The 2026-08-26 incident: an Eastern stamp written two hours after a UTC
    // one had already reached prod.
    expect(outOfOrder(['20260826011447'], ['20260826030444'])).toEqual(['20260826011447']);
  });

  it('returns every offender, sorted', () => {
    expect(outOfOrder(['20260903163853', '20260903155522', '20260905120000'], ['20260903184500'])).toEqual([
      '20260903155522',
      '20260903163853'
    ]);
  });

  it('treats a pending version equal to the newest applied as in order', () => {
    expect(outOfOrder(['20260904193807'], ['20260904193807'])).toEqual([]);
  });

  it('returns nothing when the ledger is empty, since there is nothing to sort below', () => {
    expect(outOfOrder(['20260704204411'], [])).toEqual([]);
  });

  it('reads the newest applied version without assuming the ledger arrives sorted', () => {
    expect(outOfOrder(['20260826011447'], ['20260826030444', '20260704204411'])).toEqual(['20260826011447']);
  });

  it('never judges a version the ledger already holds', () => {
    // compareLedger runs first, so an applied file is not in the input at all.
    const { localOnly } = compareLedger(['20260826011447', '20260826030444'], ['20260826030444']);
    expect(outOfOrder(localOnly, ['20260826030444'])).toEqual(['20260826011447']);
  });
});

describe('aheadOfWallClock', () => {
  it('passes a stamp four minutes ahead, inside the default skew', () => {
    expect(aheadOfWallClock('20260903120400', '2026-09-03T12:00:00-04:00')).toBe(false);
  });

  it('fails a stamp six minutes ahead', () => {
    expect(aheadOfWallClock('20260903120600', '2026-09-03T12:00:00-04:00')).toBe(true);
  });

  it('passes a stamp equal to the wall clock at its commit', () => {
    expect(aheadOfWallClock('20260903120000', '2026-09-03T12:00:00-04:00')).toBe(false);
  });

  it('passes a stamp hours behind, which is only a file that waited in a branch', () => {
    expect(aheadOfWallClock('20260903080000', '2026-09-03T12:00:00-04:00')).toBe(false);
  });

  it('fails the 2026-09-03 UTC stamp against the Eastern clock at its commit', () => {
    expect(aheadOfWallClock('20260903053022', '2026-09-03T01:59:06-04:00')).toBe(true);
  });

  it('passes the Eastern stamp written the same afternoon', () => {
    expect(aheadOfWallClock('20260903155522', '2026-09-03T16:35:20-04:00')).toBe(false);
  });

  it('fails a hand-typed round stamp two weeks ahead of its commit', () => {
    expect(aheadOfWallClock('20260726100000', '2026-07-11T15:20:00-04:00')).toBe(true);
  });

  it('converts a January anchor as EST, so the UTC form of the same instant fails', () => {
    expect(aheadOfWallClock('20260115090000', '2026-01-15T14:00:00Z')).toBe(false);
    expect(aheadOfWallClock('20260115140000', '2026-01-15T14:00:00Z')).toBe(true);
  });

  it('honours a wider skew when one is given', () => {
    expect(aheadOfWallClock('20260903121000', '2026-09-03T12:00:00-04:00', 15)).toBe(false);
  });
});

describe('addedAt', () => {
  it('takes the oldest commit touching the path, which is the last line git prints', () => {
    const lines = '2026-09-03T18:00:00-04:00\n2026-09-03T01:59:06-04:00\n';
    expect(addedAt('supabase/migrations/x.sql', () => lines)).toBe('2026-09-03T01:59:06-04:00');
  });

  it('returns null for a path git knows nothing about, so an uncommitted file is skipped', () => {
    expect(addedAt('x.sql', () => '')).toBe(null);
  });

  it('returns null when git itself fails, so a checkout without history cannot fail the run', () => {
    expect(
      addedAt('x.sql', () => {
        throw new Error('not a git repository');
      })
    ).toBe(null);
  });
});

describe('CLI, order and clock rules', () => {
  // A real git repo rather than an injected anchor: the clock rule's whole
  // point is the commit date it reads, and stubbing that would leave the
  // lookup wiring untested.
  function makeGitRepo(files) {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-clock-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    // Windows checkouts default to autocrlf=true, which prints a warning per
    // added file and buries the run's real output.
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir });
    for (const [name, authorDate] of files) {
      writeFileSync(join(dir, name), '-- test\n');
      execFileSync('git', ['add', name], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', name], {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: authorDate }
      });
    }
    return dir;
  }

  function runIn(dir, stdin, extraArgs) {
    try {
      const stdout = execFileSync('node', [SCRIPT, '.', ...extraArgs], { cwd: dir, input: stdin, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (err) {
      return { status: err.status, stdout: err.stdout };
    }
  }

  it('names the rename fix, and the newest applied version, before the push fix', () => {
    // Both halves of the 2026-08-26 incident. The pending file is also
    // local-only, so the existing push message fires too; the rename is the
    // one that actually unblocks it and has to be read first.
    const dir = makeGitRepo([
      ['20260826030444_delete_self_received_request.sql', '2026-08-25T23:04:44-04:00'],
      ['20260826011447_rclc_export_wishlist_status.sql', '2026-08-26T01:14:47-04:00']
    ]);
    try {
      const result = runIn(dir, '20260826030444\n', ['--new', '20260826011447_rclc_export_wishlist_status.sql']);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('20260826030444');
      expect(result.stdout).toContain('20260826011447_rclc_export_wishlist_status.sql');
      expect(result.stdout).toContain('--rename');
      const renameAt = result.stdout.indexOf('Rename:');
      const pushAt = result.stdout.indexOf('Committed but not recorded');
      expect(renameAt).toBeGreaterThanOrEqual(0);
      expect(pushAt).toBeGreaterThan(renameAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a file stamped ahead of the Eastern wall clock at its commit', () => {
    // The ledger agrees here, so the clock rule is the only thing that can
    // fail: a UTC stamp on a file committed at 23:04 Eastern the day before.
    const dir = makeGitRepo([['20260826030444_delete_self_received_request.sql', '2026-08-25T23:04:44-04:00']]);
    try {
      const result = runIn(dir, '20260826030444\n', ['--new', '20260826030444_delete_self_received_request.sql']);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Eastern wall clock');
      expect(result.stdout).toContain('--rename');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a file stamped from the Eastern clock at its commit', () => {
    const dir = makeGitRepo([['20260826011447_rclc_export_wishlist_status.sql', '2026-08-26T01:14:47-04:00']]);
    try {
      const result = runIn(dir, '20260826011447\n', ['--new', '20260826011447_rclc_export_wishlist_status.sql']);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a new file with no commit history once and judges nothing on it', () => {
    const dir = makeGitRepo([['20260826030444_applied.sql', '2026-08-26T03:04:44-04:00']]);
    try {
      writeFileSync(join(dir, '20260827000000_uncommitted.sql'), '-- test\n');
      const result = runIn(dir, '20260826030444\n20260827000000\n', ['--new', '20260827000000_uncommitted.sql']);
      expect(result.status).toBe(0);
      expect(result.stdout.match(/no commit history/g)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the denominator of both rules, so a silent check cannot pass as a green one', () => {
    const dir = makeGitRepo([['20260826011447_rclc_export_wishlist_status.sql', '2026-08-26T01:14:47-04:00']]);
    try {
      const result = runIn(dir, '20260826011447\n', ['--new', '20260826011447_rclc_export_wishlist_status.sql']);
      expect(result.stdout).toMatch(/checked 0 pending for order, 1 new for clock/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports agreement when no new files are passed at all', () => {
    const dir = makeGitRepo([['20260826011447_rclc_export_wishlist_status.sql', '2026-08-26T01:14:47-04:00']]);
    try {
      const result = runIn(dir, '20260826011447\n', []);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('1 versions');
      expect(result.stdout).toMatch(/checked 0 pending for order, 0 new for clock/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
