/**
 * Дані ТВ-режиму (US7) — чисті функції над набором даних області.
 * Таймлайн (рішення 2026-11-06): **програма** — що покаже автопілот (по одній події на слот ефіру, ті самі картки,
 * що «Зараз і далі» на головній, `nowNextItems`) — і **події з графіка гостя**. Пояс — у картці поруч із часом.
 */
import type { EventCardItem } from '@/components/live/eventCards';
import { hasStreamNow, withStatus } from '@/components/live/eventCards';
import type { Dataset, Ms } from '@/lib/data/types';
import { utcLabel } from '@/lib/i18n/time';
import { streamRows, type StreamRowData } from '@/lib/live/countryData';
import { eventCard, nowNextItems } from '@/lib/live/homeData';

export interface TvTimelineItem extends EventCardItem {
  /** Подія програми (що покаже автопілот «Усе свято»). */
  program: boolean;
  /** «UTC+0» — пояс події. */
  utc: string;
}

/** Фільтр таймлайну: «Усі · З трансляціями · Мій графік». */
export type TvTimelineFilter = 'all' | 'live' | 'mine';

/** Програма свята й події графіка за часом півночі; у межах однієї півночі програма — першою. */
export function tvTimeline(data: Dataset, now: Ms, schedule: readonly string[]): TvTimelineItem[] {
  const program = nowNextItems(data, now, schedule);
  const ids = new Set(program.map((p) => p.id));
  const extra = schedule
    .filter((id) => !ids.has(id))
    .map((id) => data.eventsById.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => eventCard(data, e, now, schedule));
  const utc = (eventId: string) => {
    const zone = data.zonesById.get(data.eventsById.get(eventId)?.zoneId ?? '');
    return zone ? utcLabel(zone.offsetMinutes) : '';
  };
  const items = [
    ...withStatus(now, program).map((it) => ({ ...it, program: true, utc: utc(it.id) })),
    ...withStatus(now, extra).map((it) => ({ ...it, program: false, utc: utc(it.id) })),
  ];
  return items.sort((a, b) => a.midnightMs - b.midnightMs || Number(b.program) - Number(a.program));
}

/** Таймлайн за фільтром; подія в ефірі (`keepId`) лишається завжди — від неї рахується смуга. */
export function filterTimeline<T extends EventCardItem>(items: readonly T[], filter: TvTimelineFilter, keepId: string | null): T[] {
  return items.filter((it) => {
    if (it.id === keepId) return true;
    if (filter === 'live') return hasStreamNow(it);
    if (filter === 'mine') return !!it.inSchedule;
    return true;
  });
}

/** «Змінити трансляцію»: трансляції поясу, що йдуть наживо зараз. */
export function zoneLiveRows(data: Dataset, zoneId: string, now: Ms): StreamRowData[] {
  const events = data.events.filter((e) => e.zoneId === zoneId);
  return streamRows(data, events, now).filter((r) => r.status === 'live');
}

/** Сцена відліку: найближча трансляція наживо з наступних поясів (одна підказка «Перемкнути»). */
export function nearestLive(data: Dataset, afterMs: Ms, now: Ms): StreamRowData | null {
  const events = data.events
    .filter((e) => e.midnightMs > afterMs)
    .sort((a, b) => a.midnightMs - b.midnightMs || b.popularity - a.popularity);
  for (const e of events) {
    const row = streamRows(data, [e], now).find((r) => r.status === 'live');
    if (row) return row;
  }
  return null;
}

/** «Усе свято: ще 15 поясів · до 14:00»: скільки поясів лишилось і коли настане остання північ. */
export function remainingFest(data: Dataset, now: Ms): { zones: number; endMs: Ms } {
  const zones = data.zones;
  const last = zones[zones.length - 1];
  return { zones: zones.filter((z) => z.midnightMs > now).length, endMs: last?.midnightMs ?? now };
}
