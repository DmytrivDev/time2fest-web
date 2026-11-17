/**
 * SPEC-13a AC-5, AC-6: `GET /api/health` through the full dispatcher against this slot's real
 * Postgres and Redis. 200 with the commit when both answer; 503 `{"ok":false}` (no host, no error
 * text) when Redis does not; behind the edge gate like every `/api/*` path.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf } from '../../src/container';
import { createRedisStore, type RedisStore } from '../../src/adapters/redis';
import { BASE, ownRedis, testDeps } from './helpers';

const COMMIT = randomBytes(20).toString('hex');
// Built at runtime: no secret-looking literal in the test.
const SECRET = randomBytes(24).toString('hex');
const redis = ownRedis();
// Port 1 on loopback: nothing listens there, so every connection is refused at once.
const deadRedis: RedisStore = createRedisStore({ REDIS_URL: 'redis://127.0.0.1:1/0', T2F_REDIS_PREFIX: 't2f:test:health:' });

const get = (path: string, edge?: string) =>
  new Request(BASE + path, { headers: edge === undefined ? {} : { 'x-t2f-edge': edge } });

async function shape(res: Response) {
  const headers = [...res.headers.entries()].filter(([k]) => k !== 'date').sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, body: await res.text(), headers };
}

beforeAll(async () => {
  // The first Payload start can take longer than the 2 s cap; the deploy tolerates that by polling.
  await payloadOf(testDeps({ redis }))();
});

afterAll(async () => {
  await redis.close();
  await deadRedis.close();
});

describe('GET /api/health (SPEC-13a AC-5, AC-6)', () => {
  it('AC-5: database and Redis answer → 200, the exact body with T2F_COMMIT, Cache-Control private, no-store', async () => {
    const dispatch = await buildDispatcher(testDeps({ redis }, { T2F_COMMIT: COMMIT }));
    const res = await dispatch(get('/api/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).toBe(JSON.stringify({ ok: true, commit: COMMIT }));
  });

  it('AC-6: Redis on a closed loopback port → 503 with body exactly {"ok":false} within 3 s', async () => {
    const dispatch = await buildDispatcher(testDeps({ redis: deadRedis }, { T2F_COMMIT: COMMIT }));
    const started = Date.now();
    const res = await dispatch(get('/api/health'));
    expect(Date.now() - started).toBeLessThanOrEqual(3_000);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('{"ok":false}');
  });

  it('class test with an edge secret: no x-t2f-edge → the single 404 of an unknown path; with it → 200', async () => {
    const dispatch = await buildDispatcher(testDeps({ redis }, { T2F_EDGE_SECRET: SECRET, T2F_COMMIT: COMMIT }));
    const unknown = await shape(await dispatch(get('/api/nope')));
    expect(unknown.status).toBe(404);
    expect(await shape(await dispatch(get('/api/health')))).toEqual(unknown);
    expect((await dispatch(get('/api/health', SECRET))).status).toBe(200);
  });
});
