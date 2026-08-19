import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { makeRows, keysetSource } from './helpers/supabase-mock.js';

// fetchAllPaged (#694): the shared helper every team-wide read pages through.
//
// PostgREST caps a response at max-rows (1000 here) and returns the truncated
// page as HTTP 200 with error: null, so a short read is indistinguishable from
// a complete one at the call site. Three hand-rolled loops existed before this
// helper and they disagreed on empty-result handling, timeout handling, and
// how they advanced -- these tests are the executable spec for the one answer.
//
// The sandbox loader and the keyset mock both live in ./helpers (#695): the
// mock encodes the server behavior being tested, so a second copy of it is a
// second chance to get that spec wrong somewhere nothing would fail.

describe('fetchAllPaged (#694)', () => {
  it('returns every row when the result spans several pages', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const rows = makeRows(2402);
    const { makeQuery, calls } = keysetSource(rows);

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(out).not.toBeNull();
    expect(out.length).toBe(2402);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    // First page asks with no cursor; later pages carry the last id seen.
    expect(calls[0].afterId).toBeNull();
    expect(calls[1].afterId).toBe(1000);
    expect(calls[2].afterId).toBe(2000);
  });

  it('passes the caller a null cursor on the first page only', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const { makeQuery, calls } = keysetSource(makeRows(1500));

    await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(calls.filter((c) => c.afterId === null).length).toBe(1);
  });

  it('terminates without requesting a page past the end on an exact multiple', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const { makeQuery, calls } = keysetSource(makeRows(2000));

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(out.length).toBe(2000);
    // The exact count bounds the loop, so the third (empty) request the old
    // hand-rolled loops all made never happens.
    expect(calls.length).toBe(2);
  });

  it('keeps going when a page comes back short but rows remain', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const rows = makeRows(2500);
    // Second request returns only 900 of its 1000 rows. Short-page-means-done
    // would stop here and silently drop the tail.
    const { makeQuery } = keysetSource(rows, {
      pageOverride: (n, slice) => (n === 2 ? slice.slice(0, 900) : slice)
    });

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(out.length).toBe(2500);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('stops on an empty page when no count was supplied', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const { makeQuery, calls } = keysetSource(makeRows(2000), { withCount: false });

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(out.length).toBe(2000);
    expect(calls.length).toBe(3);
  });

  it('returns an empty array for a genuinely empty result', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const { makeQuery } = keysetSource([]);

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    // Empty is not failure: callers distinguish [] from null to decide
    // whether a cache stays retryable.
    expect(out).toEqual([]);
  });

  it('returns null on a query error, never the rows it already had', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const rows = makeRows(2500);
    let n = 0;
    const makeQuery = (afterId, limit) => {
      n += 1;
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'boom' }, count: null });
      const slice = rows.filter((r) => afterId === null || r.id > afterId).slice(0, limit);
      return Promise.resolve({ data: slice, error: null, count: afterId === null ? rows.length : null });
    };

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    // Returning the first 1000 rows here would be silent truncation with
    // extra steps, which is the whole bug class this helper exists to remove.
    expect(out).toBeNull();
  });

  it('returns null when a rejected query throws', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const makeQuery = () => Promise.reject(new Error('network down'));

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000 });

    expect(out).toBeNull();
  });

  it('times out per page and returns null rather than a partial result', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const rows = makeRows(2500);
    let n = 0;
    const makeQuery = (afterId, limit) => {
      n += 1;
      // Second page never settles.
      if (n === 2) return new Promise(() => {});
      const slice = rows.filter((r) => afterId === null || r.id > afterId).slice(0, limit);
      return Promise.resolve({ data: slice, error: null, count: afterId === null ? rows.length : null });
    };

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000, timeoutMs: 20 });

    expect(out).toBeNull();
  });

  it('gives each page its own timeout budget rather than one across the loop', async () => {
    const sandbox = loadCommonJs(quietConsole);
    const rows = makeRows(3000);
    // Every page takes half of a single page's budget, and three of them take
    // more than one whole budget. Under one overall budget this run would be
    // cut short partway, which is truncation by another name; per-page, it
    // completes. The two numbers are far enough apart that scheduler jitter
    // under a loaded suite cannot push one page past its own budget, which it
    // could when these were 30ms against 60ms.
    const makeQuery = (afterId, limit) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const slice = rows.filter((r) => afterId === null || r.id > afterId).slice(0, limit);
          resolve({ data: slice, error: null, count: afterId === null ? rows.length : null });
        }, 100);
      });

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000, timeoutMs: 200 });

    expect(out).not.toBeNull();
    expect(out.length).toBe(3000);
  });

  it('gives up rather than looping forever if the cursor stops advancing', async () => {
    const sandbox = loadCommonJs(quietConsole);
    // Pathological source: always returns the same full page, so the cursor
    // never moves and the count is never satisfied.
    const makeQuery = (afterId) =>
      Promise.resolve({
        data: makeRows(1000),
        error: null,
        count: afterId === null ? 100000 : null
      });

    const out = await sandbox.fetchAllPaged(makeQuery, { pageSize: 1000, maxPages: 5 });

    expect(out).toBeNull();
  });
});
