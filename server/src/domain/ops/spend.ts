/**
 * Витрати платних служб (SPEC-13b AC-60 … AC-65, NFR-6), ring 1: чиста математика без портів і годинника.
 * Період — місяць UTC (`YYYY-MM`); гроші — USD числом, лічильники — цілі.
 */

export const SPEND_LEVELS = [50, 80] as const;
export type SpendLevel = (typeof SPEND_LEVELS)[number];

const MS_PER_HOUR = 3_600_000;
const BYTES_PER_GB = 1_000_000_000;
const PER_MILLION = 1_000_000;

/** Місяць UTC моменту `now`: `YYYY-MM`. */
export function monthPeriod(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Початок місяця `YYYY-MM` і початок наступного (мс, UTC). */
export function monthBounds(period: string): { start: number; end: number } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}

/** Додатковий розмір вузла: години за ціною години (AC-63). */
export interface ServerHours {
  hours: number;
  usdPerHour: number;
}

/**
 * Вартість сервера за місяць до `now` (AC-63): база × частка місяця, що минула, плюс Σ години × ціна години.
 * Частка — за мілісекундами, обмежена `[0, 1]`.
 */
export function serverCost(month: string, now: number, baseUsd: number, records: readonly ServerHours[]): number {
  const { start, end } = monthBounds(month);
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const extra = records.reduce((sum, r) => sum + r.hours * r.usdPerHour, 0);
  return baseUsd * elapsed + extra;
}

/** Ціни й безплатні межі Cloudflare R2 (параметри `ops-settings`, AC-64). */
export interface CloudflarePrices {
  classAPerMillionUsd: number;
  classBPerMillionUsd: number;
  storagePerGbUsd: number;
  freeClassA: number;
  freeClassB: number;
  freeStorageGb: number;
}

export interface CloudflareUsage {
  classA: number;
  classB: number;
  storageGb: number;
}

/** `max(0, A − free) × ціна/млн + max(0, B − free) × ціна/млн + max(0, ГБ − free) × ціна` (AC-64). */
export function cloudflareCost(u: CloudflareUsage, p: CloudflarePrices): number {
  return (
    (Math.max(0, u.classA - p.freeClassA) / PER_MILLION) * p.classAPerMillionUsd +
    (Math.max(0, u.classB - p.freeClassB) / PER_MILLION) * p.classBPerMillionUsd +
    Math.max(0, u.storageGb - p.freeStorageGb) * p.storagePerGbUsd
  );
}

/** Відсоток стелі (не округлений); стеля ≤ 0 → 0. */
export function percent(amount: number, ceiling: number): number {
  return ceiling > 0 ? (amount / ceiling) * 100 : 0;
}

/** Пороги, яких досягнуто при відсотку `p`. */
export function levelsReached(p: number): SpendLevel[] {
  return SPEND_LEVELS.filter((l) => p >= l);
}

/** Пороги, які перетнув перехід від `prev` до `next` відсотків. */
export function levelsCrossed(prev: number, next: number): SpendLevel[] {
  return SPEND_LEVELS.filter((l) => prev < l && next >= l);
}

/** Обсяг копій у сховищі за маніфестами, байти (NFR-6, `storageGb` рядка Cloudflare). */
export function backupStorageEstimate(manifests: readonly { size: number }[]): number {
  return manifests.reduce((sum, m) => sum + m.size, 0);
}

export const bytesToGb = (bytes: number): number => bytes / BYTES_PER_GB;

/** Години нічного розміру в доларах: `hours × usdPerHour`. */
export const extraServerUsd = (hours: number, usdPerHour: number): number => hours * usdPerHour;

/**
 * Рядок пошти (SPEC-10 AC-46): лічильник доби UTC основного постачальника проти його стелі; без поштового сервісу
 * (немає `SMTP_HOST`) — «немає провайдера».
 */
export type MailRow = { state: 'counted'; sentToday: number; ceiling: number } | { state: 'no-provider' };

export function mailRow(counts: { sentToday: number; ceiling: number } | null): MailRow {
  return counts ? { state: 'counted', ...counts } : { state: 'no-provider' };
}

export { MS_PER_HOUR };
