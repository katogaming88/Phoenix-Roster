import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// clearMyWishlist() lets a raider reset their whole wishlist in one action
// instead of removing every gear-slot tag and Other Sources pick one at a
// time. Same "confirm(), then a direct delete, then update local state and
// re-render" shape as removeOwnStreamer() (js/streamers.js). Same
// load-common.js-then-wishlist.js sandbox pattern as
// tests/frontend/wishlist-insert.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox({ confirmResult = true } = {}) {
  const deletes = [];
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    confirm: () => confirmResult,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots: {}, itemPlaceholders: {}, itemIds: {}, wishlistOpen: true };
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPrefs = [
    { id: 1, item_id: 42, status: 'bis', slot: null },
    { id: 2, item_id: 900, status: 'good', slot: 'Neck' }
  ];
  // clearMyWishlist() calls renderProfile() on success -- stubbed out since
  // it needs DOM/roster globals this minimal sandbox doesn't set up and
  // isn't what's under test here.
  sandbox.renderProfile = function () {};

  sandbox.supabaseClient = {
    from(table) {
      const call = { table, eq: [] };
      const builder = {
        delete() {
          call.op = 'delete';
          return builder;
        },
        eq(col, val) {
          call.eq.push([col, val]);
          return builder;
        },
        then(onFulfilled, onRejected) {
          deletes.push(call);
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        }
      };
      return builder;
    }
  };
  return { sandbox, deletes };
}

describe('clearMyWishlist', () => {
  it('deletes every item_preferences row for the player, with no item_id/slot filter', async () => {
    const { sandbox, deletes } = makeSandbox();
    sandbox.clearMyWishlist('Kat');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe('item_preferences');
    expect(deletes[0].op).toBe('delete');
    expect(deletes[0].eq).toEqual([['player_id', 11]]);
    expect(sandbox._wishlistPrefs).toEqual([]);
  });

  it('does nothing when the confirm prompt is declined', () => {
    const { sandbox, deletes } = makeSandbox({ confirmResult: false });
    sandbox.clearMyWishlist('Kat');
    expect(deletes).toHaveLength(0);
    expect(sandbox._wishlistPrefs).toHaveLength(2);
  });

  it('does nothing when wishlist editing is closed', () => {
    const { sandbox, deletes } = makeSandbox();
    sandbox.DATA.wishlistOpen = false;
    sandbox.clearMyWishlist('Kat');
    expect(deletes).toHaveLength(0);
  });

  it('does nothing when there is nothing to clear', () => {
    const { sandbox, deletes } = makeSandbox();
    sandbox._wishlistPrefs = [];
    sandbox.clearMyWishlist('Kat');
    expect(deletes).toHaveLength(0);
  });
});
