/**
 * Catalog model (AC-43 … AC-48, W25): four languages per localized field, the gender set, the
 * `startsAt` rule, and coverage of every key of `data/schedule.json` and `data/countries.json`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CollectionConfig, Field } from 'payload';
import { select, text } from 'payload/shared';
import { describe, expect, it } from 'vitest';
import { cities } from '../../src/collections/catalog/cities';
import { countries, GENDERS } from '../../src/collections/catalog/countries';
import { events, SLOTS, startsAtRequired } from '../../src/collections/catalog/events';
import { localized } from '../../src/collections/catalog/fields';
import { seasons } from '../../src/collections/catalog/seasons';
import { traditions } from '../../src/collections/catalog/traditions';
import { zones } from '../../src/collections/catalog/zones';

const ctx = { t: (k: string) => k, req: { t: (k: string) => k, payload: { config: { localization: false } } } };
const textOptions = (required: boolean) => ({ ...ctx, required }) as never;
const selectOptions = (options: unknown) => ({ ...ctx, options, required: false }) as never;

const named = (fields: Field[], name: string): Field | undefined => fields.find((f) => 'name' in f && f.name === name);
const fieldNames = (c: CollectionConfig): string[] => c.fields.flatMap((f) => ('name' in f && f.name ? [f.name] : []));
const group = (c: CollectionConfig, name: string) => named(c.fields, name) as unknown as { fields: { name: string }[] };
const ALL: CollectionConfig[] = [seasons, zones, countries, cities, events, traditions];

describe('localized fields (AC-43)', () => {
  const field = localized('name', 'Назва') as unknown as { fields: { name: string; type: string; required?: boolean }[] };

  it('has uk, en, es, fr as plain text', () => {
    expect(field.fields.map((f) => [f.name, f.type])).toEqual([
      ['uk', 'text'],
      ['en', 'text'],
      ['es', 'text'],
      ['fr', 'text'],
    ]);
  });

  it('uk alone passes; without uk is refused; en, es, fr are optional', () => {
    const byName = Object.fromEntries(field.fields.map((f) => [f.name, f]));
    expect(byName.uk?.required).toBe(true);
    expect(text('Назва', textOptions(true))).toBe(true);
    expect(text('', textOptions(true))).not.toBe(true);
    for (const lang of ['en', 'es', 'fr']) expect(byName[lang]?.required).toBe(false);
  });

  it('an optional group does not require uk', () => {
    const optional = localized('landmark', 'x', { optional: true }) as unknown as { fields: { required?: boolean }[] };
    expect(optional.fields.every((f) => f.required === false)).toBe(true);
  });

  it('no catalog collection has a rich text field', () => {
    for (const c of ALL) expect(JSON.stringify(c.fields)).not.toContain('richText');
  });
});

describe('gender (AC-44)', () => {
  const gender = named(countries.fields, 'gender') as unknown as { options: string[] };

  it('has the five values: m, f, n, pl and empty', () => {
    expect([...GENDERS]).toEqual(['m', 'f', 'n', 'pl']);
    for (const v of ['m', 'f', 'n', 'pl', undefined]) expect(select(v as never, selectOptions(gender.options))).toBe(true);
  });

  it('x is refused', () => {
    expect(select('x' as never, selectOptions(gender.options))).not.toBe(true);
  });
});

describe('event slot (AC-48)', () => {
  const run = (slot: unknown, value: unknown) =>
    (startsAtRequired as unknown as (v: unknown, o: unknown) => unknown)(value, { siblingData: { slot } });

  it('has the four slots, default midnight', () => {
    expect([...SLOTS]).toEqual(['midnight', 'fireworks-20', 'dawn', 'jan-1']);
    expect((named(events.fields, 'slot') as unknown as { defaultValue: string }).defaultValue).toBe('midnight');
  });

  it('midnight needs no startsAt; every other slot does', () => {
    expect(run('midnight', undefined)).toBe(true);
    expect(run(undefined, undefined)).toBe(true);
    for (const slot of ['fireworks-20', 'dawn', 'jan-1']) {
      expect(run(slot, undefined)).not.toBe(true);
      expect(run(slot, '2027-01-01T05:00:00.000Z')).toBe(true);
    }
  });
});

describe('zones and access', () => {
  it('midnightUtc of a zone is read-only for update', () => {
    const f = named(zones.fields, 'midnightUtc') as unknown as { access: { update: () => boolean }; admin: { readOnly: boolean } };
    expect(f.access.update()).toBe(false);
    expect(f.admin.readOnly).toBe(true);
  });

  it('delete is denied in every catalog collection (AC-47)', () => {
    for (const c of ALL) expect((c.access?.delete as unknown as () => boolean)()).toBe(false);
  });
});

/**
 * Where each source key is stored. `file` keys belong to the file, not to a record (the export writes
 * them from constants); `nesting` keys only hold records, which the foreign-key fields express.
 */
const SCHEDULE_MAP: Record<string, string> = {
  $schema: 'file',
  version: 'file',
  season: 'seasons.key',
  generatedAt: 'seasons.generatedAt',
  tzdbVersion: 'seasons.tzdbVersion',
  zones: 'nesting',
  'zones[].id': 'zones.zoneId',
  'zones[].order': 'zones.order',
  'zones[].offsetMinutes': 'zones.offsetMinutes',
  'zones[].midnightUtc': 'zones.midnightUtc',
  'zones[].representativeCityId': 'zones.representativeCityId',
  'zones[].countries': 'nesting',
  'zones[].countries[].iso': 'cities.countryIso',
  'zones[].countries[].cities': 'nesting',
  'zones[].countries[].cities[].id': 'cities.cityId',
  'zones[].countries[].cities[].name': 'cities.name',
  'zones[].countries[].cities[].celebrationType': 'cities.celebrationType',
  'zones[].countries[].cities[].isCountryMain': 'cities.isCountryMain',
  'zones[].countries[].cities[].mapPoint': 'cities.mapPoint',
  'zones[].countries[].cities[].landmark': 'cities.landmark',
  'zones[].countries[].cities[].events': 'nesting',
  'zones[].countries[].cities[].events[].id': 'events.eventId',
  'zones[].countries[].cities[].events[].midnightUtc': 'events.midnightUtc',
  'zones[].countries[].cities[].events[].isMainCelebration': 'events.isMainCelebration',
  'zones[].countries[].cities[].events[].type': 'events.type',
  'zones[].countries[].cities[].events[].popularity': 'events.popularity',
};
const COUNTRIES_MAP: Record<string, string> = {
  version: 'file',
  countries: 'nesting',
  'countries[].iso': 'countries.iso',
  'countries[].slug': 'countries.slug',
  'countries[].name': 'countries.name',
  'countries[].gender': 'countries.gender',
  'countries[].flagCode': 'countries.flagCode',
  'countries[].zoneIds': 'countries.zoneIds',
  'countries[].illustrationId': 'countries.illustrationId',
  'countries[].howTo': 'nesting',
  'countries[].howTo.traditions': 'nesting',
  'countries[].howTo.traditions[].id': 'traditions.traditionId',
  'countries[].howTo.traditions[].title': 'traditions.title',
  'countries[].howTo.traditions[].text': 'traditions.text',
  'countries[].howTo.traditions[].iconId': 'traditions.iconId',
  'countries[].howTo.text': 'countries.howToText',
  'countries[].howTo.gallery': 'countries.gallery',
  'countries[].popularity': 'countries.popularity',
};
const COLLECTIONS: Record<string, CollectionConfig> = { seasons, zones, countries, cities, events, traditions };

/** Every key path of a JSON value, arrays as `[]`; the keys of a localized text or a map point are leaves. */
function keyPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keyPaths(v, `${prefix}[]`, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (/^(uk|en|es|fr|x|y)$/.test(k)) continue;
      out.add(path);
      keyPaths(v, path, out);
    }
  }
  return out;
}

const readData = (file: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url)), 'utf8'));

describe('key coverage of data/ (W25)', () => {
  const cases: [string, Record<string, string>][] = [
    ['schedule.json', SCHEDULE_MAP],
    ['countries.json', COUNTRIES_MAP],
  ];
  for (const [file, map] of cases) {
    it(`every key of ${file} has a place in the model`, () => {
      expect([...keyPaths(readData(file))].filter((p) => !(p in map))).toEqual([]);
      for (const place of Object.values(map)) {
        if (place === 'file' || place === 'nesting') continue;
        const [collection, field] = place.split('.');
        const config = COLLECTIONS[collection ?? ''];
        expect(config, place).toBeDefined();
        expect(fieldNames(config as CollectionConfig), place).toContain(field);
      }
    });
  }

  it('the map point keeps x and y; landmark, title and text are localized', () => {
    expect(group(cities, 'mapPoint').fields.map((f) => f.name)).toEqual(['x', 'y']);
    for (const g of [group(cities, 'landmark'), group(traditions, 'title'), group(traditions, 'text')]) expect(g.fields).toHaveLength(4);
  });
});
