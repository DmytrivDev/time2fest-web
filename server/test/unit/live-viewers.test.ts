/** Viewers aggregate (SPEC-12 AC-60, AC-61, AC-62, NFR-6), without Centrifugo. */
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS } from '../../src/domain/live/config';
import { aggregateViewers, viewerCatalogOrder, type PresenceEntry, type ViewerCatalogCountry } from '../../src/domain/live/viewers';

const AT = '2026-12-31T23:00:00.000Z';
const on = { viewersMap: true, viewersCount: true };
const catalog: ViewerCatalogCountry[] = viewerCatalogOrder([
  { iso: 'DE', name: 'Німеччина', flagCode: 'DE', popularity: 80 },
  { iso: 'PL', name: 'Польща', flagCode: 'PL', popularity: 60 },
  { iso: 'UA', name: 'Україна', flagCode: 'UA', popularity: 95 },
]);
const person = (c?: string): PresenceEntry => ({ chanInfo: c === undefined ? { p: 1 } : { p: 1, c } });
const tab: PresenceEntry = { chanInfo: undefined };

describe('countries with at least 3 people, no numbers (AC-60)', () => {
  it('3 from PL, 2 from DE → only PL', () => {
    const entries = [person('PL'), person('PL'), person('PL'), person('DE'), person('DE')];
    expect(aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS)).toEqual({
      countries: [{ iso: 'PL', name: 'Польща', flagCode: 'PL' }],
      people: 5,
      at: AT,
    });
  });
  it('orders by catalog popularity and drops XX, T1, malformed and unknown codes', () => {
    const entries = [...Array(3).fill(person('PL')), ...Array(3).fill(person('UA')), ...Array(3).fill(person('XX')), ...Array(3).fill(person('T1')), ...Array(3).fill(person('pl')), ...Array(3).fill(person('ZZ'))];
    const r = aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS);
    expect(r.countries.map((c) => c.iso)).toEqual(['UA', 'PL']);
    expect(r.people).toBe(18);
  });
  it('the threshold comes from the configuration', () => {
    const r = aggregateViewers([person('DE'), person('DE')], on, catalog, AT, { ...LIVE_DEFAULTS, viewersMinPerCountry: 2 });
    expect(r.countries.map((c) => c.iso)).toEqual(['DE']);
  });
});

describe('people: one per browser (AC-61)', () => {
  it('counts token entries only; a second tab without a token is not a person', () => {
    const r = aggregateViewers([person('UA'), person(), person('PL'), tab, { chanInfo: { p: 2 } }, { chanInfo: 'x' }], on, catalog, AT, LIVE_DEFAULTS);
    expect(r.people).toBe(3);
  });
});

describe('switches (AC-62)', () => {
  const entries = [person('PL'), person('PL'), person('PL')];
  it.each([
    [{ viewersMap: true, viewersCount: true }, ['PL'], 3],
    [{ viewersMap: false, viewersCount: true }, [], 3],
    [{ viewersMap: true, viewersCount: false }, ['PL'], undefined],
    [{ viewersMap: false, viewersCount: false }, [], undefined],
  ])('%o', (switches, isos, people) => {
    const r = aggregateViewers(entries, switches, catalog, AT, LIVE_DEFAULTS);
    expect(r.countries.map((c) => c.iso)).toEqual(isos);
    expect(r.people).toBe(people);
    expect('people' in r).toBe(people !== undefined);
  });
});

describe('30 000 connections (NFR-6)', () => {
  it('aggregates in under 100 ms', () => {
    const isos = ['UA', 'PL', 'DE', 'XX', undefined];
    const entries: PresenceEntry[] = Array.from({ length: 30_000 }, (_, i) => (i % 7 === 0 ? tab : person(isos[i % isos.length])));
    aggregateViewers(entries.slice(0, 100), on, catalog, AT, LIVE_DEFAULTS);
    const t = performance.now();
    const r = aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS);
    const ms = performance.now() - t;
    expect(r.countries.map((c) => c.iso)).toEqual(['UA', 'DE', 'PL']);
    expect(ms).toBeLessThan(100);
  });
});
