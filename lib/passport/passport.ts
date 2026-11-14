/**
 * Дані сторінки «Мій паспорт Нових років» (рішення власника 2026-11-07, концепція `passport-concept-2026-11-07.md`,
 * дошки `Desk-Passport-New` / `Phone-Passport-New`):
 * - континенти — 6, без Антарктиди (регіони UI зводимо: Близький Схід → Азія, Кариби й Центральна Америка → Північна
 *   Америка; Туреччина й Кіпр — Європа; Росія — за поясом, як у `regionOf`);
 * - оцінка «Як тобі шоу?» — лише головні святкування з трансляцією (тип події «головне святкування» чи ТБ);
 *   вебкамери й «лише відлік» — без оцінки;
 * - «Наступний штамп»: наступний пояс є в графіку — країна з графіка; ні — країни наступної півночі (наживо, головне
 *   святкування, вебкамера, лише відлік);
 * - серії: «Усі континенти» (6), «5 поясів», «10 країн», «Усі пояси за свято».
 */
import { regionOf, type RegionKey } from '@/lib/geo/regions';
import type { Dataset, Ms, Stamp } from '@/lib/data/types';
import { countryHref } from '@/lib/live/countryHref';
import { scheduledCountries, zoneCountryIsos } from '@/lib/schedule/countryZone';
import { GROUP_ORDER, scheduleCountry, type ScheduleCountry } from '@/lib/schedule/scheduleCountry';

export const CONTINENTS = ['europe', 'asia', 'africa', 'northAmerica', 'southAmerica', 'oceania'] as const;
export type Continent = (typeof CONTINENTS)[number];

const REGION_TO_CONTINENT: Record<RegionKey, Continent | null> = {
  europe: 'europe',
  middleEast: 'asia',
  africa: 'africa',
  asia: 'asia',
  northAmerica: 'northAmerica',
  caribbean: 'northAmerica',
  southAmerica: 'southAmerica',
  oceania: 'oceania',
  antarctic: null,
};

/** Континент країни в поясі; Антарктида й невідомі — `null`. */
export function continentOf(iso: string, offsetMinutes: number): Continent | null {
  if (iso === 'TR' || iso === 'CY') return 'europe';
  const region = regionOf(iso, offsetMinutes);
  return region ? REGION_TO_CONTINENT[region] : null;
}

/**
 * Чи можна оцінити шоу події: головне святкування міста з трансляцією — головне шоу, ТБ чи вебкамера (у прототипних
 * даних Сідней, Лондон, Париж, Ріо, Нью-Йорк, Токіо, Окленд поки мають лише вебкамеру). «Лише відлік» — без оцінки.
 * Власник 2026-11-07: на прототипі кожен штамп з трансляцією має потрапляти в рейтинг — однаково в штампі під плеєром,
 * паспорті й «Рейтингу святкувань».
 */
export function isRateable(data: Dataset, eventId: string): boolean {
  const e = data.eventsById.get(eventId);
  return !!e && e.isMainCelebration && e.type !== 'countdown-only';
}

export interface PassportStamp {
  eventId: string;
  city: string;
  countryIso: string;
  country: string;
  flagCode: string;
  illustrationId: string;
  zoneId: string;
  offsetMinutes: number;
  midnightMs: Ms;
  continent: Continent | null;
  rateable: boolean;
  href: string;
}

export function passportStamps(stamps: readonly Stamp[], data: Dataset): PassportStamp[] {
  return [...stamps]
    .map((st) => {
      const e = data.eventsById.get(st.eventId);
      const country = data.countriesByIso.get(st.countryIso);
      const zone = e ? data.zonesById.get(e.zoneId) : undefined;
      if (!e || !zone) return null;
      return {
        eventId: st.eventId,
        city: data.citiesById.get(e.cityId)?.name.uk ?? st.cityName,
        countryIso: st.countryIso,
        country: country?.name.uk ?? st.countryIso,
        flagCode: country?.flagCode ?? st.countryIso,
        illustrationId: country?.illustrationId ?? st.illustrationId,
        zoneId: e.zoneId,
        offsetMinutes: zone.offsetMinutes,
        midnightMs: e.midnightMs,
        continent: continentOf(st.countryIso, zone.offsetMinutes),
        rateable: isRateable(data, st.eventId),
        href: country ? countryHref(country, { eventId: e.id }) : '/',
      } satisfies PassportStamp;
    })
    .filter((x): x is PassportStamp => x !== null)
    .sort((a, b) => a.midnightMs - b.midnightMs || a.city.localeCompare(b.city, 'uk'));
}

export interface PassportStats {
  stamps: number;
  countries: number;
  continents: ReadonlySet<Continent>;
  zones: number;
  zonesTotal: number;
}

export function passportStats(rows: readonly PassportStamp[], data: Dataset): PassportStats {
  return {
    stamps: rows.length,
    countries: new Set(rows.map((r) => r.countryIso)).size,
    continents: new Set(rows.map((r) => r.continent).filter((c): c is Continent => c !== null)),
    zones: new Set(rows.map((r) => r.zoneId)).size,
    zonesTotal: data.zones.length,
  };
}

export type NextStamp =
  | { kind: 'schedule'; country: ScheduleCountry; midnightMs: Ms }
  | { kind: 'zone'; zoneId: string; offsetMinutes: number; midnightMs: Ms; countries: ScheduleCountry[]; total: number };

/** Наступний штамп: найближча північ попереду — країна з графіка або країни поясу (головні з трансляцією першими). */
export function nextStamp(data: Dataset, schedule: readonly string[], now: Ms): NextStamp | null {
  const zone = [...data.zones].filter((z) => z.midnightMs > now).sort((a, b) => a.midnightMs - b.midnightMs)[0];
  if (!zone) return null;
  const mine = scheduledCountries(schedule, zone.id, data)[0];
  if (mine) {
    const c = scheduleCountry(data, mine, zone.id, now);
    if (c) return { kind: 'schedule', country: c, midnightMs: zone.midnightMs };
  }
  const all = zoneCountryIsos(zone.id, data)
    .map((iso) => scheduleCountry(data, iso, zone.id, now))
    .filter((c): c is ScheduleCountry => c !== null)
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || b.popularity - a.popularity);
  return { kind: 'zone', zoneId: zone.id, offsetMinutes: zone.offsetMinutes, midnightMs: zone.midnightMs, countries: all, total: all.length };
}

/** Найближча північ попереду, де є країна континенту (для «За континентами»: чого бракує). */
export function nextMidnightOfContinent(data: Dataset, continent: Continent, now: Ms): Ms | null {
  const zones = [...data.zones].filter((z) => z.midnightMs > now).sort((a, b) => a.midnightMs - b.midnightMs);
  for (const z of zones) {
    if (zoneCountryIsos(z.id, data).some((iso) => continentOf(iso, z.offsetMinutes) === continent)) return z.midnightMs;
  }
  return null;
}
