import { describe, expect, it } from 'vitest';
import type { Dataset, ScheduledEvent } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { firstRowEventFor, nextOpenSale } from '@/lib/firstrow/pick';
import { currentZoneRow, isZoneRow, zoneRowLabel, zoneRowOf, zoneRows, zoneSeatOf } from '@/lib/firstrow/zone';
import { event, LONDON_MIDNIGHT, MIN, PARIS_MIDNIGHT, RIO_MIDNIGHT } from '../fixtures/data';

const FR = { firstRow: { saleEnabled: true } };
const paris = event('paris', PARIS_MIDNIGHT, { ...FR, zoneId: 'utc+0100', countryIso: 'FR', popularity: 90 });
const berlin = event('berlin', PARIS_MIDNIGHT, { ...FR, zoneId: 'utc+0100', countryIso: 'DE', popularity: 80 });
const madrid = event('madrid', PARIS_MIDNIGHT, { ...FR, zoneId: 'utc+0100', countryIso: 'ES', popularity: 75 });
const london = event('london', LONDON_MIDNIGHT, { ...FR, popularity: 95 });
const lisbon = event('lisbon', LONDON_MIDNIGHT, { ...FR, countryIso: 'PT', popularity: 55 });
const dublin = event('dublin', LONDON_MIDNIGHT, { countryIso: 'IE', popularity: 99 }); // без «Першого ряду» в розкладі
const reykjavik = event('reykjavik', LONDON_MIDNIGHT, { ...FR, countryIso: 'IS', popularity: 99, isMainCelebration: false });
const rio = event('rio', RIO_MIDNIGHT, { ...FR, zoneId: 'utc-0300', countryIso: 'BR', popularity: 90 });
const accra = event('accra', LONDON_MIDNIGHT + 60 * MIN, { zoneId: 'utc-0100', countryIso: 'GH' }); // пояс без ряду

const events: ScheduledEvent[] = [lisbon, rio, berlin, london, dublin, reykjavik, paris, madrid, accra];
const city = (id: string, uk: string) => [id, { id, name: { uk } }] as const;
const data = {
  events,
  eventsById: new Map(events.map((e) => [e.id, e])),
  zonesById: new Map([
    ['utc+0100', { id: 'utc+0100', offsetMinutes: 60 }],
    ['utc+0000', { id: 'utc+0000', offsetMinutes: 0 }],
    ['utc-0300', { id: 'utc-0300', offsetMinutes: -180 }],
  ]),
  citiesById: new Map([
    city('paris', 'Париж'),
    city('berlin', 'Берлін'),
    city('madrid', 'Мадрид'),
    city('london', 'Лондон'),
    city('lisbon', 'Лісабон'),
    city('reykjavik', 'Рейк’явік'),
    city('rio', 'Ріо-де-Жанейро'),
  ]),
} as unknown as Dataset;

describe('ряд «Першого ряду» — один на пояс', () => {
  it('носій ряду: головне святкування з «Першим рядом», найпопулярніше; пояс без ряду — null', () => {
    expect(zoneRows(data).map((e) => e.id)).toEqual([paris.id, london.id, rio.id]);
    expect(zoneRowOf(data, lisbon)?.id).toBe(london.id);
    expect(zoneRowOf(data, dublin)?.id).toBe(london.id); // країна поясу без власного ряду — ряд поясу
    expect(zoneRowOf(data, berlin)?.id).toBe(paris.id);
    expect(zoneRowOf(data, accra)).toBeNull();
    expect(isZoneRow(data, london.id)).toBe(true);
    expect(isZoneRow(data, lisbon.id)).toBe(false);
  });

  it('поточний ряд: до +15 хв після півночі — свій, далі — наступного поясу; після останнього — null', () => {
    expect(currentZoneRow(data, PARIS_MIDNIGHT - 3 * 60 * MIN)?.id).toBe(paris.id);
    expect(currentZoneRow(data, PARIS_MIDNIGHT + HANDOVER_AFTER - 1)?.id).toBe(paris.id);
    expect(currentZoneRow(data, PARIS_MIDNIGHT + HANDOVER_AFTER)?.id).toBe(london.id);
    expect(currentZoneRow(data, LONDON_MIDNIGHT + 20 * MIN)?.id).toBe(rio.id);
    expect(currentZoneRow(data, RIO_MIDNIGHT + HANDOVER_AFTER)).toBeNull();
    expect(firstRowEventFor(data, LONDON_MIDNIGHT - MIN)?.id).toBe(london.id);
  });

  it('наступний відкритий продаж — лише ряди поясів', () => {
    expect(nextOpenSale(data, PARIS_MIDNIGHT)?.id).toBe(london.id);
    expect(nextOpenSale(data, LONDON_MIDNIGHT - 4 * MIN)?.id).toBe(rio.id);
  });

  it('назва ряду: «UTC+0 · Лондон, Лісабон», понад два міста — «…», головні — першими', () => {
    expect(zoneRowLabel(data, london)).toBe('UTC+0 · Лондон, Лісабон…'); // Рейк’явік — третій (не головне)
    expect(zoneRowLabel(data, lisbon)).toBe('UTC+0 · Лондон, Лісабон…');
    expect(zoneRowLabel(data, berlin)).toBe('UTC+1 · Париж, Берлін…');
    expect(zoneRowLabel(data, rio)).toBe('UTC−3 · Ріо-де-Жанейро');
  });

  it('місце в ряду поясу — для штампа будь-якої події поясу', () => {
    const firstRow = { [london.id]: { seat: 4 } };
    expect(zoneSeatOf(data, firstRow, lisbon)).toBe(4);
    expect(zoneSeatOf(data, firstRow, dublin)).toBe(4);
    expect(zoneSeatOf(data, firstRow, paris)).toBeUndefined();
    expect(zoneSeatOf(data, firstRow, accra)).toBeUndefined();
  });
});
