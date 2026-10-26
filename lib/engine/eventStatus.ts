import type { Event, EventRuntime, EventStatus, Ms, ScheduledEvent } from '@/lib/data/types';
import { HANDOVER_AFTER, HOWTO_BEFORE, RECORDING_AFTER } from './config';

/** Мс півночі події: з `midnightMs`, якщо вже розібрано, інакше `Date.parse`. */
export function midnightOf(e: Pick<Event, 'midnightUtc'> & { midnightMs?: Ms }): Ms {
  return e.midnightMs ?? Date.parse(e.midnightUtc);
}

/** `data-model.md` 1.4: soon → live (−15 хв) → ended (+15 хв) → recording (+RECORDING_AFTER). */
export function eventStatus(now: Ms, event: Pick<Event, 'midnightUtc'> & { midnightMs?: Ms }): EventStatus {
  const t = now - midnightOf(event);
  if (t < -HOWTO_BEFORE) return 'soon';
  if (t < HANDOVER_AFTER) return 'live';
  if (t < RECORDING_AFTER) return 'ended';
  return 'recording';
}

export function toRuntime(now: Ms, event: ScheduledEvent): EventRuntime {
  return { ...event, status: eventStatus(now, event), t: Math.floor((now - event.midnightMs) / 1_000) };
}
