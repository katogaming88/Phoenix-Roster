import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { versionsFromFilenames, parseLedger, compareLedger } from '../../scripts/ci/migration-ledger-check.js';

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
