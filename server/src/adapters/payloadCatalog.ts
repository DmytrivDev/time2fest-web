/**
 * Payload adapter of the catalog read and import ports (AC-63, AC-75 … AC-78), ring 4.
 * Reads are one `find` per collection with `pagination: false`, `depth: 0`. The import's writes carry
 * `t2fImport` (catalog hooks skip), `t2fTrusted` (server-side call) and `t2fActor: 'system:import'`
 * (the audit hook journals each write under that actor).
 */
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { CollectionSlug, Payload, PayloadRequest } from 'payload';
import type {
  CatalogCollectionName,
  CatalogImportStore,
  CatalogReader,
  CatalogStore,
  SeasonStore,
  StoredCatalog,
} from '../catalog/ports';
import { toSnapshotRow, type CatalogSnapshot } from '../domain/catalog/integrity';
import type { Tx } from '../events/ports';

const INTEGRITY_KINDS = ['zones', 'countries', 'cities', 'events'] as const;

const READ_CONTEXT = { t2fTrusted: true, t2fInternal: true };
const IMPORT_CONTEXT = { t2fImport: true, t2fTrusted: true, t2fActor: 'system:import' };
const INTERNAL_CONTEXT = { t2fImport: true, t2fInternal: true, t2fTrusted: true };

const COLLECTIONS = ['zones', 'countries', 'cities', 'events', 'traditions'] as const;

function withContext(req: PayloadRequest, context: Record<string, unknown>): PayloadRequest {
  return { ...req, context: { ...req.context, ...context } } as PayloadRequest;
}

async function findAll(payload: Payload, collection: CollectionSlug, req: PayloadRequest | undefined) {
  const found = await payload.find({
    collection,
    ...(req ? { req: withContext(req, READ_CONTEXT) } : { context: READ_CONTEXT }),
    depth: 0,
    pagination: false,
    overrideAccess: true,
  });
  return found.docs as unknown as Record<string, unknown>[];
}

/** THE current season: the one with the lowest id (numeric order). One lookup for the import, the endpoint and the hooks. */
function currentSeasonOf(seasons: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  return [...seasons].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))[0];
}

/** `CatalogReader` over Payload (the integrity hook of the catalog collections). */
export function createPayloadCatalogReader(): CatalogReader {
  return {
    async snapshot(tx) {
      const req = tx as PayloadRequest;
      const [zones, countries, cities, events] = await Promise.all(
        INTEGRITY_KINDS.map((k) => findAll(req.payload, k, req)),
      );
      return {
        zones: (zones ?? []).map((r) => toSnapshotRow('zones', r)),
        countries: (countries ?? []).map((r) => toSnapshotRow('countries', r)),
        cities: (cities ?? []).map((r) => toSnapshotRow('cities', r)),
        events: (events ?? []).map((r) => toSnapshotRow('events', r)),
      } satisfies CatalogSnapshot;
    },
  };
}

/** `SeasonStore` over Payload (the version bump of the catalog hooks). */
export function createPayloadSeasonStore(): SeasonStore {
  return {
    async current(tx) {
      const req = tx as PayloadRequest;
      const doc = currentSeasonOf(await findAll(req.payload, 'seasons', req)) as
        | { id: string | number; tzdbVersion: string; generatedAt?: string | null }
        | undefined;
      return doc ? { id: String(doc.id), tzdbVersion: doc.tzdbVersion, generatedAt: doc.generatedAt ?? null } : null;
    },
    async setGeneratedAt(tx, id, generatedAt) {
      const req = withContext(tx as PayloadRequest, READ_CONTEXT);
      await req.payload.update({ collection: 'seasons', id, data: { generatedAt }, req, depth: 0, overrideAccess: true });
    },
  };
}

export function createPayloadCatalogStore(getPayload: () => Promise<Payload>): CatalogStore {
  return {
    async read(tx) {
      const payload = await getPayload();
      const req = tx as PayloadRequest | undefined;
      const [seasons, ...rest] = await Promise.all([
        findAll(payload, 'seasons', req),
        ...COLLECTIONS.map((c) => findAll(payload, c, req)),
      ]);
      const first = currentSeasonOf(seasons ?? []);
      const stored: StoredCatalog = {
        season: first
          ? {
              id: String(first.id),
              key: String(first.key),
              generatedAt: String(first.generatedAt),
              tzdbVersion: String(first.tzdbVersion),
            }
          : null,
        zones: rest[0] ?? [],
        countries: rest[1] ?? [],
        cities: rest[2] ?? [],
        events: rest[3] ?? [],
        traditions: rest[4] ?? [],
      };
      return stored;
    },
  };
}

export function createPayloadImportStore(getPayload: () => Promise<Payload>): CatalogImportStore {
  const reads = createPayloadCatalogStore(getPayload);
  return {
    read: reads.read,
    async begin() {
      const payload = await getPayload();
      const req = await createLocalReq({ context: IMPORT_CONTEXT }, payload);
      await initTransaction(req);
      return req;
    },
    async commit(tx: Tx) {
      await commitTransaction(tx as PayloadRequest);
    },
    async rollback(tx: Tx) {
      await killTransaction(tx as PayloadRequest);
    },
    async create(tx, collection: CatalogCollectionName, data) {
      const req = tx as PayloadRequest;
      await req.payload.create({ collection, data: data as never, req, depth: 0, overrideAccess: true });
    },
    async update(tx, collection: CatalogCollectionName, id, data, opts) {
      const req = opts?.silent ? withContext(tx as PayloadRequest, INTERNAL_CONTEXT) : (tx as PayloadRequest);
      await req.payload.update({ collection, id, data: data as never, req, depth: 0, overrideAccess: true });
    },
    async writeSeason(tx, season) {
      const req = withContext(tx as PayloadRequest, INTERNAL_CONTEXT);
      const data = { key: season.key, generatedAt: season.generatedAt, tzdbVersion: season.tzdbVersion };
      if (season.id) await req.payload.update({ collection: 'seasons', id: season.id, data, req, depth: 0, overrideAccess: true });
      else await req.payload.create({ collection: 'seasons', data, req, depth: 0, overrideAccess: true });
    },
  };
}
