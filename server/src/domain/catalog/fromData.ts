/**
 * Data files → catalog rows (AC-64, AC-75 … AC-78), ring 1: pure, no I/O.
 *
 * One row per record, in the form the collections store it. The same mapper feeds the import and the
 * seed. A row's `hash` is the sha256 of its canonical JSON (keys sorted, empty values dropped); the
 * import stores it as `importedHash` and compares it with the hash of the row as it is in the database
 * to tell an admin edit from an unchanged import.
 */
import { createHash } from 'node:crypto';
import type { CatalogCountries, CatalogSchedule } from '@time2fest/contracts';

export const CATALOG_COLLECTIONS = ['zones', 'countries', 'cities', 'events', 'traditions'] as const;
export type CatalogCollection = (typeof CATALOG_COLLECTIONS)[number];

/** The natural key of each collection. */
export const NATURAL_KEYS: Readonly<Record<CatalogCollection, string>> = {
  zones: 'zoneId',
  countries: 'iso',
  cities: 'cityId',
  events: 'eventId',
  traditions: 'traditionId',
};

/** The fields the import owns, per collection: only these take part in the hash and the comparison. */
export const IMPORTED_FIELDS: Readonly<Record<CatalogCollection, readonly string[]>> = {
  zones: ['zoneId', 'order', 'offsetMinutes', 'midnightUtc', 'representativeCityId'],
  countries: ['iso', 'slug', 'name', 'gender', 'flagCode', 'zoneIds', 'illustrationId', 'howToText', 'gallery', 'popularity', 'sortIndex'],
  cities: ['cityId', 'countryIso', 'zoneId', 'name', 'landmark', 'celebrationType', 'mapPoint', 'isCountryMain', 'sortIndex'],
  events: ['eventId', 'cityId', 'zoneId', 'countryIso', 'midnightUtc', 'isMainCelebration', 'type', 'popularity', 'restrainedNote', 'slot', 'sortIndex'],
  traditions: ['traditionId', 'countryIso', 'title', 'text', 'iconId', 'sortIndex'],
};

export interface SourceRow {
  collection: CatalogCollection;
  key: string;
  data: Record<string, unknown>;
  hash: string;
}

export interface SourceSeason {
  key: string;
  generatedAt: string;
  tzdbVersion: string;
}

export interface SourceCatalog {
  season: SourceSeason;
  rows: SourceRow[];
}

/** Drops null, undefined, empty strings, empty arrays and empty objects, recursively. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    return items.length === 0 ? undefined : items;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = normalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

/** The sha256 of the canonical JSON of a row's imported fields. */
export function rowHash(collection: CatalogCollection, data: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {};
  for (const field of IMPORTED_FIELDS[collection]) picked[field] = data[field];
  return createHash('sha256')
    .update(JSON.stringify(normalize(picked) ?? {}))
    .digest('hex');
}

function row(collection: CatalogCollection, data: Record<string, unknown>): SourceRow {
  const key = data[NATURAL_KEYS[collection]];
  if (typeof key !== 'string') throw new Error(`${collection}: row without a key`);
  return { collection, key, data, hash: rowHash(collection, data) };
}

/** Maps the two data files to rows. Sort indices keep the file order (zones, countries, cities, events). */
export function fromData(schedule: CatalogSchedule, countries: CatalogCountries): SourceCatalog {
  const rows: SourceRow[] = [];
  const cityRows: SourceRow[] = [];
  const eventRows: SourceRow[] = [];
  let cityIndex = 0;
  for (const zone of schedule.zones) {
    rows.push(
      row('zones', {
        zoneId: zone.id,
        order: zone.order,
        offsetMinutes: zone.offsetMinutes,
        midnightUtc: zone.midnightUtc,
        representativeCityId: zone.representativeCityId,
      }),
    );
    for (const country of zone.countries) {
      for (const city of country.cities) {
        cityRows.push(
          row('cities', {
            cityId: city.id,
            countryIso: country.iso,
            zoneId: zone.id,
            name: { uk: city.name.uk },
            ...(city.landmark ? { landmark: { uk: city.landmark.uk } } : {}),
            celebrationType: city.celebrationType,
            mapPoint: { x: city.mapPoint.x, y: city.mapPoint.y },
            isCountryMain: city.isCountryMain,
            sortIndex: cityIndex,
          }),
        );
        for (const event of city.events) {
          eventRows.push(
            row('events', {
              eventId: event.id,
              cityId: city.id,
              zoneId: zone.id,
              countryIso: country.iso,
              midnightUtc: event.midnightUtc,
              isMainCelebration: event.isMainCelebration,
              type: event.type,
              popularity: event.popularity,
              ...(event.restrained ? { restrainedNote: { uk: event.restrained.note.uk } } : {}),
              slot: 'midnight',
              sortIndex: cityIndex,
            }),
          );
        }
        cityIndex += 1;
      }
    }
  }
  const countryRows: SourceRow[] = [];
  const traditionRows: SourceRow[] = [];
  let traditionIndex = 0;
  countries.countries.forEach((country, index) => {
    countryRows.push(
      row('countries', {
        iso: country.iso,
        slug: country.slug,
        name: { uk: country.name.uk },
        gender: country.gender,
        flagCode: country.flagCode,
        zoneIds: country.zoneIds,
        illustrationId: country.illustrationId,
        howToText: { uk: country.howTo.text },
        gallery: country.howTo.gallery,
        popularity: country.popularity,
        sortIndex: index,
      }),
    );
    for (const t of country.howTo.traditions) {
      traditionRows.push(
        row('traditions', {
          traditionId: `${country.iso}:${t.id}`,
          countryIso: country.iso,
          title: { uk: t.title },
          text: { uk: t.text },
          iconId: t.iconId,
          sortIndex: traditionIndex,
        }),
      );
      traditionIndex += 1;
    }
  });
  return {
    season: { key: schedule.season, generatedAt: schedule.generatedAt, tzdbVersion: schedule.tzdbVersion },
    // Dependency order: zones, countries, cities, events, traditions.
    rows: [...rows, ...countryRows, ...cityRows, ...eventRows, ...traditionRows],
  };
}
