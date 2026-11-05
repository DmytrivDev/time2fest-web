/**
 * Який «Перший ряд» показувати (EXPERIENCE `first-row-module`, C6). З 2026-11-05 ряд один на часовий пояс
 * (`lib/firstrow/zone`), і всюди — головна, сторінка країни, кімната перегляду, ТВ — показуємо той самий:
 * ряд поточного поясу (`currentZoneRow`). До 15 хв після його півночі — «Продаж закрито» й стіна / листівка,
 * далі — ряд наступного поясу.
 */
import type { Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { FIRSTROW_SALE_CLOSE } from '@/lib/engine/config';
import { currentZoneRow, zoneRows } from './zone';

/** Найближчий ряд поясу, продаж якого ще відкритий (`midnight − 5 хв > now`). */
export function nextOpenSale(data: Pick<Dataset, 'events'>, now: Ms, excludeId?: string): ScheduledEvent | null {
  for (const e of zoneRows(data)) {
    if (e.id === excludeId) continue;
    if (e.midnightMs - FIRSTROW_SALE_CLOSE > now) return e;
  }
  return null;
}

/** Ряд-кандидат для «Ще є місця»: ряд поясу (подія-носій) і скільки в ньому вільних місць. */
export interface OpenRow {
  event: ScheduledEvent;
  free: number;
}

/**
 * «Ще є місця» (рішення власника 2026-10-31): лише ряди поясів з відкритим продажем і вільними місцями, від найближчої
 * півночі. Ряд, де лишилось 1–2 місця, першим не ставимо (щоб не виглядало як тиск), якщо є інший.
 * `freeOf` — вільні місця ряду на `now` (імітатор місць); 0 — ряд не пропонуємо.
 */
export function otherOpenRows(
  data: Pick<Dataset, 'events'>,
  now: Ms,
  current: Pick<ScheduledEvent, 'id' | 'midnightMs'>,
  freeOf: (e: ScheduledEvent) => number,
): OpenRow[] {
  const rows: OpenRow[] = [];
  for (const e of zoneRows(data)) {
    if (e.id === current.id) continue;
    if (e.midnightMs - FIRSTROW_SALE_CLOSE <= now) continue;
    const free = freeOf(e);
    if (free > 0) rows.push({ event: e, free });
  }
  const LOW = 2;
  if (rows.length > 1 && rows[0]!.free <= LOW) {
    const i = rows.findIndex((r) => r.free > LOW);
    if (i > 0) rows.unshift(...rows.splice(i, 1));
  }
  return rows;
}

/** Ряд модуля всюди на сайті: ряд поточного поясу. */
export function firstRowEventFor(data: Pick<Dataset, 'events'>, now: Ms): ScheduledEvent | null {
  return currentZoneRow(data, now);
}
