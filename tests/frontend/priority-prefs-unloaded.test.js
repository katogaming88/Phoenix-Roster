import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { offsetClient, failingClient } from './helpers/supabase-mock.js';

// A failed team-wide item_preferences fetch must not read as an empty one
// (#707 item 2).
//
// The four call sites that populate the cache all did `_teamItemPreferences =
// rows || []`, and fetchTeamItemPreferences returns null on error. So one
// failed request turned into a confident empty array for the rest of the
// session: every raider "incomplete", the notes tab empty, the stat card 0/N,
// and no retry, because the null that triggers the fetch was gone.
//
// wishlistCompletionForPlayer's own comment already says callers should skip
// the badge rather than show a false 0/0. `|| []` is what defeated it. Same
// shape as the attendance fix in #705: keep unknown distinct from zero all the
// way to the render.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSandbox({ client, roster = [], itemSlots = {}, itemIds = {} } = {}) {
  const elements = {};
  const el = () => ({ innerHTML: '' });
  ['wishlistIncompleteBanner', 'priorityNotesContent', 'priorityContent', 'priorityNotesBadge'].forEach((id) => {
    elements[id] = el();
  });
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: { getElementById: (id) => elements[id] || null },
    DATA: { itemSlots, itemIds, roster },
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    featureEnabled: () => true,
    escHtml: (s) => String(s),
    BIS_SLOTS: ['Head'],
    BIS_CATALOG_SLOT_TO_ROWS: { Head: ['Head'] },
    getBisItems: () => [],
    bisSlotBuckets: () => ({ buckets: {} }),
    bisEligibleRealItemsBySlot: () => ({ Head: [{ itemId: 1, rankName: 'Helm' }] }),
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  return { sandbox, elements };
}

const ROSTER = [
  { id: 11, firstName: 'Kat', nameRealm: 'Kat-Illidan' },
  { id: 12, firstName: 'Rex', nameRealm: 'Rex-Illidan' }
];

describe('a failed team item_preferences fetch is not an empty one (#707)', () => {
  it('leaves the cache unloaded rather than empty, so the stat card keeps showing "-"', async () => {
    // tab-roster.js's Wishlists Completed card and its onboarding signal both
    // key off _teamItemPreferences === null meaning "not loaded".
    const { client } = failingClient();
    const { sandbox } = makeSandbox({ client, roster: ROSTER });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(sandbox._teamItemPreferences).toBeNull();
  });

  it('does not report every raider as having an incomplete wishlist', async () => {
    const { client } = failingClient();
    const { sandbox } = makeSandbox({ client, roster: ROSTER });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(sandbox.getIncompleteWishlists().count).toBe(0);
  });

  it('keeps the per-player completion badge suppressed rather than showing a false 0/0', async () => {
    const { client } = failingClient();
    const { sandbox } = makeSandbox({ client, roster: ROSTER });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(sandbox.wishlistCompletionForPlayer(ROSTER[0])).toBeNull();
  });

  it('says the wishlists could not be loaded instead of rendering nothing', async () => {
    const { client } = failingClient();
    const { sandbox, elements } = makeSandbox({ client, roster: ROSTER });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(elements.wishlistIncompleteBanner.innerHTML).toMatch(/could ?n[o']t|couldn.t|failed|unavailable/i);
  });

  it('does not refetch on every subsequent render after a failure', async () => {
    const { client, calls } = failingClient();
    const { sandbox } = makeSandbox({ client, roster: ROSTER });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();
    const afterFirst = calls.reads;

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(calls.reads).toBe(afterFirst);
  });

  it('the notes tab reports the failure instead of "no notes"', async () => {
    const { client } = failingClient();
    const { sandbox, elements } = makeSandbox({ client, roster: ROSTER });

    sandbox.buildPriorityNotesTab();
    await flush();
    await flush();

    expect(elements.priorityNotesContent.innerHTML).toMatch(/could ?n[o']t|couldn.t|failed|unavailable/i);
  });

  it('a genuinely empty table still renders the normal zero state, not an error', async () => {
    const { client } = offsetClient([]);
    const { sandbox, elements } = makeSandbox({ client, roster: [] });

    sandbox.renderWishlistIncompleteBanner();
    await flush();
    await flush();

    expect(sandbox._teamItemPreferences).toEqual([]);
    expect(elements.wishlistIncompleteBanner.innerHTML).toBe('');
  });
});
