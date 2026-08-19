import { describe, it, expect } from 'vitest';
import { findUnguardedTeamWideReads, checkFiles, listJsFiles } from '../../scripts/ci/team-wide-read-check.js';

// The guard behind the #694 defect class: a team-wide read that does not page
// silently truncates at PostgREST's 1000-row cap and returns the short page as
// an ordinary 200.

const lines = (findings) => findings.map((f) => f.line);

describe('findUnguardedTeamWideReads', () => {
  it('flags a team-wide select that does not page', () => {
    const src = `
      supabaseClient
        .from('attendance')
        .select('player_id, status')
        .eq('team_id', teamId)
        .then(handle);
    `;
    const found = findUnguardedTeamWideReads(src);
    expect(found).toHaveLength(1);
    expect(found[0].table).toBe('attendance');
  });

  it('passes a read built as a fetchAllPaged makeQuery callback', () => {
    const src = `
      fetchAllPaged(function (afterId, limit) {
        var q = supabaseClient
          .from('attendance')
          .select('id, status', afterId === null ? { count: 'exact' } : undefined)
          .eq('team_id', teamId)
          .order('id', { ascending: true })
          .limit(limit);
        return afterId === null ? q : q.gt('id', afterId);
      }, { label: 'attendance' });
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('ignores writes, which have no rows to truncate', () => {
    const src = `
      supabaseClient.from('attendance').update({ status: 'Present' }).eq('team_id', teamId).then(handle);
      supabaseClient.from('attendance').delete().eq('team_id', teamId).then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('passes a single-row read', () => {
    const src = `
      supabaseClient.from('team_settings').select('config').eq('team_id', teamId).maybeSingle().then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('passes a head-only count, which returns no rows at all', () => {
    const src = `
      supabaseClient
        .from('season_signups')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('status', 'pending')
        .then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('passes a read narrowed to one player', () => {
    const src = `
      supabaseClient
        .from('attendance')
        .select('raid_date, status')
        .eq('team_id', teamId)
        .eq('player_id', player.id)
        .then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('passes a read bounded by a literal limit, but not by the helper page size', () => {
    const bounded = `
      supabaseClient.from('audit_log').select('id').eq('team_id', teamId).limit(50).then(handle);
    `;
    expect(findUnguardedTeamWideReads(bounded)).toEqual([]);

    const notBounded = `
      supabaseClient.from('audit_log').select('id').eq('team_id', teamId).limit(pageSize).then(handle);
    `;
    expect(findUnguardedTeamWideReads(notBounded)).toHaveLength(1);
  });

  it('passes a read that declares why it cannot exceed the cap', () => {
    const src = `
      // team-read-guard: one row per roster member.
      supabaseClient.from('players').select('id').eq('team_id', teamId).then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('does not let one annotation cover a second read further down', () => {
    const src = `
      // team-read-guard: one row per roster member.
      supabaseClient.from('players').select('id').eq('team_id', teamId).then(handle);
      var a = 1;
      var b = 2;
      var c = 3;
      var d = 4;
      supabaseClient.from('attendance').select('id').eq('team_id', teamId).then(handle);
    `;
    expect(findUnguardedTeamWideReads(src)).toHaveLength(1);
  });

  it('ignores the same call shape written inside a comment or a string', () => {
    const src = `
      // supabaseClient.from('attendance').select('id').eq('team_id', teamId)
      var doc = "supabaseClient.from('attendance').select('id').eq('team_id', teamId)";
    `;
    expect(findUnguardedTeamWideReads(src)).toEqual([]);
  });

  it('reports each unguarded read once, not once per method in its chain', () => {
    const src = `
      supabaseClient.from('attendance').select('id').eq('team_id', teamId).order('id').then(handle);
    `;
    expect(lines(findUnguardedTeamWideReads(src))).toHaveLength(1);
  });

  it('reports every unguarded read in a file, in line order', () => {
    const src = `
      supabaseClient.from('attendance').select('id').eq('team_id', teamId).then(handle);
      supabaseClient.from('audit_log').select('id').eq('team_id', teamId).then(handle);
    `;
    const found = findUnguardedTeamWideReads(src);
    expect(found.map((f) => f.table)).toEqual(['attendance', 'audit_log']);
    expect(found[0].line).toBeLessThan(found[1].line);
  });

  it('names the file it could not parse rather than failing opaquely', () => {
    expect(() => findUnguardedTeamWideReads('function (', 'broken.js')).toThrow(/broken\.js/);
  });
});

describe('the repo itself', () => {
  // The point of the guard. If this fails, a team-wide read landed without
  // paging or without saying why it does not need to.
  it('has no unguarded team-wide reads in js/', () => {
    const findings = checkFiles(listJsFiles('js'));
    expect(findings.map((f) => f.file + ':' + f.line + ' ' + f.table)).toEqual([]);
  });
});
