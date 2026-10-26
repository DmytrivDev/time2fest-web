/**
 * Дані сторінки «Країни й міста» (S-COUNTRIES, C19) з набору даних області. Чисті функції, «зараз» — аргументом.
 *
 * - рядок країни в поясі: найкращий статус ланцюжків її подій у поясі (`chainStatus`), головне місто й тип святкування;
 * - групи за часом: «Зараз наживо» — перший пояс, у якого ще не минуло `HANDOVER_AFTER` після півночі;
 *   «Далі» — наступний; «Ще попереду» — решта майбутніх; «Уже зустріли» — минулі (найсвіжіший зверху);
 * - фільтри: чотири статуси (набір «усі» і швидкий набір «Наживо + Трансляція очікується»), «У моєму графіку», пошук.
 */
import type { CelebrationType, City, Dataset, LoadedZone, Ms, ScheduledEvent } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { chainStatus } from '@/lib/engine/sourceStatus';
import { countryHref } from '@/lib/player/BroadcastController';

export type RowStatus = 'live' | 'expected' | 'possible' | 'countdown-only';

/** Порядок статусів у фільтрах і в сортуванні рядків (найкращий — перший). */
export const ALL_STATUSES: readonly RowStatus[] = ['live', 'expected', 'possible', 'countdown-only'];
/** Швидкий набір перемикача «Лише з трансляціями». */
export const QUICK_STATUSES: readonly RowStatus[] = ['live', 'expected'];

export type GroupKind = 'live' | 'next' | 'later' | 'met';

/** Рядок C19 `CountryRow`: країна в одному поясі. */
export interface CountryRowData {
  iso: string;
  slug: string;
  /** Назва країни в називному відмінку. */
  name: string;
  flagCode: string;
  /** Сторінка країни. */
  href: string;
  status: RowStatus;
  /** Головне місто країни в поясі («Лондон»). */
  city: string;
  celebrationType: CelebrationType;
  /** Події країни в поясі (для «У моєму графіку»). */
  eventIds: string[];
  popularity: number;
  /** Назви країни й усіх її міст у поясі, у нижньому регістрі, для пошуку. */
  searchKey: string;
}

export interface ZoneData {
  id: string;
  offsetMinutes: number;
  /** «UTC+0», «UTC−3:30». */
  utc: string;
  midnightMs: Ms;
  /** За статусом, далі за популярністю й назвою. */
  rows: CountryRowData[];
}

export interface TimeGroups {
  live: ZoneData | null;
  next: ZoneData | null;
  later: ZoneData[];
  /** Найсвіжіший пояс першим. */
  met: ZoneData[];
}

/** «UTC+0», «UTC−3:30», «UTC+5:45» (мінус — знак U+2212). */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

const STATUS_RANK: Record<RowStatus, number> = { live: 0, expected: 1, possible: 2, 'countdown-only': 3 };

/** Нижній регістр + один вид апострофа + без зайвих пробілів. */
export function normalizeQuery(q: string): string {
  return q.toLocaleLowerCase('uk').replace(/['ʼ`´]/g, '’').replace(/\s+/g, ' ').trim();
}

interface ZoneIndex {
  cities: Map<string, City[]>;
  events: Map<string, ScheduledEvent[]>;
}

const indexCache = new WeakMap<Dataset, Map<string, ZoneIndex>>();

/** Міста й події по парі «пояс · країна»; будується один раз на набір даних. */
function zoneIndex(data: Dataset): Map<string, ZoneIndex> {
  const hit = indexCache.get(data);
  if (hit) return hit;
  const byZone = new Map<string, ZoneIndex>();
  const slot = (zoneId: string): ZoneIndex => {
    let z = byZone.get(zoneId);
    if (!z) {
      z = { cities: new Map(), events: new Map() };
      byZone.set(zoneId, z);
    }
    return z;
  };
  for (const c of data.cities) {
    const z = slot(c.zoneId);
    z.cities.set(c.countryIso, [...(z.cities.get(c.countryIso) ?? []), c]);
  }
  for (const e of data.events) {
    const z = slot(e.zoneId);
    z.events.set(e.countryIso, [...(z.events.get(e.countryIso) ?? []), e]);
  }
  indexCache.set(data, byZone);
  return byZone;
}

const RANK: Record<RowStatus, number> = { live: 3, possible: 2, expected: 1, 'countdown-only': 0 };

function bestStatus(data: Dataset, events: readonly ScheduledEvent[], now: Ms): RowStatus {
  let best: RowStatus = 'countdown-only';
  for (const e of events) {
    const st = chainStatus(data.chainsByEventId.get(e.id), now);
    const mapped: RowStatus = st === 'none' ? 'countdown-only' : st;
    if (RANK[mapped] > RANK[best]) best = mapped;
  }
  return best;
}

/** Головне місто країни в поясі: позначене `isCountryMain`, інакше місто найпопулярнішої події, інакше перше. */
function mainCity(cities: readonly City[], events: readonly ScheduledEvent[]): City | undefined {
  const flagged = cities.find((c) => c.isCountryMain);
  if (flagged) return flagged;
  const top = [...events].sort((a, b) => b.popularity - a.popularity)[0];
  return cities.find((c) => c.id === top?.cityId) ?? cities[0];
}

function zoneData(data: Dataset, zone: LoadedZone, now: Ms): ZoneData {
  const idx = zoneIndex(data).get(zone.id);
  const isoSet = new Set<string>([...(idx?.cities.keys() ?? []), ...(idx?.events.keys() ?? [])]);
  const rows: CountryRowData[] = [];
  for (const iso of isoSet) {
    const country = data.countriesByIso.get(iso);
    if (!country) continue;
    const cities = idx?.cities.get(iso) ?? [];
    const events = idx?.events.get(iso) ?? [];
    const city = mainCity(cities, events);
    rows.push({
      iso,
      slug: country.slug,
      name: country.name.uk,
      flagCode: country.flagCode,
      href: countryHref(country),
      status: bestStatus(data, events, now),
      city: city?.name.uk ?? '',
      celebrationType: city?.celebrationType ?? 'countdown-only',
      eventIds: events.map((e) => e.id),
      popularity: country.popularity,
      searchKey: [country.name.uk, ...cities.map((c) => c.name.uk)].map(normalizeQuery).join('|'),
    });
  }
  rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.popularity - a.popularity || a.name.localeCompare(b.name, 'uk'),
  );
  return { id: zone.id, offsetMinutes: zone.offsetMinutes, utc: formatUtcOffset(zone.offsetMinutes), midnightMs: zone.midnightMs, rows };
}

/** Усі пояси набору даних за зростанням півночі, з рядками країн і статусами на момент `now`. */
export function buildZones(data: Dataset, now: Ms): ZoneData[] {
  return [...data.zones].sort((a, b) => a.midnightMs - b.midnightMs).map((z) => zoneData(data, z, now));
}

/** Поділ поясів на чотири групи за часом (див. заголовок файлу). */
export function splitZones(zones: readonly ZoneData[], now: Ms): TimeGroups {
  const idx = zones.findIndex((z) => now < z.midnightMs + HANDOVER_AFTER);
  if (idx === -1) return { live: null, next: null, later: [], met: [...zones].reverse() };
  return {
    live: zones[idx] ?? null,
    next: zones[idx + 1] ?? null,
    later: zones.slice(idx + 2),
    met: zones.slice(0, idx).reverse(),
  };
}

// ── Фільтри ────────────────────────────────────────────────────────────────

export interface CountryFilters {
  statuses: ReadonlySet<RowStatus>;
  inSchedule: boolean;
  query: string;
}

export const allStatuses = (): Set<RowStatus> => new Set(ALL_STATUSES);
export const quickStatuses = (): Set<RowStatus> => new Set(QUICK_STATUSES);

const sameSet = (a: ReadonlySet<RowStatus>, b: readonly RowStatus[]): boolean => a.size === b.length && b.every((s) => a.has(s));
export const isAllSet = (s: ReadonlySet<RowStatus>): boolean => sameSet(s, ALL_STATUSES);
/** «Лише з трансляціями» ⇔ позначено лише «Наживо» і «Трансляція очікується». */
export const isQuickSet = (s: ReadonlySet<RowStatus>): boolean => sameSet(s, QUICK_STATUSES);

/** Число в «Фільтри · N»: лише коли вибір відрізняється і від «усі», і від швидкого набору. */
export function filtersBadge(statuses: ReadonlySet<RowStatus>): number | null {
  return isAllSet(statuses) || isQuickSet(statuses) ? null : statuses.size;
}

export function rowInSchedule(row: Pick<CountryRowData, 'eventIds'>, schedule: readonly string[]): boolean {
  return row.eventIds.some((id) => schedule.includes(id));
}

function rowMatches(row: CountryRowData, f: CountryFilters, schedule: readonly string[]): boolean {
  if (!f.statuses.has(row.status)) return false;
  if (f.inSchedule && !rowInSchedule(row, schedule)) return false;
  const q = normalizeQuery(f.query);
  return !q || row.searchKey.includes(q);
}

/** Пояси з відфільтрованими рядками; пояси без рядків відкидаються. */
export function filterZones(zones: readonly ZoneData[], f: CountryFilters, schedule: readonly string[]): ZoneData[] {
  const out: ZoneData[] = [];
  for (const z of zones) {
    const rows = z.rows.filter((r) => rowMatches(r, f, schedule));
    if (rows.length) out.push({ ...z, rows });
  }
  return out;
}

/** Лічильники статусів у фільтрах: унікальні країни по всіх поясах. */
export function statusCounts(zones: readonly ZoneData[]): Record<RowStatus, number> {
  const seen: Record<RowStatus, Set<string>> = { live: new Set(), expected: new Set(), possible: new Set(), 'countdown-only': new Set() };
  for (const z of zones) for (const r of z.rows) seen[r.status].add(r.iso);
  return { live: seen.live.size, expected: seen.expected.size, possible: seen.possible.size, 'countdown-only': seen['countdown-only'].size };
}

/** «Показати N країн»: унікальні країни, що проходять статуси (і «У моєму графіку»); пошук не враховується. */
export function countShown(zones: readonly ZoneData[], statuses: ReadonlySet<RowStatus>, inSchedule: boolean, schedule: readonly string[]): number {
  const iso = new Set<string>();
  for (const z of zones) {
    for (const r of z.rows) {
      if (statuses.has(r.status) && (!inSchedule || rowInSchedule(r, schedule))) iso.add(r.iso);
    }
  }
  return iso.size;
}

/** Хвилини до моменту (округлення вгору, не менше 1) для підпису «за 1 год 22 хв». */
export function minutesUntil(ms: Ms, now: Ms): number {
  return Math.max(1, Math.ceil((ms - now) / 60_000));
}
