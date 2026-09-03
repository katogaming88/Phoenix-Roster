import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// #905: every instant a page shows a person is the viewer's local date and
// time, and every surface that shows one says which zone. Both helpers live
// in js/common.js, so this loads the real file. Eastern is the project's
// canonical zone (the frontend job pins TZ=America/New_York); the assertions
// read the process's own zone and locale, so they hold under that pin and on
// any developer machine alike, and nothing here asserts a locale.

const sandbox = loadCommonJs(quietConsole);

// 11:30 pm Eastern on Sep 3: a date-only render in a zone ahead of Eastern
// would show Sep 4, and a viewer could not tell.
const ISO = '2026-09-04T03:30:00Z';

describe('formatDateTime (#905)', () => {
  it('renders the instant as the local date with its clock', () => {
    const out = sandbox.formatDateTime(ISO);
    const d = new Date(ISO);
    expect(out).not.toBe(d.toLocaleDateString());
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    expect(out).toMatch(new RegExp('\\b' + d.getDate() + '\\b'));
  });

  it('carries no seconds', () => {
    expect(sandbox.formatDateTime(ISO)).not.toMatch(/\d:\d{2}:\d{2}/);
  });

  it('is blank for null, empty, undefined and unparseable input', () => {
    expect(sandbox.formatDateTime(null)).toBe('');
    expect(sandbox.formatDateTime('')).toBe('');
    expect(sandbox.formatDateTime(undefined)).toBe('');
    expect(sandbox.formatDateTime('garbage')).toBe('');
  });
});

describe('localTimeZoneNote (#905)', () => {
  it('is a visible note naming the viewer zone', () => {
    const html = sandbox.localTimeZoneNote();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(html).toMatch(/^<p class="tz-note">/);
    expect(html).toContain('Times are shown in your time zone');
    expect(html).toContain(zone);
  });

  it('carries the short zone name beside the IANA name', () => {
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName').value;
    expect(sandbox.localTimeZoneNote()).toContain(short);
  });
});
