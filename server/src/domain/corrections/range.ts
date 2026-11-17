/**
 * Correction range of an event moment (AC-55, owner answer Q3), ring 1 — pure.
 *
 * A corrected moment may differ from the event's base moment (the catalog value) by at most 60 min
 * either way, inclusive. A different Q3 answer changes this file only.
 */

export const MAX_SHIFT_MS = 60 * 60_000;

export type RangeCheck = 'ok' | 'correction-out-of-range';

export function checkRange(baseMoment: number, newMoment: number): RangeCheck {
  return Math.abs(newMoment - baseMoment) <= MAX_SHIFT_MS ? 'ok' : 'correction-out-of-range';
}
