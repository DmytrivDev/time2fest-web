/**
 * Readiness adapter (ring 4, SPEC-13a AC-5/AC-6): `select 1` on the Payload pool and one read of
 * the fast store, in parallel, raced against a single timer. Any failure or timeout is `false`;
 * nothing is rethrown and nothing is logged (no host names, no error text leave this module).
 * The timer is I/O time, not business time, so it is a plain `setTimeout`, not the injected clock.
 * Load bound (S3): concurrent checks share one in-flight check, and its answer is reused for
 * `READY_TTL_MS` (a failure for `NOT_READY_TTL_MS`), so the database and the fast store see about
 * one check per second whatever the request rate. `now` is injectable for tests only.
 */
import type { Payload } from 'payload';
import type { ReadinessProbe } from '../health/ports';
import type { FastStore } from '../ports';

type QueryablePool = { query?: (sql: string) => Promise<unknown> };

/** How long a passing check is reused. */
export const READY_TTL_MS = 1_000;
/** How long a failing check is reused: shorter, so recovery shows quickly, but a down dependency is not hammered. */
export const NOT_READY_TTL_MS = 500;

async function databaseAnswers(payload: () => Promise<Payload>): Promise<boolean> {
  const instance = await payload();
  // Same unsafe-cast pattern as `guardPool`: the adapter's pool is not in Payload's public type.
  const pool = (instance.db as unknown as { pool?: QueryablePool }).pool;
  if (typeof pool?.query !== 'function') return false;
  await pool.query('select 1');
  return true;
}

async function fastStoreAnswers(fast: FastStore): Promise<boolean> {
  await fast.get('health:probe');
  return true;
}

async function checkOnce(payload: () => Promise<Payload>, fast: FastStore, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  const both = Promise.all([databaseAnswers(payload), fastStoreAnswers(fast)]).then(
    ([db, redis]) => db && redis,
    () => false,
  );
  try {
    return await Promise.race([both, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createReadinessProbe({
  payload,
  fast,
  now = Date.now,
}: {
  payload: () => Promise<Payload>;
  fast: FastStore;
  now?: () => number;
}): ReadinessProbe {
  let inflight: Promise<boolean> | undefined;
  let cached: { ready: boolean; until: number } | undefined;
  return {
    check(timeoutMs) {
      if (cached && now() < cached.until) return Promise.resolve(cached.ready);
      inflight ??= checkOnce(payload, fast, timeoutMs).then((ready) => {
        cached = { ready, until: now() + (ready ? READY_TTL_MS : NOT_READY_TTL_MS) };
        inflight = undefined;
        return ready;
      });
      return inflight;
    },
  };
}
