import { describe, expect, it } from 'vitest';
import { achievementsOf, streakLength, type AchievementStamp } from '../src/passport';

const order: Record<string, number> = {};
for (let i = 1; i <= 12; i += 1) order[`z${i}`] = i;
const zoneOrder = (z: string) => order[z] ?? Number.NaN;
const st = (n: number, iso: string, zone: string): AchievementStamp => ({ eventId: `e${n}`, countryIso: iso, zoneId: zone });
const S = '2027';

describe('achievementsOf (AC-41, AC-42)', () => {
  it('no stamps, no keys', () => {
    expect(achievementsOf([], zoneOrder, S)).toEqual([]);
  });

  it('3 countries in one zone give only the countries goal', () => {
    const stamps = [st(1, 'AA', 'z1'), st(2, 'BB', 'z1'), st(3, 'CC', 'z1')];
    expect(achievementsOf(stamps, zoneOrder, S)).toEqual(['goal:2027:countries:3']);
  });

  it('5 zones with 5 countries: countries 3/5, zones 3/5, streak 3/5 (ends at the top)', () => {
    const stamps = ['z3', 'z4', 'z5', 'z6', 'z7'].map((z, i) => st(i, `C${i}`, z));
    expect(achievementsOf(stamps, zoneOrder, S)).toEqual([
      'goal:2027:countries:3',
      'goal:2027:countries:5',
      'goal:2027:zones:3',
      'goal:2027:zones:5',
      'streak:2027:3',
      'streak:2027:5',
    ]);
  });

  it('10 countries and 10 zones reach the 10 goals', () => {
    const stamps = Array.from({ length: 10 }, (_, i) => st(i, `C${i}`, `z${i + 1}`));
    const keys = achievementsOf(stamps, zoneOrder, S);
    expect(keys).toContain('goal:2027:countries:10');
    expect(keys).toContain('goal:2027:zones:10');
  });

  it('same country twice counts once; same zone twice counts once', () => {
    const stamps = [st(1, 'AA', 'z1'), st(2, 'AA', 'z2'), st(3, 'AA', 'z2')];
    expect(achievementsOf(stamps, zoneOrder, S)).toEqual([]);
  });

  it('a gap breaks the run: orders 1,2,3 then 5,6 end the run at 2', () => {
    const stamps = ['z1', 'z2', 'z3', 'z5', 'z6'].map((z, i) => st(i, 'AA', z));
    expect(streakLength(stamps, zoneOrder)).toBe(2);
    expect(achievementsOf(stamps, zoneOrder, S)).toEqual(['goal:2027:zones:3', 'goal:2027:zones:5']);
  });

  it('a run that does not end at the highest order does not count', () => {
    const stamps = ['z1', 'z2', 'z3', 'z9'].map((z, i) => st(i, 'AA', z));
    expect(streakLength(stamps, zoneOrder)).toBe(1);
    expect(achievementsOf(stamps, zoneOrder, S).some((k) => k.startsWith('streak:'))).toBe(false);
  });

  it('unknown zone orders are skipped', () => {
    expect(streakLength([st(1, 'AA', 'nope')], zoneOrder)).toBe(0);
  });

  it('season is part of the key and keys come sorted', () => {
    const stamps = ['z1', 'z2', 'z3'].map((z, i) => st(i, `C${i}`, z));
    const keys = achievementsOf(stamps, zoneOrder, 2028);
    expect(keys.every((k) => k.includes(':2028:'))).toBe(true);
    expect(keys).toEqual([...keys].sort());
  });
});
