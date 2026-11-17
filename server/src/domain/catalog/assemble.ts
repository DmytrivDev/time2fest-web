/**
 * Catalog rows → the shape of `data/schedule.json` and `data/countries.json` (AC-63, AC-66), ring 1: pure.
 * Keys are written in the order of the data files; zones follow `order`, countries and cities their
 * `sortIndex`. Only events of slot `midnight` appear (AC-66). `restrained` and `landmark` are omitted
 * when empty. A language field has the form of `data/`: `{ uk }` (other languages only when filled) where
 * the file has an object, the Ukrainian string where it has a string.
 */
import type {
  CatalogCountries,
  CatalogCountry,
  CatalogPayload,
  CatalogSchedule,
  CatalogScheduleCity,
  CatalogScheduleZone,
  CatalogText,
} from '@time2fest/contracts';
import { catalogVersionOf } from './version';

type Row = Record<string, unknown>;

export interface CatalogRows {
  season: { key: string; generatedAt: string; tzdbVersion: string };
  zones: Row[];
  countries: Row[];
  cities: Row[];
  events: Row[];
  traditions: Row[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const bySort = (a: Row, b: Row): number => num(a.sortIndex) - num(b.sortIndex);

/** `{ uk }` plus any other language that is filled; `undefined` when `uk` is empty. */
function textOf(group: unknown): CatalogText | undefined {
  if (typeof group !== 'object' || group === null) return undefined;
  const g = group as Row;
  if (!str(g.uk)) return undefined;
  const out: Record<string, string> = { uk: str(g.uk) };
  for (const lang of ['en', 'es', 'fr']) if (str(g[lang])) out[lang] = str(g[lang]);
  return out as unknown as CatalogText;
}

const ukOf = (group: unknown): string => str((group as Row | null | undefined)?.uk);

function eventOf(row: Row): CatalogScheduleCity['events'][number] {
  const restrained = textOf(row.restrainedNote);
  return {
    id: str(row.eventId),
    midnightUtc: str(row.midnightUtc),
    isMainCelebration: row.isMainCelebration === true,
    type: str(row.type) as CatalogScheduleCity['events'][number]['type'],
    popularity: num(row.popularity),
    ...(restrained ? { restrained: { note: restrained } } : {}),
  };
}

export function assembleSchedule(rows: CatalogRows): CatalogSchedule {
  const events = rows.events.filter((e) => (e.slot ?? 'midnight') === 'midnight');
  const eventsByCity = new Map<string, Row[]>();
  for (const e of events) {
    const list = eventsByCity.get(str(e.cityId)) ?? [];
    list.push(e);
    eventsByCity.set(str(e.cityId), list);
  }
  const citiesByZone = new Map<string, Row[]>();
  for (const c of [...rows.cities].sort(bySort)) {
    const list = citiesByZone.get(str(c.zoneId)) ?? [];
    list.push(c);
    citiesByZone.set(str(c.zoneId), list);
  }
  const zones: CatalogScheduleZone[] = [...rows.zones]
    .sort((a, b) => num(a.order) - num(b.order))
    .map((zone) => {
      const countries = new Map<string, CatalogScheduleCity[]>();
      for (const city of citiesByZone.get(str(zone.zoneId)) ?? []) {
        const landmark = textOf(city.landmark);
        const point = (city.mapPoint ?? {}) as Row;
        const out: CatalogScheduleCity = {
          id: str(city.cityId),
          name: textOf(city.name) ?? { uk: '' },
          ...(landmark ? { landmark } : {}),
          celebrationType: str(city.celebrationType) as CatalogScheduleCity['celebrationType'],
          isCountryMain: city.isCountryMain === true,
          mapPoint: { x: num(point.x), y: num(point.y) },
          events: (eventsByCity.get(str(city.cityId)) ?? []).sort(bySort).map(eventOf),
        };
        const list = countries.get(str(city.countryIso)) ?? [];
        list.push(out);
        countries.set(str(city.countryIso), list);
      }
      return {
        id: str(zone.zoneId),
        order: num(zone.order),
        offsetMinutes: num(zone.offsetMinutes),
        midnightUtc: str(zone.midnightUtc),
        representativeCityId: str(zone.representativeCityId),
        countries: [...countries].map(([iso, cities]) => ({ iso, cities })),
      };
    });
  return {
    $schema: 'schedule.schema.json',
    version: 1,
    season: rows.season.key,
    generatedAt: rows.season.generatedAt,
    tzdbVersion: rows.season.tzdbVersion,
    zones,
  };
}

export function assembleCountries(rows: CatalogRows): CatalogCountries {
  const traditionsByCountry = new Map<string, Row[]>();
  for (const t of [...rows.traditions].sort(bySort)) {
    const list = traditionsByCountry.get(str(t.countryIso)) ?? [];
    list.push(t);
    traditionsByCountry.set(str(t.countryIso), list);
  }
  const countries: CatalogCountry[] = [...rows.countries].sort(bySort).map((c) => {
    const iso = str(c.iso);
    return {
      iso,
      slug: str(c.slug),
      name: textOf(c.name) ?? { uk: '' },
      gender: str(c.gender),
      flagCode: str(c.flagCode),
      zoneIds: Array.isArray(c.zoneIds) ? (c.zoneIds as string[]) : [],
      illustrationId: str(c.illustrationId),
      howTo: {
        traditions: (traditionsByCountry.get(iso) ?? []).map((t) => ({
          id: str(t.traditionId).startsWith(`${iso}:`) ? str(t.traditionId).slice(iso.length + 1) : str(t.traditionId),
          title: ukOf(t.title),
          text: ukOf(t.text),
          iconId: str(t.iconId),
        })),
        text: ukOf(c.howToText),
        gallery: Array.isArray(c.gallery) ? (c.gallery as unknown[]) : [],
      },
      popularity: num(c.popularity),
    };
  });
  return { version: 1, countries };
}

/** The body of `GET /api/catalog`. */
export function assembleCatalog(rows: CatalogRows): CatalogPayload {
  return {
    version: catalogVersionOf(rows.season),
    schedule: assembleSchedule(rows),
    countries: assembleCountries(rows),
  };
}
