/** Ports of the catalog (ring 2): technology-neutral; the Payload adapters live in `collections/catalog/hooks.ts`. */
import type { CatalogSnapshot } from '../domain/catalog/integrity';
import type { Tx } from '../events/ports';

/** Reads the whole catalog inside the caller's transaction. */
export interface CatalogReader {
  snapshot(tx: Tx): Promise<CatalogSnapshot>;
}

/** The single season record whose `generatedAt` marks the catalog version. */
export interface SeasonStore {
  current(tx: Tx): Promise<{ id: string; tzdbVersion: string } | null>;
  setGeneratedAt(tx: Tx, id: string, generatedAt: string): Promise<void>;
}
