import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogService } from '@/lib/api/contracts/catalog';
import { catalogVersionOf } from '@/lib/api/contracts/site';
import { buildDataset } from '@/lib/data/build';
import type { CountriesFile, ScheduleFile, StreamsFile } from '@/lib/data/types';
import countriesJson from '@/data/countries.json';
import scheduleJson from '@/data/schedule.json';
import streamsJson from '@/data/streams.json';

/** The catalog `data/` yields: the reference the service must equal (AC-64). */
export function expectedCatalog(): Catalog {
  const { chainsByEventId: _chains, ...catalog } = buildDataset(
    scheduleJson as unknown as ScheduleFile,
    countriesJson as unknown as CountriesFile,
    streamsJson as unknown as StreamsFile,
  );
  void _chains;
  return catalog;
}

/** Recursive deep equality that walks Map entries; returns the first differing path, or null. */
export function firstDifference(a: unknown, b: unknown, at = '$'): string | null {
  if (a === b) return null;
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map)) return at;
    if (a.size !== b.size) return `${at}.size`;
    for (const [k, v] of a) {
      if (!b.has(k)) return `${at}[${String(k)}]`;
      const d = firstDifference(v, b.get(k), `${at}[${String(k)}]`);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `${at}.length`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return `${at}.keys`;
    for (const k of ka) {
      if (!(k in b)) return `${at}.${k}`;
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Number.isNaN(a) && Number.isNaN(b) ? null : at;
}

/** One behaviour suite for the `catalog` domain, run on the sim adapter and on the catalog fetched from the server. */
export function describeDomain(name: string, makeService: () => CatalogService, expected: Catalog = expectedCatalog()): void {
  describe(name, () => {
    it('version() is catalogVersionOf(meta)', () => {
      const svc = makeService();
      expect(svc.version()).toBe(catalogVersionOf(svc.catalog().meta));
    });

    it('has 38 zones, 246 countries, 298 cities and 298 events', () => {
      const c = makeService().catalog();
      expect([c.zones.length, c.countries.length, c.cities.length, c.events.length]).toEqual([38, 246, 298, 298]);
    });

    it('does not carry stream chains (they belong to the live domain)', () => {
      expect('chainsByEventId' in makeService().catalog()).toBe(false);
    });

    it('is deeply equal to the catalog built from data/, Map entries included', () => {
      expect(firstDifference(makeService().catalog(), expected)).toBeNull();
    });
  });
}
