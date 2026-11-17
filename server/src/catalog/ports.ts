/** Ports of the catalog (ring 2): technology-neutral; the Payload adapters live in `collections/catalog/hooks.ts`. */
import type { CatalogSnapshot } from '../domain/catalog/integrity';
import type { Tx } from '../events/ports';

/** Reads the whole catalog inside the caller's transaction. */
export interface CatalogReader {
  snapshot(tx: Tx): Promise<CatalogSnapshot>;
}

/** The single season record whose `generatedAt` marks the catalog version. */
export interface SeasonStore {
  current(tx: Tx): Promise<{ id: string; tzdbVersion: string; generatedAt?: string | null } | null>;
  setGeneratedAt(tx: Tx, id: string, generatedAt: string): Promise<void>;
}

/** The collections the import writes (the season is written on its own). */
export type CatalogCollectionName = 'zones' | 'countries' | 'cities' | 'events' | 'traditions';

/** The whole stored catalog: raw rows (with `id`) per collection, and the season if there is one. */
export interface StoredCatalog {
  season: { id: string; key: string; generatedAt: string; tzdbVersion: string } | null;
  zones: Record<string, unknown>[];
  countries: Record<string, unknown>[];
  cities: Record<string, unknown>[];
  events: Record<string, unknown>[];
  traditions: Record<string, unknown>[];
}

/** Reads the stored catalog: one query per collection (AC-63). */
export interface CatalogStore {
  read(tx?: Tx): Promise<StoredCatalog>;
}

/** What `import catalog --apply` needs: one transaction, reads and writes inside it. */
export interface CatalogImportStore extends CatalogStore {
  begin(): Promise<Tx>;
  commit(tx: Tx): Promise<void>;
  rollback(tx: Tx): Promise<void>;
  /** A write in the import context: the audit hook journals it as `system:import`, the catalog hooks skip it. */
  create(tx: Tx, collection: CatalogCollectionName, data: Record<string, unknown>): Promise<void>;
  /** `silent`: no journal row (only for filling in a missing hash). */
  update(tx: Tx, collection: CatalogCollectionName, id: string, data: Record<string, unknown>, opts?: { silent?: boolean }): Promise<void>;
  /** Creates or updates the season without a journal row of its own (the run's summary row covers it). */
  writeSeason(tx: Tx, season: { id?: string; key: string; generatedAt: string; tzdbVersion: string }): Promise<void>;
}

/** A bucket of an S3-compatible store (Cloudflare R2 in production, an emulator on a worktree stack). */
export interface ObjectStore {
  /** Writes (replaces) one object; the key already carries the environment's prefix. Throws when the write fails. */
  put(key: string, body: string, contentType: string): Promise<void>;
}
