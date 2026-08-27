import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, localAssets, readVersion } from '../../scripts/ci/stamp-version.js';

// GitHub Pages serves every static asset with Cache-Control: max-age=600, so
// for up to 10 minutes after a deploy a browser can run fresh HTML/JS against a
// stale cached CSS/JS (or vice versa) -- the visible styling/layout mismatch in
// #431. Each local stylesheet/script tag carries a ?v=<VERSION> query string so
// a version bump forces a fresh fetch of every asset. VERSION is a runtime JS
// constant (only known after common.js loads), so the query string is hardcoded
// into each static tag rather than injected; this check keeps those ~40 tags in
// sync with js/common.js's VERSION so a bump can't silently leave them stale.
//
// PAGES, the asset pattern and readVersion come from scripts/ci/stamp-version.js,
// which is what does the stamping. They were duplicated here before (#776) and a
// new page had to be registered in two places, either of which failing open.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('asset cache-busting version tags (#431)', () => {
  const version = readVersion(ROOT);

  for (const page of PAGES) {
    it(`every local css/js asset in ${page} is tagged ?v=${version}`, () => {
      const html = readFileSync(join(ROOT, page), 'utf8');
      const assets = localAssets(html);
      // Guard against the pattern silently matching nothing (e.g. a markup
      // change) and the check passing vacuously.
      expect(assets.length).toBeGreaterThan(0);
      const untagged = assets.filter((href) => !href.endsWith(`?v=${version}`));
      expect(untagged).toEqual([]);
    });
  }
});
