import type { CelebrationType, Dataset, Gender, Ms } from '@/lib/data/types';
import { zoneRowOf } from '@/lib/firstrow/zone';

/** Країна поясу на мапі: посилання, прапор і «Як святкувати» (до трьох традицій). */
export interface MapCountry {
  iso: string;
  name: string;
  flagCode: string;
  href: string;
  /** Традиції для `HowToPopover` і вікна країни; порожньо — кнопки «Як святкувати» немає. */
  traditions?: { id: string; title: string; text: string; iconId?: string }[];
  /** Рід назви країни: «Україна зустріла», «США зустріли» (підказка мапи). */
  gender?: Gender;
  /** Головне місто країни в цьому поясі, якщо там є трансляція (підказка мапи: «Київ · наживо»). */
  mainCity?: string;
  /** Головне місто країни в цьому поясі — завжди (картки країн у вікні поясу). */
  city?: string;
  /** Трансляції країни в цьому поясі (вікно країни, «Де дивитися»): місце, місто, тип. */
  streams?: MapCountryStream[];
  /** Події країни в цьому поясі — штамп за присутність опівночі (`guest.stamps`). */
  eventIds?: string[];
  /** Тиха зустріч (`event.restrained`): коротка примітка в шапці вікна країни. */
  quiet?: string;
  /** Подія з «Першим рядом» у цьому поясі (вікно країни: «лишилось N місць»). */
  firstRowEventId?: string;
}

/** Трансляція країни у вікні країни: місто з подією, що має відео. */
export interface MapCountryStream {
  cityId: string;
  /** Подія міста в цьому поясі — для «Додати в графік». */
  eventId?: string;
  /** Що за трансляція: пам’ятка (`landmark`), інакше — місто. */
  place: string;
  city: string;
  type: CelebrationType;
}

/** Трансляція в поясі (вікно поясу, «Де дивитися»): місто з подією, що має відео. */
export interface MapStream {
  cityId: string;
  /** Подія міста в цьому поясі — для «Додати в графік». */
  eventId?: string;
  city: string;
  iso: string;
  country: string;
  flagCode: string;
  href: string;
  type: CelebrationType;
}

/** Пояс: `id` збігається з `data-zone` шляху в `zonemap.json` (`utc+0545`). */
export interface MapZone {
  id: string;
  offsetMinutes: number;
  midnightMs: Ms;
  /** За спаданням популярності: перша — «головна» країна поясу. */
  countries: MapCountry[];
  /** Скільки міст поясу мають трансляцію (підказка мапи: «3 трансляції»). */
  streamCount?: number;
  /** Міста з трансляцією — за популярністю країни (вікно поясу, «Де дивитися»). */
  streams?: MapStream[];
  /** Скільки міст у поясі (вікно поясу: «31 місто»). */
  cityCount?: number;
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

/**
 * Міста на мапі (рішення власника 2026-11-02): лише ці 20, у такому порядку; решта з’явиться пізніше.
 * Якщо міста немає в наборі даних, його просто немає на мапі.
 */
export const MAP_CITY_IDS = [
  'auckland', 'sydney', 'tokyo', 'seoul', 'new-delhi', 'dubai', 'kyiv', 'johannesburg', 'cairo', 'rome',
  'berlin', 'paris', 'london', 'reykjavik', 'dakar', 'rio-de-janeiro', 'new-york', 'toronto', 'las-vegas', 'los-angeles',
] as const;

/** Дані мапи з набору даних області: пояси з країнами й міста з `MAP_CITY_IDS`. */
export function buildMapModel(data: Dataset): MapModel {
  const zones: MapZone[] = [];
  const cities: MapCity[] = [];
  for (const z of data.zones) {
    const isoSet = new Set<string>();
    const zoneCities = data.cities.filter((c) => c.zoneId === z.id);
    for (const c of zoneCities) isoSet.add(c.countryIso);
    const streamCities = zoneCities.filter((c) => c.celebrationType !== 'countdown-only');
    // Головне місто країни в поясі з трансляцією: спершу «головне» країни, далі — перше з трансляцією.
    const mainCityOf = (iso: string) => {
      const own = streamCities.filter((c) => c.countryIso === iso);
      return (own.find((c) => c.isCountryMain) ?? own[0])?.name.uk;
    };
    const cityOf = (iso: string) => {
      const own = zoneCities.filter((c) => c.countryIso === iso);
      return (own.find((c) => c.isCountryMain) ?? own[0])?.name.uk;
    };
    const zoneEvents = data.events.filter((e) => e.zoneId === z.id);
    // Вікно країни: трансляції (головне місто — першим), події для штампа, тиха зустріч, «Перший ряд».
    const countryExtras = (iso: string): Partial<MapCountry> => {
      const own = streamCities
        .filter((c) => c.countryIso === iso)
        .sort((a, b) => Number(b.isCountryMain) - Number(a.isCountryMain));
      const events = zoneEvents.filter((e) => e.countryIso === iso);
      const quiet = events.find((e) => e.restrained)?.restrained?.note.uk;
      // «Перший ряд» — один на пояс (2026-11-05): усі країни поясу показують місця того самого ряду.
      const firstRow = zoneRowOf(data, z.id);
      return {
        streams: own.map((c) => ({
          cityId: c.id,
          eventId: zoneEvents.find((e) => e.cityId === c.id)?.id,
          place: c.landmark?.uk ?? c.name.uk,
          city: c.name.uk,
          type: c.celebrationType,
        })),
        eventIds: events.map((e) => e.id),
        ...(quiet ? { quiet } : {}),
        ...(firstRow ? { firstRowEventId: firstRow.id } : {}),
      };
    };
    const countries = [...isoSet]
      .map((iso) => data.countriesByIso.get(iso))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .sort((a, b) => b.popularity - a.popularity)
      .map<MapCountry>((c) => ({
        iso: c.iso,
        name: c.name.uk,
        flagCode: c.flagCode,
        href: countryPath(c.slug),
        traditions: c.howTo.traditions.slice(0, 3).map((t) => ({ id: t.id, title: t.title, text: t.text, iconId: t.iconId })),
        gender: c.gender,
        ...(mainCityOf(c.iso) ? { mainCity: mainCityOf(c.iso) } : {}),
        ...(cityOf(c.iso) ? { city: cityOf(c.iso) } : {}),
        ...countryExtras(c.iso),
      }));
    const rank = new Map(countries.map((c, i) => [c.iso, i]));
    const streams = streamCities
      .map<MapStream | null>((c) => {
        const country = countries.find((k) => k.iso === c.countryIso);
        return country
          ? {
              cityId: c.id,
              eventId: zoneEvents.find((e) => e.cityId === c.id)?.id,
              city: c.name.uk,
              iso: country.iso,
              country: country.name,
              flagCode: country.flagCode,
              href: country.href,
              type: c.celebrationType,
            }
          : null;
      })
      .filter((v): v is MapStream => v !== null)
      .sort((a, b) => (rank.get(a.iso) ?? 0) - (rank.get(b.iso) ?? 0));
    zones.push({
      id: z.id,
      offsetMinutes: z.offsetMinutes,
      midnightMs: z.midnightMs,
      countries,
      streamCount: streamCities.length,
      streams,
      cityCount: zoneCities.length,
    });
  }
  for (const id of MAP_CITY_IDS) {
    const city = data.citiesById.get(id);
    if (!city) continue;
    cities.push({
      id: city.id,
      name: city.name.uk,
      ...(city.landmark ? { landmark: city.landmark.uk } : {}),
      zoneId: city.zoneId,
      countryIso: city.countryIso,
      x: city.mapPoint.x,
      y: city.mapPoint.y,
      celebrationType: city.celebrationType,
      stream: city.celebrationType === 'countdown-only' ? 'none' : 'live',
    });
  }
  return { zones, cities };
}

/**
 * Геометрія з `data/zonemap.json` (`scripts/zonemap-v2`, рішення власника 2026-11-02): стара мапа Time2Fest (Figma,
 * перевірена вручну) з поясами на ніч 31.12.2026 за tzdata 2026f; проекція Міллера в кадрі 1781×911.
 */
export interface ZoneMapGeometry {
  meta: { width: number; height: number; lon0: number; pxPerDeg: number; equatorY: number };
  /**
   * Пояс: країни (окремі шляхи — для підсвітки країни), морські області острівних країн `sea`, смуга в океані `band`
   * (варіант «смуги поясів»), точка значка `label`.
   */
  zones: {
    offset: string;
    offsetMinutes: number;
    zoneId: string;
    countries: { iso: string; d: string }[];
    sea?: { iso: string; d: string }[];
    band?: string;
    label: [number, number];
  }[];
  /** Пояси, суходолу яких майже не видно (Кірітіматі, Чатем), — точка. */
  markers: { zoneId: string; x: number; y: number }[];
  /** Кордони країн на суходолі, один шлях. */
  borders?: string;
  /** Межі поясів в океані й на суходолі (разом із кордонами, що є межами поясів), один шлях. */
  zoneLines?: string;
  /** Умовні кордони в морі між острівними країнами (Океанія), один шлях. */
  sea?: string;
  /** Лінія зміни дат. */
  dayline?: string;
  /** Великі озера (колір океану). */
  lakes?: string;
  /** Області дрібних островів (Андамани, Лакшадвіп, Маркізькі): `frame` — пунктирна рамка, інакше лише заливка. */
  areas?: { zoneId: string; iso: string; x0: number; y0: number; x1: number; y1: number; frame: boolean }[];
}

/** lon/lat → пікселі мапи (та сама проекція Міллера, що й у скрипті збирання). */
export function projectLonLat(lon: number, lat: number, meta: ZoneMapGeometry['meta']): { x: number; y: number } {
  const dLon = (((lon - meta.lon0) % 360) + 360) % 360;
  const r = (meta.pxPerDeg * 180) / Math.PI;
  const phi = (lat * Math.PI) / 180;
  return { x: dLon * meta.pxPerDeg, y: meta.equatorY - r * 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi)) };
}

/** `mapPoint` (0–1 по всьому світу в рівнопроміжних координатах, lat +90…−90) → відсотки полотна мапи. */
export function pointToPercent(p: { x: number; y: number }, meta: ZoneMapGeometry['meta']): { left: number; top: number } {
  const { x, y } = projectLonLat(p.x * 360 - 180, 90 - p.y * 180, meta);
  return { left: (x / meta.width) * 100, top: (y / meta.height) * 100 };
}

/** «UTC+5:45» для підпису в картці поясу (UTC лише там і в назві «Першого ряду» поясу). */
export { utcLabel } from '@/lib/i18n/time';
