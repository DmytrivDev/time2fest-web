/**
 * Payload adapter of the catalog read and import ports (AC-63, AC-75 … AC-78), ring 4.
 * Reads are one `find` per collection with `pagination: false`, `depth: 0`. The import's writes carry
 * `t2fImport` (catalog hooks skip), `t2fTrusted` (server-side call) and `t2fActor: 'system:import'`
 * (the audit hook journals each write under that actor).
 */
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { CollectionSlug, Payload, PayloadRequest } from 'payload';
import type { CatalogCollectionName, CatalogImportStore, CatalogStore, StoredCatalog } from '../catalog/ports';
import type { Tx } from '../events/ports';

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

export function createPayloadCatalogStore(getPayload: () => Promise<Payload>): CatalogStore {
  return {
    async read(tx) {
      const payload = await getPayload();
      const req = tx as PayloadRequest | undefined;
      const [seasons, ...rest] = await Promise.all([
        findAll(payload, 'seasons', req),
        ...COLLECTIONS.map((c) => findAll(payload, c, req)),
      ]);
      const first = [...(seasons ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))[0];
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
