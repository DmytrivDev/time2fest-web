// Локальний перегляд зібраного передстартового сайту: node scripts/prelaunch/serve.mjs [тека] [--port 4310]
// Статика як на краї: `/шлях/` → `index.html`, невідома адреса → найближчий `404.html` угору по дереву (код 404).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { root } from './routes.mjs';

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : 4310;
const dir = path.resolve(
  root,
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') ?? 'out-prelaunch',
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.ics': 'text/calendar',
};

const fileFor = (pathname) => {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const full = path.join(dir, safe);
  if (!full.startsWith(dir)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  const index = path.join(full, 'index.html');
  return fs.existsSync(index) ? index : null;
};

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    let file = fileFor(pathname);
    let status = 200;
    if (!file) {
      status = 404;
      let at = path.join(dir, pathname);
      while (at.startsWith(dir)) {
        const candidate = path.join(at, '404.html');
        if (fs.existsSync(candidate)) {
          file = candidate;
          break;
        }
        const up = path.dirname(at);
        if (up === at) break;
        at = up;
      }
    }
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    // Відео й фото не змінюються між збірками — кеш, як у `_headers` збірки (`/media/*`), щоб петля ролика не
    // качала файл наново.
    const cache = pathname.startsWith('/media/') ? 'public, max-age=86400' : 'no-store';
    // Відео: браузери (особливо Safari й телефони) просять частинами — віддаємо діапазон, як край.
    const range = status === 200 ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '') : null;
    if (range) {
      const size = fs.statSync(file).size;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cache,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(status, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`serve:prelaunch: ${dir} → http://127.0.0.1:${port}`),
  );
