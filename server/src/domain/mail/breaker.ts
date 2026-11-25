/** Вікна «зламаного» постачальника (SPEC-10 [П-7], AC-39), ring 1. */
import { msToUtcMidnight } from './day';

export type BrokenKind = 'quota' | 'other';

export const OTHER_BROKEN_MS = 5 * 60 * 1000;

/** Квота — до 00:00 UTC наступної доби, інше — 5 хвилин. Повертає мс епохи. */
export function brokenUntil(kind: BrokenKind, now: Date): number {
  return kind === 'quota' ? now.getTime() + msToUtcMidnight(now) : now.getTime() + OTHER_BROKEN_MS;
}
