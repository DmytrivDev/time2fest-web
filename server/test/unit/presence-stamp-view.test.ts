/**
 * SPEC-14 W25 — the server stamp view (AC-36, AC-31): for every event of the seeded catalog (`data/` → `fromData`, the
 * rows the import stores), the view composed over the stored rows equals the rules' `stampOf` with lookups read straight
 * from the data files (the site's `buildStamp` equals that `stampOf` — web parity test `rules-parity.test.ts`).
 * The stored `grantedAt` is kept; an event gone from the catalog has no view; two events of one country are two stamps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CountriesFileSchema, ScheduleFileSchema } from '@time2fest/contracts/schemas';
import { stampOf, type StampEventLike } from '@time2fest/rules/passport';
import { describe, expect, it } from 'vitest';
import { fromData } from '../../src/domain/catalog/fromData';
import { stampCatalogOf, stampViewOf } from '../../src/domain/passport/stampView';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const schedule = ScheduleFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8')));
const countries = CountriesFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dataDir, 'countries.json'), 'utf8')));
const source = fromData(schedule, countries);
const rowsOf = (c: string) => source.rows.filter((r) => r.collection === c).map((r) => r.data);
const catalog = stampCatalogOf({ events: rowsOf('events'), cities: rowsOf('cities'), countries: rowsOf('countries') });

/** Lookups straight from the data files (the dataset the site's `buildStamp` reads). */
const cityNames = new Map<string, string>();
const events: StampEventLike[] = [];
for (const zone of schedule.zones)
  for (const country of zone.countries)
    for (const city of country.cities) {
      cityNames.set(city.id, city.name.uk);
      for (const e of city.events) events.push({ id: e.id, midnightUtc: e.midnightUtc, countryIso: country.iso, cityId: city.id });
    }
const illustrations = new Map(countries.countries.map((c) => [c.iso, c.illustrationId]));
const datasetLookups = {
  cityName: (cityId: string) => cityNames.get(cityId),
  illustrationOfUnit: (e: StampEventLike) => illustrations.get(e.countryIso) || undefined,
};

describe('stamp view over the stored catalog (AC-36)', () => {
  it('equals stampOf with the dataset lookups for every seeded event', () => {
    expect(events.length).toBeGreaterThan(100);
    for (const e of events) {
      const expected = stampOf(e, datasetLookups, 'country');
      const got = stampViewOf({ eventId: e.id, grantedAt: expected.grantedAt, presenceSource: 'country' }, catalog);
      expect(got, e.id).toEqual(expected);
      expect(got!.cityName, e.id).not.toBe('');
    }
  });

  it('keeps the stored grantedAt and the stored source', () => {
    const e = events[0]!;
    expect(stampViewOf({ eventId: e.id, grantedAt: 123, presenceSource: 'tv' }, catalog)).toMatchObject({ grantedAt: 123, presenceSource: 'tv' });
  });

  it('an event that left the catalog has no view', () => {
    expect(stampViewOf({ eventId: 'no-such-event', grantedAt: 1, presenceSource: 'tv' }, catalog)).toBeNull();
  });

  it('a changed country illustration changes the view (read-time composition)', () => {
    const e = events[0]!;
    const changed = stampCatalogOf({
      events: rowsOf('events'),
      cities: rowsOf('cities'),
      countries: rowsOf('countries').map((c) => (c.iso === e.countryIso ? { ...c, illustrationId: 'changed-ill' } : c)),
    });
    expect(stampViewOf({ eventId: e.id, grantedAt: 1, presenceSource: 'tv' }, changed)?.illustrationId).toBe('changed-ill');
  });
});

describe('one stamp per event (AC-31)', () => {
  it('two events of one country give two stamps of that country', () => {
    const byCountry = new Map<string, StampEventLike[]>();
    for (const e of events) byCountry.set(e.countryIso, [...(byCountry.get(e.countryIso) ?? []), e]);
    const [iso, two] = [...byCountry].find(([, list]) => new Set(list.map((x) => x.cityId)).size > 1)!;
    const [a, b] = [two[0]!, two.find((x) => x.cityId !== two[0]!.cityId)!];
    const sa = stampViewOf({ eventId: a.id, grantedAt: 1, presenceSource: 'room' }, catalog)!;
    const sb = stampViewOf({ eventId: b.id, grantedAt: 1, presenceSource: 'room' }, catalog)!;
    expect(sa.eventId).not.toBe(sb.eventId);
    expect(sa.cityName).not.toBe(sb.cityName);
    expect([sa.countryIso, sb.countryIso]).toEqual([iso, iso]);
  });
});
