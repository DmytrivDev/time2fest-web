/**
 * Late rules and lag of moment actions (SPEC-07 AC-33 … AC-36, AC-38, AC-39), ring 1: pure, every
 * instant is a parameter. Lateness is counted in server time (virtual when the clock is virtual);
 * lag is counted in real time.
 *
 * - `'always'`          — runs whatever the lateness (stamps, rating close, celebration end, pin end);
 * - `{ within: ms }`    — skipped once the lateness exceeds `ms` (midnight greetings: 300 000);
 * - `{ until: kind }`   — skipped once server time reached the moment of that kind of the same
 *                         subject (reminder until `event-handover`).
 */
import type { SeasonMoment, SeasonMomentKind } from '@time2fest/rules/time';

export type LateRule = 'always' | { readonly within: number } | { readonly until: SeasonMomentKind };

/** Why a late action is skipped; written to the journal and to the run row `reason`. */
export type LateSkipReason = 'within-exceeded' | 'until-passed' | 'until-missing';

export type LateVerdict =
  | { readonly run: true; readonly lateMs: number }
  | { readonly run: false; readonly lateMs: number; readonly reason: LateSkipReason };

/** AC-39: an action due longer than this in real time and not started raises `page` scheduler/lag. */
export const LAG_ALARM_MS = 2_000;

/** Lateness of a moment in server time: 0 before or at the moment. */
export function lateness(at: number, serverNow: number): number {
  return Math.max(0, serverNow - at);
}

/**
 * The verdict for one moment. `untilAt` is the instant of the `until` boundary of this moment's
 * subject (`untilBoundary`); `undefined` means the subject has no such moment, and the action is
 * skipped rather than run without a bound.
 */
export function lateVerdict(rule: LateRule, at: number, serverNow: number, untilAt?: number): LateVerdict {
  const lateMs = lateness(at, serverNow);
  if (rule === 'always') return { run: true, lateMs };
  if ('within' in rule) return lateMs > rule.within ? { run: false, lateMs, reason: 'within-exceeded' } : { run: true, lateMs };
  if (untilAt === undefined) return { run: false, lateMs, reason: 'until-missing' };
  return serverNow >= untilAt ? { run: false, lateMs, reason: 'until-passed' } : { run: true, lateMs };
}

/** Subject id of a C1 key `<kind>:<id>` (zone, event or season id). */
export function subjectOf(momentKey: string): string {
  const i = momentKey.indexOf(':');
  return i < 0 ? momentKey : momentKey.slice(i + 1);
}

/**
 * Instant of the `until` boundary of `momentKey`: the moment `<kind>:<same subject>`; failing that,
 * the season-wide moment of that kind when there is exactly one (`celebration-end`, `rating-close`).
 */
export function untilBoundary(
  kind: SeasonMomentKind,
  momentKey: string,
  byKey: ReadonlyMap<string, SeasonMoment>,
  byKind: ReadonlyMap<SeasonMomentKind, readonly SeasonMoment[]>,
): number | undefined {
  const same = byKey.get(`${kind}:${subjectOf(momentKey)}`);
  if (same) return same.at;
  const all = byKind.get(kind);
  return all?.length === 1 ? all[0]?.at : undefined;
}

/**
 * Lag of a due action in real milliseconds (AC-38, AC-39): server lateness divided by the speed,
 * never more than `observedRealMs` (real time since the loop first saw it due; a virtual jump makes
 * a moment late in server time without any real delay). Frozen (speed 0) → no lag.
 */
export function lagMs(at: number, serverNow: number, speed: number, observedRealMs?: number): number {
  if (!(speed > 0)) return 0;
  const fromServer = lateness(at, serverNow) / speed;
  return observedRealMs === undefined ? fromServer : Math.min(fromServer, Math.max(0, observedRealMs));
}

/** AC-39: true when the action should raise `page` scheduler/lag (holder only, AC-41 — the caller's check). */
export function isLagging(at: number, serverNow: number, speed: number, observedRealMs?: number): boolean {
  return lagMs(at, serverNow, speed, observedRealMs) > LAG_ALARM_MS;
}
