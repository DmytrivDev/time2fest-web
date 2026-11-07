// Паспорт (рішення власника 2026-11-07): 6 континентів без Антарктиди, оцінка лише головних святкувань, наступний
// штамп — з графіка або країни наступної півночі, лічильники інфографіки.
import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { CONTINENTS, continentOf, isRateable, nextStamp, passportStamps, passportStats } from '@/lib/passport/passport';

const data = getData();
const ev = (cityId: string) => data.events.find((e) => e.cityId === cityId)!;
const stamp = (cityId: string, extra: Partial<Stamp> = {}): Stamp => {
  const e = ev(cityId);
  return { eventId: e.id, grantedAt: e.midnightMs + 30_000, presenceSource: 'country', illustrationId: 'x', cityName: cityId, countryIso: e.countryIso, ...extra };
};

describe('паспорт', () => {
  it('континенти: 6, Близький Схід — Азія, Кариби — Північна Америка, Антарктида не рахується', () => {
    expect(CONTINENTS).toHaveLength(6);
    expect(continentOf('AE', 240)).toBe('asia');
    expect(continentOf('CU', -240)).toBe('northAmerica');
    expect(continentOf('TR', 180)).toBe('europe');
    expect(continentOf('RU', 180)).toBe('europe');
    expect(continentOf('RU', 600)).toBe('asia');
    expect(continentOf('AQ', 0)).toBeNull();
  });

  it('оцінка — лише головні святкування; вебкамера й «лише відлік» — ні', () => {
    expect(isRateable(data, ev('kyiv').id)).toBe(true);
    expect(isRateable(data, ev('dubai').id)).toBe(true);
    expect(isRateable(data, ev('london').id)).toBe(false); // вебкамера
    expect(isRateable(data, ev('santiago').id)).toBe(false); // лише відлік
  });

  it('лічильники: штампи, країни, континенти, пояси з усіх', () => {
    const rows = passportStamps([stamp('auckland'), stamp('tokyo'), stamp('seoul'), stamp('kyiv')], data);
    const st = passportStats(rows, data);
    expect(st.stamps).toBe(4);
    expect(st.countries).toBe(4);
    expect([...st.continents].sort()).toEqual(['asia', 'europe', 'oceania']);
    expect(st.zones).toBe(3);
    expect(st.zonesTotal).toBe(data.zones.length);
    expect(rows.map((r) => r.city)[0]).toBe('Окленд');
  });

  it('наступний штамп: з графіка, інакше — країни наступної півночі (наживо й головні першими)', () => {
    const now = Date.parse('2026-12-31T23:38:00Z');
    const mine = nextStamp(data, [ev('lisbon').id], now)!;
    expect(mine.kind).toBe('schedule');
    if (mine.kind === 'schedule') expect(mine.country.iso).toBe('PT');
    const any = nextStamp(data, [], now)!;
    expect(any.kind).toBe('zone');
    if (any.kind === 'zone') {
      expect(any.zoneId).toBe('utc+0000');
      expect(any.total).toBeGreaterThan(5);
      const order = ['live', 'main', 'webcam', 'countdown'];
      const groups = any.countries.map((c) => order.indexOf(c.group));
      expect(groups).toEqual([...groups].sort((a, b) => a - b));
    }
  });
});
