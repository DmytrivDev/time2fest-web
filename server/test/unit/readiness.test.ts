/**
 * SPEC-13a S3: the readiness probe bounds its own load — concurrent checks share one in-flight
 * check, and the answer is reused for a short time (a failure too), so a flood of
 * `GET /api/health` reaches the database and the fast store about once per second.
 */
import type { Payload } from 'payload';
import { describe, expect, it, vi } from 'vitest';
import { createReadinessProbe, NOT_READY_TTL_MS, READY_TTL_MS } from '../../src/adapters/readiness';
import type { FastStore } from '../../src/ports';

const TIMEOUT_MS = 2_000;

function world(o: { dbFails?: () => boolean } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const release: (() => void)[] = [];
  const query = vi.fn(
    (sql: string) =>
      new Promise<unknown>((resolve, reject) => {
        release.push(() => (o.dbFails?.() ? reject(new Error(`down: ${sql}`)) : resolve({ rows: [] })));
      }),
  );
  const get = vi.fn(async (key: string) => (key === '' ? 'never' : null));
  const instance = { db: { pool: { query } } } as unknown as Payload;
  const probe = createReadinessProbe({ payload: async () => instance, fast: { get } as unknown as FastStore, now });
  /** Lets the pending check reach the pool, then answers every pending query. */
  const settle = async () => {
    await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
    while (release.length) release.shift()?.();
  };
  return { probe, query, get, settle, advance: (ms: number) => (t += ms) };
}

describe('readiness probe load bound (S3)', () => {
  it('50 concurrent checks run exactly one database and one fast-store check', async () => {
    const w = world();
    const all = Promise.all(Array.from({ length: 50 }, () => w.probe.check(TIMEOUT_MS)));
    await w.settle();
    expect(await all).toEqual(Array.from({ length: 50 }, () => true));
    expect(w.query).toHaveBeenCalledTimes(1);
    expect(w.query).toHaveBeenCalledWith('select 1');
    expect(w.get).toHaveBeenCalledTimes(1);
  });

  it('reuses a passing result within the TTL and checks again after it', async () => {
    const w = world();
    const first = w.probe.check(TIMEOUT_MS);
    await w.settle();
    expect(await first).toBe(true);

    w.advance(READY_TTL_MS - 1);
    expect(await w.probe.check(TIMEOUT_MS)).toBe(true);
    expect(w.query).toHaveBeenCalledTimes(1);

    w.advance(1);
    const again = w.probe.check(TIMEOUT_MS);
    await w.settle();
    expect(await again).toBe(true);
    expect(w.query).toHaveBeenCalledTimes(2);
  });

  it('caches a failed check for a shorter time, then a recovered dependency answers true', async () => {
    let down = true;
    const w = world({ dbFails: () => down });
    const first = w.probe.check(TIMEOUT_MS);
    await w.settle();
    expect(await first).toBe(false);

    w.advance(NOT_READY_TTL_MS - 1);
    expect(await w.probe.check(TIMEOUT_MS)).toBe(false);
    expect(w.query).toHaveBeenCalledTimes(1);

    down = false;
    w.advance(1);
    const again = w.probe.check(TIMEOUT_MS);
    await w.settle();
    expect(await again).toBe(true);
    expect(w.query).toHaveBeenCalledTimes(2);
    expect(NOT_READY_TTL_MS).toBeLessThan(READY_TTL_MS);
  });

  it('keeps the timeout: a hanging database answers false at the cap, shared by every waiter', async () => {
    vi.useFakeTimers();
    try {
      const w = world();
      const all = Promise.all([w.probe.check(TIMEOUT_MS), w.probe.check(TIMEOUT_MS)]);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      expect(await all).toEqual([false, false]);
      expect(w.query).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
