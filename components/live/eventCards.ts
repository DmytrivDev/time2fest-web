import type { EventStatus } from '@/lib/data/types';
import { eventStatus } from '@/lib/engine/eventStatus';
import type { EventCardData } from './EventCard';

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

/** За часом півночі; події з графіка — першими серед подій того самого часу. */
export function sortForStrip<T extends Pick<EventCardData, 'midnightMs' | 'inSchedule'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.midnightMs - b.midnightMs || Number(!!b.inSchedule) - Number(!!a.inSchedule));
}
