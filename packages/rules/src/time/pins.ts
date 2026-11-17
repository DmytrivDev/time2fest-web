import { CELEBRATION_TAIL } from './constants';
import type { Ms } from './types';

/** Перша північ поясу строго після `at` (`midnights` — за зростанням); немає — `null`. */
export function nextMidnightAfter(at: Ms, midnights: readonly Ms[]): Ms | null {
  for (const m of midnights) if (m > at) return m;
  return null;
}

/** Остання північ поясу не пізніше `at`; немає — `null`. */
export function prevMidnightAtOrBefore(at: Ms, midnights: readonly Ms[]): Ms | null {
  let out: Ms | null = null;
  for (const m of midnights) {
    if (m > at) break;
    out = m;
  }
  return out;
}

/**
 * До якої миті закріплено тост, створений у `createdAt`: перша північ строго після нього; після останньої півночі — до кінця
 * свята; інакше `null`. Рівень тосту (хто закріплюється) тут не перевіряється (`midnights` — за зростанням).
 */
export function pinnedUntilAt(createdAt: Ms, midnights: readonly Ms[]): Ms | null {
  const next = nextMidnightAfter(createdAt, midnights);
  if (next !== null) return next;
  const last = midnights[midnights.length - 1];
  if (last === undefined) return null;
  const end = last + CELEBRATION_TAIL;
  return createdAt < end ? end : null;
}
