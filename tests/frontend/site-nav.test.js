import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SITE_NAV_ITEMS is the single source of truth for the top nav on index.html
// and officer.html, and renderSiteNav() is its only consumer -- everything else
// in the codebase reads the rendered element ids. Nothing tested either until
// #779 added a cross-page link to guild.html, which is a third shape alongside
// the showView() button and the index.html#hash link the function already knew.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox({ search = '' } = {}) {
  const mount = { innerHTML: '' };
  const sandbox = {
    window: {},
    location: { search, pathname: '/index.html' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => (id === 'siteNavItems' ? mount : null),
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return { sandbox, mount };
}

// One <a> or <button> per rendered item, in order.
function items(html) {
  return [...html.matchAll(/<(a|button)\s([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    tag: m[1],
    attrs: m[2],
    label: m[3].replace(/<[^>]*>/g, ''),
    id: (m[2].match(/id="([^"]+)"/) || [])[1],
    href: (m[2].match(/href="([^"]+)"/) || [])[1],
    active: /class="[^"]*\bactive\b/.test(m[2])
  }));
}

describe('SITE_NAV_ITEMS', () => {
  it('carries a Guild entry pointing at the page, not a view', () => {
    const { sandbox } = makeSandbox();
    const guild = sandbox.SITE_NAV_ITEMS.find((i) => i.id === 'navGuild');
    expect(guild).toBeDefined();
    expect(guild.href).toBe('guild.html');
    expect(guild.view).toBeUndefined();
  });

  it('puts Guild first, since it is the level above every other item', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.SITE_NAV_ITEMS[0].id).toBe('navGuild');
  });

  it('gives exactly one item an href', () => {
    // The active-default rule below depends on knowing which items are
    // cross-page links, so a second one arriving unnoticed should fail here.
    const { sandbox } = makeSandbox();
    expect(sandbox.SITE_NAV_ITEMS.filter((i) => i.href).length).toBe(1);
  });
});

describe('renderSiteNav, public mode', () => {
  it('renders a cross-page item as a link, not a showView button', () => {
    const { sandbox, mount } = makeSandbox();
    sandbox.renderSiteNav('public');
    const guild = items(mount.innerHTML).find((i) => i.id === 'navGuild');
    expect(guild.tag).toBe('a');
    expect(guild.href).toBe('guild.html');
    expect(guild.attrs).not.toContain('onclick');
  });

  it('still renders every other item as a showView button', () => {
    const { sandbox, mount } = makeSandbox();
    sandbox.renderSiteNav('public');
    const rendered = items(mount.innerHTML);
    expect(rendered.length).toBe(sandbox.SITE_NAV_ITEMS.length);
    rendered
      .filter((i) => i.id !== 'navGuild')
      .forEach((i) => {
        expect(i.tag).toBe('button');
        expect(i.attrs).toContain('onclick');
      });
  });

  it('marks Home active, not the cross-page link', () => {
    // The old rule marked index 0 active. Putting a link there would have made
    // the guild page read as the current view on index.html.
    const { sandbox, mount } = makeSandbox();
    sandbox.renderSiteNav('public');
    const rendered = items(mount.innerHTML);
    const active = rendered.filter((i) => i.active);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('navHome');
  });

  it('keeps the News dot, which rides on the item that has extraHtml', () => {
    const { sandbox, mount } = makeSandbox();
    sandbox.renderSiteNav('public');
    expect(mount.innerHTML).toContain('id="navNewsDot"');
  });
});

describe('renderSiteNav, officer mode', () => {
  it('links to the guild page directly, with no team param', () => {
    // Officer mode bakes ?team= into every index.html link. guild.html has no
    // team, and carrying one there would pin a team it never had.
    const { sandbox, mount } = makeSandbox({ search: '?team=hellfire' });
    sandbox.renderSiteNav('officer');
    const guild = items(mount.innerHTML).find((i) => i.id === 'navGuild');
    expect(guild.href).toBe('guild.html');
  });

  it('still bakes the team into the index.html links beside it', () => {
    const { sandbox, mount } = makeSandbox({ search: '?team=hellfire' });
    sandbox.renderSiteNav('officer');
    const roster = items(mount.innerHTML).find((i) => i.id === 'navRoster');
    expect(roster.href).toBe('index.html?team=hellfire#roster');
  });

  it('marks nothing active, as before', () => {
    const { sandbox, mount } = makeSandbox({ search: '?team=hellfire' });
    sandbox.renderSiteNav('officer');
    expect(items(mount.innerHTML).filter((i) => i.active)).toEqual([]);
  });
});
