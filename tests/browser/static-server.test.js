import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startServer } from './static-server.js';

// The browser suite needs the site served over http rather than file://, so
// that relative asset paths, the URL query string index.html reads for
// ?team=, and same-origin sessionStorage all behave the way they do on GitHub
// Pages. This is that server, and these are its own tests: it is ordinary node
// code, so it does not need a browser to be checked.

let root;
let server;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wga-static-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>root page</title>');
  await writeFile(join(root, 'news.json'), '{"items":[]}');
  await mkdir(join(root, 'css'), { recursive: true });
  await writeFile(join(root, 'css', 'styles.css'), 'body{color:red}');
  await mkdir(join(root, 'js'), { recursive: true });
  await writeFile(join(root, 'js', 'common.js'), 'var VERSION = "0.0.0";');
  await writeFile(join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(root, 'pixel.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(root, 'secret.txt'), 'not served');
  server = await startServer(root);
});

afterAll(async () => {
  if (server) await server.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const get = (path) => fetch('http://127.0.0.1:' + server.port + path);

// Sends the path exactly as written, with no URL normalisation in between.
const rawGet = (path) =>
  new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.port, path }, (res) => {
      res.resume();
      done({ status: res.statusCode });
    });
    req.on('error', fail);
    req.end();
  });

describe('static-server', () => {
  it('picks a free port rather than a fixed one', () => {
    // Fixed ports collide with whatever else is listening on a dev machine,
    // and with a second vitest worker running the same suite.
    expect(server.port).toBeGreaterThan(0);
  });

  it.each([
    ['/index.html', 'text/html', 'root page'],
    ['/css/styles.css', 'text/css', 'color:red'],
    ['/js/common.js', 'text/javascript', 'VERSION'],
    ['/news.json', 'application/json', 'items'],
    ['/icon.svg', 'image/svg+xml', 'svg']
  ])('serves %s with the right content type', async (path, type, body) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(type);
    expect(await res.text()).toContain(body);
  });

  it('serves a binary file without mangling it', async () => {
    // Read as a buffer, not utf8: a png read as text comes back replacement
    // characters and the byte comparison below is the only thing that notices.
    const res = await get('/pixel.png');
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe(true);
  });

  it('ignores the query string when resolving a path', async () => {
    // index.html reads ?team= (js/common.js), so every page state in the
    // browser suite arrives with one attached.
    const res = await get('/index.html?team=phoenix');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('root page');
  });

  it('serves index.html for the root path', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('root page');
  });

  it('404s a path that does not exist', async () => {
    const res = await get('/nope.html');
    expect(res.status).toBe(404);
  });

  it('404s a directory rather than listing it', async () => {
    const res = await get('/css');
    expect(res.status).toBe(404);
  });

  it('refuses a path that escapes the root', async () => {
    // Sent over raw http, not fetch(): the WHATWG URL parser decodes %2e to a
    // dot and removes the dot segments, so fetch() would turn this into a
    // plain /etc/passwd and the request would never test the server's guard.
    const res = await rawGet('/%2e%2e/%2e%2e/etc/passwd');
    expect(res.status).toBe(403);
  });

  it('refuses an absolute path smuggled in as a segment', async () => {
    const res = await get('/..%2fsecret.txt');
    expect(res.status).toBe(403);
  });

  it('stops listening after close()', async () => {
    const other = await startServer(root);
    await other.close();
    await expect(fetch('http://127.0.0.1:' + other.port + '/index.html')).rejects.toThrow();
  });
});
