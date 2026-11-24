/**
 * Stored operator alarms (AC-37 … AC-39), ring 2. A `page` alarm raised through the `Alarm` port is
 * also saved here; saving never makes `raise` throw (SPEC-02 AC-56).
 */
import type { Tx } from '../events/ports';

export interface AlarmRecord {
  id: string;
  source: string;
  code: string;
  level: 'page';
  /** Epoch ms. */
  raisedAt: number;
  acknowledgedAt: number | null;
}

export type AcknowledgeOutcome = 'ok' | 'already' | 'not-found';

export interface AlarmStore {
  /**
   * Saves a `page` alarm with `raisedAt` = now and no acknowledgement. `details` (SPEC-13b) are the
   * already sanitized allow-listed keys (AC-11); absent → the column stays empty.
   */
  save(alarm: { source: string; code: string; details?: AlarmDetails }): Promise<{ id: string }>;
  /** Open (unacknowledged) `page` alarms, newest first, at most 100. */
  listOpenPage(): Promise<AlarmRecord[]>;
  /** Sets `acknowledgedAt` inside `tx`; the write is journalled in the same transaction. */
  acknowledge(tx: Tx, id: string, at: number): Promise<AcknowledgeOutcome>;
}

/** Allow-listed alarm details after sanitizing (SPEC-13b AC-11): numbers and short codes only. */
export type AlarmDetails = Readonly<Record<string, string | number>>;

/** A stored `log` alarm (SPEC-13b AC-12): kept 30 days, never sent anywhere. */
export interface LogAlarmRecord {
  id: string;
  source: string;
  code: string;
  details: AlarmDetails | null;
  /** Epoch ms. */
  raisedAt: number;
}

/** The `log-alarms` collection (SPEC-13b AC-12, AC-33); separate so `AlarmStore` consumers stay untouched. */
export interface LogAlarmStore {
  /** Saves a `log` alarm with `raisedAt` = now. */
  insert(alarm: { source: string; code: string; details?: AlarmDetails }): Promise<{ id: string }>;
  /** `log` alarms raised at or after `sinceMs`, newest first. */
  listLog(sinceMs: number): Promise<LogAlarmRecord[]>;
  /** Removes `log` alarms raised before `beforeMs`; returns how many were removed. */
  pruneLog(beforeMs: number): Promise<number>;
}

/** One message to Telegram: the text is built before it is queued (SPEC-13b AC-2). */
export interface AlarmMessage {
  text: string;
  chatId: string;
}

/**
 * Outcome of one delivery attempt (SPEC-13b AC-4): `retry` for 429 / 5xx / network, with the
 * server's `retry_after` when it gave one; `fatal` for 400 / 403 (never retried).
 */
export interface AlarmDeliveryOutcome {
  result: 'ok' | 'retry' | 'fatal';
  retryAfterSec?: number;
  /** HTTP status when there was a response. */
  status?: number;
}

/** Where alarms go out (SPEC-13b): the Telegram adapter, the loopback fake, an in-memory sink in unit tests. */
export interface AlarmSink {
  /** Never throws: every failure is an outcome. */
  deliver(msg: AlarmMessage): Promise<AlarmDeliveryOutcome>;
}
