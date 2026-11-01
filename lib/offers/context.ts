/**
 * Контекст для `offerEligibility` (`data-model.md` 3.4): стан гостя + розклад + стан інтерфейсу.
 * Передається в `EngineScheduler` як `getOfferContext`; сам планувальник лише викликає двигун на кожному такті.
 */
import { getData } from '@/lib/data/load';
import type { ScheduledEvent } from '@/lib/data/types';
import { airSlots } from '@/lib/engine/currentAirEvent';
import { midnightOf } from '@/lib/engine/eventStatus';
import type { OfferContext } from '@/lib/engine/offerEligibility';
import { useGuestStore } from '@/stores/guest';
import { getOfferUi } from './uiState';

/** Сумісна з `getOfferContext(now)`: стан гостя від часу не залежить, тож `now` не потрібен. */
export function buildOfferContext(): OfferContext | null {
  const guest = useGuestStore.getState();
  if (guest.stamps.length === 0) return null;
  const data = getData();

  let last: ScheduledEvent | null = null;
  for (const stamp of guest.stamps) {
    const event = data.eventsById.get(stamp.eventId);
    if (event && (last === null || midnightOf(event) > midnightOf(last))) last = event;
  }
  if (!last) return null;
  const lastMs = midnightOf(last);

  const nextSlot = airSlots(data).find((slot) => slot.midnightMs > lastMs);
  const next = nextSlot?.events[0] ?? null;

  return {
    stamps: guest.stamps,
    lastEvent: last,
    nextEvent: next,
    hasPass: guest.hasPass,
    // Оцінка — рядок у штампі (рішення 2026-11-01): вікна не займає й пропозицій не блокує; окремої картки немає.
    rate: 'none',
    offers: guest.offers,
    ui: getOfferUi(),
  };
}
