/**
 * A tiny valid catalog for the catalog integration tests: one season, zone, country, city, event and
 * tradition under keys unique to the run. Rows are written as the import does (`t2fImport`, which skips
 * the integrity and version hooks), so a test starts from a valid catalog and a known `generatedAt`.
 */
import type { Payload } from 'payload';

export const IMPORT_CONTEXT = { t2fImport: true, t2fTrusted: true, t2fActor: 'system:test' };
export const KINDS = ['seasons', 'zones', 'countries', 'cities', 'events', 'traditions'] as const;
export type Kind = (typeof KINDS)[number];

export interface TinyCatalog {
  keys: { season: string; zone: string; zone2: string; country: string; city: string; event: string; tradition: string };
  ids: Record<Kind, number>;
}

export async function createTinyCatalog(payload: Payload, run: string): Promise<TinyCatalog> {
  const keys = {
    season: `s-${run}`,
    zone: `zone-${run}`,
    zone2: `zone2-${run}`,
    country: `C${run}`,
    city: `city-${run}`,
    event: `evt-${run}`,
    tradition: `trad-${run}`,
  };
  // The version bump reads the first season: no other season may exist.
  await payload.delete({ collection: 'seasons', where: { id: { exists: true } }, overrideAccess: true, context: IMPORT_CONTEXT });
  const make = async (collection: Kind, data: Record<string, unknown>): Promise<number> =>
    (await payload.create({ collection, data: data as never, overrideAccess: true, context: IMPORT_CONTEXT })).id as number;
  const ids = {
    seasons: await make('seasons', { key: keys.season, generatedAt: '2020-01-01T00:00:00Z', tzdbVersion: '2026f' }),
    zones: await make('zones', { zoneId: keys.zone, order: 1, offsetMinutes: 60, midnightUtc: '2026-12-31T23:00:00Z' }),
    countries: await make('countries', { iso: keys.country, slug: `slug-${run}`, name: { uk: 'Тест' } }),
    cities: await make('cities', { cityId: keys.city, countryIso: keys.country, zoneId: keys.zone, name: { uk: 'Місто' } }),
    events: await make('events', {
      eventId: keys.event,
      cityId: keys.city,
      zoneId: keys.zone,
      countryIso: keys.country,
      midnightUtc: '2026-12-31T23:00:00Z',
      isMainCelebration: true,
    }),
    traditions: await make('traditions', { traditionId: keys.tradition, countryIso: keys.country, title: { uk: 'Т' }, text: { uk: 'Текст' } }),
  };
  // A second zone, so a city/event zone mismatch can name an existing zone.
  await make('zones', { zoneId: keys.zone2, order: 2, offsetMinutes: 120, midnightUtc: '2026-12-31T22:00:00Z' });
  return { keys, ids };
}

/** Removes every row of the tiny catalog (and any event/city a test added under its keys). */
export async function removeTinyCatalog(payload: Payload, run: string): Promise<void> {
  const like = { like: run };
  const del = (collection: Kind, field: string) =>
    payload.delete({ collection, where: { [field]: like } as never, overrideAccess: true, context: IMPORT_CONTEXT });
  await del('events', 'eventId');
  await del('cities', 'cityId');
  await del('zones', 'zoneId');
  await del('countries', 'iso');
  await del('traditions', 'traditionId');
  await del('seasons', 'key');
}

/** The message and data of a Payload error, flattened for a `toContain` check. */
export function errorText(err: unknown): string {
  const e = err as { message?: string; data?: unknown };
  return `${e?.message ?? ''} ${JSON.stringify(e?.data ?? {})}`;
}
