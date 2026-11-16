import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { Deps } from '../../src/endpoints/types';
import type { IdempotencyRow } from '../../src/platform/idempotency';
import { checkLimit, ipDayKey, limitKeys, type RateLimitRow } from '../../src/platform/rateLimit';
import { assertRegistry } from '../../src/platform/registry';
import { idempotencyRegistry } from '../../src/registries/idempotency';
import { rateLimitMiddleware } from '../../src/registries/middleware';
import { momentsRegistry } from '../../src/registries/moments';
import { rateLimitRegistry } from '../../src/registries/rateLimits';
import { subjectDataRegistry } from '../../src/registries/subjectData';
import { DependencyUnavailable, type FastStore } from '../../src/ports';

const clock = { now: () => Date.parse('2026-12-31T23:59:00Z') };

describe('platform mechanisms', () => {
  it('AC-48: a rate-limit row without its Redis-down policy does not typecheck', () => {
    // @ts-expect-error — `onStoreDown` is required, with no default.
    const row: RateLimitRow = { key: 'x', limit: 1, windowMs: 1_000, keys: ['subject'] };
    expect(row.key).toBe('x');
  });

  it('AC-55: an idempotency row without its retention class does not typecheck', () => {
    // @ts-expect-error — `retention` is required, with no default.
    const row: IdempotencyRow = { method: 'chat.send' };
    expect(row.method).toBe('chat.send');
  });

  it('AC-51: the ipDay key ignores forged X-Forwarded-For and X-Real-IP', async () => {
    const row: RateLimitRow = { key: 'r', limit: 1, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'fail-closed' };
    expect(ipDayKey(clock)).toBe('ipday:stub:2026-12-31');
    expect(limitKeys(row, { clock })).toEqual(['rl:r:ipDay:ipday:stub:2026-12-31']);

    const store = createMemoryStore(realClock);
    const deps: Deps = {
      env: { class: 'test', vars: {} },
      clock,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      alarm: { raise: () => {} },
      payload: () => Promise.reject(new Error('not used')),
      lockState: { holdsExclusive: () => false },
      redis: store,
      memory: createMemoryStore(realClock),
      orderStore: { begin: () => Promise.reject(new Error('not used')), finish: async () => {}, abort: async () => {} },
    };
    const dispatch = createDispatcher({
      routes: [{ key: 'r', method: 'GET', path: '/api/r', rateLimit: 'r', handler: async () => ({ ok: true, value: 1 }) }],
      middleware: [rateLimitMiddleware([row])],
      deps,
    });
    const first = await dispatch(
      new Request('http://server.test/api/r', { headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7' } }),
    );
    expect(first.status).toBe(200);
    // Another forged address does not open a new counter: the key is the same, so the limit holds.
    const forged = await dispatch(
      new Request('http://server.test/api/r', { headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1', 'x-real-ip': '198.51.100.9' } }),
    );
    expect(forged.status).toBe(429);
    expect(await store.get('rl:r:ipDay:ipday:stub:2026-12-31')).toBe('2');
  });

  it('AC-50 (logic): store down → fail-closed refuses, memory keeps counting', async () => {
    const down: FastStore = {
      incrWindow: () => Promise.reject(new DependencyUnavailable('redis')),
      setIfAbsent: () => Promise.reject(new DependencyUnavailable('redis')),
      get: () => Promise.reject(new DependencyUnavailable('redis')),
      set: () => Promise.reject(new DependencyUnavailable('redis')),
      del: () => Promise.reject(new DependencyUnavailable('redis')),
      deleteByPrefix: () => Promise.reject(new DependencyUnavailable('redis')),
    };
    const stores = { fast: down, memory: createMemoryStore(clock) };
    const closed: RateLimitRow = { key: 'c', limit: 3, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' };
    expect(await checkLimit(closed, { subject: 's', clock }, stores)).toEqual({ ok: false, error: { code: 'unavailable' } });

    const memory: RateLimitRow = { ...closed, key: 'm', onStoreDown: 'memory' };
    for (let i = 0; i < 3; i += 1) expect((await checkLimit(memory, { subject: 's', clock }, stores)).ok).toBe(true);
    const fourth = await checkLimit(memory, { subject: 's', clock }, stores);
    expect(fourth).toEqual({ ok: false, error: { code: 'rate_limited', retryAfterMs: 60_000 } });
  });

  it('AC-62: the rate-limit, idempotency, moments and subject-data registries are sorted and unique', () => {
    const registries: [string, readonly unknown[], (row: never) => string][] = [
      ['rate-limits', rateLimitRegistry, (r: RateLimitRow) => r.key],
      ['idempotency', idempotencyRegistry, (r: IdempotencyRow) => r.method],
      ['moments', momentsRegistry, (r: { key: string }) => r.key],
      ['subject-data', subjectDataRegistry, (r: { capability: string }) => r.capability],
    ];
    for (const [name, rows, keyOf] of registries) {
      expect(() => assertRegistry(name, rows as never[], keyOf)).not.toThrow();
    }
    expect(() => assertRegistry('x', [{ k: 'b' }, { k: 'a' }], (r) => r.k)).toThrow(/out of order/);
  });
});
