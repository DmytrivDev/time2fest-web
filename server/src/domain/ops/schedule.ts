/**
 * Розклад операцій (SPEC-13b AC-18, AC-19, AC-21, AC-22, AC-40, AC-45, AC-12, NFR-2), ring 1 — чисті функції.
 *
 * Час — завжди параметр `now` справжнього настінного годинника (AC-22): віртуальний годинник сезону SPEC-07
 * сюди не потрапляє. Перетворення в `Europe/Kyiv` — через `Intl.DateTimeFormat` (у кінці грудня переходу на
 * літній час немає, але вважати зсув сталим не можна).
 *
 * - Вікно свята — межі `isCelebrating` (`@time2fest/rules`: перша північ − `CELEBRATION_LEAD` … остання +
 *   `CELEBRATION_TAIL`); без поясів — запасне 31.12 08:00 UTC – 01.01 14:00 UTC (`fallback: true`, AC-19).
 * - Контрольне повідомлення — кожна :00 UTC у вікні і мить початку вікна; ключ слоту `hb:<UTC рррр-мм-ддTгг>`.
 * - Пропущений слот: ≤10 хв запізнення — надіслати, інакше пропустити (AC-21).
 * - Ранковий підсумок — 09:00 за Києвом, ключ `digest:<рррр-мм-дд за Києвом>` (AC-20).
 * - Копії: щодня 03:00 UTC, у годинному вікні 26.12 00:00 … 02.01 23:59 за Києвом — щогодини о :00 за Києвом
 *   (AC-40); застарілість — понад 26 год, у вікні понад 2 год (AC-45); `log`-тривоги — 30 днів (AC-12).
 */
import { CELEBRATION_LEAD, CELEBRATION_TAIL, type ZonesLike } from '@time2fest/rules/time';

export const KYIV_TZ = 'Europe/Kyiv';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Запізнення, з яким пропущений слот ще надсилається (AC-21). */
export const MISSED_SLOT_GRACE_MS = 10 * MIN;
/** Скільки днів живуть `log`-тривоги (AC-12). */
export const LOG_ALARM_RETENTION_MS = 30 * DAY;
export const STALE_OUTSIDE_WINDOW_MS = 26 * HOUR;
export const STALE_IN_WINDOW_MS = 2 * HOUR;

export interface CelebrationWindow {
  /** Epoch ms, обидві межі включно. */
  start: number;
  end: number;
  /** Вікно взято за замовчуванням: поясів каталогу немає (AC-19). */
  fallback: boolean;
}

/** Слот розкладу: стійкий ключ і мить, коли він настає. */
export interface Slot {
  key: string;
  /** Epoch ms. */
  due: number;
}

export type MissedSlotDecision = 'wait' | 'send' | 'skip';

const pad = (n: number) => String(n).padStart(2, '0');

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Місцеві дата й час миті `ms` у поясі `tz`. */
export function localParts(ms: number, tz: string = KYIV_TZ): LocalParts {
  const p: Record<string, number> = {};
  for (const part of formatterOf(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year ?? 0, m: p.month ?? 1, d: p.day ?? 1, h: p.hour ?? 0, mi: p.minute ?? 0, s: p.second ?? 0 };
}

function offsetAt(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1_000) * 1_000;
}

/** Мить місцевого часу `y-m-d h:mi` у поясі `tz` (місяць 1…12; переповнення дня нормалізується). */
export function zonedInstant(tz: string, y: number, m: number, d: number, h = 0, mi = 0): number {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - offsetAt(wall, tz);
  const again = wall - offsetAt(t, tz);
  if (again !== t) t = again;
  return t;
}

function dateKey(y: number, m: number, d: number): string {
  const n = new Date(Date.UTC(y, m - 1, d));
  return `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
}

/** Запасне вікно року: 31.12 08:00 UTC – 01.01 14:00 UTC; у січні — вікно минулого року. */
export function fallbackWindow(now: number): CelebrationWindow {
  const d = new Date(now);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  return { start: Date.UTC(y, 11, 31, 8), end: Date.UTC(y + 1, 0, 1, 14), fallback: true };
}

/** Вікно свята за поясами каталогу (межі `isCelebrating`); `null` чи порожньо — запасне вікно (AC-19). */
export function celebrationWindow(zones: ZonesLike | null, now: number): CelebrationWindow {
  if (!zones || zones.zones.length === 0) return fallbackWindow(now);
  let first = Infinity;
  let last = -Infinity;
  for (const z of zones.zones) {
    if (z.midnightMs < first) first = z.midnightMs;
    if (z.midnightMs > last) last = z.midnightMs;
  }
  return { start: first - CELEBRATION_LEAD, end: last + CELEBRATION_TAIL, fallback: false };
}

/**
 * Останній слот контрольного повідомлення, що настав до `now` (AC-18): :00 UTC у межах вікна або мить його
 * початку; `null` поза вікном. До кінця години, у якій настав останній слот, повертається той самий слот —
 * рішення про запізнення приймає `missedSlotDecision`.
 */
export function heartbeatSlotAt(now: number, window: CelebrationWindow): Slot | null {
  if (now < window.start) return null;
  const hour = Math.floor(now / HOUR) * HOUR;
  const due = Math.max(hour, window.start);
  if (due > window.end) return null;
  const d = new Date(due);
  return { key: `hb:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`, due };
}

/** Слот, що настав `now - due` тому: ще ні, надіслати (≤10 хв) чи пропустити (AC-21). */
export function missedSlotDecision(slot: Slot, now: number): MissedSlotDecision {
  const late = now - slot.due;
  if (late < 0) return 'wait';
  return late <= MISSED_SLOT_GRACE_MS ? 'send' : 'skip';
}

/** Останній ранковий підсумок, що настав до `now`: щодня `at` (`гг:хх`) у поясі `tz` (AC-20). */
export function digestSlotAt(now: number, tz: string = KYIV_TZ, at = '09:00'): Slot {
  const [h, mi] = at.split(':').map(Number) as [number, number];
  const p = localParts(now, tz);
  let due = zonedInstant(tz, p.y, p.m, p.d, h, mi);
  let day = p.d;
  if (due > now) {
    day -= 1;
    due = zonedInstant(tz, p.y, p.m, day, h, mi);
  }
  return { key: `digest:${dateKey(p.y, p.m, day)}`, due };
}

/** Годинне вікно копій: 26.12 00:00 … 02.01 23:59 за Києвом того сезону, до якого належить `now` (AC-40). */
export function inHourlyBackupWindow(now: number): boolean {
  const p = localParts(now, KYIV_TZ);
  const y = p.m === 1 ? p.y - 1 : p.y;
  return now >= zonedInstant(KYIV_TZ, y, 12, 26) && now < zonedInstant(KYIV_TZ, y + 1, 1, 3);
}

/**
 * Останній слот копії до `now` (AC-40): у годинному вікні — :00 за Києвом, ключ `backup:<дата Києва>T<гг>`;
 * поза ним — 03:00 UTC, ключ `backup:<дата UTC>`.
 */
export function backupSlotAt(now: number): Slot {
  if (inHourlyBackupWindow(now)) {
    const p = localParts(now, KYIV_TZ);
    return { key: `backup:${dateKey(p.y, p.m, p.d)}T${pad(p.h)}`, due: zonedInstant(KYIV_TZ, p.y, p.m, p.d, p.h) };
  }
  const d = new Date(now);
  let due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3);
  if (due > now) due -= DAY;
  const u = new Date(due);
  return { key: `backup:${dateKey(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate())}`, due };
}

/** Межа застарілості копії (AC-45): 2 год у годинному вікні, інакше 26 год. */
export function staleThresholdMs(now: number): number {
  return inHourlyBackupWindow(now) ? STALE_IN_WINDOW_MS : STALE_OUTSIDE_WINDOW_MS;
}

/** Остання успішна копія старша за межу (строго) або її немає. */
export function isBackupStale(lastOkAt: number | null, now: number): boolean {
  return lastOkAt === null || now - lastOkAt > staleThresholdMs(now);
}

/** `log`-тривоги, підняті раніше за цю мить, видаляються (AC-12). */
export function logPruneBefore(now: number): number {
  return now - LOG_ALARM_RETENTION_MS;
}
