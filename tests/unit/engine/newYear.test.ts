import { describe, expect, it } from 'vitest';
import { arrivedYear } from '@/lib/engine/newYear';

describe('arrivedYear — рік, що настав опівночі пояса', () => {
  it('за зсувом пояса: Кірібаті (+14) і Самоа-Американське (−11) — обидва 2027', () => {
    expect(arrivedYear(Date.parse('2026-12-31T10:00:00Z'), 14 * 60)).toBe(2027);
    expect(arrivedYear(Date.parse('2027-01-01T11:00:00Z'), -11 * 60)).toBe(2027);
    expect(arrivedYear(Date.parse('2027-01-01T00:00:00Z'), 0)).toBe(2027);
  });

  it('без зсуву — та сама відповідь для будь-якої новорічної півночі від −12 до +14', () => {
    for (let h = -12; h <= 14; h++) expect(arrivedYear(Date.parse('2027-01-01T00:00:00Z') - h * 3_600_000)).toBe(2027);
  });
});
