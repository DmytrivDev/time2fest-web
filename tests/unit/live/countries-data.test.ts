import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import {
  ALL_STATUSES,
  allStatuses,
  buildZones,
  countShown,
  filterZones,
  filtersBadge,
  formatUtcOffset,
  isAllSet,
  isQuickSet,
  minutesUntil,
  normalizeQuery,
  quickStatuses,
  splitZones,
  statusCounts,
  type CountryFilters,
  type RowStatus,
} from '@/lib/live/countriesData';

const data = getData();
/** 23:50 UTC 31 грудня: пояс UTC+0 (північ о 00:00) — «наживо», UTC−1 — «далі». */
const NOW = Date.parse('2026-12-31T23:50:00Z');
const zones = buildZones(data, NOW);
const groups = splitZones(zones, NOW);
const none: CountryFilters = { statuses: allStatuses(), inSchedule: false, query: '' };

describe('групи поясів за часом', () => {
  it('«Зараз наживо» — перший пояс, чия півночі +15 хв ще не минули; «Далі» — наступний', () => {
    expect(groups.live?.utc).toBe('UTC+0');
    expect(groups.next?.utc).toBe('UTC−1');
    expect(minutesUntil(groups.next!.midnightMs, NOW)).toBe(70);
  });

  it('усі пояси розкладено без втрат: майбутні за зростанням, минулі — найсвіжіший першим', () => {
    expect(1 + 1 + groups.later.length + groups.met.length).toBe(data.zones.length);
    const later = groups.later.map((z) => z.midnightMs);
    expect(later).toEqual([...later].sort((a, b) => a - b));
    const met = groups.met.map((z) => z.midnightMs);
    expect(met).toEqual([...met].sort((a, b) => b - a));
    expect(groups.met[0]!.utc).toBe('UTC+1');
  });

  it('межа переходу: через 14 хв після півночі пояс ще «наживо», через 15 — вже «зустріли»', () => {
    const t0 = groups.live!.midnightMs;
    expect(splitZones(zones, t0 + 14 * 60_000).live?.id).toBe(groups.live!.id);
    const after = splitZones(zones, t0 + 15 * 60_000);
    expect(after.live?.utc).toBe('UTC−1');
    expect(after.met[0]?.id).toBe(groups.live!.id);
  });

  it('до першої півночі «наживо» — найперший пояс, після останньої груп «наживо» і «далі» немає', () => {
    expect(splitZones(zones, Date.parse('2026-12-31T00:00:00Z')).met).toHaveLength(0);
    const end = splitZones(zones, Date.parse('2027-01-02T00:00:00Z'));
    expect(end.live).toBeNull();
    expect(end.next).toBeNull();
    expect(end.met).toHaveLength(data.zones.length);
  });
});

describe('рядок країни', () => {
  it('Велика Британія в UTC+0: головне місто, тип святкування, посилання на сторінку країни', () => {
    const gb = groups.live!.rows.find((r) => r.iso === 'GB');
    expect(gb).toBeDefined();
    expect(gb!.city).toBe('Лондон');
    expect(gb!.celebrationType).toBe('webcam');
    expect(gb!.href).toBe(`/country/${data.countriesByIso.get('GB')!.slug}/`);
    expect(ALL_STATUSES).toContain(gb!.status);
  });

  it('рядки поясу відсортовано за статусом (кращі першими)', () => {
    const rank = (s: RowStatus) => ALL_STATUSES.indexOf(s);
    for (const z of zones) {
      const ranks = z.rows.map((r) => rank(r.status));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('країна з кількома поясами має рядок у кожному поясі', () => {
    const br = zones.filter((z) => z.rows.some((r) => r.iso === 'BR'));
    expect(br.length).toBeGreaterThan(1);
  });
});

describe('фільтри', () => {
  it('«Лише з трансляціями» ⇔ позначено лише «Наживо» і «Трансляція очікується»', () => {
    expect(isQuickSet(quickStatuses())).toBe(true);
    expect(isQuickSet(allStatuses())).toBe(false);
    expect(isAllSet(allStatuses())).toBe(true);
    expect(isQuickSet(new Set<RowStatus>(['live']))).toBe(false);
  });

  it('«Фільтри · N» лише коли вибір відрізняється і від «усі», і від швидкого набору', () => {
    expect(filtersBadge(allStatuses())).toBeNull();
    expect(filtersBadge(quickStatuses())).toBeNull();
    expect(filtersBadge(new Set<RowStatus>(['live', 'possible', 'countdown-only']))).toBe(3);
    expect(filtersBadge(new Set())).toBe(0);
  });

  it('статуси відсікають рядки; порожній вибір дає порожній список і «Показати 0»', () => {
    const quick = filterZones(zones, { ...none, statuses: quickStatuses() }, []);
    for (const z of quick) for (const r of z.rows) expect(['live', 'expected']).toContain(r.status);
    expect(filterZones(zones, { ...none, statuses: new Set() }, [])).toHaveLength(0);
    expect(countShown(zones, new Set(), false, [])).toBe(0);
  });

  it('лічильники статусів і «Показати N»: унікальні країни', () => {
    const counts = statusCounts(zones);
    const total = countShown(zones, allStatuses(), false, []);
    expect(total).toBe(new Set(zones.flatMap((z) => z.rows.map((r) => r.iso))).size);
    expect(counts.live + counts.expected + counts.possible + counts['countdown-only']).toBeGreaterThanOrEqual(total);
  });

  it('пошук за назвою країни чи міста, без урахування регістру: «Бра» → Бразилія в UTC−3', () => {
    const found = filterZones(zones, { ...none, query: 'Бра' }, []);
    const brazil = found.find((z) => z.utc === 'UTC−3');
    expect(brazil?.rows.some((r) => r.iso === 'BR')).toBe(true);
    const byCity = filterZones(zones, { ...none, query: 'ЛОНДОН' }, []);
    expect(byCity.flatMap((z) => z.rows.map((r) => r.iso))).toContain('GB');
    expect(filterZones(zones, { ...none, query: 'qqqqzzzz' }, [])).toHaveLength(0);
  });

  it('апостроф у пошуку нормалізується', () => {
    expect(normalizeQuery(" Рейк'явік ")).toBe('рейк’явік');
  });

  it('«У моєму графіку» залишає лише країни з подіями з графіка', () => {
    const gb = groups.live!.rows.find((r) => r.iso === 'GB')!;
    const mine = filterZones(zones, { ...none, inSchedule: true }, [gb.eventIds[0]!]);
    expect(mine.flatMap((z) => z.rows.map((r) => r.iso))).toEqual(['GB']);
    expect(filterZones(zones, { ...none, inSchedule: true }, [])).toHaveLength(0);
  });
});

describe('formatUtcOffset', () => {
  it.each([
    [0, 'UTC+0'],
    [60, 'UTC+1'],
    [-120, 'UTC−2'],
    [-210, 'UTC−3:30'],
    [345, 'UTC+5:45'],
    [840, 'UTC+14'],
  ])('%i → %s', (minutes, label) => {
    expect(formatUtcOffset(minutes)).toBe(label);
  });
});
