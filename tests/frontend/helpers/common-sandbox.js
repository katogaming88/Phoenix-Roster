// Shared vm-sandbox harness for js/common.js (#695).
//
// js/common.js is a plain browser script with no exports, so reaching anything
// it declares means running it in a context with the browser globals stubbed.
// Three suites needed that and had written the context out three times. Each
// copy is an independent chance to stub a global slightly differently, and the
// drift does not fail -- it changes what the code under test sees.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMON_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../js/common.js'),
  'utf8'
);

export const quietConsole = { log: () => {}, warn: () => {}, error: () => {} };

// Runs js/common.js in a fresh context and hands back the sandbox, so its var
// and function declarations are readable as properties. Pass a console
// stand-in to capture what the code under test warns about.
export function loadCommonJs(consoleObj) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console: consoleObj || console,
    Intl,
    // Unref'd so a pending page timer never holds the test process open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

// The shipped fetchAllPaged, for suites whose subject calls it as a global.
// Handing over the real function rather than a stand-in is the point: a copy
// can drift from the helper it stands in for, and the suite would still pass.
export function realFetchAllPaged() {
  const sandbox = loadCommonJs(quietConsole);
  if (typeof sandbox.fetchAllPaged !== 'function') {
    throw new Error('js/common.js does not define fetchAllPaged');
  }
  return sandbox.fetchAllPaged;
}
