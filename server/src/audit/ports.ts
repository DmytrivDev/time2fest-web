/**
 * Audit journal (AC-20 … AC-25, NFR-5, NFR-6), ring 2.
 *
 * Every write appends exactly one row IN THE SAME TRANSACTION as the write: every service must pass
 * the transaction (`Tx`) of the write it journals — for Payload, the operation's `req` — or the row
 * and the data are no longer atomic. The journal has no update and no delete: rows are kept (≥ 3
 * years, NFR-6) and only appended. Secrets never enter `before`/`after` (NFR-5).
 */
import type { Tx } from '../events/ports';

export type { Tx };

export type ActorKind = 'owner' | 'agent' | 'system';

export interface Actor {
  kind: ActorKind;
  /** Admin record id, or the subsystem name for `system`. */
  id: string;
  /** Human-readable name: the record's email, or the subsystem name. */
  label: string;
}

export interface JournalTarget {
  collection: string;
  id: string;
}

export interface JournalEntry {
  actor: Actor;
  /** Action kind, e.g. `collection.update`, `key.issue`; revert handlers are keyed by it. */
  action: string;
  target: JournalTarget;
  /** Epoch ms, from the server clock. */
  at: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Id of the journal row this one reverts. */
  revertOf: string | null;
}

export interface StoredJournalEntry extends JournalEntry {
  id: string;
  revertible: boolean;
}

export interface Journal {
  append(tx: Tx, entry: JournalEntry): Promise<void>;
}

/** A row of the revert-handler registry: reverts journal rows of one action kind (AC-22, AC-24). */
export interface RevertHandler {
  key: string;
  /**
   * The target's current value in the shape of the entry's `after`, for a target that is not one
   * stored document (e.g. a correction of several events); absent → `RevertStore.current`.
   */
  current?(tx: Tx, entry: StoredJournalEntry): Promise<Record<string, unknown> | null>;
  /** Restores the entry's `before` inside `tx`, writing a new journal row that points at `entry.id`. */
  revert(tx: Tx, entry: StoredJournalEntry): Promise<void>;
}

/** What the revert use case reads, and its transaction boundary. */
export interface RevertStore {
  entry(tx: Tx, id: string): Promise<StoredJournalEntry | null>;
  /** The target's current stored value, or `null` when it no longer exists. */
  current(tx: Tx, target: JournalTarget): Promise<Record<string, unknown> | null>;
  /** Runs `fn` in one transaction (joining `tx`'s when it has one); a throw rolls it back. */
  inTransaction<T>(tx: Tx, fn: () => Promise<T>): Promise<T>;
}
