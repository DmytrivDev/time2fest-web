/**
 * Ports of the shared server clock (SPEC-07 AC-49, AC-50, NFR-7), ring 2.
 *
 * The state of virtual time lives in the database (global `clock-state`), so it is the same for
 * every process of an environment and survives a restart or a deploy. Each process keeps a cached
 * copy (`timekeeping/shared.ts`) and refreshes it on the `clock.changed` internal event.
 */
import type { Actor } from '../audit/ports';
import type { VirtualState } from '../domain/timekeeping/virtual';

export type { Actor, VirtualState };

/** The internal-events topic of every committed clock change; payload `ClockChangedPayload`. */
export const CLOCK_CHANGED_TOPIC = 'clock.changed';

export interface ClockChangedPayload {
  seq: number;
  runEpoch: number;
}

/** The journal action of a clock change (NFR-7). */
export const CLOCK_CHANGE_ACTION = 'clock.change';

export interface ClockStateStore {
  /** The stored state; a never-written global is real time, epoch 0, `seq` 0. */
  load(): Promise<VirtualState>;
  /**
   * One transaction: locks the state, applies `fn` to the stored state, writes it, appends one
   * journal row (`actor`, before, after, epoch) and one `clock.changed` outbox row. A throw from
   * `fn` or from any write rolls everything back. Returns the written state. When `fn` returns
   * the very state it was given, nothing is written (no journal row, no event).
   */
  change(actor: Actor, fn: (state: VirtualState, realNow: number) => VirtualState): Promise<VirtualState>;
}

/** A clock that never goes backwards and is not the wall clock (`performance.now`): for durations. */
export interface MonotonicClock {
  now(): number;
}
