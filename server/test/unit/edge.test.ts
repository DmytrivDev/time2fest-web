import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { Deps, RouteRow } from '../../src/endpoints/types';
import { createEdgeGate, inactiveEdgeGate, type ClientContext, type EdgeGate } from '../../src/platform/edge';
import { loadEnv } from '../../src/platform/env';
import { daySalts, networkOf } from '../../src/platform/fingerprint';
import { createLogger } from '../../src/platform/logger';
import { runSubjectData } from '../../src/platform/subjectData';
import { DependencyUnavailable, type Clock, type FastStore } from '../../src/ports';
import { envRegistry } from '../../src/registries/env';
import { rateLimitMiddleware } from '../../src/registries/middleware';

// Every secret is built at runtime: no secret-looking literal in the test.
const SECRET = randomBytes(24).toString('hex');
const DAY = Date.parse('2026-12-31T12:00:00Z');
const fixedClock = (at = DAY): Clock => ({ now: () => at });

function gate(opts: { secret?: string; clock?: Clock; fast?: FastStore } = {}): EdgeGate {
  const clock = opts.clock ?? fixedClock();
  const fast = opts.fast ?? createMemoryStore(realClock);
  return createEdgeGate({ envClass: 'test', secret: opts.secret ?? SECRET, salts: daySalts({ fast, clock }), clock });
}

function req(headers: Record<string, string> = {}, path = '/api/x'): Request {
  return new Request(`http://server.test${path}`, { headers });
}

const edge = (client?: string): Record<string, string> =>
  client === undefined ? { 'x-t2f-edge': SECRET } : { 'x-t2f-edge': SECRET, 'x-t2f-client': client };

function admitted(g: EdgeGate, headers: Record<string, string>): ClientContext {
  const client = g.admit(req(headers));
  if (client === null) throw new Error('refused');
  return client;
}

const downStore: FastStore = {
  incrWindow: () => Promise.reject(new DependencyUnavailable('redis')),
  setIfAbsent: () => Promise.reject(new DependencyUnavailable('redis')),
  get: () => Promise.reject(new DependencyUnavailable('redis')),
  set: () => Promise.reject(new DependencyUnavailable('redis')),
  del: () => Promise.reject(new DependencyUnavailable('redis')),
  deleteByPrefix: () => Promise.reject(new DependencyUnavailable('redis')),
};

function depsWith(log: Deps['log'], store: FastStore, env: Deps['env'] = { class: 'test', vars: {} }): Deps {
  return {
    env,
    clock: fixedClock(),
    log,
    alarm: { raise: () => {} },
    lockState: { holdsExclusive: () => false },
    redis: store,
    memory: createMemoryStore(realClock),
    orderStore: { begin: () => Promise.reject(new Error('not used')), finish: async () => {}, abort: async () => {} },
  };
}

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] as number;
}

describe('edge secret in the env registry', () => {
  it('AC-14: rehearsal without T2F_EDGE_SECRET fails by name only; 31 characters fail; test without it is ok', () => {
    const payloadSecret = randomBytes(24).toString('hex');
    const base = {
      DATABASE_URI: 'postgres://localhost:5433/t2f_edge_unit_test',
      REDIS_URL: 'redis://localhost:6380/4',
      T2F_REDIS_PREFIX: 't2f:edge_unit:',
      PAYLOAD_SECRET: payloadSecret,
      // SPEC-04 blocks `access` and `catalog` are required in rehearsal too; present so only the edge secret is missing.
      T2F_ADMIN_HOST: 'admin.localhost:3100',
      T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
      T2F_ACCESS_AUD: 't2f-test-aud',
      T2F_ACCESS_JWKS_URL: 'test-signer:',
      T2F_OWNER_EMAILS: 'owner@example.com',
      T2F_R2_ENDPOINT: 'http://127.0.0.1:9090',
      T2F_R2_BUCKET: 't2f-catalog',
      T2F_R2_PREFIX: 'edge_unit/',
      T2F_R2_ACCESS_KEY_ID: 't2f-local',
      T2F_R2_SECRET_ACCESS_KEY: randomBytes(12).toString('hex'),
      T2F_CENTRIFUGO_API_KEY: 'centrifugo-api-key-unit-test-0000000000', // check-secrets: allow test fake
      T2F_CENTRIFUGO_TOKEN_SECRET: 'centrifugo-token-secret-unit-test-000000', // check-secrets: allow test fake
    };
    const missing = loadEnv({ ...base, T2F_ENV: 'rehearsal' }, envRegistry);
    expect(missing).toEqual({ ok: false, failing: ['T2F_EDGE_SECRET'] });

    const short = SECRET.slice(0, 31);
    const tooShort = loadEnv({ ...base, T2F_ENV: 'rehearsal', T2F_EDGE_SECRET: short }, envRegistry);
    expect(tooShort).toEqual({ ok: false, failing: ['T2F_EDGE_SECRET'] });
    expect(JSON.stringify(tooShort)).not.toContain(short);

    const ok = loadEnv({ ...base, T2F_ENV: 'rehearsal', T2F_EDGE_SECRET: SECRET }, envRegistry);
    expect(ok.ok && ok.secrets.includes(SECRET)).toBe(true);
    expect(loadEnv({ ...base, T2F_ENV: 'test' }, envRegistry).ok).toBe(true);
  });
});

describe('edge gate', () => {
  it('AC-18: a wrong secret of another length, of the same length and with a shared prefix is refused', () => {
    const g = gate();
    const flip = (c: string) => (c === 'a' ? 'b' : 'a');
    const sameLength = SECRET.slice(0, -1) + flip(SECRET.slice(-1));
    for (const wrong of ['x', `${SECRET}x`, SECRET.slice(0, 8), sameLength, SECRET.slice(0, -1), '']) {
      expect(g.admit(req({ 'x-t2f-edge': wrong }))).toBeNull();
    }
    expect(g.admit(req())).toBeNull();
    expect(g.admit(req(edge()))).not.toBeNull();
    // Rehearsal and production are always active; without a secret they refuse everything.
    const clock = fixedClock();
    const salts = daySalts({ fast: createMemoryStore(realClock), clock });
    for (const envClass of ['rehearsal', 'production'] as const) {
      const g2 = createEdgeGate({ envClass, secret: undefined, salts, clock });
      expect(g2.active).toBe(true);
      expect(g2.admit(req({ 'x-t2f-edge': '' }))).toBeNull();
    }
  });

  it('AC-19: logs of a success, a refusal and a throwing handler hold no secret, client header, address or salt', async () => {
    const lines: string[] = [];
    const ip = '203.0.113.45';
    const clientHeader = `${ip};UA`;
    const store = createMemoryStore(realClock);
    const env = { class: 'test' as const, vars: { T2F_EDGE_SECRET: SECRET } };
    const loaded = loadEnv(
      {
        T2F_ENV: 'test',
        DATABASE_URI: 'postgres://localhost:5433/t2f_edge_unit_test',
        REDIS_URL: 'redis://localhost:6380/4',
        T2F_REDIS_PREFIX: 't2f:edge_unit:',
        PAYLOAD_SECRET: randomBytes(24).toString('hex'),
        T2F_EDGE_SECRET: SECRET,
      },
      envRegistry,
    );
    if (!loaded.ok) throw new Error('env');
    const log = createLogger(loaded.secrets, { clock: fixedClock(), write: (l) => void lines.push(l) });
    const routes: RouteRow[] = [
      { key: 'ok', method: 'GET', path: '/api/ok', handler: async (ctx) => ({ ok: true, value: (await ctx.client.ipDay()).length }) },
      {
        key: 'boom',
        method: 'GET',
        path: '/api/boom',
        handler: async (ctx) => {
          await ctx.client.ipDay();
          throw new Error('handler failed');
        },
      },
    ];
    const dispatch = createDispatcher({ routes, middleware: [], deps: depsWith(log, store, env), edge: gate({ fast: store }) });
    const headers = { 'x-t2f-edge': SECRET, 'x-t2f-client': clientHeader };
    expect((await dispatch(req(headers, '/api/ok'))).status).toBe(200);
    expect((await dispatch(req({ ...headers, 'x-t2f-edge': `${SECRET}0` }, '/api/ok'))).status).toBe(404);
    const failed = await dispatch(req(headers, '/api/boom'));
    expect(failed.status).toBe(500);

    const salt = await store.get('edge:salt:2026-12-31');
    expect(salt).not.toBeNull();
    const text = lines.join('\n') + (await failed.text());
    expect(lines.length).toBeGreaterThan(0);
    for (const leak of [SECRET, clientHeader, ip, salt as string]) expect(text).not.toContain(leak);
  });

  it('AC-21: a missing or invalid country part is unknown', () => {
    const g = gate();
    for (const country of ['', 'XX', 'T1', 'ua', 'U1', 'UAX']) {
      expect(admitted(g, edge(`198.51.100.7;${country}`)).country).toBe('unknown');
    }
    expect(admitted(g, edge('198.51.100.7;UA')).country).toBe('UA');
  });

  it('AC-22: an invalid or absent address, or an inactive gate, counts in the no-address bucket', async () => {
    const g = gate();
    const bucket = 'noaddr:2026-12-31';
    for (const ip of ['1.2.3', 'abc', '']) {
      const client = admitted(g, edge(`${ip};UA`));
      expect(client.addressPresent).toBe(false);
      expect(await client.ipDay()).toBe(bucket);
    }
    expect(await admitted(g, edge()).ipDay()).toBe(bucket);
    const off = inactiveEdgeGate(fixedClock());
    expect(off.active).toBe(false);
    const client = off.admit(req({ 'x-t2f-client': '198.51.100.7;UA' }));
    expect(client?.edgeVerified).toBe(false);
    expect(await client?.ipDay()).toBe(bucket);
    // Class `test` without a secret is inactive (AC-17).
    const clock = fixedClock();
    const unset = createEdgeGate({ envClass: 'test', secret: undefined, salts: daySalts({ fast: downStore, clock }), clock });
    expect(unset.active).toBe(false);
    expect(await unset.admit(req())?.ipDay()).toBe(bucket);
  });

  it('AC-23: the client context has no address field', () => {
    expectTypeOf<keyof ClientContext>().toEqualTypeOf<'country' | 'edgeVerified' | 'addressPresent' | 'ipDay'>();
    const client = admitted(gate(), edge('198.51.100.7;UA'));
    const keys = Object.keys(client).filter((k) => /ip|addr/i.test(k));
    expect(keys.sort()).toEqual(['addressPresent', 'ipDay']);
    expect(JSON.stringify(client)).not.toContain('198.51.100.7');
  });

  it('AC-24: same address same day → same fingerprint; one IPv6 /64 → same; another /64 → different', async () => {
    const g = gate();
    const fp = (ip: string) => admitted(g, edge(`${ip};UA`)).ipDay();
    const v4 = await fp('198.51.100.7');
    expect(v4).toMatch(/^fp:[0-9a-f]{64}$/);
    expect(await fp('198.51.100.7')).toBe(v4);
    expect(await fp('198.51.100.8')).not.toBe(v4);
    expect(await fp('::ffff:198.51.100.7')).toBe(v4);
    const v6 = await fp('2001:db8:1:2::a');
    expect(await fp('2001:db8:1:2:ffff::1')).toBe(v6);
    expect(await fp('2001:db8:1:3::a')).not.toBe(v6);
    for (const [ip, value] of [['198.51.100.7', v4], ['2001:db8:1:2::a', v6]] as const) {
      expect(value).not.toContain(ip);
      expect(value).not.toContain(networkOf(ip) as string);
    }
    expect(networkOf('2001:db8:1:2::a')).toBe('2001:0db8:0001:0002::/64');
    expect(networkOf('::ffff:198.51.100.7')).toBe('198.51.100.7');
  });

  it('AC-26: the fingerprint changes at UTC midnight', async () => {
    let now = Date.parse('2026-12-31T23:59:59.999Z');
    const clock: Clock = { now: () => now };
    const g = gate({ clock });
    const before = await admitted(g, edge('198.51.100.7;UA')).ipDay();
    now = Date.parse('2027-01-01T00:00:00.000Z');
    const after = await admitted(g, edge('198.51.100.7;UA')).ipDay();
    expect(after).toMatch(/^fp:[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });

  it('AC-27: with the fast store down the fingerprint is computed and stable within the day', async () => {
    let now = DAY;
    const clock: Clock = { now: () => now };
    const g = gate({ clock, fast: downStore });
    const values = [];
    for (let i = 0; i < 3; i += 1) values.push(await admitted(g, edge('198.51.100.7;UA')).ipDay());
    expect(values[0]).toMatch(/^fp:[0-9a-f]{64}$/);
    expect(new Set(values).size).toBe(1);
    now = Date.parse('2027-01-01T00:00:00.000Z');
    expect(await admitted(g, edge('198.51.100.7;UA')).ipDay()).not.toBe(values[0]);
  });

  it('AC-29: an ipDay rate-limit row with a window over 24 h stops the registry', () => {
    expect(() => rateLimitMiddleware([{ key: 'x', limit: 1, windowMs: 86_400_001, keys: ['ipDay'], onStoreDown: 'memory' }])).toThrow(
      /ipDay window exceeds 24 h/,
    );
    expect(() => rateLimitMiddleware([{ key: 'x', limit: 1, windowMs: 86_400_000, keys: ['ipDay'], onStoreDown: 'memory' }])).not.toThrow();
  });

  it('NFR-5: the edge check and fingerprint add at most 1 ms per request at p95', async () => {
    const routes: RouteRow[] = [
      { key: 't', method: 'GET', path: '/api/t', handler: async (ctx) => ({ ok: true, value: await ctx.client.ipDay() }) },
    ];
    const store = createMemoryStore(realClock);
    const measure = async (g: EdgeGate): Promise<number> => {
      const dispatch = createDispatcher({ routes, middleware: [], deps: depsWith(silent, store), edge: g });
      const headers = edge('198.51.100.7;UA');
      for (let i = 0; i < 50; i += 1) await dispatch(req(headers, '/api/t'));
      const samples: number[] = [];
      for (let i = 0; i < 1_000; i += 1) {
        const start = performance.now();
        const res = await dispatch(req(headers, '/api/t'));
        samples.push(performance.now() - start);
        expect(res.status).toBe(200);
      }
      return p95(samples);
    };
    const run = async () => (await measure(gate({ fast: store }))) - (await measure(inactiveEdgeGate(fixedClock())));
    // One retry on a loaded machine; the bound is never loosened.
    const first = await run();
    const overhead = first <= 1 ? first : await run();
    expect(overhead).toBeLessThanOrEqual(1);
  });
});

describe('declarative subject-data row (SPEC-05 AC-31)', () => {
  it('a declarative row beside a handler → no throw, the row is named, the handler ran', async () => {
    const handler = { capability: 'chat', export: async () => 1, erase: async () => 2, anonymise: async () => 3 };
    const declaration = { capability: 'ip-day-fingerprint', declarative: true as const, retention: '<= 24 h', description: 'rate-limit key' };
    expect(await runSubjectData('erase', 's-1', [declaration, handler])).toEqual({
      ok: true,
      results: { chat: 2 },
      declarative: ['ip-day-fingerprint'],
    });
  });
});
