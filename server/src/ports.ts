/**
 * Ports of the platform (ring 2): technology-neutral interfaces for what crosses a process
 * boundary — log, alarm, fast store, idempotency store, seed store, lock state, clock. No implementation
 * may live here; adapters implement these, the container wires them.
 */

/** Structured log sink. Each call writes one line. */
export interface Logger {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
}

export type AlarmLevel = 'page' | 'log';

export interface AlarmInput {
  level: AlarmLevel;
  source: string;
  code: string;
  details?: Record<string, unknown>;
}

/** Raises an operator alarm. Never throws (AC-56). */
export interface Alarm {
  raise(alarm: AlarmInput): void;
}

/** Fast key-value store with expiry (Redis in production). */
export interface FastStore {
  /** Increments the counter of a fixed window and returns its count and remaining lifetime. */
  incrWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  /** Sets the key only when absent; true when it was set. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Deletes one key (no-op when absent). */
  del(key: string): Promise<void>;
  /** Deletes every key under the prefix and returns how many were deleted. */
  deleteByPrefix(prefix: string): Promise<number>;
}

export type IdempotencyBegin<R> = 'started' | { status: 'running' } | { status: 'done'; result: R };

/** Remembers the outcome of a request keyed by its client id. */
export interface IdempotencyStore<R = unknown> {
  begin(key: string): Promise<IdempotencyBegin<R>>;
  finish(key: string, result: R): Promise<void>;
  abort(key: string): Promise<void>;
}

/**
 * Row store of the seed and the worktree reset (AC-45 … AC-47): collections are named by slug,
 * rows are plain data. Only the seed, the test doors and the composition root use it.
 */
export interface SeedStore {
  /** Updates the row whose `naturalKey` equals `data[naturalKey]`, or creates it. */
  upsertByKey(collection: string, naturalKey: string, data: Record<string, unknown>): Promise<void>;
  count(collection: string): Promise<number>;
  /** Deletes every row of the collection. */
  clear(collection: string): Promise<void>;
}

/** Read-only view of the machine integration lock. */
export interface LockState {
  holdsExclusive(owner: string): boolean;
}

/** The only source of the current time (AC-34), in epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** A dependency (database, fast store, …) cannot be reached. Core error taxonomy. */
export class DependencyUnavailable extends Error {
  readonly dependency: string;

  constructor(dependency: string, options?: { cause?: unknown }) {
    super(`dependency unavailable: ${dependency}`, options);
    this.name = 'DependencyUnavailable';
    this.dependency = dependency;
  }
}
