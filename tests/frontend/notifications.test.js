import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #151: in-app notification bell. Loads the real common.js (notifyPlayer/
// fetchOwnNotifications/markNotificationsRead/renderNotifBell/
// toggleNotifDropdown/renderNotifDropdown/_esc), same vm-sandbox pattern as
// tests/frontend/streamers-supabase.test.js. renderDiscordNav() (js/discord.js)
// is the real caller of renderNotifBell() but isn't loaded here -- these tests
// call renderNotifBell() directly, which is exactly the seam discord.js calls
// through.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '' }, extra);
}

// Chainable stand-in for the supabase-js query builder used by
// fetchOwnNotifications (select/order/limit/then), markNotificationsRead
// (update/in/then), and notifyPlayer (rpc/then).
function makeSupabase({ selectResult, updateResult, rpcResult } = {}) {
  const calls = { selects: [], updates: [], rpcs: [] };
  function selectBuilder(record) {
    const b = {
      order(col, opts) {
        record.order = [col, opts];
        return b;
      },
      limit(n) {
        record.limit = n;
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => selectResult ?? { data: [], error: null })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  function updateBuilder(record) {
    const b = {
      in(col, vals) {
        record.in = [col, vals];
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => updateResult ?? { data: null, error: null })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  const client = {
    from(table) {
      return {
        select(cols) {
          const record = { table, select: cols };
          calls.selects.push(record);
          return selectBuilder(record);
        },
        update(payload) {
          const record = { table, payload };
          calls.updates.push(record);
          return updateBuilder(record);
        }
      };
    },
    rpc(fn, args) {
      const record = { fn, args };
      calls.rpcs.push(record);
      return Promise.resolve(rpcResult ?? { data: 1, error: null });
    }
  };
  return { calls, client };
}

function loadSandbox({ supabaseClient, els = {} } = {}) {
  const allEls = { ...els };
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    console,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  sandbox.supabaseClient = supabaseClient;
  return { sandbox, els: allEls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('notifyPlayer', () => {
  it('calls notify_player with the right args', async () => {
    const { calls, client } = makeSupabase({});
    const { sandbox } = loadSandbox({ supabaseClient: client });
    await sandbox.notifyPlayer(7, 'Your BiS list link was approved.');
    expect(calls.rpcs).toEqual([
      { fn: 'notify_player', args: { p_player_id: 7, p_message: 'Your BiS list link was approved.' } }
    ]);
  });

  it('is a no-op when playerId is null (approve/reject sites guard on player existing first)', async () => {
    const { calls, client } = makeSupabase({});
    const { sandbox } = loadSandbox({ supabaseClient: client });
    await sandbox.notifyPlayer(null, 'test');
    expect(calls.rpcs).toHaveLength(0);
  });

  it('warns but does not throw on an RPC error', async () => {
    const { client } = makeSupabase({ rpcResult: { data: null, error: { message: 'Not authorized' } } });
    const { sandbox } = loadSandbox({ supabaseClient: client });
    const warnSpy = vi.spyOn(sandbox.console, 'warn').mockImplementation(() => {});
    await expect(sandbox.notifyPlayer(7, 'test')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('fetchOwnNotifications', () => {
  it('returns the rows from a successful select', async () => {
    const rows = [{ id: 1, message: 'a', read: false, created_at: '2026-07-01T00:00:00Z' }];
    const { calls, client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox } = loadSandbox({ supabaseClient: client });
    const result = await sandbox.fetchOwnNotifications();
    expect(result).toEqual(rows);
    expect(calls.selects[0].table).toBe('notifications');
  });

  it('returns an empty array on error rather than throwing', async () => {
    const { client } = makeSupabase({ selectResult: { data: null, error: { message: 'boom' } } });
    const { sandbox } = loadSandbox({ supabaseClient: client });
    const result = await sandbox.fetchOwnNotifications();
    expect(result).toEqual([]);
  });
});

describe('markNotificationsRead', () => {
  it('updates read=true for the given ids', async () => {
    const { calls, client } = makeSupabase({});
    const { sandbox } = loadSandbox({ supabaseClient: client });
    await sandbox.markNotificationsRead([1, 2, 3]);
    expect(calls.updates[0].payload).toEqual({ read: true });
    expect(calls.updates[0].in).toEqual(['id', [1, 2, 3]]);
  });

  it('is a no-op for an empty id list', async () => {
    const { calls, client } = makeSupabase({});
    const { sandbox } = loadSandbox({ supabaseClient: client });
    await sandbox.markNotificationsRead([]);
    expect(calls.updates).toHaveLength(0);
  });
});

describe('renderNotifBell', () => {
  it('hides the bell and closes the dropdown when there is no session', () => {
    const { sandbox, els } = loadSandbox({ supabaseClient: makeSupabase({}).client });
    els.navBell = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: {} });
    sandbox.renderNotifBell(null);
    expect(els.navBell.style.display).toBe('none');
    expect(els.notifDropdown.style.display).toBe('none');
  });

  it('hides the bell for a session with no linked character (nameRealm)', () => {
    const { sandbox, els } = loadSandbox({ supabaseClient: makeSupabase({}).client });
    els.navBell = makeEl({ style: {} });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: null });
    expect(els.navBell.style.display).toBe('none');
  });

  it('shows the bell and sets the badge for a linked session with unread notifications', async () => {
    const rows = [
      { id: 1, message: 'a', read: false, created_at: '2026-07-01T00:00:00Z' },
      { id: 2, message: 'b', read: true, created_at: '2026-07-01T00:00:00Z' }
    ];
    const { client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();
    expect(els.navBell.style.display).toBe('');
    expect(els.navBellBadge.textContent).toBe(1);
    expect(els.navBellBadge.style.display).toBe('');
  });

  it('hides the badge when there are no unread notifications', async () => {
    const rows = [{ id: 1, message: 'a', read: true, created_at: '2026-07-01T00:00:00Z' }];
    const { client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();
    expect(els.navBellBadge.style.display).toBe('none');
  });
});

describe('toggleNotifDropdown', () => {
  it('opens the dropdown, renders rows, and marks unread ones read', async () => {
    const rows = [
      { id: 5, message: 'Your BiS list link was approved.', read: false, created_at: '2026-07-01T00:00:00Z' }
    ];
    const { calls, client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: { display: 'none' } });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();

    sandbox.toggleNotifDropdown();
    expect(els.notifDropdown.style.display).toBe('');
    expect(els.notifDropdown.innerHTML).toContain('Your BiS list link was approved.');
    await flush();
    expect(calls.updates[0].in).toEqual(['id', [5]]);
  });

  it('closes an already-open dropdown on a second call', async () => {
    const { client } = makeSupabase({ selectResult: { data: [], error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: { display: 'none' } });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();

    sandbox.toggleNotifDropdown();
    expect(els.notifDropdown.style.display).toBe('');
    sandbox.toggleNotifDropdown();
    expect(els.notifDropdown.style.display).toBe('none');
  });

  it('shows an empty-state message when there are no notifications', async () => {
    const { client } = makeSupabase({ selectResult: { data: [], error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: { display: 'none' } });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();

    sandbox.toggleNotifDropdown();
    expect(els.notifDropdown.innerHTML).toContain('No notifications yet.');
  });

  it('HTML-escapes a notification message (defense in depth, even though messages are officer-authored)', async () => {
    const rows = [{ id: 1, message: '<img src=x onerror=alert(1)>', read: false, created_at: '2026-07-01T00:00:00Z' }];
    const { client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: { display: 'none' } });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();

    sandbox.toggleNotifDropdown();
    expect(els.notifDropdown.innerHTML).not.toContain('<img');
    expect(els.notifDropdown.innerHTML).toContain('&lt;img');
  });
});

// The dropdown says which zone its times are in, and each time is the
// viewer's local date and time without seconds (#905).
describe('notification times (#905)', () => {
  it('renders the zone note and a local time with no seconds', async () => {
    const rows = [
      { id: 7, message: 'Your BiS list link was approved.', read: false, created_at: '2026-09-04T03:30:00Z' }
    ];
    const { client } = makeSupabase({ selectResult: { data: rows, error: null } });
    const { sandbox, els } = loadSandbox({ supabaseClient: client });
    els.navBell = makeEl({ style: {} });
    els.navBellBadge = makeEl({ style: {} });
    els.notifDropdown = makeEl({ style: { display: 'none' } });
    sandbox.renderNotifBell({ username: 'kato', nameRealm: 'Kato-Illidan' });
    await flush();
    sandbox.toggleNotifDropdown();

    const html = els.notifDropdown.innerHTML;
    expect(html).toContain('class="tz-note"');
    expect(html).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const time = (html.match(/<div class="notif-time">([^<]*)<\/div>/) || [])[1];
    expect(time).toMatch(/\d{1,2}:\d{2}/);
    expect(time).not.toMatch(/\d:\d{2}:\d{2}/);
  });
});
