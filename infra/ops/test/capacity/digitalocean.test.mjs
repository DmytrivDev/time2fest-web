// @ts-check
// Адаптер DigitalOcean проти loopback-сервера, що відтворює форми відповідей із `test/fixtures/do/*.json`
// (складено вручну за офіційним OpenAPI; справжнього API тест не торкається).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDigitalOcean, resolveBase } from '../../lib/capacity/digitalocean/adapter.mjs';
import { ProviderError } from '../../lib/capacity/provider.mjs';
import { describeProvider } from './provider.contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = path.resolve(HERE, '..', '..');
const FIX = path.join(OPS, 'test', 'fixtures', 'do');
/** @param {string} name @returns {any} */
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));

const TOKEN = 'fake-do-token-for-local-api-0123456789abcdef'; // check-secrets: allow fake DO token for local fake API
const REQ = ['t2f-managed', 't2f-env-rehearsal'];
const FINGERPRINT = '3b:16:bf:e4:8b:00:8b:b8:59:8c:a9:d3:f0:19:45:fa';

/**
 * @typedef {import('../../lib/capacity/fake.mjs').SeedNode} SeedNode
 * @typedef {{ method: string, path: string, query: Record<string, string>, body: any, auth: string | undefined }} Req
 */

/**
 * Loopback-сервер API зі станом: вузли, дії, пагінація, сценарні 429.
 * @param {SeedNode[]} seed
 * @param {{ pageSize?: number, shutdownHangs?: boolean }} [opts]
 */
async function startFakeDo(seed, opts = {}) {
  const sizes = fixture('sizes').sizes;
  /** @param {string} slug */
  const sizeOf = (slug) => sizes.find((/** @type {any} */ s) => s.slug === slug);
  let nextId = 3164444;
  let nextAction = 72531856;
  let nextIp = 10;
  /**
   * @param {{ name: string, size: string, tags: string[], status?: string, diskGb?: number }} n
   * @param {any} template
   */
  const makeDroplet = (n, template) => {
    const d = structuredClone(template);
    const s = sizeOf(n.size);
    Object.assign(d, { id: nextId++, name: n.name, size_slug: n.size, size: structuredClone(s), memory: s.memory, vcpus: s.vcpus });
    d.disk = n.diskGb ?? s.disk;
    d.status = n.status ?? 'active';
    d.tags = [...n.tags];
    d.networks = { v4: d.status === 'new' ? [] : [{ ip_address: `203.0.113.${nextIp++}`, netmask: '255.255.240.0', gateway: '203.0.113.1', type: 'public' }], v6: [] };
    return d;
  };
  /** @type {any[]} */
  const droplets = seed.map((n) => makeDroplet(n, fixture('droplet')));
  /** @type {Map<string, { dropletId: number, type: string, body: any, status: string }>} */
  const actions = new Map();
  /** @type {Req[]} */
  const log = [];
  /** @type {number[]} */
  const fail = [];
  const pageSize = opts.pageSize ?? 2;

  /** @param {http.ServerResponse} res @param {number} status @param {unknown} [body] @param {Record<string, string>} [headers] */
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  /** @param {any[]} items @param {string} key @param {URL} url @param {any} template */
  const page = (items, key, url, template) => {
    const p = Number(url.searchParams.get('page') ?? '1');
    const json = structuredClone(template);
    json[key] = items.slice((p - 1) * pageSize, p * pageSize);
    json.meta = { total: items.length };
    json.links = { pages: {} };
    if (p * pageSize < items.length) {
      const next = new URL(`https://api.digitalocean.com${url.pathname}`);
      for (const [k, v] of url.searchParams) if (k !== 'page') next.searchParams.set(k, v);
      next.searchParams.set('page', String(p + 1));
      json.links.pages.next = next.toString();
    }
    return json;
  };
  /** @param {any} d @param {{ type: string, body: any }} a */
  const apply = (d, a) => {
    if (a.type === 'shutdown' || a.type === 'power_off') d.status = 'off';
    if (a.type === 'power_on') d.status = 'active';
    if (a.type === 'resize') {
      const s = sizeOf(a.body.size);
      Object.assign(d, { size_slug: s.slug, size: structuredClone(s), memory: s.memory, vcpus: s.vcpus });
      if (a.body.disk === true) d.disk = s.disk;
    }
  };

  const server = http.createServer((req, res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      log.push({ method: String(req.method), path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { id: 'unauthorized', message: 'Unable to authenticate you.' });
      const failing = fail.shift();
      if (failing !== undefined) {
        return send(res, failing, fixture('error-429'), {
          'ratelimit-limit': '5000',
          'ratelimit-remaining': '0',
          'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 7),
        });
      }
      const m = url.pathname.match(/^\/v2\/droplets(?:\/(\d+))?(?:\/actions(?:\/(\d+))?)?$/);
      if (req.method === 'GET' && url.pathname === '/v2/sizes') return send(res, 200, page(sizes, 'sizes', url, fixture('sizes')));
      if (!m) return send(res, 404, { id: 'not_found', message: 'The resource you were accessing could not be found.' });
      const [, id, actionId] = m;
      const d = id ? droplets.find((x) => String(x.id) === id) : undefined;
      if (id && !d) return send(res, 404, { id: 'not_found', message: 'The resource you were accessing could not be found.' });

      if (req.method === 'GET' && !id) {
        const tag = url.searchParams.get('tag_name');
        return send(res, 200, page(droplets.filter((x) => !tag || x.tags.includes(tag)), 'droplets', url, fixture('droplets-list')));
      }
      if (req.method === 'POST' && !id) {
        const created = makeDroplet({ name: body.name, size: body.size, tags: body.tags, status: 'new' }, fixture('create-202').droplet);
        droplets.push(created);
        const json = fixture('create-202');
        json.droplet = created;
        return send(res, 202, json);
      }
      if (req.method === 'GET' && id && actionId === undefined && !url.pathname.endsWith('/actions')) {
        if (d.status === 'new') {
          d.status = 'active';
          d.networks.v4 = [{ ip_address: `203.0.113.${nextIp++}`, netmask: '255.255.240.0', gateway: '203.0.113.1', type: 'public' }];
          return send(res, 200, { droplet: { ...d, status: 'new', networks: { v4: [], v6: [] } } });
        }
        return send(res, 200, { droplet: d });
      }
      if (req.method === 'DELETE' && id) {
        droplets.splice(droplets.indexOf(d), 1);
        return send(res, 204);
      }
      if (req.method === 'POST' && url.pathname.endsWith('/actions')) {
        if (body.type === 'resize' && d.status !== 'off') return send(res, 422, { id: 'unprocessable_entity', message: 'Droplet must be powered off.' });
        const aid = String(nextAction++);
        actions.set(aid, { dropletId: d.id, type: body.type, body, status: 'in-progress' });
        const json = fixture('action-201');
        Object.assign(json.action, { id: Number(aid), type: body.type, resource_id: d.id });
        return send(res, 201, json);
      }
      if (req.method === 'GET' && actionId) {
        const a = actions.get(actionId);
        if (!a) return send(res, 404, { id: 'not_found', message: 'not found' });
        const hang = a.type === 'shutdown' && opts.shutdownHangs;
        if (a.status === 'in-progress' && !hang) {
          a.status = 'completed';
          apply(d, a);
          const json = fixture('action-completed');
          Object.assign(json.action, { id: Number(actionId), type: a.type, resource_id: d.id });
          return send(res, 200, json);
        }
        const json = fixture('action-201');
        Object.assign(json.action, { id: Number(actionId), type: a.type, resource_id: d.id, status: a.status });
        return send(res, 200, json);
      }
      return send(res, 405, { id: 'method_not_allowed', message: 'no' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return {
    base: `http://127.0.0.1:${port}`,
    log,
    droplets,
    /** @param {number} status */
    failNext: (status) => fail.push(status),
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/** Годинник без очікування: `sleep` лише пересуває час. */
const fastClock = () => {
  let t = Date.now();
  return { now: () => t, sleep: async (/** @type {number} */ ms) => void (t += ms) };
};

/**
 * @param {Awaited<ReturnType<typeof startFakeDo>>} srv
 * @param {Record<string, string>} [extra]
 */
const providerFor = (srv, extra = {}) =>
  createDigitalOcean({
    env: { DIGITALOCEAN_TOKEN: TOKEN, DO_API_BASE: srv.base, T2F_DO_SSH_KEY: FINGERPRINT, ...extra },
    clock: fastClock(),
  });

describeProvider('digitalocean (loopback)', async (seed) => {
  const srv = await startFakeDo(seed);
  return { provider: providerFor(srv), failNext: (status) => srv.failNext(status), close: srv.close };
});

describe('адаптер DigitalOcean: запити', () => {
  const SEED = [{ name: 't2f-rehearsal-main', size: 's-2vcpu-4gb', diskGb: 80, tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-main'] }];

  it('список іде за посиланнями пагінації, лише шляхом на тому самому API, з токеном у заголовку', async () => {
    const seed = [0, 1, 2].map((i) => ({ name: `n${i}`, size: 's-2vcpu-4gb', tags: ['t2f-managed', 't2f-env-rehearsal'] }));
    const srv = await startFakeDo(seed, { pageSize: 1 });
    try {
      const nodes = await providerFor(srv).listNodes(['t2f-managed', 't2f-env-rehearsal']);
      expect(nodes.map((n) => n.name)).toEqual(['n0', 'n1', 'n2']);
      const gets = srv.log.filter((r) => r.path === '/v2/droplets');
      expect(gets.map((r) => r.query.page ?? '1')).toEqual(['1', '2', '3']);
      expect(gets[0].query).toMatchObject({ tag_name: 't2f-managed', per_page: '200' });
      expect(srv.log.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('створення: образ, ключ, теги, без IPv6 і моніторингу; 202, далі опитування до active', async () => {
    const srv = await startFakeDo(SEED);
    try {
      const n = await providerFor(srv).createNode({ name: 't2f-rehearsal-realtime', region: 'fra1', size: 's-2vcpu-4gb', tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-realtime'] });
      const post = srv.log.find((r) => r.method === 'POST' && r.path === '/v2/droplets');
      expect(post?.body).toEqual({
        name: 't2f-rehearsal-realtime',
        region: 'fra1',
        size: 's-2vcpu-4gb',
        image: 'ubuntu-24-04-x64',
        ssh_keys: [FINGERPRINT],
        tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-realtime'],
        ipv6: false,
        monitoring: false,
      });
      expect(n.status).toBe('active');
      expect(n.publicIp).toMatch(/^203\.0\.113\.\d+$/);
    } finally {
      await srv.close();
    }
  });

  it('зміна розміру: shutdown → resize (disk:false) → power_on; без power_off, коли вимкнення вдалося', async () => {
    const srv = await startFakeDo(SEED);
    try {
      const p = providerFor(srv);
      const [main] = await p.listNodes(['t2f-managed']);
      await p.resizeNode(main.id, 's-4vcpu-8gb', { keepDisk: true, requireTags: REQ });
      const posted = srv.log.filter((r) => r.method === 'POST' && r.path.endsWith('/actions')).map((r) => r.body);
      expect(posted).toEqual([{ type: 'shutdown' }, { type: 'resize', size: 's-4vcpu-8gb', disk: false }, { type: 'power_on' }]);
      expect(srv.droplets[0]).toMatchObject({ size_slug: 's-4vcpu-8gb', disk: 80, status: 'active' });
    } finally {
      await srv.close();
    }
  });

  it('вимкнення не завершилось за 60 с → power_off, потім resize', async () => {
    const srv = await startFakeDo(SEED, { shutdownHangs: true });
    try {
      const p = providerFor(srv);
      const [main] = await p.listNodes(['t2f-managed']);
      await p.resizeNode(main.id, 's-4vcpu-8gb', { keepDisk: true, requireTags: REQ });
      const types = srv.log.filter((r) => r.method === 'POST' && r.path.endsWith('/actions')).map((r) => r.body.type);
      expect(types).toEqual(['shutdown', 'power_off', 'resize', 'power_on']);
    } finally {
      await srv.close();
    }
  });

  it('повтор на вимкненому вузлі того ж розміру лише вмикає його', async () => {
    const srv = await startFakeDo([{ ...SEED[0], size: 's-4vcpu-8gb', status: 'off' }]);
    try {
      const p = providerFor(srv);
      const [main] = await p.listNodes(['t2f-managed']);
      await p.resizeNode(main.id, 's-4vcpu-8gb', { keepDisk: true, requireTags: REQ });
      const types = srv.log.filter((r) => r.method === 'POST' && r.path.endsWith('/actions')).map((r) => r.body.type);
      expect(types).toEqual(['power_on']);
    } finally {
      await srv.close();
    }
  });

  it('видалення — DELETE → 204', async () => {
    const srv = await startFakeDo(SEED);
    try {
      const p = providerFor(srv);
      const [main] = await p.listNodes(['t2f-managed']);
      await p.deleteNode(main.id, { requireTags: REQ });
      expect(srv.log.at(-1)).toMatchObject({ method: 'DELETE', path: `/v2/droplets/${main.id}` });
      expect(srv.droplets).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('F7: без обох тегів — відмова до будь-якої дії (жодного POST /actions, жодного DELETE)', async () => {
    const srv = await startFakeDo([{ ...SEED[0], tags: ['t2f-env-rehearsal', 't2f-role-main'] }]);
    try {
      const p = providerFor(srv);
      const [main] = await p.listNodes(['t2f-env-rehearsal']);
      await expect(p.resizeNode(main.id, 's-4vcpu-8gb', { keepDisk: true, requireTags: REQ })).rejects.toThrow(/t2f-managed/);
      await expect(p.deleteNode(main.id, { requireTags: REQ })).rejects.toThrow(/t2f-managed/);
      expect(srv.log.filter((r) => r.method !== 'GET')).toEqual([]);
      expect(srv.droplets).toHaveLength(1);
    } finally {
      await srv.close();
    }
  });

  it('429: retryAfterSec з ratelimit-reset; у повідомленні немає ні токена, ні тіла відповіді', async () => {
    const srv = await startFakeDo(SEED);
    try {
      srv.failNext(429);
      const e = await providerFor(srv).sizes().catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.status).toBe(429);
      expect(e.retryAfterSec).toBeGreaterThanOrEqual(6);
      expect(e.retryAfterSec).toBeLessThanOrEqual(8);
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toMatch(/Rate limit exceeded/);
    } finally {
      await srv.close();
    }
  });

  it('базова адреса: лише справжній API або http://127.0.0.1:<port>; без токена — відмова', () => {
    expect(resolveBase({})).toBe('https://api.digitalocean.com');
    expect(resolveBase({ DO_API_BASE: 'http://127.0.0.1:8080' })).toBe('http://127.0.0.1:8080');
    for (const bad of ['https://evil.example', 'http://localhost:8080', 'http://127.0.0.1:8080/x', 'http://10.0.0.1:80']) {
      expect(() => resolveBase({ DO_API_BASE: bad })).toThrow(/DO_API_BASE/);
    }
    expect(() => createDigitalOcean({ env: {} })).toThrow(/DIGITALOCEAN_TOKEN/);
  });

  it('без відбитка ключа SSH створення відмовляє до запиту', async () => {
    const srv = await startFakeDo(SEED);
    try {
      const p = providerFor(srv, { T2F_DO_SSH_KEY: '' });
      await expect(p.createNode({ name: 'x', region: 'fra1', size: 's-2vcpu-4gb', tags: ['t2f-managed'] })).rejects.toThrow(/T2F_DO_SSH_KEY/);
      expect(srv.log.filter((r) => r.method === 'POST')).toEqual([]);
    } finally {
      await srv.close();
    }
  });
});

describe('назви провайдера лише в його адаптері (AC-45)', () => {
  /**
   * Дозволені рядки поза текою адаптера: реєстр провайдерів (точка підключення) і назва змінної токена в переліку
   * секретів для маскування (`lib/config.mjs`, P5).
   * @param {string} rel
   * @param {string} line
   */
  const allowed = (rel, line) => rel === 'lib/capacity/providers.mjs' || (rel === 'lib/config.mjs' && line.trim() === "'DIGITALOCEAN_TOKEN',");

  it('`droplet|digitalocean` не трапляється в infra/ops/lib і ops.mjs поза lib/capacity/digitalocean/', () => {
    /** @type {string[]} */
    const files = [path.join(OPS, 'ops.mjs')];
    /** @param {string} dir */
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.join(OPS, 'lib'));
    /** @type {string[]} */
    const hits = [];
    for (const f of files) {
      const rel = path.relative(OPS, f).split(path.sep).join('/');
      if (rel.startsWith('lib/capacity/digitalocean/')) continue;
      fs.readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/droplet|digitalocean/i.test(line) && !allowed(rel, line)) hits.push(`${rel}:${i + 1}`);
        });
    }
    expect(files.some((f) => f.endsWith(path.join('capacity', 'capacity.mjs')))).toBe(true);
    expect(hits).toEqual([]);
  });
});
