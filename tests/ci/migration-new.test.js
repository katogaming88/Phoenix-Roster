import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { easternStamp } from '../../scripts/ci/migration-new.js';

// The filename prefix is a sort key shared between two machines, so it has to
// come from one clock. CONTRIBUTING has asked for the Eastern wall clock since
// #761; what was missing was a tool that produces it, which is why 30 of the
// repo's 161 migrations sort below one that was added before them (#927).

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ci', 'migration-new.js');

function run(args, cwd) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (err) {
    return { status: err.status, output: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'migration-new-'));
}

describe('easternStamp', () => {
  it('converts a UTC instant to the Eastern wall clock, which is what the filename records', () => {
    // The same instant a `supabase migration new` run would stamp 20260903195833.
    expect(easternStamp('2026-09-03T19:58:33Z')).toBe('20260903155833');
  });

  it('uses EST in January rather than a fixed four-hour offset', () => {
    expect(easternStamp('2026-01-15T14:00:00Z')).toBe('20260115090000');
  });

  it('walks the date back when Eastern is still on the previous day', () => {
    expect(easternStamp('2026-07-04T03:30:00Z')).toBe('20260703233000');
  });

  it('takes a Date as well as an ISO string', () => {
    expect(easternStamp(new Date('2026-09-03T19:58:33Z'))).toBe('20260903155833');
  });
});

describe('CLI', () => {
  it('creates <stamp>_<slug>.sql stamped with the current Eastern clock', () => {
    const dir = tempDir();
    try {
      const before = easternStamp(new Date());
      const result = run(['boe_upgrade_rank', '--dir', dir]);
      const after = easternStamp(new Date());

      expect(result.status).toBe(0);
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{14}_boe_upgrade_rank\.sql$/);

      // The acceptance criterion is "matches the Eastern system clock to the
      // second", so the stamp is bracketed by two readings of that clock
      // rather than compared to a fixed value.
      const stamp = files[0].slice(0, 14);
      expect(stamp >= before).toBe(true);
      expect(stamp <= after).toBe(true);
      expect(result.output).toContain(files[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the header skeleton and a trailing newline', () => {
    const dir = tempDir();
    try {
      run(['items_icon', '--dir', dir]);
      const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
      expect(text.startsWith('-- #NNN: ')).toBe(true);
      expect(text).toContain('\n--\n');
      expect(text.endsWith('\n')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a slug outside [a-z0-9_] and writes nothing', () => {
    const dir = tempDir();
    try {
      const result = run(['Bad-Slug', '--dir', dir]);
      expect(result.status).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
      expect(result.output).toContain('Bad-Slug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an empty slug', () => {
    const dir = tempDir();
    try {
      const result = run(['', '--dir', dir]);
      expect(result.status).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a stamp at or below an existing file, names it, and writes nothing', () => {
    // The real case this guards: a UTC-stamped file already landed, so every
    // Eastern stamp for the next four hours sorts below it.
    const dir = tempDir();
    try {
      writeFileSync(join(dir, '20990101000000_from_the_future.sql'), '-- test\n');
      const result = run(['later_change', '--dir', dir]);
      expect(result.status).toBe(1);
      expect(readdirSync(dir)).toEqual(['20990101000000_from_the_future.sql']);
      expect(result.output).toContain('20990101000000_from_the_future.sql');
      expect(result.output).toContain('2099-01-01');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-stamps a file with --rename, keeping its slug and its body', () => {
    const dir = tempDir();
    try {
      const original = join(dir, '20260101000000_keep_this_slug.sql');
      writeFileSync(original, '-- body kept verbatim\n');
      const result = run(['--rename', original]);

      expect(result.status).toBe(0);
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{14}_keep_this_slug\.sql$/);
      expect(files[0]).not.toBe('20260101000000_keep_this_slug.sql');
      expect(readFileSync(join(dir, files[0]), 'utf8')).toBe('-- body kept verbatim\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --rename when another file already sorts at or above the new stamp', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, '20990101000000_from_the_future.sql'), '-- test\n');
      const original = join(dir, '20260101000000_keep_this_slug.sql');
      writeFileSync(original, '-- body\n');
      const result = run(['--rename', original]);
      expect(result.status).toBe(1);
      expect(readdirSync(dir).sort()).toEqual([
        '20260101000000_keep_this_slug.sql',
        '20990101000000_from_the_future.sql'
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --rename on a path that does not exist', () => {
    const dir = tempDir();
    try {
      const result = run(['--rename', join(dir, '20260101000000_nope.sql')]);
      expect(result.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 with usage when given no slug and no --rename', () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.output).toContain('migration:new');
  });
});
