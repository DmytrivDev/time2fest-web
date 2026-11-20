/**
 * Payload hooks of the catalog collections (AC-49, AC-67), Payload glue (ring 4), thin: the rules are
 * in `domain/catalog/`, the use cases in `catalog/service.ts`; this file adapts Payload to their ports.
 *
 * The import and the seed (`context.t2fImport`) and internal writes (`context.t2fInternal`) skip both
 * hooks: the import writes a whole catalog in steps and sets the version from its source.
 */
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, PayloadRequest } from 'payload';
import { ValidationError } from 'payload';
import { createPayloadCatalogReader, createPayloadSeasonStore } from '../../adapters/payloadCatalog';
import { processDeps } from '../../adapters/processDeps';
import { assertIntegrityAfter, CatalogIntegrityError, recordCatalogChange } from '../../catalog/service';
import { NATURAL_KEYS } from '../../domain/catalog/fromData';
import type { CatalogKind } from '../../domain/catalog/integrity';
import { eventsOf, siteOf } from '../../endpoints/deps';

export const IMPORT_CONTEXT_KEY = 't2fImport';
export const INTERNAL_CONTEXT_KEY = 't2fInternal';

/** The request comes from the import, the seed or an internal write. */
export function skipsCatalogHooks(req: Pick<PayloadRequest, 'context'>): boolean {
  return req.context?.[IMPORT_CONTEXT_KEY] === true || req.context?.[INTERNAL_CONTEXT_KEY] === true;
}

/** `beforeChange`: refuses a write that introduces an integrity violation (AC-49). */
export function checkIntegrity(kind: CatalogKind): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req }) => {
    if (skipsCatalogHooks(req)) return data;
    const previous = originalDoc as Record<string, unknown> | undefined;
    const keyField = NATURAL_KEYS[kind];
    try {
      await assertIntegrityAfter(createPayloadCatalogReader(), req, {
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
  const deps = await processDeps();
  await recordCatalogChange(
    { seasons: createPayloadSeasonStore(), publisher: eventsOf(deps).publisher, clock: deps.clock, siteVersion: siteOf(deps).store },
    req,
  );
  return doc;
};
