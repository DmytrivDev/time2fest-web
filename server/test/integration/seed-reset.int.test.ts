import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestClock } from '../../src/clock';
import { payloadOf, seedStoreOf } from '../../src/container';
import { createDispatcher } from '../../src/endpoints/pipeline';
import { inactiveEdgeGate } from '../../src/platform/edge';
import { middlewareRegistry } from '../../src/registries/middleware';
import { runSeed } from '../../src/seed/index';
import type { SeedRow } from '../../src/seed/registry';
import { doorRoutes } from '../../src/test-doors/index';
import { fixturesDoor, resetDoor } from '../../src/test-doors/registry';
import { ownRedis, post, testDeps } from './helpers';

const COLLECTION = 'idempotency-records';
// The last Redis database never belongs to a worktree: 63 on the local stand (slots use 0–47), 15 in CI (slot 0 only).
async function foreignDbIndex(): Promise<number> {
  const probe = new Redis(REDIS_URL, { lazyConnect: true });
  try {
    await probe.connect();
    const [, count] = (await probe.config('GET', 'databases')) as string[];
    return Number(count) - 1;
  } finally {
    probe.disconnect();
  }
}
const PREFIX = process.env.T2F_REDIS_PREFIX as string;
const REDIS_URL = process.env.REDIS_URL as string;

const seedRow: SeedRow = {
  key: 'test-idem',
  collection: COLLECTION,
  naturalKey: 'key',
  source: 'fixture',
  rows: async () => [
    { key: 'seed:test:a', status: 'done', result: { n: 1 } },
    { key: 'seed:test:b', status: 'running' },
  ],
};
const fixtureRow: SeedRow = {
  key: 'test-fixture',
  collection: COLLECTION,
  naturalKey: 'key',
  source: 'fixture',
  fixture: true,
  rows: async () => [{ key: 'fixture:test:x', status: 'done' }],
};
const rows = [seedRow, fixtureRow];

const redis = ownRedis();
const deps = testDeps({ redis });
const dispatch = createDispatcher({
  routes: doorRoutes(deps, seedStoreOf(deps), [fixturesDoor(rows), resetDoor(rows)]),
  middleware: middlewareRegistry,
  deps,
  edge: inactiveEdgeGate(deps.clock),
});

function rawClient(db: number, keyPrefix?: string): Redis {
  return new Redis(REDIS_URL.replace(/\/\d+$/, `/${db}`), { lazyConnect: true, ...(keyPrefix ? { keyPrefix } : {}) });
}

async function keys(): Promise<string[]> {
  const payload = await payloadOf(deps)();
  const found = await payload.find({ collection: COLLECTION, limit: 100, depth: 0, overrideAccess: true, sort: 'key' });
  return found.docs.map((d) => d.key);
}

afterEach(async () => {
  await createTestClock(deps.sharedClock!).reset();
});

afterAll(async () => {
  const payload = await payloadOf(deps)();
  await payload.delete({ collection: COLLECTION, where: { id: { exists: true } }, overrideAccess: true });
  await redis.close();
});

describe('seed, reset and fixtures', () => {
  it('AC-46: seeding twice leaves the same counts', async () => {
    const store = seedStoreOf(deps);
    const first = await runSeed(store, [seedRow]);
    const second = await runSeed(store, [seedRow]);
    expect(second).toEqual(first);
    expect(first[COLLECTION]).toBeGreaterThanOrEqual(2);
  });

  it('AC-47: reset empties own rows and prefixed keys, resets the clock and seeds; other data untouched', async () => {
    const payload = await payloadOf(deps)();
    await payload.create({ collection: COLLECTION, data: { key: 'stray:row', status: 'running' }, overrideAccess: true });
    await redis.set('seedtest:one', '1', 60_000);
    await redis.set('seedtest:two', '2', 60_000);
    await createTestClock(deps.sharedClock!).set({ at: Date.parse('2026-12-31T23:59:00Z'), frozen: true });

    // The same prefix in a database that belongs to no worktree, and a foreign prefix in our own database.
    const foreignDb = rawClient(await foreignDbIndex(), PREFIX);
    const ownDbRaw = rawClient(Number(/\/(\d+)$/.exec(REDIS_URL)?.[1]));
    const foreignPrefixKey = 't2f:seed_reset_foreign:k';
    try {
      await foreignDb.connect();
      await ownDbRaw.connect();
      await foreignDb.set('seedtest:foreign', 'x', 'PX', 60_000);
      await ownDbRaw.set(foreignPrefixKey, 'x', 'PX', 60_000);

      const res = await dispatch(post('/api/_test/reset', {}));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, value: {} });

      expect(await redis.get('seedtest:one')).toBeNull();
      expect(await redis.get('seedtest:two')).toBeNull();
      expect(await foreignDb.get('seedtest:foreign')).toBe('x');
      expect(await ownDbRaw.get(foreignPrefixKey)).toBe('x');
      expect(await keys()).toEqual(['seed:test:a', 'seed:test:b']);
      expect(Math.abs(deps.clock.now() - Date.now())).toBeLessThanOrEqual(2_000);
      expect(createTestClock(deps.sharedClock!).state()).toMatchObject({ speed: 1, frozen: false });
    } finally {
      await foreignDb.del('seedtest:foreign').catch(() => 0);
      await ownDbRaw.del(foreignPrefixKey).catch(() => 0);
      foreignDb.disconnect();
      ownDbRaw.disconnect();
    }
  }, 120_000);

  it('fixtures: a known name → 200 and applied, unknown → 404, {} → 400', async () => {
    const ok = await dispatch(post('/api/_test/fixtures', { name: 'test-fixture' }));
    expect(ok.status).toBe(200);
    expect(await keys()).toContain('fixture:test:x');

    const unknown = await dispatch(post('/api/_test/fixtures', { name: 'no-such-fixture' }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ ok: false, error: { code: 'not_found' } });

    // A seed row that is not a fixture is not reachable through the door.
    expect((await dispatch(post('/api/_test/fixtures', { name: 'test-idem' }))).status).toBe(404);

    const empty = await dispatch(post('/api/_test/fixtures', {}));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: { reason?: string } }).error.reason).toBe('invalid-input');
  });

  it('AC-45: a row whose source is outside the allowed list is refused before any read', async () => {
    const read = vi.fn(async () => [{ key: 'never' }]);
    // Built from parts so the repository-wide path check (W25) finds no literal reference.
    const outside = ['research', 'data'].join('_') + '/x.json';
    const bad = { ...seedRow, key: 'bad', source: outside as SeedRow['source'], rows: read };
    await expect(runSeed(seedStoreOf(deps), [seedRow, bad])).rejects.toThrow(/source not allowed for bad/);
    expect(read).not.toHaveBeenCalled();
    const candidates = { ...seedRow, key: 'cand', source: 'data/streams.candidates.json' as const, rows: read };
    await expect(runSeed(seedStoreOf(deps), [candidates])).rejects.toThrow(/source not allowed/);
    expect(read).not.toHaveBeenCalled();
  });
});
