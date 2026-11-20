/**
 * Catalog rebuild rules (SPEC-08 AC-61 … AC-66), ring 1 — pure: time is always a parameter (epoch ms, UTC).
 *
 * A rebuild is due 150 s after the last `catalog.changed` (debounce). Whether it may run is decided at the
 * moment of the launch, never at the moment of the change: inside the New Year freeze window
 * (31.12 08:00:00 UTC ≤ t < 01.01 14:00:00 UTC) it is deferred to the window's end.
 */
import type { EnvClass } from '../../platform/env';

/** Debounce after the last catalog change (AC-61). */
export const REBUILD_DEBOUNCE_MS = 150_000;
/** Offsets from the first attempt, in ms (AC-66): the launch and two retries at 60 s and 300 s. */
export const REBUILD_RETRY_SCHEDULE: readonly number[] = [0, 60_000, 300_000];
/** How often each process checks for a due launch, on the server clock (AC-63: ≤ 60 s after the window). */
export const REBUILD_TICK_MS = 15_000;

const DECEMBER = 11;
const JANUARY = 0;
const FREEZE_START_HOUR = 8;
const FREEZE_END_HOUR = 14;

/** True inside the freeze window: 31.12 08:00:00 UTC ≤ t < 01.01 14:00:00 UTC (the year of `t`, either side). */
export function inFreeze(ms: number): boolean {
  const d = new Date(ms);
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  if (month === DECEMBER && day === 31) return hour >= FREEZE_START_HOUR;
  if (month === JANUARY && day === 1) return hour < FREEZE_END_HOUR;
  return false;
}

/** The end of the freeze window that contains `ms` (01.01 14:00:00 UTC); `ms` itself outside the window. */
export function freezeEnd(ms: number): number {
  if (!inFreeze(ms)) return ms;
  const d = new Date(ms);
  const year = d.getUTCMonth() === DECEMBER ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  return Date.UTC(year, JANUARY, 1, FREEZE_END_HOUR, 0, 0, 0);
}

/** When the rebuild after a change committed at `committedAt` is due (AC-61). */
export function dueAfter(committedAt: number): number {
  return committedAt + REBUILD_DEBOUNCE_MS;
}

export type RebuildDecision = 'launch' | 'wait' | 'frozen';

/** What to do with a launch due at `dueAt`, evaluated at `now` — the moment of the launch (AC-62). */
export function decide(now: number, dueAt: number): RebuildDecision {
  if (now < dueAt) return 'wait';
  return inFreeze(now) ? 'frozen' : 'launch';
}

export type LaunchGate = 'go' | 'disabled' | 'not-configured';

/**
 * Whether a launch may leave the process (AC-64, AC-65): `production` only with `T2F_REBUILD_PRODUCTION`
 * on (off by default); otherwise a token is needed.
 */
export function launchGate(input: { envClass: EnvClass; productionFlag: boolean; hasToken: boolean }): LaunchGate {
  if (input.envClass === 'production' && !input.productionFlag) return 'disabled';
  return input.hasToken ? 'go' : 'not-configured';
}
