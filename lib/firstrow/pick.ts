/**
 * Яку подію показує модуль «Перший ряд» (EXPERIENCE `first-row-module`, C6):
 * поточна подія ефіру, якщо вона має «Перший ряд» і ще не минуло 15 хв після півночі (тоді «Продаж закрито» й стіна);
 * інакше — найближче основне святкування з відкритим продажем.
 */
import type { Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { FIRSTROW_SALE_CLOSE, HANDOVER_AFTER } from '@/lib/engine/config';

const hasFirstRow = (e: ScheduledEvent | null | undefined): e is ScheduledEvent => !!e?.firstRow?.saleEnabled;

/** Найближча подія з «Першим рядом», продаж якої ще відкритий (`midnight − 15 хв > now`). */
export function nextOpenSale(data: Pick<Dataset, 'events'>, now: Ms, excludeId?: string): ScheduledEvent | null {
  let best: ScheduledEvent | null = null;
  for (const e of data.events) {
    if (!hasFirstRow(e) || e.id === excludeId) continue;
    if (e.midnightMs - FIRSTROW_SALE_CLOSE <= now) continue;
    if (!best || e.midnightMs < best.midnightMs) best = e;
  }
  return best;
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
