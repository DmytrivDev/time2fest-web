// @ts-check
/**
 * Integration static server (SPEC-02 W21): serves <root>/out-int (trailingSlash export layout) on the
 * worktree's web port and proxies /api/* to the worktree's server port. Node built-ins only.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorktree } from './lib/worktree.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const outDir = path.join(rootDir, 'out-int');
const UPSTREAM_TIMEOUT_MS = 10_000;

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const wt = resolveWorktree(here, process.env);
const webPort = wt.ports.web;
const serverPort = wt.ports.server;

/** @param {string} urlPath @returns {string | null} an existing file under out-int, else null */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = path.resolve(outDir);
  const candidates = decoded.endsWith('/') ? [path.join(decoded, 'index.html')] : [decoded, path.join(decoded, 'index.html')];
  for (const c of candidates) {
    const full = path.resolve(base, '.' + path.sep + c);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
function proxy(req, res) {
  const up = http.request(
    { host: '127.0.0.1', port: serverPort, method: req.method, path: req.url, headers: req.headers, timeout: UPSTREAM_TIMEOUT_MS },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  const fail = () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-length': '0' });
    }
    res.end();
  };
  up.on('timeout', () => up.destroy());
  up.on('error', fail);
  req.pipe(up);
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    proxy(req, res);
    return;
  }
  const file = resolveFile(url.pathname);
  if (file) {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const notFound = path.join(outDir, '404.html');
  if (fs.existsSync(notFound)) {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    fs.createReadStream(notFound).pipe(res);
  } else {
    res.writeHead(404, { 'content-type': TYPES['.txt'] });
    res.end('not found');
  }
}

/** @param {number} port */
function probe(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(undefined)));
  });
}

try {
  await probe(webPort);
} catch (e) {
  if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EADDRINUSE') {
    console.error(`port ${webPort} is in use`);
    process.exit(3);
  }
  throw e;
}

const server = http.createServer(handle);
server.listen(webPort, '127.0.0.1', () => {
  console.log(`[serve-int] listening on http://127.0.0.1:${webPort} (api -> ${serverPort})`);
});
for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(sig, () => server.close(() => process.exit(0)));
