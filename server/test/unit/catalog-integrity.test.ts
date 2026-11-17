/**
 * Catalog integrity rules (AC-49, W27) and version arithmetic (AC-67, W28), pure.
 * The full `data/` snapshot has no violation; each rule is triggered once.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertIntegrityAfter, CatalogIntegrityError, recordCatalogChange } from '../../src/catalog/service';
import { applyChange, checkCatalog, newViolations, type CatalogSnapshot } from '../../src/domain/catalog/integrity';
import { bumpedMeta, catalogVersionOf, generatedAtOf } from '../../src/domain/catalog/version';

interface Schedule {
  zones: { id: string; countries: { iso: string; cities: { id: string; events: { id: string; isMainCelebration: boolean }[] }[] }[] }[];
}

const read = (file: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url)), 'utf8'));

function snapshotOfData(): CatalogSnapshot {
  const schedule = read('schedule.json') as Schedule;
  const countries = (read('countries.json') as { countries: { iso: string }[] }).countries;
  const snap: CatalogSnapshot = { zones: [], countries: countries.map((c) => ({ iso: c.iso })), cities: [], events: [] };
  for (const z of schedule.zones) {
    snap.zones.push({ zoneId: z.id });
    for (const c of z.countries)
      for (const city of c.cities) {
        snap.cities.push({ cityId: city.id, zoneId: z.id, countryIso: c.iso });
        for (const e of city.events) {
          snap.events.push({ eventId: e.id, cityId: city.id, zoneId: z.id, countryIso: c.iso, isMainCelebration: e.isMainCelebration });
        }
      }
  }
  return snap;
}

const small = (): CatalogSnapshot => ({
  zones: [{ zoneId: 'z1' }, { zoneId: 'z2' }],
  countries: [{ iso: 'AA' }],
  cities: [{ cityId: 'c1', zoneId: 'z1', countryIso: 'AA' }],
  events: [{ eventId: 'e1', cityId: 'c1', zoneId: 'z1', countryIso: 'AA', isMainCelebration: true }],
});

const rules = (s: CatalogSnapshot) => checkCatalog(s).map((v) => v.rule);

describe('checkCatalog (AC-49)', () => {
  it('the full data/ snapshot has no violation', () => {
    expect(checkCatalog(snapshotOfData())).toEqual([]);
  });

  it('a valid small snapshot has none', () => {
    expect(rules(small())).toEqual([]);
  });

  it('event-zone-missing', () => {
    const s = small();
    s.events[0] = { ...s.events[0]!, zoneId: 'nope' };
    expect(rules(s)).toContain('event-zone-missing');
  });

  it('event-city-missing', () => {
    const s = small();
    s.events[0] = { ...s.events[0]!, cityId: 'nope' };
    expect(rules(s)).toContain('event-city-missing');
  });

  it('event-country-missing', () => {
    const s = small();
    s.events[0] = { ...s.events[0]!, countryIso: 'ZZ' };
    expect(rules(s)).toContain('event-country-missing');
  });

  it('city-zone-mismatch', () => {
    const s = small();
    s.events[0] = { ...s.events[0]!, zoneId: 'z2' };
    expect(rules(s)).toContain('city-zone-mismatch');
  });

  it('pair-main-count: none main, two main; an all-hidden pair is exempt', () => {
    const none = small();
    none.events[0] = { ...none.events[0]!, isMainCelebration: false };
    expect(rules(none)).toEqual(['pair-main-count']);
    const two = small();
    two.events.push({ eventId: 'e2', cityId: 'c1', zoneId: 'z1', countryIso: 'AA', isMainCelebration: true });
    expect(rules(two)).toEqual(['pair-main-count']);
    const hidden = small();
    hidden.events = [{ ...hidden.events[0]!, isMainCelebration: false, hidden: true }];
    expect(rules(hidden)).toEqual([]);
  });
});

describe('applyChange and newViolations', () => {
  it('a key rename replaces the old row', () => {
    const next = applyChange(small(), { kind: 'cities', previousKey: 'c1', row: { cityId: 'c9', zoneId: 'z1', countryIso: 'AA' } });
    expect(next.cities.map((c) => c.cityId)).toEqual(['c9']);
  });

  it('keeps only what the change introduced', () => {
    const broken = small();
    broken.events[0] = { ...broken.events[0]!, zoneId: 'nope' };
    const worse = applyChange(broken, { kind: 'events', previousKey: 'e1', row: { ...broken.events[0]!, countryIso: 'ZZ' } });
    expect(newViolations(checkCatalog(broken), checkCatalog(worse)).map((v) => v.rule)).toEqual(['event-country-missing']);
  });
});

describe('services over fake ports', () => {
  const reader = { snapshot: async () => small() };

  it('assertIntegrityAfter throws with the rule name', async () => {
    const bad = assertIntegrityAfter(reader, {}, { kind: 'events', previousKey: 'e1', row: { ...small().events[0]!, cityId: 'nope' } });
    await expect(bad).rejects.toBeInstanceOf(CatalogIntegrityError);
    await expect(bad).rejects.toThrow('event-city-missing');
  });

  it('recordCatalogChange sets generatedAt from the clock and publishes the new version', async () => {
    const calls: unknown[] = [];
    const now = Date.parse('2026-11-17T10:00:00.789Z');
    const result = await recordCatalogChange(
      {
        seasons: { current: async () => ({ id: '1', tzdbVersion: '2026f' }), setGeneratedAt: async (_t, id, at) => void calls.push([id, at]) },
        publisher: { publish: async (_t, topic, payload) => (calls.push([topic, payload]), { version: 1 }) },
        clock: { now: () => now },
      },
      {},
    );
    expect(result).toEqual({ version: '2026-11-17T10:00:00Z+2026f' });
    expect(calls).toEqual([
      ['1', '2026-11-17T10:00:00Z'],
      ['catalog.changed', { version: '2026-11-17T10:00:00Z+2026f', at: '2026-11-17T10:00:00Z' }],
    ]);
  });

  it('no season: nothing is published', async () => {
    const out = await recordCatalogChange(
      { seasons: { current: async () => null, setGeneratedAt: async () => {} }, publisher: { publish: async () => ({ version: 1 }) }, clock: { now: () => 0 } },
      {},
    );
    expect(out).toBeNull();
  });
});

describe('version (AC-67)', () => {
  it('uses the shared rule and whole-second UTC', () => {
    expect(catalogVersionOf({ generatedAt: 'a', tzdbVersion: 'b' })).toBe('a+b');
    expect(generatedAtOf(Date.parse('2026-11-02T16:12:35.999Z'))).toBe('2026-11-02T16:12:35Z');
    expect(bumpedMeta({ tzdbVersion: '2026f' }, Date.parse('2026-11-02T16:12:35Z')).version).toBe('2026-11-02T16:12:35Z+2026f');
  });
});
