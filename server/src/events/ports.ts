/**
 * Internal events (AC-40 … AC-42), ring 2: technology-neutral interfaces only.
 *
 * An event is written to an outbox inside the caller's transaction, so it exists only if that
 * transaction commits (AC-41); every running server instance delivers each committed event to the
 * subscribers of the subscriber registry, at most once per process, within 2 s (AC-40). Every
 * event of a topic carries a version that grows by one (AC-42).
 */

/**
 * The caller's open transaction, opaque to rings 1–3: only the adapter knows what it is (for
 * Payload it is the request whose `transactionID` names the database session). Every service must
 * pass the transaction of the write it belongs to, or the event (or journal row) is not atomic with it.
 */
export type Tx = object & { readonly __tx?: never };

export interface InternalEvent {
  /** Global, increasing outbox id (decimal string). */
  id: string;
  topic: string;
  /** Per-topic version: 1, 2, 3, … */
  version: number;
  payload: unknown;
  /** Epoch ms when the event was written. */
  committedAt: number;
}

export interface EventPublisher {
  /** Writes the event inside `tx`; it is delivered only after `tx` commits. */
  publish(tx: Tx, topic: string, payload: unknown): Promise<{ version: number }>;
}

/** Read side: a subscriber that missed events reconciles with the latest one of its topic (AC-42). */
export interface EventLog {
  latest(topic: string): Promise<InternalEvent | null>;
}

/** Where the delivery loop reads committed events from. */
export interface EventSource {
  /** The highest committed outbox id, or `'0'`. */
  maxId(): Promise<string>;
  /** Committed events with an id above `id`, in id order, at most `limit`. */
  after(id: string, limit: number): Promise<InternalEvent[]>;
  /** Calls `wake` whenever a commit may have added events; returns a stop function. */
  watch(wake: () => void): () => Promise<void>;
}

/** A row of the subscriber registry. `topic: '*'` receives every topic. */
export interface EventSubscriber {
  key: string;
  topic: string;
  /** Present only in the `test` class. */
  testOnly?: true;
  handle(event: InternalEvent): Promise<void> | void;
}
