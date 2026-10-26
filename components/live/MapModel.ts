import type { CelebrationType, Dataset, Ms } from '@/lib/data/types';

/** Країна поясу на мапі: посилання, прапор і «Як святкувати» (до трьох традицій). */
export interface MapCountry {
  iso: string;
  name: string;
  flagCode: string;
  href: string;
  /** Традиції для `HowToPopover`; порожньо — кнопки «Як святкувати» немає. */
  traditions?: { id: string; title: string; text: string }[];
}

/** Пояс: `id` збігається з `data-zone` шляху в `zonemap.json` (`utc+0545`). */
export interface MapZone {
  id: string;
  offsetMinutes: number;
  midnightMs: Ms;
  /** За спаданням популярності: перша — «головна» країна поясу. */
  countries: MapCountry[];
}

/** Основне місто на мапі: тиха точка, коралова — коли є трансляція (C18). */
export interface MapCity {
  id: string;
  name: string;
  landmark?: string;
  zoneId: string;
  countryIso: string;
  /** 0–1 у координатах повної рівнопроміжної мапи світу (як `mapPoint` у schedule.json). */
  x: number;
  y: number;
  celebrationType: CelebrationType;
  /** `live` — для міста є трансляція (її показ залежить від стану поясу); `none` — лише відлік. */
  stream: 'live' | 'none';
}

export interface MapModel {
  zones: MapZone[];
  cities: MapCity[];
}

export const countryPath = (slug: string): string => `/country/${slug}/`;

/** Дані мапи з набору даних області: по одному основному місту на пояс (його `representativeCityId`). */
export function buildMapModel(data: Dataset): MapModel {
  const zones: MapZone[] = [];
  const cities: MapCity[] = [];
  for (const z of data.zones) {
    const isoSet = new Set<string>();
    for (const c of data.cities) if (c.zoneId === z.id) isoSet.add(c.countryIso);
    const countries = [...isoSet]
      .map((iso) => data.countriesByIso.get(iso))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .sort((a, b) => b.popularity - a.popularity)
      .map<MapCountry>((c) => ({
        iso: c.iso,
        name: c.name.uk,
        flagCode: c.flagCode,
        href: countryPath(c.slug),
        traditions: c.howTo.traditions.slice(0, 3).map((t) => ({ id: t.id, title: t.title, text: t.text })),
      }));
    zones.push({ id: z.id, offsetMinutes: z.offsetMinutes, midnightMs: z.midnightMs, countries });
    const city = data.citiesById.get(z.representativeCityId);
    if (city) {
      cities.push({
        id: city.id,
        name: city.name.uk,
        ...(city.landmark ? { landmark: city.landmark.uk } : {}),
        zoneId: z.id,
        countryIso: city.countryIso,
        x: city.mapPoint.x,
        y: city.mapPoint.y,
        celebrationType: city.celebrationType,
        stream: city.celebrationType === 'countdown-only' ? 'none' : 'live',
      });
    }
  }
  return { zones, cities };
}

/** Геометрія з `data/zonemap.json` (T079). */
export interface ZoneMapGeometry {
  meta: { width: number; height: number; latTop: number; latBottom: number };
  zones: { offset: string; offsetMinutes: number; zoneId: string; d: string; label: [number, number] }[];
  markers: { zoneId: string; x: number; y: number }[];
}

/** `mapPoint` (0–1 по всьому світу, lat +90…−90) → відсотки видимої частини мапи. */
export function pointToPercent(p: { x: number; y: number }, meta: ZoneMapGeometry['meta']): { left: number; top: number } {
  const lat = 90 - p.y * 180;
  const top = ((meta.latTop - lat) / (meta.latTop - meta.latBottom)) * 100;
  return { left: p.x * 100, top };
}

/** «UTC+5:45» для підпису в картці поясу (UTC лише там). */
export function utcLabel(offsetMinutes: number): string {
  const a = Math.abs(offsetMinutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const sign = offsetMinutes < 0 ? '−' : '+';
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
