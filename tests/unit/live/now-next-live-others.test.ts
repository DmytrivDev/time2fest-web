import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import { nowNextItems } from '@/lib/live/homeData';

const data = getData();
const LONDON = Date.parse('2027-01-01T00:00:00Z');

describe('«Зараз і далі»: решта трансляцій поясу, що йдуть зараз (правка власника 2026-11-11)', () => {
  const at = LONDON - 10 * 60_000;

  it('за замовчуванням (програма режиму вечірки) — по одній події на слот', () => {
    const items = nowNextItems(data, at, []);
    expect(new Set(items.map((i) => i.midnightMs)).size).toBe(items.length);
  });

  it('liveOthers: після події ефіру — інші події поясу з трансляцією наживо', () => {
    const items = nowNextItems(data, at, [], { liveOthers: true });
    const inSlot = items.filter((i) => i.midnightMs === LONDON);
    expect(inSlot[0]?.id).toBe('evt_london_2027');
    expect(inSlot.map((i) => i.id)).toContain('evt_dublin_2027');
    expect(inSlot.slice(1).every((i) => i.stream === 'live')).toBe(true);
  });
});
