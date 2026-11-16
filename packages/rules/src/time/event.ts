import { HANDOVER_AFTER, HOWTO_BEFORE, RECORDING_AFTER } from './constants';
import type { EventLike, EventStatus, MidnightLike, Ms } from './types';

/** Мс півночі події: з `midnightMs`, якщо вже розібрано, інакше `Date.parse`. */
export function midnightOf(e: Pick<EventLike, 'midnightUtc'> & { midnightMs?: Ms }): Ms {
  return e.midnightMs ?? Date.parse(e.midnightUtc);
}

/** `data-model.md` 1.4: soon → live (−15 хв) → ended (+15 хв) → recording (+RECORDING_AFTER). */
export function eventStatus(now: Ms, event: Pick<EventLike, 'midnightUtc'> & { midnightMs?: Ms }): EventStatus {
  const t = now - midnightOf(event);
  if (t < -HOWTO_BEFORE) return 'soon';
  if (t < HANDOVER_AFTER) return 'live';
  if (t < RECORDING_AFTER) return 'ended';
  return 'recording';
}

export function toRuntime<E extends MidnightLike>(now: Ms, event: E): E & { status: EventStatus; t: number } {
  return {
    ...event,
    status: eventStatus(now, event as unknown as Pick<EventLike, 'midnightUtc'> & { midnightMs?: Ms }),
    t: Math.floor((now - event.midnightMs) / 1_000),
  };
}

/** Мить передачі ефіру наступній події: північ + `HANDOVER_AFTER`. */
export function handoverMoment(m: Ms): Ms {
  return m + HANDOVER_AFTER;
}
