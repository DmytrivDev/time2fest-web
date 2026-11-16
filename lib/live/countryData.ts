/**
 * Дані сторінки країни (S-COUNTRY, US2) з набору даних області. Чисті функції, «зараз» — аргументом від `TimeSource`.
 *
 * - пояс за замовчуванням — пояс столиці (для країн з кількома поясами), інакше перший пояс країни;
 * - рядки трансляцій (C2 `StreamRow`): по одному на джерело ланцюжка події; міста «Лише відлік» (без ланцюжка
 *   чи без придатних джерел) не показуються;
 * - після `RECORDING_AFTER` статус рядка — `recording` («Запис»).
 */
import type { CelebrationType, Country, Dataset, LoadedZone, Ms, ScheduledEvent, StreamSource } from '@/lib/data/types';
import { eventStatus, RECORDING_AFTER } from '@time2fest/rules/time';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { countryHref } from '@/lib/player/BroadcastController';

/** Місто-столиця для країн з кількома поясами (у даних столиці немає; решта країн має один пояс). */
export const CAPITAL_CITY: Readonly<Record<string, string>> = {
  KI: 'tarawa',
  NZ: 'auckland',
  RU: 'moscow',
  AU: 'sydney',
  FM: 'pohnpei',
  PG: 'port-moresby',
  ID: 'jakarta',
  CN: 'beijing',
  MN: 'ulaanbaatar',
  CD: 'kinshasa',
  ES: 'madrid',
  PT: 'lisbon',
  GL: 'nuuk',
  BR: 'rio-de-janeiro',
  CL: 'santiago',
  CA: 'toronto',
  US: 'new-york',
  MX: 'mexico-city',
  EC: 'guayaquil',
  PF: 'tahiti',
};

/** Пояси країни за зростанням півночі (перший — найраніший). */
export function countryZones(data: Dataset, country: Pick<Country, 'iso' | 'zoneIds'>): LoadedZone[] {
  return country.zoneIds
    .map((id) => data.zonesById.get(id))
    .filter((z): z is LoadedZone => z !== undefined)
    .sort((a, b) => a.midnightMs - b.midnightMs);
}

/**
 * Пояс за замовчуванням. Коли «зараз» відоме (рішення власника 2026-11-05): найближча північ, що ще попереду; усі минули —
 * остання. Поки час невідомий — пояс столиці, інакше перший пояс країни.
 */
export function defaultZoneId(data: Dataset, country: Pick<Country, 'iso' | 'zoneIds'>, now?: Ms): string | null {
  const zones = countryZones(data, country);
  if (now !== undefined && now > 0 && zones.length > 1) {
    return (zones.find((z) => z.midnightMs + RECORDING_AFTER > now) ?? zones.at(-1))?.id ?? null;
  }
  const capital = CAPITAL_CITY[country.iso];
  const capitalZone = capital ? data.citiesById.get(capital)?.zoneId : undefined;
  if (capitalZone && country.zoneIds.includes(capitalZone)) return capitalZone;
  return countryZones(data, country)[0]?.id ?? null;
}

/** Події країни в поясі: спершу основне святкування, далі за `popularity` ↓. */
export function countryEventsInZone(data: Dataset, iso: string, zoneId: string): ScheduledEvent[] {
  return data.events
    .filter((e) => e.countryIso === iso && e.zoneId === zoneId)
    .sort((a, b) => Number(b.isMainCelebration) - Number(a.isMainCelebration) || b.popularity - a.popularity || (a.id < b.id ? -1 : 1));
}

/** Головна подія країни в поясі (її показує плеєр сторінки за замовчуванням). */
export function countryMainEvent(data: Dataset, iso: string, zoneId: string): ScheduledEvent | undefined {
  return countryEventsInZone(data, iso, zoneId)[0];
}

/** Статус рядка трансляції: похідний статус джерела, а після півночі (+30 хв) — «Запис». */
export type StreamRowStatus = 'live' | 'expected' | 'possible' | 'recording';

/** Рядок C2 `StreamRow`. */
export interface StreamRowData {
  /** id джерела (`StreamSource.id`). */
  id: string;
  eventId: string;
  countryIso: string;
  flagCode: string;
  /** Назва країни в називному відмінку. */
  countryName: string;
  /** «Париж · Ейфелева вежа» (`StreamSource.title.uk`). */
  title: string;
  /** Тип джерела: основне святкування / вебкамера / ТБ. */
  kind: StreamSource['kind'];
  celebrationType: CelebrationType;
  status: StreamRowStatus;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  /** Сторінка країни. */
  href: string;
  /** Повтор півночі, якщо джерело його дає. */
  hasReplay: boolean;
}

/** Рядки трансляцій подій (порядок подій зберігається, джерела — за `order`); непридатні джерела пропускаються. */
export function streamRows(data: Dataset, events: readonly ScheduledEvent[], now: Ms): StreamRowData[] {
  const out: StreamRowData[] = [];
  for (const event of events) {
    const chain = data.chainsByEventId.get(event.id);
    if (!chain?.sources.length) continue;
    const country = data.countriesByIso.get(event.countryIso);
    const recording = eventStatus(now, event) === 'recording';
    for (const src of chain.sources) {
      const st = sourceStatus(src, now);
      if (st === 'none') continue;
      out.push({
        id: src.id,
        eventId: event.id,
        countryIso: event.countryIso,
        flagCode: country?.flagCode ?? event.countryIso,
        countryName: country?.name.uk ?? event.countryIso,
        title: src.title.uk,
        kind: src.kind,
        celebrationType: event.type,
        status: recording ? 'recording' : st,
        midnightMs: event.midnightMs,
        href: country ? countryHref(country, { eventId: event.id }) : '/',
        hasReplay: !!src.replay,
      });
    }
  }
  return out;
}

/** «Міста й трансляції · <Країна>»: трансляції країни в поясі. */
export function countryStreamRows(data: Dataset, iso: string, zoneId: string, now: Ms): StreamRowData[] {
  return streamRows(data, countryEventsInZone(data, iso, zoneId), now);
}

/** «Трансляції в цьому поясі»: трансляції інших країн з тією самою північчю. */
export function zoneStreamRows(data: Dataset, zoneId: string, excludeIso: string, now: Ms): StreamRowData[] {
  const zone = data.zonesById.get(zoneId);
  if (!zone) return [];
  const events = data.events
    .filter((e) => e.midnightMs === zone.midnightMs && e.countryIso !== excludeIso)
    .sort((a, b) => b.popularity - a.popularity || (a.id < b.id ? -1 : 1));
  return streamRows(data, events, now);
}
