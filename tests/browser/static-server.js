import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';

// A file server for the browser suite, matching the house style of the
// scripts/ci/ tools: node built-ins only, no dependency. The pages have to be
// served over http rather than opened as file:// URLs, because js/common.js
// reads location.search for ?team=, sessionStorage is origin-scoped, and the
// supabase-js client refuses a null origin.

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Resolves a request path to an absolute file path inside root, or null when
 * it escapes. The decode happens before the resolve on purpose: a traversal
 * only survives fetch()'s own URL normalisation if it is percent-encoded, so
 * checking the raw path would look clean and still hand out /etc/passwd.
 */
function resolveInsideRoot(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const rootAbs = resolve(root);
  const full = resolve(join(rootAbs, decoded));
  if (full !== rootAbs && !full.startsWith(rootAbs + sep)) return null;
  return full;
}

/**
 * @param {string} root directory to serve
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startServer(root) {
  const server = createServer(async (req, res) => {
    // Split rather than `new URL`: only the path matters, and index.html
    // always arrives with a ?team= query the file system knows nothing about.
    let path = (req.url || '/').split('?')[0].split('#')[0];
    if (path === '/' || path === '') path = '/index.html';

    const full = resolveInsideRoot(root, path);
    if (!full) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = await stat(full);
      // No directory listing and no implicit index below the root: an
      // unresolvable path should look missing, not partially served.
      if (!info.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const body = await readFile(full);
      res.writeHead(200, {
        'content-type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        // The suite reloads the same URLs many times in one run.
        'cache-control': 'no-store'
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    // Port 0 lets the OS pick: a fixed port collides with a dev server or with
    // a second vitest worker running the same file.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveStart({
        port: typeof address === 'object' && address ? address.port : 0,
        close: () =>
          new Promise((done, fail) => {
            // closeAllConnections first: keep-alive sockets from fetch() hold
            // close() open past the test's afterAll otherwise.
            server.closeAllConnections();
            server.close((err) => (err ? fail(err) : done()));
          })
      });
    });
  });
}
