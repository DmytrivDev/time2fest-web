/**
 * Яку подію показує модуль «Перший ряд» (EXPERIENCE `first-row-module`, C6):
 * поточна подія ефіру, якщо вона має «Перший ряд» і ще не минуло 15 хв після півночі (тоді «Продаж закрито» й стіна);
 * інакше — найближче основне святкування з відкритим продажем.
 */
import type { Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { FIRSTROW_SALE_CLOSE, HANDOVER_AFTER } from '@/lib/engine/config';

const hasFirstRow = (e: ScheduledEvent | null | undefined): e is ScheduledEvent => !!e?.firstRow?.saleEnabled;

/** Найближча подія з «Першим рядом», продаж якої ще відкритий (`midnight − 5 хв > now`). */
export function nextOpenSale(data: Pick<Dataset, 'events'>, now: Ms, excludeId?: string): ScheduledEvent | null {
  let best: ScheduledEvent | null = null;
  for (const e of data.events) {
    if (!hasFirstRow(e) || e.id === excludeId) continue;
    if (e.midnightMs - FIRSTROW_SALE_CLOSE <= now) continue;
    if (!best || e.midnightMs < best.midnightMs) best = e;
  }
  return best;
}

/** Ряд-кандидат для «Ще є місця»: подія й скільки в ній вільних місць. */
export interface OpenRow {
  event: ScheduledEvent;
  free: number;
}

/**
 * «Ще є місця» (рішення власника 2026-10-31): лише ряди з відкритим продажем і вільними місцями.
 * Порядок: спершу та сама північ (інші країни поясу), далі найближча наступна; серед однакових — головне святкування,
 * потім популярніше. Ряд, де лишилось 1–2 місця, першим не ставимо (щоб не виглядало як тиск), якщо є інший.
 * `freeOf` — вільні місця події на `now` (імітатор місць); 0 — ряд не пропонуємо.
 */
export function otherOpenRows(
  data: Pick<Dataset, 'events'>,
  now: Ms,
  current: Pick<ScheduledEvent, 'id' | 'midnightMs'>,
  freeOf: (e: ScheduledEvent) => number,
): OpenRow[] {
  const rows: OpenRow[] = [];
  for (const e of data.events) {
    if (!hasFirstRow(e) || e.id === current.id) continue;
    if (e.midnightMs - FIRSTROW_SALE_CLOSE <= now) continue;
    const free = freeOf(e);
    if (free > 0) rows.push({ event: e, free });
  }
  rows.sort((a, b) => {
    const sa = a.event.midnightMs === current.midnightMs ? 0 : 1;
    const sb = b.event.midnightMs === current.midnightMs ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.event.midnightMs !== b.event.midnightMs) return a.event.midnightMs - b.event.midnightMs;
    if (a.event.isMainCelebration !== b.event.isMainCelebration) return a.event.isMainCelebration ? -1 : 1;
    return (b.event.popularity ?? 0) - (a.event.popularity ?? 0);
  });
  const LOW = 2;
  if (rows.length > 1 && rows[0]!.free <= LOW) {
    const i = rows.findIndex((r) => r.free > LOW);
    if (i > 0) rows.unshift(...rows.splice(i, 1));
  }
  return rows;
}

/** Подія модуля на головній і в кімнаті. `preferred` — подія ефіру чи вікна зі звуком. */
export function firstRowEventFor(data: Pick<Dataset, 'events'>, now: Ms, preferred?: ScheduledEvent | null): ScheduledEvent | null {
  if (hasFirstRow(preferred) && now < preferred.midnightMs + HANDOVER_AFTER) return preferred;
  return nextOpenSale(data, now);
}

/** Подія модуля на сторінці країни: основне святкування країни з «Першим рядом». */
export function firstRowEventForCountry(data: Pick<Dataset, 'events'>, countryIso: string): ScheduledEvent | null {
  return data.events.find((e) => e.countryIso === countryIso && hasFirstRow(e)) ?? null;
}
