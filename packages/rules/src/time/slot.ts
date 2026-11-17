import { CELEBRATION_TAIL, HANDOVER_AFTER } from './constants';
import type { MidnightLike, Ms, ZoneState } from './types';

/**
 * Індекс поточного слота: перший, для якого `now < midnight + 15 хв`; −1 — свято скінчилося. Останній слот передавати нікуди,
 * тому він лишається в ефірі до кінця свята — `CELEBRATION_TAIL` після останньої півночі (рішення власника 2026-11-14).
 */
export function currentSlotIndex(now: Ms, slots: readonly MidnightLike[]): number {
  const last = slots.length - 1;
  return slots.findIndex((s, i) => (i === last ? now <= s.midnightMs + CELEBRATION_TAIL : now < s.midnightMs + HANDOVER_AFTER));
}

/** Слот пояса закінчився: `now ≥ m + HANDOVER_AFTER`. */
export function isZonePast(now: Ms, m: Ms): boolean {
  return now >= m + HANDOVER_AFTER;
}

/**
 * Стан поясу для мапи (`data-model.md` 3.6): `live` — поточний слот ефіру; `next` — наступний;
 * `past` — слот закінчився (північ + 15 хв); `future` — решта. `zones` — усі пояси.
 */
export function zoneState(now: Ms, zone: MidnightLike, zones: readonly MidnightLike[]): ZoneState {
  if (isZonePast(now, zone.midnightMs)) return 'past';
  const upcoming = [...new Set(zones.map((z) => z.midnightMs))]
    .filter((m) => !isZonePast(now, m))
    .sort((a, b) => a - b);
  if (upcoming[0] === zone.midnightMs) return 'live';
  if (upcoming[1] === zone.midnightMs) return 'next';
  return 'future';
}
