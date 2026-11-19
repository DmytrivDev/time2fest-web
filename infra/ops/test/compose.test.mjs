// @ts-check
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (/** @type {string} */ name) =>
  readFileSync(new URL(`../node/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/**
 * Розбір без YAML-бібліотеки: сервіси на відступі 2, їхні ключі на відступі 4.
 * @param {string} text
 */
function parse(text) {
  const lines = text.split('\n').filter((l) => !/^\s*#/.test(l));
  /** @type {Record<string, string[]>} */
  const services = {};
  /** @type {Record<string, boolean>} */
  const networks = {};
  let top = '';
  let current = '';
  for (const line of lines) {
    const t = line.match(/^([a-z]+):/);
    if (t) {
      top = t[1];
      current = '';
      continue;
    }
    const child = line.match(/^ {2}([a-z0-9_-]+):\s*(.*)$/);
    if (child) {
      current = child[1];
      if (top === 'services') services[current] = [];
      if (top === 'networks') networks[current] = /internal:\s*true/.test(child[2]);
      continue;
    }
    if (top === 'services' && current) services[current].push(line);
    if (top === 'networks' && current && /^ {4}internal:\s*true\s*$/.test(line)) networks[current] = true;
  }
  return { lines, services, networks };
}

/** @param {string[]} body */
function networksOf(body) {
  const out = [];
  let inList = false;
  for (const line of body) {
    if (/^ {4}networks:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^ {6}- ([a-z0-9_-]+)\s*$/);
      if (m) out.push(m[1]);
      else inList = false;
    }
  }
  return out;
}

describe('node compose.yml', () => {
  const c = parse(read('compose.yml'));

  it('has exactly postgres, redis, centrifugo, server, cloudflared', () => {
    expect(Object.keys(c.services).sort()).toEqual(['centrifugo', 'cloudflared', 'postgres', 'redis', 'server']);
  });

  it('publishes no ports', () => {
    expect(c.lines.filter((l) => /^\s*ports:/.test(l))).toEqual([]);
  });

  it('pins every third-party image by digest', () => {
    for (const [name, body] of Object.entries(c.services)) {
      const image = body.find((l) => /^ {4}image:/.test(l)) ?? '';
      expect(image, name).not.toBe('');
      if (name === 'server') expect(image).toMatch(/image:\s*t2f-server:\$\{T2F_SERVER_SHA:\?/);
      else expect(image, name).toMatch(/@sha256:[0-9a-f]{64}\s*$/);
    }
  });

  it('restarts unless stopped', () => {
    for (const [name, body] of Object.entries(c.services)) {
      expect(body.some((l) => /^ {4}restart:\s*unless-stopped\s*$/.test(l)), name).toBe(true);
    }
  });

  it('keeps postgres and redis on backend only, server off any open network but egress', () => {
    expect(networksOf(c.services.postgres)).toEqual(['backend']);
    expect(networksOf(c.services.redis)).toEqual(['backend']);
    expect(c.networks.backend).toBe(true);
    for (const n of networksOf(c.services.server)) {
      if (n !== 'egress') expect(c.networks[n], n).toBe(true);
    }
    expect(networksOf(c.services.server)).toContain('backend');
  });

  it('S1: cloudflared is off backend and shares only the internal tunnel network with the server', () => {
    const cf = networksOf(c.services.cloudflared);
    expect(cf).not.toContain('backend');
    expect(cf).toContain('tunnel');
    expect(c.networks.tunnel).toBe(true);
    expect(networksOf(c.services.server)).toContain('tunnel');
    // Кожна мережа cloudflared, крім його власного виходу, спільна лише із сервером.
    // realtime — лише з Centrifugo (клієнтський порт 8000).
    /** @type {Record<string, string[]>} */
    const shared = { tunnel: ['cloudflared', 'server'], realtime: ['centrifugo', 'cloudflared'] };
    for (const n of cf) {
      const members = Object.entries(c.services).filter(([, body]) => networksOf(body).includes(n)).map(([name]) => name).sort();
      expect(members, n).toEqual(shared[n] ?? ['cloudflared']);
    }
    expect(c.networks.realtime).toBe(true);
    // backend — лише postgres, redis, centrifugo, server.
    const backend = Object.entries(c.services).filter(([, body]) => networksOf(body).includes('backend')).map(([name]) => name).sort();
    expect(backend).toEqual(['centrifugo', 'postgres', 'redis', 'server']);
    expect(networksOf(c.services.centrifugo).sort()).toEqual(['backend', 'realtime']);
  });

  it('S1: redis requires a password from redis.env, never in argv or the healthcheck text', () => {
    const body = c.services.redis.join('\n');
    expect(body).toMatch(/^ {4}env_file:\s*redis\.env\s*$/m);
    expect(body).toMatch(/requirepass/);
    expect(body).not.toMatch(/--requirepass/);
    expect(body).toMatch(/REDISCLI_AUTH=\\?"\$\$REDIS_PASSWORD\\?" redis-cli ping/);
    expect(body).toMatch(/exec docker-entrypoint\.sh redis-server \/tmp\/redis\.conf/);
  });

  it('does not set what ops or the image own', () => {
    const text = read('compose.yml')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    for (const name of ['REDIS_URL', 'REDIS_PASSWORD', 'T2F_REDIS_PREFIX', 'DATABASE_URI', 'POSTGRES_USER', 'POSTGRES_DB', 'T2F_COMMIT']) {
      // `$$POSTGRES_USER` у healthcheck читає змінну контейнера, а не задає її
      const cleaned = text.replace(/\$\$[A-Z_]+/g, '');
      expect(cleaned, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('fixes the server environment and probes health', () => {
    const body = c.services.server.join('\n');
    expect(body).toMatch(/T2F_HOST:\s*0\.0\.0\.0/);
    expect(body).toMatch(/T2F_SERVER_PORT:\s*"3000"/);
    expect(body).toMatch(/node.*scripts\/health-probe\.mjs/);
  });
});

describe('node compose.yml: Centrifugo (SPEC-06 → вузол)', () => {
  const c = parse(read('compose.yml'));
  const body = () => c.services.centrifugo.join('\n');

  /** Конфігурація класу як змінні Centrifugo (те саме, що `realtime:config --print-env`). @param {any} v @param {string} key @param {Map<string, string>} out */
  function flatten(v, key, out) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v)) flatten(x, `${key}_${k.toUpperCase()}`, out);
    } else if (Array.isArray(v)) {
      out.set(key, v.every((x) => typeof x === 'string') ? v.join(' ') : JSON.stringify(v));
    } else out.set(key, String(v));
    return out;
  }

  it('environment is exactly the generated rehearsal config, plus engine and admin off', () => {
    const json = JSON.parse(readFileSync(new URL('../../../server/realtime/centrifugo.rehearsal.json', import.meta.url), 'utf8'));
    const want = flatten(json, 'CENTRIFUGO', new Map());
    /** @type {Map<string, string>} */
    const got = new Map();
    for (const line of c.services.centrifugo) {
      const m = line.match(/^ {6}(CENTRIFUGO_[A-Z0-9_]+):\s*'(.*)'\s*$/);
      if (m) got.set(m[1], m[2].replace(/''/g, "'"));
    }
    for (const [k, v] of want) expect(got.get(k), k).toBe(v);
    expect(want.get('CENTRIFUGO_CLIENT_ALLOWED_ORIGINS')).toBe('https://rehearsal.time2fest.com');
    expect(want.get('CENTRIFUGO_HTTP_SERVER_INTERNAL_PORT')).toBe('9000');
    expect(got.get('CENTRIFUGO_ENGINE_TYPE')).toBe('redis');
    expect(got.get('CENTRIFUGO_ADMIN_ENABLED')).toBe('false');
    expect([...got.keys()].filter((k) => !want.has(k)).sort()).toEqual(['CENTRIFUGO_ADMIN_ENABLED', 'CENTRIFUGO_ENGINE_REDIS_PREFIX', 'CENTRIFUGO_ENGINE_TYPE']);
  });

  it('keys and the engine address come from centrifugo.env only', () => {
    expect(body()).toMatch(/^ {4}env_file:\s*centrifugo\.env\s*$/m);
    for (const name of ['CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY', 'CENTRIFUGO_HTTP_API_KEY', 'CENTRIFUGO_ENGINE_REDIS_ADDRESS']) {
      expect(body(), name).not.toContain(name);
    }
  });

  it('nofile ≥ 70000, memory capped, health on the internal port, server waits for it', () => {
    const soft = Number(body().match(/soft:\s*(\d+)/)?.[1]);
    const hard = Number(body().match(/hard:\s*(\d+)/)?.[1]);
    expect(soft).toBeGreaterThanOrEqual(70000);
    expect(hard).toBeGreaterThanOrEqual(soft);
    expect(body()).toMatch(/^ {4}mem_limit:\s*\d+m\s*$/m);
    expect(body()).toMatch(/127\.0\.0\.1:9000\/health/);
    expect(c.services.server.join('\n')).toMatch(/centrifugo:\n\s+condition: service_healthy/);
  });
});

describe('node compose.realtime.yml', () => {
  const c = parse(read('compose.realtime.yml'));

  it('has exactly one service, cloudflared, and no ports', () => {
    expect(Object.keys(c.services)).toEqual(['cloudflared']);
    expect(c.lines.filter((l) => /^\s*ports:/.test(l))).toEqual([]);
    expect(c.services.cloudflared.join('\n')).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(c.services.cloudflared.some((l) => /restart:\s*unless-stopped/.test(l))).toBe(true);
  });
});

// --- O·P18a: другий вузол репетиції (навчання «два сервери») ---
describe('node compose.server2.yml', () => {
  const c = parse(read('compose.server2.yml'));
  const main = parse(read('compose.yml'));

  it('only server: same image variable, server.env, no cloudflared, no ports, egress only', () => {
    expect(Object.keys(c.services)).toEqual(['server']);
    expect(c.lines.filter((l) => /^\s*ports:/.test(l))).toEqual([]);
    const body = c.services.server.join('\n');
    expect(body).toContain('image: t2f-server:${T2F_SERVER_SHA:?set by ops}');
    expect(body).toMatch(/env_file: server\.env/);
    expect(body).toMatch(/mem_limit: 1536m/);
    expect(networksOf(c.services.server)).toEqual(['egress']);
    expect(c.networks).toEqual({ egress: false });
  });

  it('environment and healthcheck are the same as the main node server', () => {
    /** @param {string[]} b @param {string} key */
    const block = (b, key) => {
      const i = b.findIndex((l) => l === `    ${key}:`);
      const out = [];
      for (const l of b.slice(i + 1)) {
        if (!/^ {6}/.test(l)) break;
        out.push(l);
      }
      return out;
    };
    for (const key of ['environment', 'healthcheck']) expect(block(c.services.server, key)).toEqual(block(main.services.server, key));
  });
});

describe('node compose.private-db.yml', () => {
  const text = read('compose.private-db.yml');
  const c = parse(text);

  it('one proxy service; postgres/redis are not redeclared; ports only on the private address', () => {
    expect(Object.keys(c.services)).toEqual(['private-db']);
    const ports = c.services['private-db'].filter((l) => /^ {6}- "/.test(l) && /:\d+"$/.test(l)).map((l) => l.trim());
    expect(ports).toEqual(['- "${T2F_PRIVATE_ADDR:?set by ops}:5432:5432"', '- "${T2F_PRIVATE_ADDR:?set by ops}:6379:6379"']);
    const live = c.lines.join('\n'); // без коментарів
    expect(live).not.toMatch(/0\.0\.0\.0/);
    // Ні голого "5432:5432" (усі адреси), ні публічної адреси — лише змінна приватної.
    expect(live).not.toMatch(/^\s*- ["']?(5432|6379):(5432|6379)["']?\s*$/m);
    expect(ports.every((p) => p.startsWith('- "${T2F_PRIVATE_ADDR:?'))).toBe(true);
    expect(live).not.toMatch(/9000/);
    expect(c.services['private-db'].join('\n')).toMatch(/restart: "no"/);
  });

  it('joins the main project backend as external and its own network to publish', () => {
    expect(networksOf(c.services['private-db'])).toEqual(['backend', 'private-db']);
    expect(text).toMatch(/backend:\n {4}external: true\n {4}name: \$\{T2F_BACKEND_NETWORK:\?set by ops\}/);
  });
});

describe('docker compose config (O·P18a files)', () => {
  const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  const hasDocker = docker.status === 0;

  /**
   * `docker compose config --format json` у тимчасовій теці з порожніми файлами змінних.
   * @param {string} file
   * @param {Record<string, string>} env
   */
  const config = (file, env) => {
    const dir = mkdtempSync(join(tmpdir(), 't2f-compose-'));
    try {
      writeFileSync(join(dir, file), read(file));
      writeFileSync(join(dir, 'server.env'), '');
      writeFileSync(join(dir, 'private-db-proxy.mjs'), '');
      const r = spawnSync('docker', ['compose', '-p', 't2f-check', '-f', join(dir, file), 'config', '--format', 'json'], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
      return { status: r.status, json: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.skipIf(!hasDocker)('compose.server2.yml validates and publishes nothing', () => {
    const r = config('compose.server2.yml', { T2F_SERVER_SHA: 'c'.repeat(40), T2F_ENV: 'rehearsal' });
    expect(r.status, r.stderr).toBe(0);
    expect(Object.keys(r.json.services)).toEqual(['server']);
    expect(r.json.services.server.ports).toBeUndefined();
  });

  it.skipIf(!hasDocker)('compose.private-db.yml validates; every published port is bound to the private address', () => {
    const r = config('compose.private-db.yml', {
      T2F_SERVER_SHA: 'c'.repeat(40),
      T2F_PRIVATE_ADDR: '10.114.0.2',
      T2F_PRIVATE_DB_PEER: '10.114.0.3',
      T2F_BACKEND_NETWORK: 't2f-rehearsal_backend',
    });
    expect(r.status).toBe(0);
    const ports = r.json.services['private-db'].ports;
    expect(ports.map((/** @type {any} */ p) => `${p.host_ip}:${p.published}:${p.target}`)).toEqual(['10.114.0.2:5432:5432', '10.114.0.2:6379:6379']);
    expect(r.json.networks.backend).toMatchObject({ external: true, name: 't2f-rehearsal_backend' });
  });

  it.skipIf(!hasDocker)('compose.private-db.yml without the private address does not validate', () => {
    const r = config('compose.private-db.yml', { T2F_SERVER_SHA: 'c'.repeat(40), T2F_PRIVATE_DB_PEER: '10.114.0.3', T2F_BACKEND_NETWORK: 'x' });
    expect(r.status).not.toBe(0);
  });
});
// --- кінець O·P18a ---

// --- O·P17: навчання планувальника на одному вузлі (накладка на compose.yml) ---
describe('node compose.drill.yml', () => {
  const c = parse(read('compose.drill.yml'));
  const main = parse(read('compose.yml'));

  it('only server-drill behind the scheduler-drill profile: same image, server.env, 640m, no ports, off tunnel', () => {
    expect(Object.keys(c.services)).toEqual(['server-drill']);
    expect(c.lines.filter((l) => /^\s*ports:/.test(l))).toEqual([]);
    const body = c.services['server-drill'].join('\n');
    expect(body).toMatch(/profiles: \["scheduler-drill"\]/);
    expect(body).toContain('image: t2f-server:${T2F_SERVER_SHA:?set by ops}');
    expect(body).toMatch(/env_file: server\.env/);
    expect(body).toMatch(/mem_limit: 640m/);
    expect(body).toMatch(/restart: "no"/);
    expect(networksOf(c.services['server-drill'])).toEqual(['backend', 'egress']);
    // Мережі — з compose.yml (накладка не оголошує власних).
    expect(c.networks).toEqual({});
  });

  it('environment and healthcheck are the same as the main node server', () => {
    /** @param {string[]} b @param {string} key */
    const block = (b, key) => {
      const i = b.findIndex((l) => l === `    ${key}:`);
      const out = [];
      for (const l of b.slice(i + 1)) {
        if (!/^ {6}/.test(l)) break;
        out.push(l);
      }
      return out;
    };
    for (const key of ['environment', 'healthcheck']) expect(block(c.services['server-drill'], key)).toEqual(block(main.services.server, key));
  });

  const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  it.skipIf(docker.status !== 0)('docker compose config: compose.yml + compose.drill.yml validates, publishes nothing, profile gates the service', () => {
    const dir = mkdtempSync(join(tmpdir(), 't2f-compose-drill-'));
    try {
      for (const f of ['compose.yml', 'compose.drill.yml']) writeFileSync(join(dir, f), read(f));
      for (const f of ['server.env', 'postgres.env', 'redis.env', 'centrifugo.env', 'cloudflared.env']) writeFileSync(join(dir, f), '');
      /** @param {string[]} extra */
      const config = (extra) => {
        const r = spawnSync('docker', ['compose', '-p', 't2f-check', '-f', join(dir, 'compose.yml'), '-f', join(dir, 'compose.drill.yml'), ...extra, 'config', '--format', 'json'], {
          encoding: 'utf8',
          env: { ...process.env, T2F_SERVER_SHA: 'c'.repeat(40), T2F_ENV: 'rehearsal' },
        });
        expect(r.status, r.stderr).toBe(0);
        return JSON.parse(r.stdout);
      };
      const on = config(['--profile', 'scheduler-drill']);
      expect(Object.keys(on.services).sort()).toEqual(['centrifugo', 'cloudflared', 'postgres', 'redis', 'server', 'server-drill']);
      for (const s of Object.values(on.services)) expect(/** @type {any} */ (s).ports).toBeUndefined();
      expect(Object.keys(on.services['server-drill'].networks).sort()).toEqual(['backend', 'egress']);
      expect(Number(on.services['server-drill'].mem_limit)).toBe(640 * 1024 * 1024);
      expect(Object.keys(config([]).services)).not.toContain('server-drill');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
// --- кінець O·P17 ---
