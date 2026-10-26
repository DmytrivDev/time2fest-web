import type { Ms } from '@/lib/data/types';
import { HANDOVER_AFTER } from './config';

export type ZoneState = 'past' | 'live' | 'next' | 'future';

interface ZoneLike {
  id: string;
  midnightMs: Ms;
}

/**
 * Стан поясу для мапи (`data-model.md` 3.6): `live` — поточний слот ефіру; `next` — наступний;
 * `past` — слот закінчився (північ + 15 хв); `future` — решта. `zones` — усі пояси.
 */
export function zoneState(now: Ms, zone: ZoneLike, zones: readonly ZoneLike[]): ZoneState {
  if (now >= zone.midnightMs + HANDOVER_AFTER) return 'past';
  const upcoming = [...new Set(zones.map((z) => z.midnightMs))]
    .filter((m) => now < m + HANDOVER_AFTER)
    .sort((a, b) => a - b);
  if (upcoming[0] === zone.midnightMs) return 'live';
  if (upcoming[1] === zone.midnightMs) return 'next';
  return 'future';
}
