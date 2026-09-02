// stamp-version.js
// Rewrites the VERSION constant and every ?v= cache-bust asset tag in one pass.
//
// GitHub Pages serves every static asset with Cache-Control: max-age=600, so a
// deploy can run fresh HTML against stale cached JS/CSS unless each local tag
// carries ?v=<VERSION> (#431). VERSION is a runtime JS constant, so those query
// strings are hardcoded into the markup rather than injected -- which means a
// version bump is a mechanical sweep over four files and ~40 tags, and missing
// one leaves a dead cache-bust that nothing notices until a user sees the
// mismatch. tests/ci/asset-version-check.test.js catches it, but only after the
// fact; this is the sweep itself.
//
// PAGES lives here rather than in that test so the registry cannot drift: the
// check imports it from this file, so a new page is registered once.
//
// No external dependencies, matching the other scripts/ci/ tools.
//
// Usage: node scripts/ci/stamp-version.js <x.y.z>

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The HTML entry points GitHub Pages serves. Adding a page here registers it
// with the stamper AND with tests/ci/asset-version-check.test.js, which imports
// this list. Both halves of that contract move together on purpose.
export const PAGES = ['index.html', 'officer.html', 'admin.html', 'guild.html', 'boe.html'];

// Local (relative) css/ and js/ assets only. External URLs -- Google Fonts and
// the jsDelivr supabase-js CDN -- are versioned or pinned upstream and are
// deliberately left untagged, so the pattern only matches paths beginning css/
// or js/, never https://... Built fresh per call: a shared /g regex carries
// lastIndex between .replace() and .matchAll() and would skip matches.
function localAssetPattern() {
  return /(?:href|src)="((?:css|js)\/[^"]*)"/g;
}

const VERSION_PATTERN = /var VERSION = '([^']+)';/;

export function isValidVersion(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
}

/** Every local css/js asset path in a page, query string included. */
export function localAssets(html) {
  return [...html.matchAll(localAssetPattern())].map((m) => m[1]);
}

export function readVersion(root = ROOT) {
  const common = readFileSync(join(root, 'js', 'common.js'), 'utf8');
  const match = common.match(VERSION_PATTERN);
  if (!match) throw new Error('Could not find the VERSION constant in js/common.js');
  return match[1];
}

export function stampCommonJs(source, version) {
  if (!VERSION_PATTERN.test(source)) {
    throw new Error('Could not find the VERSION constant to replace');
  }
  // Function replacement, not a string: a '$' in the replacement text is a
  // substitution token to String.replace and would be eaten silently.
  return source.replace(VERSION_PATTERN, () => `var VERSION = '${version}';`);
}

export function stampHtml(html, version) {
  let count = 0;
  const stamped = html.replace(localAssetPattern(), (whole, path) => {
    count += 1;
    const attr = whole.slice(0, whole.indexOf('='));
    return `${attr}="${path.split('?')[0]}?v=${version}"`;
  });
  // A page that matched nothing is a markup change or a wrong path, not a page
  // with no assets. Reporting "stamped 0 tags" would read as success.
  if (count === 0) throw new Error('Found no local css/ or js/ asset tags to stamp');
  return { html: stamped, count };
}

/**
 * Stamps js/common.js and every page. Reads and rewrites everything in memory
 * first, so a failure on the last page cannot leave the first ones rewritten.
 */
export function stampAll({ root = ROOT, version, pages = PAGES } = {}) {
  if (!isValidVersion(version)) {
    throw new Error(`Version must look like x.y.z, got: ${version}`);
  }

  const commonPath = join(root, 'js', 'common.js');
  const commonSource = readFileSync(commonPath, 'utf8');
  const previous = commonSource.match(VERSION_PATTERN)[1];

  const writes = [{ path: commonPath, text: stampCommonJs(commonSource, version) }];
  const counts = [];

  for (const page of pages) {
    const pagePath = join(root, page);
    const { html, count } = stampHtml(readFileSync(pagePath, 'utf8'), version);
    writes.push({ path: pagePath, text: html });
    counts.push({ page, count });
  }

  for (const { path, text } of writes) {
    writeFileSync(path, text, 'utf8');
  }

  return { version, previous, pages: counts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/ci/stamp-version.js <x.y.z>');
    process.exit(2);
  }
  try {
    const result = stampAll({ version });
    console.log(`${result.previous} -> ${result.version}`);
    console.log('js/common.js: VERSION');
    for (const { page, count } of result.pages) {
      console.log(`${page}: ${count} asset tags`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
