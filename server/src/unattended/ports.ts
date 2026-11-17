/**
 * Ports of the unattended mode (AC-31 … AC-36), ring 2: technology-neutral.
 *
 * The mode is one stored state with a version that grows by one per transition. Every transition is
 * computed and written under `lock` (one holder at a time across every server instance), so two
 * instances evaluating the same instant write it once (compare-and-set on the state read under the lock).
 */
import type { AlarmRecord } from '../alarms/ports';
import type { ModeState } from '../domain/unattended/machine';
import type { SleepWindow } from '../domain/unattended/windows';
import type { Tx } from '../events/ports';

export type { Tx };

export interface StoredMode extends ModeState {
  /** 0 before the first transition. */
  version: number;
  /** Epoch ms of the last transition, or `null` before the first. */
  changedAt: number | null;
}

export interface UnattendedStore {
  /**
   * Runs `fn` in one transaction: `tx`'s when given (joined), else a new one; a throw rolls it back.
   */
  inTransaction<T>(tx: Tx | null, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Serialises transitions and window edits until `tx` ends. */
  lock(tx: Tx): Promise<void>;
  state(tx: Tx): Promise<StoredMode>;
  write(tx: Tx, state: StoredMode): Promise<void>;
  windows(tx: Tx): Promise<SleepWindow[]>;
}

/** The open `page` alarms the rule reads (the alarm store, AC-37). */
export interface OpenPageAlarms {
  listOpenPage(): Promise<AlarmRecord[]>;
}
