import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import { buildPrefestModel, countriesMetBefore, defaultCountry, isDescribed, viewerZone } from '@/lib/prefest/model';

describe('buildPrefestModel', () => {
  const model = buildPrefestModel(getData());

  it('38 поясів у порядку півночі, перший — Кірітіматі (UTC+14)', () => {
    expect(model.zones).toHaveLength(38);
    expect(model.zones[0]?.id).toBe('utc+1400');
    expect(model.zones.map((z) => z.index)).toEqual([...Array(38).keys()]);
    for (let i = 1; i < 38; i++) expect(model.zones[i]!.midnightMs).toBeGreaterThan(model.zones[i - 1]!.midnightMs);
    expect(model.firstMidnightMs).toBe(Date.parse('2026-12-31T10:00:00Z'));
    // 26 годин від першої до останньої півночі.
    expect((model.lastMidnightMs - model.firstMidnightMs) / 3_600_000).toBe(26);
  });

  it('усі країни каталогу; описані — лише з власним текстом', () => {
    expect(model.countries).toHaveLength(getData().countries.length);
    expect(model.described.every((c) => c.described && c.traditions.length > 0 && c.text.length > 0)).toBe(true);
    expect(model.countriesByIso.get('AD')?.described).toBe(false);
    expect(model.countriesByIso.get('AD')?.traditions).toEqual([]);
    expect(isDescribed({ text: 'Тут ще збираємо розповідь…' })).toBe(false);
    expect(isDescribed({ text: '' })).toBe(false);
    expect(isDescribed({ text: 'Справжній опис.' })).toBe(true);
  });

  it('11 головних місць розкладу з часом півночі поясу', () => {
    expect(model.celebrations.map((c) => c.city)).toEqual([
      'Окленд', 'Сідней', 'Токіо', 'Дубай', 'Берлін', 'Париж', 'Рим', 'Лондон', 'Ріо-де-Жанейро', 'Нью-Йорк', 'Лос-Анджелес',
    ]);
    const kyivTime = (ms: number) =>
      new Intl.DateTimeFormat('uk', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(ms);
    // Рішення власника 2026-11-17 (за Києвом): Окленд 13:00, Лос-Анджелес 10:00.
    expect(kyivTime(model.celebrations[0]!.midnightMs)).toBe('13:00');
    expect(kyivTime(model.celebrations[10]!.midnightMs)).toBe('10:00');
  });

  it('Україна: 22-й пояс із 38, перед ним 21', () => {
    const zone = viewerZone(model, 120);
    expect(zone.id).toBe('utc+0200');
    expect(zone.index + 1).toBe(22);
    expect(defaultCountry(model, zone).country.iso).toBe('UA');
    expect(countriesMetBefore(model, 0)).toBe(0);
    expect(countriesMetBefore(model, zone.index)).toBeGreaterThan(0);
  });

  it('невідомий зсув — пояс UTC+2', () => {
    expect(viewerZone(model, 7).id).toBe('utc+0200');
  });
});
