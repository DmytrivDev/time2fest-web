/**
 * Контекст для `offerEligibility` (`data-model.md` 3.4): стан гостя + розклад + стан інтерфейсу.
 * Передається в `EngineScheduler` як `getOfferContext`; сам планувальник лише викликає двигун на кожному такті.
 */
import { getData } from '@/lib/data/load';
import type { Ms, ScheduledEvent } from '@/lib/data/types';
import { airSlots } from '@/lib/engine/currentAirEvent';
import { midnightOf } from '@/lib/engine/eventStatus';
import { momentTimeline } from '@/lib/engine/momentTimeline';
import type { OfferContext } from '@/lib/engine/offerEligibility';
import { useGuestStore } from '@/stores/guest';
import { getOfferUi } from './uiState';

export type OfferRateState = OfferContext['rate'];

/** Оцінка подій останнього моменту: відкрита → `open`; закрита → `closed`; не відкривалась → `none`. */
export function rateStateOf(eventIds: readonly string[], rate: Record<string, { closed: boolean }>): OfferRateState {
  const entries = eventIds.map((id) => rate[id]).filter((r): r is { closed: boolean } => r !== undefined);
  if (entries.length === 0) return 'none';
  return entries.some((r) => !r.closed) ? 'open' : 'closed';
}

export function buildOfferContext(now: Ms): OfferContext | null {
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

  const lastSlotEventIds = guest.stamps
    .map((s) => data.eventsById.get(s.eventId))
    .filter((e): e is ScheduledEvent => e !== undefined && midnightOf(e) === lastMs)
    .map((e) => e.id);

  const nextSlot = airSlots(data).find((slot) => slot.midnightMs > lastMs);
  const next = nextSlot?.events[0] ?? null;

  return {
    stamps: guest.stamps,
    lastEvent: last,
    nextEvent: next,
    hasPass: guest.hasPass,
    // Оцінка — рядком у штампі (рішення 2026-11-01), вікна не займає й пропозиції не блокує; окрема картка оцінки
    // буває лише тоді, коли штамп прибрали «×». Після `rateCloseAt` картка точно закрита, навіть якщо `closed` не
    // встигло записатись (перезавантаження).
    rate: !lastSlotEventIds.every((id) => guest.stampsDismissed?.includes(id))
      ? 'none'
      : now >= momentTimeline(last).rateCloseAt
        ? 'closed'
        : rateStateOf(lastSlotEventIds, guest.rate),
    offers: guest.offers,
    ui: getOfferUi(),
  };
}
