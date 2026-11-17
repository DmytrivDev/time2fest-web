/**
 * The unattended-mode rule (AC-32 … AC-35), ring 1 — a pure function of (time, windows, the manual
 * switch, open `page` alarms, the current mode). Time is a parameter; nothing here reads a clock.
 *
 * Precedence, first match wins:
 * 1. the mode is on because of an alarm → it stays on until no open `page` alarm is left (Q4,
 *    `alarmExit.ts`); a manual off replaces the cause, so it is rule 3;
 * 2. an open `page` alarm is due (15 min, `alarmTrigger.ts`) and became due after the last manual
 *    switch → on, cause `alarm` (AC-34);
 * 3. a manual switch that still holds (until the next window boundary, Q5, `override.ts`) → its value,
 *    cause `manual` (AC-33);
 * 4. the schedule: inside a sleep window → on, cause `schedule`; else off, no cause (AC-32).
 *
 * A transition is any change of `on`, `cause` or the manual switch instant (`sameMode`). Invariant:
 * `manualAt` is set exactly when `cause === 'manual'`.
 */
import { alarmModeEnds } from './alarmExit';
import { alarmDue, type PageAlarm } from './alarmTrigger';
import { holdActive } from './override';
import { activeWindow, type SleepWindow } from './windows';

export type UnattendedCause = 'schedule' | 'manual' | 'alarm';

export interface ModeState {
  on: boolean;
  /** What governs the mode now; `null` = off with nothing governing it. */
  cause: UnattendedCause | null;
  /** When the owner switched manually (epoch ms); set exactly when `cause === 'manual'`. */
  manualAt: number | null;
}

export const INITIAL_MODE: ModeState = Object.freeze({ on: false, cause: null, manualAt: null });

export interface RuleInput {
  windows: readonly SleepWindow[];
  /** Unacknowledged `page` alarms. */
  openPageAlarms: readonly PageAlarm[];
  now: number;
  current: ModeState;
}

/** The mode the rule wants at `input.now`. */
export function desiredState({ windows, openPageAlarms, now, current }: RuleInput): ModeState {
  if (current.on && current.cause === 'alarm' && !alarmModeEnds(openPageAlarms)) return { on: true, cause: 'alarm', manualAt: null };

  const manual = current.cause === 'manual' && current.manualAt !== null ? { on: current.on, at: current.manualAt } : null;
  const holds = manual !== null && holdActive(manual, windows, now);
  if (alarmDue(openPageAlarms, now, holds ? manual.at : null)) return { on: true, cause: 'alarm', manualAt: null };
  if (holds) return { on: manual.on, cause: 'manual', manualAt: manual.at };

  return activeWindow(windows, now) ? { on: true, cause: 'schedule', manualAt: null } : { on: false, cause: null, manualAt: null };
}

/** The mode right after the owner's manual switch at `at`. */
export function manualState(on: boolean, at: number): ModeState {
  return { on, cause: 'manual', manualAt: at };
}

export function sameMode(a: ModeState, b: ModeState): boolean {
  return a.on === b.on && a.cause === b.cause && a.manualAt === b.manualAt;
}

/**
 * The cause the "Unattended mode" event of a rule-driven transition carries (always one of the three):
 * the new cause, or — when the mode falls back to off with nothing governing it — what released it
 * (`alarm` when the last alarm was acknowledged, else the window boundary, `schedule`). An owner's
 * own action (manual switch, revert) carries `manual`.
 */
export function transitionCause(prev: ModeState, next: ModeState): UnattendedCause {
  return next.cause ?? (prev.cause === 'alarm' ? 'alarm' : 'schedule');
}
