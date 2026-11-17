/**
 * Revert-handler registry (AC-22, AC-24): sorted, unique rows keyed by journal action kind, one
 * line per domain. A journal row is `revertible` exactly when its action has a row here.
 *
 * `collection.update` restores the row's `before` through a Payload `update` on the same `req`
 * (so the same transaction); the audit hook of the collection writes the new journal row, marked
 * `revertOf` through the request context. `correction.save` restores a whole correction through the
 * correction service (one journal row, one event per restored event). `unattended.set-manual` restores
 * the unattended mode before the owner's manual switch (one journal row, one event).
 */
import type { CollectionSlug, PayloadRequest } from 'payload';
import { REVERT_OF_CONTEXT_KEY, resolveActor } from '../audit/journal';
import type { RevertHandler } from '../audit/ports';
import { createPayloadCorrectionStore, payloadCorrectionDeps } from '../adapters/payloadCorrections';
import { createPayloadUnattendedStore } from '../adapters/payloadUnattended';
import { clockFor } from '../clock';
import { CORRECTION_ACTION, journalledState, revertCorrection } from '../corrections/service';
import { restoreData } from '../domain/audit/revert';
import { envClass } from '../platform/env';
import { assertRegistry } from '../platform/registry';
import { journalledMode, revertManual, UNATTENDED_MANUAL_ACTION } from '../unattended/service';

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

/** `correction.save` (AC-22, AC-54): restores every event's `before` through `saveCorrection`, which journals and publishes. */
const correctionSave: RevertHandler = {
  key: CORRECTION_ACTION,
  current: (tx, entry) => journalledState(createPayloadCorrectionStore(), tx, entry),
  async revert(tx, entry) {
    const req = tx as PayloadRequest;
    const { eventsOf, getDeps } = await import('../container');
    const deps = payloadCorrectionDeps({
      publisher: eventsOf(getDeps()).publisher,
      clock: clockFor(envClass(process.env)),
      isRevertible: (action) => revertHandlerRegistry.some((r) => r.key === action),
    });
    await revertCorrection(deps, tx, entry, { ...resolveActor(req.user, req.context), kind: 'owner' });
  },
};

/** `unattended.set-manual` (AC-22, AC-33): restores the mode before the owner's switch; the rule applies again on the next tick. */
const unattendedSetManual: RevertHandler = {
  key: UNATTENDED_MANUAL_ACTION,
  current: (tx) => journalledMode(createPayloadUnattendedStore(async () => (tx as PayloadRequest).payload), tx),
  async revert(tx, entry) {
    const req = tx as PayloadRequest;
    const { getDeps, unattendedDepsOf } = await import('../container');
    await revertManual(unattendedDepsOf(getDeps()), tx, entry, { ...resolveActor(req.user, req.context), kind: 'owner' });
  },
};

export const revertHandlerRegistry: readonly RevertHandler[] = [
  collectionUpdate,
  correctionSave,
  unattendedSetManual,
];

assertRegistry('revert-handlers', revertHandlerRegistry, (r) => r.key);
