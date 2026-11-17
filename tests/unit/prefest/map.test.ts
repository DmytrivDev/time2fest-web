import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import { buildMapModel } from '@/lib/map/model';
import { prefestMapModel } from '@/lib/prefest/map';
import { buildPrefestModel } from '@/lib/prefest/model';

describe('prefestMapModel', () => {
  const data = getData();
  const model = buildPrefestModel(data);
  const map = prefestMapModel(buildMapModel(data), (iso) => model.countriesByIso.get(iso)?.described ?? false);

  it('прибирає трансляції й події з поясів, країн і міст', () => {
    for (const z of map.zones) {
      expect(z.streams).toEqual([]);
      expect(z.streamCount).toBe(0);
      for (const c of z.countries) {
        expect(c.streams).toEqual([]);
        expect(c.eventIds).toEqual([]);
        expect(c.mainCity).toBeUndefined();
      }
    }
    expect(map.cities.every((c) => c.stream === 'none')).toBe(true);
  });

  it('традиції — лише в країн з описом', () => {
    const all = map.zones.flatMap((z) => z.countries);
    const fr = all.find((c) => c.iso === 'FR');
    const ad = all.find((c) => c.iso === 'AD');
    expect(fr?.described).toBe(true);
    expect(fr?.traditions?.length).toBeGreaterThan(0);
    expect(ad?.described).toBe(false);
    expect(ad?.traditions).toEqual([]);
  });
});
