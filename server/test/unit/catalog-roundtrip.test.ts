/**
 * AC-82: the existing `data/` files go through `fromData` → `assemble` → `toData` and come out byte for
 * byte (number format, key order, line endings), so an export of an unchanged catalog changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CountriesFileSchema, ScheduleFileSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it } from 'vitest';
import { assembleCountries, assembleSchedule, type CatalogRows } from '../../src/domain/catalog/assemble';
import { fromData } from '../../src/domain/catalog/fromData';
import { detectEol, toData } from '../../src/domain/catalog/toData';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const read = (file: string): string => fs.readFileSync(path.join(dataDir, file), 'utf8');

function rowsOf(scheduleText: string, countriesText: string): CatalogRows {
  const schedule = ScheduleFileSchema.parse(JSON.parse(scheduleText));
  const countries = CountriesFileSchema.parse(JSON.parse(countriesText));
  const source = fromData(schedule, countries);
  const of = (c: string) => source.rows.filter((r) => r.collection === c).map((r) => r.data);
  return {
    season: source.season,
    zones: of('zones'),
    countries: of('countries'),
    cities: of('cities'),
    events: of('events'),
    traditions: of('traditions'),
  };
}

describe('toData round trip', () => {
  const scheduleText = read('schedule.json');
  const countriesText = read('countries.json');

  it('AC-82: both data files come back byte-equal', () => {
    const rows = rowsOf(scheduleText, countriesText);
    const out = toData({ schedule: assembleSchedule(rows), countries: assembleCountries(rows) }, { schedule: scheduleText, countries: countriesText });
    expect(Buffer.from(out.schedule).equals(Buffer.from(scheduleText))).toBe(true);
    expect(Buffer.from(out.countries).equals(Buffer.from(countriesText))).toBe(true);
  });

  it('the line ending follows the target, LF when there is no target', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
    expect(detectEol(undefined)).toBe('\n');
  });
});
