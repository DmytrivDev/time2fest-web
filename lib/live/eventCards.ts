import type { EventStatus } from '@/lib/data/types';
import { eventStatus } from '@/lib/engine/eventStatus';
import type { EventCardData } from '@/components/live/EventCard';

export interface EventCardItem extends EventCardData {
  status: EventStatus;
}

/** Додає статус події на момент `now`. До гідратації (`now === 0`) усі події «скоро». */
export function withStatus(now: number, items: readonly EventCardData[]): EventCardItem[] {
  return items.map((item) => ({ ...item, status: eventStatus(now, { midnightUtc: '', midnightMs: item.midnightMs }) }));
}

export const isPastStatus = (s: EventStatus) => s === 'ended' || s === 'recording';

/** Фільтр «Лише з трансляціями» = «Наживо» + «Трансляція очікується» (одна логіка скрізь). */
export const hasStreamNow = (item: Pick<EventCardData, 'stream'>) => item.stream === 'live' || item.stream === 'expected';

/**
 * За часом півночі; серед подій того самого часу першою — подія ефіру (головне святкування, 2026-11-13), далі події з графіка.
 */
export function sortForStrip<T extends Pick<EventCardData, 'id' | 'midnightMs' | 'inSchedule'>>(items: readonly T[], firstId?: string | null): T[] {
  return [...items].sort(
    (a, b) =>
      a.midnightMs - b.midnightMs ||
      Number(!!firstId && b.id === firstId) - Number(!!firstId && a.id === firstId) ||
      Number(!!b.inSchedule) - Number(!!a.inSchedule),
  );
}
