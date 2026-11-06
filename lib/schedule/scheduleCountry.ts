/**
 * Картка країни в поясі для «Мого графіка» (дошка `Desk-Schedule-New` v4): стан трансляції країни зараз — група в списку
 * країн поясу (наживо → головне святкування → вебкамера → лише відлік), підпис унизу картки, мініатюра.
 */
import type { CelebrationType, Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { countryEventsInZone, countryStreamRows, type StreamRowData } from '@/lib/live/countryData';
import { countryHref } from '@/lib/player/BroadcastController';

export type CountryGroup = 'live' | 'main' | 'webcam' | 'countdown';
export const GROUP_ORDER: readonly CountryGroup[] = ['live', 'main', 'webcam', 'countdown'];

export interface ScheduleCountry {
  iso: string;
  name: string;
  flagCode: string;
  href: string;
  /** Подія країни в поясі, яку додаємо в графік (головна — з трансляцією, інакше перша). */
  eventId: string;
  /** Головне місто (чи «місто · місце» трансляції). */
  place: string;
  group: CountryGroup;
  /** Рядок трансляції для мініатюри й підпису; `null` — лише відлік. */
  row: StreamRowData | null;
  midnightMs: Ms;
  popularity: number;
}

const TYPE_RANK: Record<CelebrationType, number> = { main: 0, tv: 1, webcam: 2, 'countdown-only': 3 };

function mainEventOf(events: readonly ScheduledEvent[]): ScheduledEvent | undefined {
  return [...events].sort((a, b) => Number(b.isMainCelebration) - Number(a.isMainCelebration) || TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.popularity - a.popularity)[0];
}

/** Країна в поясі: група, подія, місто, рядок трансляції. */
export function scheduleCountry(data: Dataset, iso: string, zoneId: string, now: Ms): ScheduleCountry | null {
  const country = data.countriesByIso.get(iso);
  const events = countryEventsInZone(data, iso, zoneId);
  const main = mainEventOf(events);
  if (!country || !main) return null;
  const rows = countryStreamRows(data, iso, zoneId, now);
  const live = rows.find((r) => r.status === 'live');
  const mainRow = rows.find((r) => r.kind === 'main');
  const row = live ?? mainRow ?? rows[0] ?? null;
  const group: CountryGroup = live ? 'live' : mainRow ? 'main' : rows.length ? 'webcam' : 'countdown';
  const city = data.citiesById.get((row ? data.eventsById.get(row.eventId) : main)?.cityId ?? main.cityId);
  return {
    iso,
    name: country.name.uk,
    flagCode: country.flagCode,
    href: countryHref(country),
    eventId: row?.eventId ?? main.id,
    place: row?.title ?? city?.name.uk ?? '',
    group,
    row,
    midnightMs: main.midnightMs,
    popularity: country.popularity,
  };
}
