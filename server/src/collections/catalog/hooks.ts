/**
 * Payload hooks of the catalog collections (AC-49, AC-67), Payload glue (ring 4), thin: the rules are
 * in `domain/catalog/`, the use cases in `catalog/service.ts`; this file adapts Payload to their ports.
 *
 * The import and the seed (`context.t2fImport`) and internal writes (`context.t2fInternal`) skip both
 * hooks: the import writes a whole catalog in steps and sets the version from its source.
 */
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionSlug, PayloadRequest } from 'payload';
import { ValidationError } from 'payload';
import { TRUSTED_CONTEXT_KEY } from '../../access/payloadGuard';
import type { CatalogReader, SeasonStore } from '../../catalog/ports';
import { assertIntegrityAfter, CatalogIntegrityError, recordCatalogChange } from '../../catalog/service';
import { clockFor } from '../../clock';
import { toSnapshotRow, type CatalogKind, type CatalogSnapshot } from '../../domain/catalog/integrity';
import { envClass } from '../../platform/env';

export const IMPORT_CONTEXT_KEY = 't2fImport';
export const INTERNAL_CONTEXT_KEY = 't2fInternal';

/** The request comes from the import, the seed or an internal write. */
export function skipsCatalogHooks(req: Pick<PayloadRequest, 'context'>): boolean {
  return req.context?.[IMPORT_CONTEXT_KEY] === true || req.context?.[INTERNAL_CONTEXT_KEY] === true;
}

/** The same request and transaction, marked as a server-side call (the guard of `harden` accepts it). */
function trusted(req: PayloadRequest): PayloadRequest {
  return { ...req, context: { ...req.context, [TRUSTED_CONTEXT_KEY]: true, [INTERNAL_CONTEXT_KEY]: true } };
}

async function allOf(req: PayloadRequest, collection: CollectionSlug): Promise<Record<string, unknown>[]> {
  const found = await req.payload.find({
    collection,
    req: trusted(req),
    depth: 0,
    pagination: false,
    overrideAccess: true,
  });
  return found.docs as unknown as Record<string, unknown>[];
}

const KINDS: readonly CatalogKind[] = ['zones', 'countries', 'cities', 'events'];

function readerOf(): CatalogReader {
  return {
    async snapshot(tx) {
      const req = tx as PayloadRequest;
      const [zones, countries, cities, events] = await Promise.all(KINDS.map((k) => allOf(req, k)));
      return {
        zones: (zones ?? []).map((r) => toSnapshotRow('zones', r)),
        countries: (countries ?? []).map((r) => toSnapshotRow('countries', r)),
        cities: (cities ?? []).map((r) => toSnapshotRow('cities', r)),
        events: (events ?? []).map((r) => toSnapshotRow('events', r)),
      } satisfies CatalogSnapshot;
    },
  };
}

function seasonsOf(): SeasonStore {
  return {
    async current(tx) {
      const req = tx as PayloadRequest;
      const found = await req.payload.find({
        collection: 'seasons',
        req: trusted(req),
        depth: 0,
        limit: 1,
        sort: 'id',
        overrideAccess: true,
      });
      const doc = found.docs[0] as unknown as { id: string | number; tzdbVersion: string } | undefined;
      return doc ? { id: String(doc.id), tzdbVersion: doc.tzdbVersion } : null;
    },
    async setGeneratedAt(tx, id, generatedAt) {
      const req = tx as PayloadRequest;
      await req.payload.update({
        collection: 'seasons',
        id,
        data: { generatedAt },
        req: trusted(req),
        depth: 0,
        overrideAccess: true,
      });
    },
  };
}

/** `beforeChange`: refuses a write that introduces an integrity violation (AC-49). */
export function checkIntegrity(kind: CatalogKind): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req }) => {
    if (skipsCatalogHooks(req)) return data;
    const previous = originalDoc as Record<string, unknown> | undefined;
    const keyField = { zones: 'zoneId', countries: 'iso', cities: 'cityId', events: 'eventId' }[kind];
    try {
      await assertIntegrityAfter(readerOf(), req, {
        kind,
        ...(previous && typeof previous[keyField] === 'string' ? { previousKey: previous[keyField] } : {}),
        row: { ...previous, ...(data as Record<string, unknown>) },
      });
    } catch (err) {
      if (!(err instanceof CatalogIntegrityError)) throw err;
      throw new ValidationError({
        errors: err.violations.map((v) => ({ message: `${v.rule}: ${v.ids.join(', ')}`, path: v.rule })),
      });
    }
    return data;
  };
}

/** `afterChange`: a catalog record changed → new `generatedAt`, `catalog.changed` in the same transaction (AC-67). */
export const bumpCatalogVersion: CollectionAfterChangeHook = async ({ doc, req }) => {
  if (skipsCatalogHooks(req)) return doc;
  const { eventsOf, getDeps } = await import('../../container');
  await recordCatalogChange(
    { seasons: seasonsOf(), publisher: eventsOf(getDeps()).publisher, clock: clockFor(envClass(process.env)) },
    req,
  );
  return doc;
};
