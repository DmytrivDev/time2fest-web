/**
 * Revert-handler registry (AC-22, AC-24): sorted, unique rows keyed by journal action kind, one
 * line per domain. A journal row is `revertible` exactly when its action has a row here.
 *
 * `collection.update` restores the row's `before` through a Payload `update` on the same `req`
 * (so the same transaction); the audit hook of the collection writes the new journal row, marked
 * `revertOf` through the request context.
 */
import type { CollectionSlug, PayloadRequest } from 'payload';
import { REVERT_OF_CONTEXT_KEY } from '../audit/journal';
import type { RevertHandler } from '../audit/ports';
import { restoreData } from '../domain/audit/revert';
import { assertRegistry } from '../platform/registry';

const collectionUpdate: RevertHandler = {
  key: 'collection.update',
  async revert(tx, entry) {
    const req = tx as PayloadRequest;
    req.context = { ...req.context, [REVERT_OF_CONTEXT_KEY]: entry.id };
    await req.payload.update({
      collection: entry.target.collection as CollectionSlug,
      id: entry.target.id,
      data: restoreData(entry.before, entry.after),
      req,
      overrideAccess: true,
      depth: 0,
    });
  },
};

export const revertHandlerRegistry: readonly RevertHandler[] = [
  collectionUpdate,
];

assertRegistry('revert-handlers', revertHandlerRegistry, (r) => r.key);
