/**
 * Shared dependencies stopped (AC-50, AC-72; AC-3 is added by W24). Runs only under
 * `pnpm --dir server test:int:exclusive`, which holds the machine's exclusive integration lock:
 * it stops and starts the shared containers of the `t2f` compose project, so no other
 * worktree may be testing meanwhile. Every stopped service is started again in `finally`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { createDispatcher } from '../../src/endpoints/pipeline';
import { inactiveEdgeGate } from '../../src/platform/edge';
import type { RouteRow } from '../../src/endpoints/types';
import { timeRoute } from '../../src/endpoints/time';
import type { RateLimitRow } from '../../src/platform/rateLimit';
import { middlewareRegistry, rateLimitMiddleware } from '../../src/registries/middleware';
import { BASE, ownRedis, testDeps } from '../integration/helpers';

const COMPOSE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docker-compose.yml');

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', 't2f', '-f', COMPOSE_FILE, ...args], {
    stdio: 'pipe',
    timeout: 120_000,
    encoding: 'utf8',
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts the same container again (never recreates it) and waits until it is healthy. */
async function startAndWait(service: string): Promise<void> {
  compose('start', service);
  const id = compose('ps', '-q', service).trim();
  for (let i = 0; i < 120; i += 1) {
    const health = execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', id], { encoding: 'utf8' }).trim();
    if (health === 'healthy') return;
    await sleep(500);
  }
  throw new Error(`${service} did not become healthy`);
}

const run = `${Date.now().toString(36)}`;
const closed: RateLimitRow = { key: `x-closed-${run}`, limit: 3, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' };
const memory: RateLimitRow = { key: `x-memory-${run}`, limit: 3, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' };

const routes: RouteRow[] = [
  timeRoute,
  { key: 'closed', method: 'GET', path: '/api/sample/closed', rateLimit: closed.key, handler: async () => ({ ok: true, value: 1 }) },
  { key: 'memory', method: 'GET', path: '/api/sample/memory', rateLimit: memory.key, handler: async () => ({ ok: true, value: 1 }) },
  {
    key: 'db',
    method: 'GET',
    path: '/api/sample/db',
    needs: ['db'],
    async handler(ctx) {
      const payload = await payloadOf(ctx.deps)();
      const found = await payload.find({ collection: 'idempotency-records', limit: 1, depth: 0, overrideAccess: true });
      return { ok: true, value: found.totalDocs };
    },
  },
];

const redis = ownRedis();
const deps = testDeps({ redis });
const middleware = middlewareRegistry.map((m) => (m.key === '30-rate-limit' ? rateLimitMiddleware([closed, memory]) : m));
const dispatch = createDispatcher({ routes, middleware, deps, edge: inactiveEdgeGate(deps.clock) });
const get = (p: string) => dispatch(new Request(BASE + p));

afterAll(async () => {
  await redis.deleteByPrefix('rl:x-').catch(() => 0);
  await redis.close();
});

describe('dependencies down (exclusive lock)', () => {
  it('AC-50: Redis stopped → fail-closed row answers 503 unavailable; memory row still enforces its limit', async () => {
    expect((await get('/api/sample/closed')).status).toBe(200); // connected before the stop
    compose('stop', 'redis');
    try {
      await sleep(500);
      const refused = await get('/api/sample/closed');
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ ok: false, error: { code: 'unavailable' } });

      for (let i = 0; i < 3; i += 1) expect((await get('/api/sample/memory')).status).toBe(200);
      const limited = await get('/api/sample/memory');
      expect(limited.status).toBe(429);
      const body = (await limited.json()) as { error: { code: string; retryAfterMs?: number } };
      expect(body.error.code).toBe('rate_limited');
      expect(body.error.retryAfterMs).toBeGreaterThan(0);
    } finally {
      await startAndWait('redis');
    }
  });

  it('AC-72: Postgres stopped → a needs-db route answers 503 unavailable while /api/time answers 200', async () => {
    expect((await get('/api/sample/db')).status).toBe(200); // Payload initialised before the stop
    compose('stop', 'postgres');
    try {
      await sleep(500);
      const refused = await get('/api/sample/db');
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ ok: false, error: { code: 'unavailable' } });
      const time = await get('/api/time');
      expect(time.status).toBe(200);
      expect(Number.isInteger(((await time.json()) as { now: number }).now)).toBe(true);
    } finally {
      await startAndWait('postgres');
    }
  });
});
