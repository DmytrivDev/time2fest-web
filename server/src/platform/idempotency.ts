/**
 * Idempotency by `clientId` (ring 3, AC-52 … AC-55). Depends on `ports.ts` only.
 * - The key holds the method and the subject, so a stored result is only ever returned to the
 *   same subject for the same method (AC-53).
 * - `chat` keeps its records in the fast store for 24 h; `order` keeps them in Postgres.
 * - Known limit: a process that dies mid-request leaves an `order` record `running`, and the
 *   repeat gets `in-progress` until the record is cleared (SPEC-17).
 */
import type { ApiError } from '@time2fest/contracts';
import type { FastStore, IdempotencyBegin, IdempotencyStore } from '../ports';

export type RetentionClass = 'chat' | 'order';

/** One idempotent method. `retention` is required, with no default (AC-55). */
export interface IdempotencyRow {
  method: string;
  retention: RetentionClass;
}

export type IdempotencyStores = Readonly<Record<RetentionClass, IdempotencyStore>>;

/** At least 24 hours (AC-55): 24 h plus one minute, so a read of the remaining TTL right after the write is still ≥ 24 h. */
export const CHAT_RETENTION_MS = 86_460_000;

export const IN_PROGRESS: { ok: false; error: ApiError } = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'conflict', reason: 'in-progress' }) as ApiError,
});

export function idemKey(subject: string, method: string, clientId: string): string {
  return `idem:${method}:${subject}:${clientId}`;
}

const RUNNING = 'running';

/** An `IdempotencyStore` over the fast store: `running` set with `SET NX PX`, the result kept for `ttlMs`. */
export function fastIdempotencyStore<R = unknown>(store: FastStore, ttlMs: number = CHAT_RETENTION_MS): IdempotencyStore<R> {
  return {
    async begin(key): Promise<IdempotencyBegin<R>> {
      if (await store.setIfAbsent(key, RUNNING, ttlMs)) return 'started';
      const raw = await store.get(key);
      // Expired between the two calls: treat as running; the caller retries.
      if (raw === null || raw === RUNNING) return { status: 'running' };
      return { status: 'done', result: (JSON.parse(raw) as { result: R }).result };
    },
    async finish(key, result) {
      await store.set(key, JSON.stringify({ result }), ttlMs);
    },
    async abort(key) {
      await store.del(key);
    },
  };
}

/**
 * Runs `run` once per key: a repeat after it finished gets the stored result without running
 * it again (AC-52); a repeat while it runs gets `conflict` / `in-progress` (AC-54). A throw
 * forgets the key, so the client may retry.
 */
export async function runOnce<R>(
  row: IdempotencyRow,
  key: string,
  run: () => Promise<R>,
  stores: IdempotencyStores,
): Promise<R | typeof IN_PROGRESS> {
  const store = stores[row.retention] as IdempotencyStore<R>;
  const begun = await store.begin(key);
  if (begun !== 'started') return begun.status === 'running' ? IN_PROGRESS : begun.result;
  let result: R;
  try {
    result = await run();
  } catch (err) {
    await store.abort(key).catch(() => undefined);
    throw err;
  }
  await store.finish(key, result);
  return result;
}
