// @ts-check
import { readFileSync } from 'node:fs';
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

  it('has exactly postgres, redis, server, cloudflared', () => {
    expect(Object.keys(c.services).sort()).toEqual(['cloudflared', 'postgres', 'redis', 'server']);
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
    for (const n of cf) {
      const members = Object.entries(c.services).filter(([, body]) => networksOf(body).includes(n)).map(([name]) => name).sort();
      expect(members, n).toEqual(n === 'tunnel' ? ['cloudflared', 'server'] : ['cloudflared']);
    }
    // backend — лише postgres, redis, server.
    const backend = Object.entries(c.services).filter(([, body]) => networksOf(body).includes('backend')).map(([name]) => name).sort();
    expect(backend).toEqual(['postgres', 'redis', 'server']);
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

describe('node compose.realtime.yml', () => {
  const c = parse(read('compose.realtime.yml'));

  it('has exactly one service, cloudflared, and no ports', () => {
    expect(Object.keys(c.services)).toEqual(['cloudflared']);
    expect(c.lines.filter((l) => /^\s*ports:/.test(l))).toEqual([]);
    expect(c.services.cloudflared.join('\n')).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(c.services.cloudflared.some((l) => /restart:\s*unless-stopped/.test(l))).toBe(true);
  });
});
