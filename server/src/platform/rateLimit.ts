/**
 * Rate limits (ring 3): fixed-window counters over the `FastStore` port (AC-48 … AC-51).
 * Depends on `ports.ts` only — never on a Redis client (onion ban 2).
 */
import type { ApiError } from '@time2fest/contracts';
import { DependencyUnavailable, type FastStore } from '../ports';

export type RateLimitKeyKind = 'subject' | 'device' | 'ipDay';

/**
 * One limit. Every field is required and none has a default (AC-48): a row without its
 * Redis-down policy does not typecheck.
 */
export interface RateLimitRow {
  key: string;
  limit: number;
  windowMs: number;
  keys: readonly RateLimitKeyKind[];
  /** When the fast store is unavailable: refuse (`fail-closed`) or count in this process (`memory`). */
  onStoreDown: 'fail-closed' | 'memory';
}

/** Who is being counted. A kind with no value is skipped. */
export interface LimitTarget {
  subject?: string;
  device?: string;
  /** The daily client fingerprint or the no-address bucket (SPEC-05 AC-28). */
  ipDay?: string;
}

export interface LimitStores {
  fast: FastStore;
  memory: FastStore;
}

export type LimitResult = { ok: true } | { ok: false; error: ApiError };

/** The store keys of `row` for `target`; a row with no resolvable kind counts everyone together. */
export function limitKeys(row: RateLimitRow, target: LimitTarget): string[] {
  const out: string[] = [];
  for (const kind of row.keys) {
    const value = target[kind];
    if (value !== undefined && value !== '') out.push(`rl:${row.key}:${kind}:${value}`);
  }
  return out.length > 0 ? out : [`rl:${row.key}:all`];
}

async function countIn(store: FastStore, row: RateLimitRow, keys: readonly string[]): Promise<LimitResult> {
  for (const key of keys) {
    const { count, ttlMs } = await store.incrWindow(key, row.windowMs);
    if (count > row.limit) {
      const retryAfterMs = Math.max(1, Math.ceil(ttlMs > 0 ? ttlMs : row.windowMs));
      return { ok: false, error: { code: 'rate_limited', retryAfterMs } };
    }
  }
  return { ok: true };
}

/**
 * Keyed limits (SPEC-10 W22): for a target outside `subject | device | ipDay` (an email hash, the IPv6 /48 key) the
 * caller passes the key value itself. The window is aligned to `nowMs` (window index = ⌊now / windowMs⌋), so the
 * remaining time is known without reading a TTL and a limit can be PEEKED before the counted work and COUNTED after
 * it ([П-8]). `key` must not contain personal data (hashes only). A store outage follows `row.onStoreDown`.
 */
function keyedKey(row: RateLimitRow, key: string, nowMs: number): { storeKey: string; retryAfterMs: number } {
  const index = Math.floor(nowMs / row.windowMs);
  return { storeKey: `rl:${row.key}:k:${key}:${index}`, retryAfterMs: Math.max(1, (index + 1) * row.windowMs - nowMs) };
}

async function keyedIn(
  stores: LimitStores,
  row: RateLimitRow,
  run: (store: FastStore) => Promise<number>,
  retryAfterMs: number,
  allowedCount: number,
): Promise<LimitResult> {
  let count: number;
  try {
    count = await run(stores.fast);
  } catch (err) {
    if (!(err instanceof DependencyUnavailable)) throw err;
    if (row.onStoreDown === 'fail-closed') return { ok: false, error: { code: 'unavailable' } };
    count = await run(stores.memory);
  }
  return count > allowedCount ? { ok: false, error: { code: 'rate_limited', retryAfterMs } } : { ok: true };
}

/** Counts one hit of `key` against `row`; the hit over `row.limit` → `rate_limited` + `retryAfterMs` to the window end. */
export async function checkKeyedLimit(row: RateLimitRow, key: string, stores: LimitStores, nowMs: number): Promise<LimitResult> {
  const { storeKey, retryAfterMs } = keyedKey(row, key, nowMs);
  return keyedIn(stores, row, async (s) => (await s.incrWindow(storeKey, row.windowMs)).count, retryAfterMs, row.limit);
}

/** Whether one more hit of `key` would pass, without counting it (the window already holds `row.limit` → refused). */
export async function peekKeyedLimit(row: RateLimitRow, key: string, stores: LimitStores, nowMs: number): Promise<LimitResult> {
  const { storeKey, retryAfterMs } = keyedKey(row, key, nowMs);
  return keyedIn(stores, row, async (s) => Number((await s.get(storeKey)) ?? '0') + 1, retryAfterMs, row.limit);
}

/** Counts one request against `row`; over the limit → `rate_limited` with `retryAfterMs > 0` (AC-49). */
export async function checkLimit(row: RateLimitRow, target: LimitTarget, stores: LimitStores): Promise<LimitResult> {
  const keys = limitKeys(row, target);
  try {
    return await countIn(stores.fast, row, keys);
  } catch (err) {
    if (!(err instanceof DependencyUnavailable)) throw err;
    if (row.onStoreDown === 'fail-closed') return { ok: false, error: { code: 'unavailable' } };
    return countIn(stores.memory, row, keys);
  }
}
