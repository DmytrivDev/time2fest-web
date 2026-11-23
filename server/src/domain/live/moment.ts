/**
 * Event moments and poll windows of the live air (SPEC-12 AC-10, AC-58), ring 1 — pure, time is a parameter.
 *
 * The moment of an event is the one the site shows: `startsAt` for a non-midnight slot, else `midnightUtc`
 * (`collections/catalog/events.ts`), with the SPEC-08 correction's `moment` applied. An event with the `hidden`
 * correction has no window and no chain (AC-10). The window is `[moment − before; moment + after)`.
 */
import type { PatchState } from '../corrections/rules';
import type { LiveConfig } from './config';

const MIDNIGHT_SLOT = 'midnight';

export interface LiveEventInput {
  eventId: string;
  zoneId: string;
  /** Catalog slot; absent = `midnight`. */
  slot?: string | null;
  midnightUtc: string;
  /** ISO; the moment of a non-midnight event. */
  startsAt?: string | null;
  /** The SPEC-08 correction of the event, if any. */
  patch?: Pick<PatchState, 'moment' | 'hidden'> | null;
}

export interface LiveEvent {
  eventId: string;
  zoneId: string;
  /** Epoch ms of the effective moment. */
  moment: number;
  /** A non-midnight event (AC-58): its sources carry its own moment as `startsAt`. */
  nonMidnight: boolean;
  hidden: boolean;
}

/** The effective moment of one event; `null` when the catalog gives no valid time. */
export function liveEventOf(e: LiveEventInput): LiveEvent | null {
  const nonMidnight = (e.slot ?? MIDNIGHT_SLOT) !== MIDNIGHT_SLOT;
  const base = Date.parse((nonMidnight ? e.startsAt : e.midnightUtc) ?? '');
  const patched = e.patch?.moment;
  const moment = typeof patched === 'number' && Number.isFinite(patched) ? patched : base;
  if (!Number.isFinite(moment)) return null;
  return { eventId: e.eventId, zoneId: e.zoneId, moment, nonMidnight, hidden: e.patch?.hidden === true };
}

/** Poll window of a moment: from `before` ahead (inclusive) to `after` past it (exclusive). */
export function windowOf(moment: number, cfg: LiveConfig): { from: number; to: number } {
  return { from: moment - cfg.windowBeforeMs, to: moment + cfg.windowAfterMs };
}

export function isWindowOpen(moment: number, now: number, cfg: LiveConfig): boolean {
  const w = windowOf(moment, cfg);
  return now >= w.from && now < w.to;
}

/** Events polled now: not hidden, window open. */
export function openWindowEvents<E extends LiveEvent>(events: readonly E[], now: number, cfg: LiveConfig): E[] {
  return events.filter((e) => !e.hidden && isWindowOpen(e.moment, now, cfg));
}

/** Long news is served only in `[moment − longNewsBefore; moment + longNewsAfter)` (В3, AC-57). */
export function isLongNewsOpen(moment: number, now: number, cfg: LiveConfig): boolean {
  return now >= moment - cfg.longNewsBeforeMs && now < moment + cfg.longNewsAfterMs;
}
