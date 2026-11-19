/**
 * Virtual time of one environment (SPEC-07 AC-49 … AC-51, AC-54, AC-56), ring 1: pure transitions,
 * real time always a parameter, no I/O and no clock read.
 *
 * - `virtual: false` → the clock is real time; the anchors are then irrelevant.
 * - `virtual: true` → `anchorVirtual + (real − anchorReal) · speed`, constant while `frozen`.
 * - Every transition increments `seq` (one change = one number); `restartNight` also increments
 *   `runEpoch`. A transition that keeps the current instant re-anchors at it, so time never jumps.
 */

/** The part of the state the virtual instant depends on. */
export interface VirtualAnchor {
  anchorVirtual: number;
  anchorReal: number;
  speed: number;
  frozen: boolean;
}

export interface VirtualState extends VirtualAnchor {
  virtual: boolean;
  runEpoch: number;
  seq: number;
}

/** A change of the test door (`POST /api/_test/clock`): every field optional. */
export interface TestClockChange {
  at?: number;
  speed?: number;
  frozen?: boolean;
}

/** Virtual instant for a real instant: constant when frozen, else anchor + elapsed · speed. */
export function virtualNow(state: VirtualAnchor, realNow: number): number {
  if (state.frozen) return state.anchorVirtual;
  return Math.round(state.anchorVirtual + (realNow - state.anchorReal) * state.speed);
}

/** The state of an environment whose clock was never moved: real time, epoch 0, no change yet. */
export function initialState(realNow: number): VirtualState {
  return { virtual: false, anchorVirtual: realNow, anchorReal: realNow, speed: 1, frozen: false, runEpoch: 0, seq: 0 };
}

/** The server instant at `realNow`: real time unless the virtual clock is active. */
export function now(state: VirtualState, realNow: number): number {
  return state.virtual ? virtualNow(state, realNow) : realNow;
}

/** Speed and frozen flag as the clock runs them (real time is speed 1, never frozen). */
export function effective(state: VirtualState): { speed: number; frozen: boolean } {
  return state.virtual ? { speed: state.speed, frozen: state.frozen } : { speed: 1, frozen: false };
}

function assertSpeed(speed: number): void {
  if (!(Number.isFinite(speed) && speed >= 0)) throw new Error('clock: speed must be a finite number ≥ 0');
}

function assertInstant(at: number): void {
  if (!Number.isFinite(at)) throw new Error('clock: at must be a finite number');
}

/** Virtual from `anchorVirtual` at `realNow`, keeping the epoch; `seq` + 1. */
function anchored(state: VirtualState, anchorVirtual: number, realNow: number, speed: number, frozen: boolean): VirtualState {
  return { virtual: true, anchorVirtual, anchorReal: realNow, speed, frozen, runEpoch: state.runEpoch, seq: state.seq + 1 };
}

/** «Виставити момент» (AC-51): virtual from `at`, speed 1, running. */
export function setMoment(state: VirtualState, at: number, realNow: number): VirtualState {
  assertInstant(at);
  return anchored(state, at, realNow, 1, false);
}

/** «Повернути реальний час» (AC-51): real time, speed 1, not frozen; the epoch is kept. */
export function backToReal(state: VirtualState, realNow: number): VirtualState {
  return { ...initialState(realNow), runEpoch: state.runEpoch, seq: state.seq + 1 };
}

/** «Почати ніч знову» (AC-51): a new run epoch; the clock itself keeps its instant and speed. */
export function restartNight(state: VirtualState, realNow: number): VirtualState {
  const kept: VirtualState = state.virtual
    ? { ...state, anchorVirtual: virtualNow(state, realNow), anchorReal: realNow }
    : { ...state, anchorVirtual: realNow, anchorReal: realNow };
  return { ...kept, runEpoch: state.runEpoch + 1, seq: state.seq + 1 };
}

/** «Швидкість» (AC-54): re-anchored at the current instant, so nothing jumps; the clock becomes virtual. */
export function setSpeed(state: VirtualState, speed: number, realNow: number): VirtualState {
  assertSpeed(speed);
  return anchored(state, now(state, realNow), realNow, speed, state.virtual && state.frozen);
}

/**
 * The test door (`POST /api/_test/clock`): re-anchors at the current instant first (or at `at`),
 * keeps the speed and frozen flag that are not given. The clock becomes virtual.
 */
export function testSet(state: VirtualState, change: TestClockChange, realNow: number): VirtualState {
  if (change.speed !== undefined) assertSpeed(change.speed);
  if (change.at !== undefined) assertInstant(change.at);
  const current = effective(state);
  return anchored(state, change.at ?? now(state, realNow), realNow, change.speed ?? current.speed, change.frozen ?? current.frozen);
}

/** Id of the `clock` event of this state on `site:state` (C3, AC-56). */
export function clockEventId(state: Pick<VirtualState, 'runEpoch' | 'seq'>): string {
  return `clock:${state.runEpoch}:${state.seq}`;
}
