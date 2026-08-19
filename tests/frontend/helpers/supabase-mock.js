// Supabase query mocks that encode server-side behavior (#695).
//
// PostgREST caps a response at max-rows (1000 here) and returns the truncated
// page as HTTP 200 with error: null, so a short read is indistinguishable from
// a complete one at the call site. That makes these mocks the executable spec
// for the cap: one whose .limit() or .gt() quietly did nothing would not fail,
// it would pass, against an implementation that truncates in production. They
// live here so that spec has exactly one copy.

// `total` rows with sequential ids, so a test can assert both that every row
// came back and that it came back exactly once.
export function makeRows(total, startId = 1) {
  const rows = [];
  for (let i = 0; i < total; i++) rows.push({ id: startId + i, v: 'row' + (startId + i) });
  return rows;
}

// A makeQuery stand-in for fetchAllPaged, serving a fixed row set with real
// keyset semantics: rows with id > afterId, capped at `limit`. A mock that
// ignored afterId and returned everything would let an unpaginated
// implementation pass, which is the one property this cannot afford to lose.
//
// pageOverride(callNumber, slice) rewrites a page, for the cases where the
// server's answer has to disagree with the row set (short page, empty page).
export function keysetSource(rows, { withCount = true, pageOverride = null } = {}) {
  const calls = [];
  function makeQuery(afterId, limit) {
    calls.push({ afterId, limit });
    const slice = rows.filter((r) => afterId === null || r.id > afterId).slice(0, limit);
    const page = pageOverride ? pageOverride(calls.length, slice) : slice;
    return Promise.resolve({
      data: page,
      error: null,
      count: withCount && afterId === null ? rows.length : null
    });
  }
  return { makeQuery, calls };
}

// A supabase client whose builder honours .gt('id', ...) and .limit(), for
// suites that drive a read through the client surface rather than through
// fetchAllPaged's makeQuery callback. Records every select/order/gt/limit so a
// test can assert the shape of the chain the code under test built.
export function keysetClient(rows) {
  const calls = { selects: [], orders: [], gts: [], limits: [] };
  function builder(record) {
    const b = {
      eq() {
        return b;
      },
      gt(col, val) {
        record.gt = [col, val];
        calls.gts.push([col, val]);
        return b;
      },
      order(col, opts) {
        record.order = record.order || [];
        record.order.push([col, !opts || opts.ascending !== false]);
        calls.orders.push(col);
        return b;
      },
      limit(n) {
        record.limit = n;
        calls.limits.push(n);
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            const after = record.gt ? record.gt[1] : null;
            const limit = record.limit || 1000;
            const slice = rows.filter((r) => after === null || r.id > after).slice(0, limit);
            return { data: slice, error: null, count: after === null ? rows.length : null };
          })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  return {
    calls,
    client: {
      from() {
        return {
          select(cols, opts) {
            const record = { select: cols, countRequested: !!(opts && opts.count) };
            calls.selects.push(record);
            return builder(record);
          }
        };
      }
    }
  };
}

// A supabase client whose builder honours OFFSET .range(from, to), for reads
// that still page that way. Records each range window requested.
export function offsetClient(rows) {
  const calls = { ranges: [] };
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
        range(from, to) {
          calls.ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }
      };
      return b;
    }
  };
  return { client, calls };
}
