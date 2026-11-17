import { describe, expect, it } from 'vitest';
import type { MainCelebration, PrefestCountry } from '@/lib/prefest/model';
import { around, landmarkDimmed, searchCountries, segmentCenterPct, timeLeft } from '@/lib/prefest/mine';

const c = (name: string) => ({ name }) as PrefestCountry;
const e = (city: string, zoneIndex: number) => ({ city, zoneIndex }) as MainCelebration;

describe('searchCountries', () => {
  const list = [c('Албанія'), c('Бразилія'), c('Нова Зеландія'), c('Зімбабве'), c('Австралія')];
  it('без запиту — усі за порядком', () => {
    expect(searchCountries(list, '  ').map((x) => x.name)).toHaveLength(5);
  });
  it('спершу початок назви, потім входження', () => {
    expect(searchCountries(list, 'зе').map((x) => x.name)).toEqual(['Нова Зеландія']);
    expect(searchCountries(list, 'нов').map((x) => x.name)).toEqual(['Нова Зеландія']);
  });
  it('обмежує кількість', () => {
    expect(searchCountries(list, '', 2)).toHaveLength(2);
  });
  it('початок раніше входження', () => {
    const l = [c('Бразилія'), c('Австралія'), c('Алжир')];
    expect(searchCountries(l, 'а').map((x) => x.name)).toEqual(['Австралія', 'Алжир', 'Бразилія']);
  });
});

describe('around', () => {
  const cel = [e('Окленд', 3), e('Сідней', 8), e('Токіо', 14), e('Дубай', 20), e('Берлін', 25), e('Лондон', 27)];
  it('перший у світі', () => {
    expect(around(cel, 0, 38).before).toEqual({ kind: 'first' });
  });
  it('останній у світі', () => {
    expect(around(cel, 37, 38).after).toEqual({ kind: 'last' });
  });
  it('останні три міста й «та ще»', () => {
    const r = around(cel, 26, 38);
    expect(r.before).toEqual({ kind: 'namedMore', names: 'Токіо, Дубай, Берлін', count: 23 });
    expect(r.after).toEqual({ kind: 'named', names: 'Лондон' });
  });
  it('після — «та інші», коли міст більше трьох', () => {
    expect(around(cel, 1, 38).after).toEqual({ kind: 'namedMore', names: 'Окленд, Сідней, Токіо' });
  });
  it('без міст — лише кількість', () => {
    const r = around([e('Лондон', 27)], 30, 38);
    expect(r.before).toEqual({ kind: 'namedMore', names: 'Лондон', count: 29 });
    expect(around([], 5, 38)).toEqual({ before: { kind: 'count', count: 5 }, after: { kind: 'count', count: 32 } });
  });
});

describe('timeLeft', () => {
  it('рахує дні й години', () => {
    expect(timeLeft(100_000_000, 0)).toEqual({ days: 1, hours: 3, over: false });
  });
  it('після півночі — over', () => {
    expect(timeLeft(10, 20)).toEqual({ days: 0, hours: 0, over: true });
  });
});

describe('стрічка', () => {
  it('центр сегмента', () => {
    expect(segmentCenterPct(0, 38)).toBeCloseTo(1.316, 2);
  });
  it('приглушення в межах одного сегмента', () => {
    expect(landmarkDimmed(10, 11)).toBe(true);
    expect(landmarkDimmed(10, 12)).toBe(false);
  });
});
