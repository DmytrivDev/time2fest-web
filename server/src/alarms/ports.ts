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
  /** Saves a `page` alarm with `raisedAt` = now and no acknowledgement. */
  save(alarm: { source: string; code: string }): Promise<{ id: string }>;
  /** Open (unacknowledged) `page` alarms, newest first, at most 100. */
  listOpenPage(): Promise<AlarmRecord[]>;
  /** Sets `acknowledgedAt` inside `tx`; the write is journalled in the same transaction. */
  acknowledge(tx: Tx, id: string, at: number): Promise<AcknowledgeOutcome>;
}
