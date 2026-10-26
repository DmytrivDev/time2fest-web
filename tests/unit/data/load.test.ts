import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import { LONDON_MIDNIGHT, miniSchedule, PARIS_MIDNIGHT, RIO_MIDNIGHT } from '../fixtures/data';

describe('buildDataset', () => {
  const { schedule, countries, streams } = miniSchedule();
  const d = buildDataset(schedule, countries, streams);

  it('розбирає midnightUtc один раз у мс і сортує пояси', () => {
    expect(d.zones.map((z) => z.id)).toEqual(['utc+0100', 'utc+0000', 'utc-0300']);
    expect(d.zones[0]!.midnightMs).toBe(PARIS_MIDNIGHT);
    expect(d.eventsById.get('evt_london_2027')!.midnightMs).toBe(LONDON_MIDNIGHT);
  });

  it('будує eventsBySlot за зростанням моменту', () => {
    expect(d.eventsBySlot.map((s) => s.midnightMs)).toEqual([PARIS_MIDNIGHT, LONDON_MIDNIGHT, RIO_MIDNIGHT]);
    expect(d.eventsBySlot[1]!.events.map((e) => e.id).sort()).toEqual(
      ['evt_lisbon_2027', 'evt_london_2027', 'evt_manchester_2027'],
    );
  });

  it('індекси: citiesById, countriesBySlug, zonesById, countriesByIso', () => {
    expect(d.citiesById.get('london')).toMatchObject({ countryIso: 'GB', zoneId: 'utc+0000' });
    expect(d.countriesBySlug.get('velyka-brytaniia')!.iso).toBe('GB');
    expect(d.zonesById.get('utc-0300')!.offsetMinutes).toBe(-180);
    expect(d.countriesByIso.get('FR')!.popularity).toBe(88);
  });

  it('подія успадковує countryIso, zoneId, cityId з дерева', () => {
    expect(d.eventsById.get('evt_berlin_2027')).toMatchObject({
      countryIso: 'DE',
      zoneId: 'utc+0100',
      cityId: 'berlin',
      isMainCelebration: true,
    });
  });

  it('ланцюжки за eventId відсортовано за order', () => {
    const chain = d.chainsByEventId.get('evt_london_2027')!;
    expect(chain.sources.map((s) => s.id)).toEqual(['src_london_1', 'src_london_2']);
    expect(d.chainsByEventId.has('evt_paris_2027')).toBe(false);
  });

  it('працює без streams.json', () => {
    expect(buildDataset(schedule, countries, null).chainsByEventId.size).toBe(0);
  });
});

const dataDir = resolve(process.cwd(), 'data') + '/';
const hasRealData = ['schedule.json', 'countries.json', 'streams.json'].every((f) =>
  existsSync(dataDir + f),
);

describe.runIf(hasRealData)('справжні дані (web/data)', () => {
  it('load.ts будує 38 поясів і індекси', async () => {
    const { data } = await import('@/lib/data/load');
    expect(data.zones).toHaveLength(38);
    expect(data.eventsBySlot.length).toBeGreaterThan(0);
    for (const e of data.events) expect(Number.isFinite(e.midnightMs)).toBe(true);
  });
});
