/**
 * Дані ТВ-режиму (US7) — чисті функції над набором даних області.
 * Черга «Далі» і таймлайн будуються з тих самих карток подій, що й «Зараз і далі» на головній
 * (`nowNextItems`: по одній події на слот ефіру), тож ТВ і головна не розходяться.
 */
import type { EventCardItem } from '@/components/live/eventCards';
import { hasStreamNow, withStatus } from '@/components/live/eventCards';
import type { Dataset, Ms } from '@/lib/data/types';
import { nowNextItems } from '@/lib/live/homeData';

/** Скільки карток черги «Далі» показуємо (далі — таймлайн). */
export const QUEUE_LIMIT = 6;

export interface TvTimelineFilters {
  /** «Лише з трансляціями»: наживо + трансляція очікується. */
  onlyStreams: boolean;
  /** «У моєму графіку». */
  mySchedule: boolean;
}

/** Усі слоти свята зі статусами на момент `now` (минулі, поточний, майбутні). */
export function tvEvents(data: Dataset, now: Ms, schedule: readonly string[]): EventCardItem[] {
  return withStatus(now, nowNextItems(data, now, schedule));
}

/** Таймлайн за фільтрами; поточна подія ефіру (`currentEventId`) лишається завжди — від неї рахується смуга. */
export function filterTimeline(
  items: readonly EventCardItem[],
  filters: TvTimelineFilters,
  currentEventId: string | null,
): EventCardItem[] {
  return items.filter((it) => {
    if (it.id === currentEventId) return true;
    if (filters.onlyStreams && !hasStreamNow(it)) return false;
    if (filters.mySchedule && !it.inSchedule) return false;
    return true;
  });
}

/**
 * Черга «Далі»: події після поточної. Без трансляції на місці плеєра (`onlyStreams`) показуємо
 * лише найближчі події з трансляцією («Найближчі трансляції»).
 */
export function queueAfter(
  items: readonly EventCardItem[],
  currentMidnightMs: Ms,
  opts: { onlyStreams?: boolean; limit?: number } = {},
): EventCardItem[] {
  const after = items.filter((it) => it.midnightMs > currentMidnightMs);
  const picked = opts.onlyStreams ? after.filter(hasStreamNow) : after;
  return picked.slice(0, opts.limit ?? QUEUE_LIMIT);
}

/** «Усе свято: ще 15 поясів · до 14:00»: скільки поясів лишилось і коли настане остання північ. */
export function remainingFest(data: Dataset, now: Ms): { zones: number; endMs: Ms } {
  const zones = data.zones;
  const last = zones[zones.length - 1];
  return { zones: zones.filter((z) => z.midnightMs > now).length, endMs: last?.midnightMs ?? now };
}
