/**
 * Seed and worktree reset (AC-45 … AC-47, AC-39). Ring 3: talks to storage only through the
 * `SeedStore` and `FastStore` ports; the composition root and the doors wire the adapters.
 * - `runSeed` upserts by natural key, so a second run changes no count (AC-46). Every source
 *   is checked against the AC-45 list before any row is read.
 * - `resetWorktree` touches only what this process is configured for: the rows of the
 *   resettable collections in its own database, and the Redis keys under its own prefix.
 */
import { WORKTREE_REDIS_PREFIX } from '../platform/env';
import type { FastStore, SeedStore } from '../ports';
import { isAllowedSource, seedRegistry, type SeedRow } from './registry';

export type SeedCounts = Record<string, number>;

/** The part of a collection row the reset needs. */
export interface ResettableCollection {
  key: string;
  resettable: boolean;
}

/** The rows the seed applies by itself: everything but fixtures. */
export function baseSeedRows(rows: readonly SeedRow[] = seedRegistry): SeedRow[] {
  return rows.filter((r) => !r.fixture);
}

/** A repeated key keeps its last row (what writing the rows one after another would leave). */
function lastPerKey(records: readonly Record<string, unknown>[], naturalKey: string): Record<string, unknown>[] {
  return [...new Map(records.map((r) => [String(r[naturalKey]), r])).values()];
}

/** Upserts every row; returns the row count of each touched collection. */
export async function runSeed(store: SeedStore, rows: readonly SeedRow[]): Promise<SeedCounts> {
  const refused = rows.filter((r) => !isAllowedSource(r.source));
  if (refused.length > 0) throw new Error(`seed: source not allowed for ${refused.map((r) => r.key).join(', ')}`);

  const counts: SeedCounts = {};
  for (const row of rows) {
    const records: Record<string, unknown>[] = [];
    for (const data of await row.rows()) {
      const record = data as Record<string, unknown>;
      const natural = record[row.naturalKey];
      if (natural === undefined || natural === null || natural === '') {
        throw new Error(`seed: ${row.key} has a row without ${row.naturalKey}`);
      }
      records.push(record);
    }
    if (store.upsertMany) await store.upsertMany(row.collection, row.naturalKey, lastPerKey(records, row.naturalKey));
    else for (const record of records) await store.upsertByKey(row.collection, row.naturalKey, record);
    counts[row.collection] = await store.count(row.collection);
  }
  return counts;
}

export interface ResetDeps {
  store: SeedStore;
  /** The client applies this worktree's key prefix; only keys under it are deleted. */
  fast: FastStore;
  /** The prefix the `fast` client applies; checked before anything is deleted (no half reset). */
  redisPrefix: unknown;
  /** The shared test clock: its reset writes the clock-state store (SPEC-07 W14). */
  clock: { reset(): Promise<void> };
  collections: readonly ResettableCollection[];
  rows: readonly SeedRow[];
}

/** Empties the resettable collections and own Redis keys, resets the clock, then seeds (AC-47). */
export async function resetWorktree(deps: ResetDeps): Promise<SeedCounts> {
  if (typeof deps.redisPrefix !== 'string' || !WORKTREE_REDIS_PREFIX.test(deps.redisPrefix)) {
    throw new Error('reset: T2F_REDIS_PREFIX is not a worktree prefix');
  }
  for (const c of deps.collections.filter((r) => r.resettable)) await deps.store.clear(c.key);
  await deps.fast.deleteByPrefix('');
  await deps.clock.reset();
  return runSeed(deps.store, deps.rows);
}
