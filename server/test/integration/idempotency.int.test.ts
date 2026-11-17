import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { payloadOf } from '../../src/container';
import { createDispatcher, originMiddleware, validateMiddleware } from '../../src/endpoints/pipeline';
import type { Deps, Middleware, RouteRow } from '../../src/endpoints/types';
import { CHAT_RETENTION_MS, idemKey, type IdempotencyRow } from '../../src/platform/idempotency';
import { idempotencyMiddleware, rateLimitMiddleware } from '../../src/registries/middleware';
import { ownRedis, post, testDeps } from './helpers';

const RUN = `${Date.now().toString(36)}`;
const rows: IdempotencyRow[] = [
  { method: 'test.chat', retention: 'chat' },
  { method: 'test.chat2', retention: 'chat' },
  { method: 'test.order', retention: 'order' },
  { method: 'test.slow', retention: 'chat' },
];

/** Test-local subject: from a header (real subjects arrive with SPEC-10). */
const subjectFromHeader: Middleware = {
  key: '15-subject',
  async run(ctx, next) {
    ctx.subject = ctx.req.headers.get('x-test-subject') ?? undefined;
    return next();
  },
};

const middleware = [originMiddleware, subjectFromHeader, validateMiddleware, rateLimitMiddleware([]), idempotencyMiddleware(rows)];
const body = z.object({ clientId: z.string(), text: z.string().optional() });

const counters: Record<string, number> = {};
let release: () => void = () => {};
let latch = Promise.resolve();

function route(method: string, wait = false): RouteRow {
  return {
    key: method,
    method: 'POST',
    path: `/api/sample/${method}`,
    body,
    idempotency: method,
    async handler() {
      counters[method] = (counters[method] ?? 0) + 1;
      if (wait) await latch;
      return { ok: true, value: { method, n: counters[method] } };
    },
  };
}

const routes = [route('test.chat'), route('test.chat2'), route('test.order'), route('test.slow', true)];
const redisStores = [ownRedis()];
const deps = testDeps({ redis: redisStores[0] });
const dispatch = createDispatcher({ routes, middleware, deps });

const call = (d: (r: Request) => Promise<Response>, method: string, clientId: string, subject = `alice-${RUN}`) =>
  d(post(`/api/sample/${method}`, { clientId }, { 'x-test-subject': subject }));

afterAll(async () => {
  const redis = redisStores[redisStores.length - 1] as (typeof redisStores)[number];
  await redis.deleteByPrefix('idem:test.');
  const payload = await payloadOf(deps)();
  await payload.delete({ collection: 'idempotency-records', where: { key: { like: 'idem:test.order' } }, overrideAccess: true });
  for (const r of redisStores) await r.close();
});

describe('idempotency by clientId', () => {
  it('AC-52: a repeat returns the first stored result and the handler runs once', async () => {
    const cid = `c52-${RUN}`;
    const before = counters['test.chat'] ?? 0;
    const first = await call(dispatch, 'test.chat', cid);
    const again = await call(dispatch, 'test.chat', cid);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe(await first.text());
    expect((counters['test.chat'] ?? 0) - before).toBe(1);
  });

  it('AC-53: the same clientId for another subject or another method is a new request', async () => {
    const cid = `c53-${RUN}`;
    const chat = counters['test.chat'] ?? 0;
    const chat2 = counters['test.chat2'] ?? 0;
    expect((await call(dispatch, 'test.chat', cid)).status).toBe(200);
    expect((await call(dispatch, 'test.chat', cid, `bob-${RUN}`)).status).toBe(200);
    expect((await call(dispatch, 'test.chat2', cid)).status).toBe(200);
    expect((counters['test.chat'] ?? 0) - chat).toBe(2);
    expect((counters['test.chat2'] ?? 0) - chat2).toBe(1);
  });

  it('AC-54: a duplicate while the first still runs → 409 conflict / in-progress', async () => {
    const cid = `c54-${RUN}`;
    latch = new Promise<void>((r) => {
      release = r;
    });
    const before = counters['test.slow'] ?? 0;
    const [first, second] = await Promise.all([
      call(dispatch, 'test.slow', cid),
      (async () => {
        while ((counters['test.slow'] ?? 0) === before) await new Promise((r) => setTimeout(r, 5));
        const res = await call(dispatch, 'test.slow', cid);
        release();
        return res;
      })(),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ ok: false, error: { code: 'conflict', reason: 'in-progress' } });
    expect((counters['test.slow'] ?? 0) - before).toBe(1);
  });

  it('AC-55: chat keys live ≥ 24 h in Redis; order records survive a new Redis client (Postgres)', async () => {
    const cid = `c55-${RUN}`;
    expect((await call(dispatch, 'test.chat', cid)).status).toBe(200);
    const raw = new Redis(process.env.REDIS_URL as string, { keyPrefix: process.env.T2F_REDIS_PREFIX, lazyConnect: true });
    try {
      await raw.connect();
      const pttl = await raw.pttl(idemKey(`alice-${RUN}`, 'test.chat', cid));
      expect(pttl).toBeGreaterThanOrEqual(86_400_000);
      expect(pttl).toBeLessThanOrEqual(CHAT_RETENTION_MS);
    } finally {
      raw.disconnect();
    }

    const before = counters['test.order'] ?? 0;
    const first = await call(dispatch, 'test.order', cid);
    expect(first.status).toBe(200);
    await (redisStores[0] as (typeof redisStores)[number]).close();

    const fresh = ownRedis();
    redisStores.push(fresh);
    const deps2: Deps = testDeps({ redis: fresh, payload: payloadOf(deps) });
    const dispatch2 = createDispatcher({ routes, middleware, deps: deps2 });
    const again = await call(dispatch2, 'test.order', cid);
    expect(again.status).toBe(200);
    // jsonb keeps the value, not the key order of the text.
    expect(await again.json()).toEqual(await first.json());
    expect((counters['test.order'] ?? 0) - before).toBe(1);
    expect(await fresh.get(idemKey(`alice-${RUN}`, 'test.order', cid))).toBeNull();
  });
});
