/**
 * Seed and worktree reset (AC-45 … AC-47, AC-39).
 * - `runSeed` upserts by natural key, so a second run changes no count (AC-46). Every source
 *   is checked against the AC-45 list before any row is read.
 * - `resetWorktree` touches only what this process is configured for: the rows of the
 *   resettable collections in its own database, and the Redis keys under its own prefix.
 */
import type { CollectionSlug, Payload } from 'payload';
import type { FastStore } from '../ports';
import { collectionRegistry, type CollectionRow } from '../registries/collections';
import { isAllowedSource, seedRegistry, type SeedRow } from './registry';

export type SeedCounts = Record<string, number>;

/** The rows the seed applies by itself: everything but fixtures. */
export function baseSeedRows(rows: readonly SeedRow[] = seedRegistry): SeedRow[] {
  return rows.filter((r) => !r.fixture);
}

/** Upserts every row; returns the row count of each touched collection. */
export async function runSeed(payload: Payload, rows: readonly SeedRow[] = baseSeedRows()): Promise<SeedCounts> {
  const refused = rows.filter((r) => !isAllowedSource(r.source));
  if (refused.length > 0) throw new Error(`seed: source not allowed for ${refused.map((r) => r.key).join(', ')}`);

  const counts: SeedCounts = {};
  for (const row of rows) {
    const collection = row.collection as CollectionSlug;
    for (const data of await row.rows()) {
      const natural = (data as Record<string, unknown>)[row.naturalKey];
      if (natural === undefined || natural === null || natural === '') {
        throw new Error(`seed: ${row.key} has a row without ${row.naturalKey}`);
      }
      const found = await payload.find({
        collection,
        where: { [row.naturalKey]: { equals: natural } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      const existing = found.docs[0] as { id: string | number } | undefined;
      if (existing) {
        await payload.update({ collection, id: existing.id, data: data as never, overrideAccess: true });
      } else {
        await payload.create({ collection, data: data as never, overrideAccess: true });
      }
    }
    counts[row.collection] = (await payload.count({ collection, overrideAccess: true })).totalDocs;
  }
  return counts;
}

export interface ResetDeps {
  payload: Payload;
  /** The client applies this worktree's key prefix; only keys under it are deleted. */
  fast: FastStore;
  clock: { reset(): void };
  collections?: readonly CollectionRow[];
  rows?: readonly SeedRow[];
}

/** Empties the resettable collections and own Redis keys, resets the clock, then seeds (AC-47). */
export async function resetWorktree(deps: ResetDeps): Promise<SeedCounts> {
  const { payload } = deps;
  for (const c of (deps.collections ?? collectionRegistry).filter((r) => r.resettable)) {
    await payload.delete({ collection: c.key as CollectionSlug, where: { id: { exists: true } }, overrideAccess: true });
  }
  await deps.fast.deleteByPrefix('');
  deps.clock.reset();
  return runSeed(payload, deps.rows ?? baseSeedRows());
}
