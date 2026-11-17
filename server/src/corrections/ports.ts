/**
 * Ports of event corrections (AC-42, AC-53 … AC-62), ring 2: technology-neutral.
 *
 * Two versions, on purpose:
 * - the per-event `version` (1, 2, … for every save that changed that event) is what a save must carry
 *   (`expectedVersions`), so a stale tab gets `changed-since` (AC-61);
 * - the topic version of `corrections` grows by one with every save that changed something, and is the
 *   same for every event changed by that save. It is the `version` of each `event-patch.changed`
 *   payload and of the read port, so a subscriber that missed events reconciles by reading (AC-42, AC-56).
 *   It is stored on each patch as `topicVersion`; the current one is their maximum (patches are never
 *   deleted, and saves are serialised by `lock`, so it only grows).
 */
import type { EventBase, PatchState } from '../domain/corrections/rules';
import type { Tx } from '../events/ports';

export type { Tx };

/** A stored correction with its bookkeeping. */
export interface StoredPatch {
  eventId: string;
  state: PatchState;
  version: number;
  topicVersion: number;
}

export interface CorrectionStore {
  /** Runs `fn` in one transaction (joining `tx`'s when it has one); a throw rolls it back. */
  inTransaction<T>(tx: Tx, fn: () => Promise<T>): Promise<T>;
  /** Serialises correction saves until `tx` ends, so versions are read and written without a race. */
  lock(tx: Tx): Promise<void>;
  /** The base values of every event of every country×zone pair (same slot) the given events belong to. */
  pairsOf(tx: Tx, eventIds: readonly string[]): Promise<EventBase[]>;
  /** Stored corrections of the given events (absent = none). */
  patches(tx: Tx, eventIds: readonly string[]): Promise<StoredPatch[]>;
  /** The current topic version of `corrections` (0 before the first save). */
  topicVersion(tx: Tx): Promise<number>;
  /** Creates or replaces the correction of one event. */
  upsert(tx: Tx, patch: StoredPatch): Promise<void>;
}

/**
 * What the read ports of the consumer waves (SPEC-07, SPEC-08) read, outside any transaction:
 * `currentPatches` and `momentsWithPatches` in `service.ts` are built on it.
 */
export interface CorrectionReader {
  /** The base values of every event of the catalog. */
  allEvents(): Promise<EventBase[]>;
  /** Every stored correction. */
  allPatches(): Promise<StoredPatch[]>;
}
