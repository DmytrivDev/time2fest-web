// @ts-check
// Проксі приватного доступу до Postgres і Redis основного вузла (O·P18a, `ops private-db open`). Працює в контейнері
// з образу сервера (лише `node:net`, без залежностей) у мережі backend; Docker публікує його порти лише на приватній
// адресі VPC. Приймає з’єднання тільки від однієї адреси (`T2F_PROXY_PEER`, другий вузол); з іншої — закриває одразу,
// до будь-якого з’єднання з базою. Вміст трафіку не читає й не пише в журнал.
import net from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ listen: number, host: string, port: number }} Route
 */

/**
 * Адреса клієнта без префікса IPv4-mapped IPv6 (`::ffff:10.0.0.3` → `10.0.0.3`).
 * @param {string | undefined} a
 */
export function normalizeRemote(a) {
  const s = String(a ?? '');
  return s.toLowerCase().startsWith('::ffff:') ? s.slice(7) : s;
}

/**
 * `5432=postgres:5432,6379=redis:6379` → маршрути.
 * @param {string} spec
 * @returns {Route[]}
 */
export function parseRoutes(spec) {
  const routes = String(spec)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(\d{1,5})=([a-z0-9-]{1,63}):(\d{1,5})$/);
      if (!m) throw new Error(`T2F_PROXY_ROUTES: недопустимий маршрут ${JSON.stringify(p.slice(0, 40))}`);
      return { listen: Number(m[1]), host: m[2], port: Number(m[3]) };
    });
  if (!routes.length) throw new Error('T2F_PROXY_ROUTES: порожньо');
  return routes;
}

/**
 * @param {{ peer: string, routes: Route[], listenHost?: string, log?: (line: string) => void }} o
 */
export function startProxy(o) {
  if (!net.isIPv4(o.peer)) throw new Error('T2F_PROXY_PEER: потрібна IPv4-адреса');
  const log = o.log ?? ((/** @type {string} */ line) => console.log(line));
  const servers = o.routes.map((r) => {
    const server = net.createServer({ pauseOnConnect: true }, (client) => {
      const from = normalizeRemote(client.remoteAddress);
      if (from !== o.peer) {
        log(`private-db: відмова ${from} → ${r.listen}`);
        client.destroy();
        return;
      }
      const upstream = net.connect({ host: r.host, port: r.port });
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
      client.on('close', close);
      upstream.on('close', close);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    server.listen(r.listen, o.listenHost ?? '0.0.0.0');
    return server;
  });
  return {
    servers,
    close: () => Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve(undefined))))),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const proxy = startProxy({ peer: String(process.env.T2F_PROXY_PEER ?? ''), routes: parseRoutes(process.env.T2F_PROXY_ROUTES ?? '') });
  process.on('SIGTERM', () => {
    proxy.close().then(() => process.exit(0));
  });
}
