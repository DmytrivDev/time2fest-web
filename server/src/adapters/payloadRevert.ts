/**
 * Revert handlers over Payload (AC-22, AC-24), ring 4: one exported handler per row of
 * `registries/revertHandlers.ts`, which only lists them.
 *
 * `collectionUpdate` restores the row's `before` through a Payload `update` on the same `req` (so the same
 * transaction); the audit hook of the collection writes the new journal row, marked `revertOf` through the
 * request context. `correctionSave` restores a whole correction through the correction service (one journal
 * row, one event per restored event). `unattendedSetManual` restores the unattended mode before the owner's
 * manual switch (one journal row, one event). Services come from the process deps (`processDeps`), built once.
 */
import type { CollectionSlug, PayloadRequest } from 'payload';
import { REVERT_OF_CONTEXT_KEY, resolveActor } from '../audit/journal';
import type { RevertHandler } from '../audit/ports';
import { CORRECTION_ACTION, journalledState, revertCorrection } from '../corrections/service';
import { restoreData } from '../domain/audit/revert';
import { correctionsOf, unattendedDepsOf } from '../endpoints/deps';
import { journalledMode, revertManual, UNATTENDED_MANUAL_ACTION } from '../unattended/service';
import { processDeps } from './processDeps';

export const collectionUpdate: RevertHandler = {
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
export const correctionSave: RevertHandler = {
  key: CORRECTION_ACTION,
  async current(tx, entry) {
    return journalledState(correctionsOf(await processDeps()).store, tx, entry);
  },
  async revert(tx, entry) {
    const req = tx as PayloadRequest;
    const deps = correctionsOf(await processDeps());
    await revertCorrection(deps, tx, entry, { ...resolveActor(req.user, req.context), kind: 'owner' });
  },
};

/** `unattended.set-manual` (AC-22, AC-33): restores the mode before the owner's switch; the rule applies again on the next tick. */
export const unattendedSetManual: RevertHandler = {
  key: UNATTENDED_MANUAL_ACTION,
  async current(tx) {
    return journalledMode(unattendedDepsOf(await processDeps()).store, tx);
  },
  async revert(tx, entry) {
    const req = tx as PayloadRequest;
    await revertManual(unattendedDepsOf(await processDeps()), tx, entry, { ...resolveActor(req.user, req.context), kind: 'owner' });
  },
};
