// Слоти поясу в графіку (рішення власника 2026-11-06): до 4 країн у поясі — стільки слотів, скільки країн, але не більше 4;
// п’ята країна не додається — «Замінити в графіку?»; заміна ставить нову країну на місце старої.
import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import {
  replaceCountryZone,
  scheduledCountries,
  scheduleToggleResult,
  toggleCountryZone,
  zoneCountryIsos,
  zoneSlotCount,
  ZONE_SLOT_LIMIT,
} from '@/lib/schedule/countryZone';
import { buildSchedulePath } from '@/lib/schedule/schedulePath';
import type { Stamp } from '@/lib/data/types';

const data = getData();
const ev = (cityId: string) => data.events.find((e) => e.cityId === cityId)!.id;
const zoneOf = (cityId: string) => data.events.find((e) => e.cityId === cityId)!.zoneId;

describe('слоти поясу', () => {
  it('слотів стільки, скільки країн, але не більше 4', () => {
    for (const z of data.zones) {
      const n = zoneCountryIsos(z.id).length;
      expect(zoneSlotCount(z.id)).toBe(Math.min(ZONE_SLOT_LIMIT, n));
    }
    expect(zoneSlotCount(zoneOf('london'))).toBe(4);
    expect(zoneSlotCount(zoneOf('praia'))).toBeLessThan(4);
  });

  it('п’ята країна поясу — «full», графік не змінюється', () => {
    const four = [ev('rio-de-janeiro'), ev('buenos-aires'), ev('montevideo'), ev('asuncion')];
    expect(scheduledCountries(four, zoneOf('santiago'))).toHaveLength(4);
    expect(scheduleToggleResult(four, ev('santiago'))).toBe('full');
    expect(toggleCountryZone(four, ev('santiago'))).toEqual(four);
    expect(scheduleToggleResult(four, ev('montevideo'))).toBe('removed');
    expect(scheduleToggleResult(four.slice(0, 3), ev('santiago'))).toBe('added');
  });

  it('заміна — на тому самому місці, решта не рухається', () => {
    const list = [ev('london'), ev('rio-de-janeiro'), ev('asuncion'), ev('new-york'), ev('montevideo')];
    const next = replaceCountryZone(list, 'PY', ev('santiago'));
    expect(next).toEqual([ev('london'), ev('rio-de-janeiro'), ev('santiago'), ev('new-york'), ev('montevideo')]);
    expect(scheduledCountries(next, zoneOf('santiago'))).toEqual(['BR', 'CL', 'UY']);
  });
});

describe('мапа «Твій шлях» — вузли й промені', () => {
  const stamp = (cityId: string, iso: string, at: number, presenceSource: Stamp['presenceSource']): Stamp => ({
    eventId: ev(cityId),
    grantedAt: at,
    presenceSource,
    illustrationId: 'x',
    cityName: cityId,
    countryIso: iso,
  });

  it('зустрінуті: вузол — не з кімнати; у графіку: вузол — перша додана країна поясу', () => {
    const now = Date.parse('2026-12-31T23:38:00Z');
    const stamps = [stamp('seoul', 'KR', 1, 'room'), stamp('tokyo', 'JP', 2, 'country')];
    const points = buildSchedulePath(stamps, [ev('montevideo'), ev('rio-de-janeiro'), ev('london')], data, now);
    const by = (id: string) => points.find((p) => p.id === id)!;
    expect(by(ev('tokyo')).hubOf).toBeUndefined();
    expect(by(ev('seoul')).hubOf).toBe(ev('tokyo'));
    expect(by(ev('montevideo')).hubOf).toBeUndefined();
    expect(by(ev('rio-de-janeiro')).hubOf).toBe(ev('montevideo'));
    // Лондон о 02:00 за Києвом — пояс зараз в ефірі.
    expect(by(ev('london')).current).toBe(true);
    expect(points.filter((p) => p.planned)).toHaveLength(3);
  });
});
