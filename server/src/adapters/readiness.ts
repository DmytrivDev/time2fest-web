/**
 * Readiness adapter (ring 4, SPEC-13a AC-5/AC-6): `select 1` on the Payload pool and one read of
 * the fast store, in parallel, raced against a single timer. Any failure or timeout is `false`;
 * nothing is rethrown and nothing is logged (no host names, no error text leave this module).
 * The timer is I/O time, not business time, so it is a plain `setTimeout`, not the injected clock.
 */
import type { Payload } from 'payload';
import type { ReadinessProbe } from '../health/ports';
import type { FastStore } from '../ports';

type QueryablePool = { query?: (sql: string) => Promise<unknown> };

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

export function createReadinessProbe({ payload, fast }: { payload: () => Promise<Payload>; fast: FastStore }): ReadinessProbe {
  return {
    async check(timeoutMs) {
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
    },
  };
}
