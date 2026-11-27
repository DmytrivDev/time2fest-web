import { CELEBRATION_LEAD, CELEBRATION_TAIL } from './constants';
import { assertTolerance } from './tolerance';
import type { Ms, ToastSeason, ZonesLike } from './types';

/**
 * The celebration is on from `CELEBRATION_LEAD` before the first midnight to `CELEBRATION_TAIL` after the last
 * (both ends inclusive). Δ moves only the end bound.
 */
export function isCelebrating(now: Ms, data: ZonesLike, delta = 0): boolean {
  assertTolerance(delta);
  if (!now || data.zones.length === 0) return false;
  let first = Infinity;
  let last = -Infinity;
  for (const z of data.zones) {
    if (z.midnightMs < first) first = z.midnightMs;
    if (z.midnightMs > last) last = z.midnightMs;
  }
  return now >= first - CELEBRATION_LEAD && now <= last + CELEBRATION_TAIL + delta;
}

/**
 * End of the season celebration: the last midnight + `CELEBRATION_TAIL` (+ Δ, which only moves this end later).
 * No zones — `-Infinity` (nothing is celebrating). Inclusive: the celebration is still on at exactly this instant.
 */
export function celebrationEndAt(data: ZonesLike, delta = 0): Ms {
  assertTolerance(delta);
  if (data.zones.length === 0) return -Infinity;
  let last = -Infinity;
  for (const z of data.zones) if (z.midnightMs > last) last = z.midnightMs;
  return last + CELEBRATION_TAIL + delta;
}

/** When toasts open: `CELEBRATION_LEAD` before the first midnight; no zones — `null`. */
export function toastsOpenAt(data: ZonesLike): Ms | null {
  if (data.zones.length === 0) return null;
  let first = Infinity;
  for (const z of data.zones) if (z.midnightMs < first) first = z.midnightMs;
  return first - CELEBRATION_LEAD;
}

/** A toast can be said while the celebration is on. */
export function canSayToast(now: Ms, data: ZonesLike, delta = 0): boolean {
  return isCelebrating(now, data, delta);
}

/** Toast season at `now`: `during` inside the celebration; `before` until it opens (and for an unknown time); else `after`. */
export function toastSeason(now: Ms, data: ZonesLike, delta = 0): ToastSeason {
  if (canSayToast(now, data, delta)) return 'during';
  const open = toastsOpenAt(data);
  if (!now || open === null || now < open) return 'before';
  return 'after';
}
