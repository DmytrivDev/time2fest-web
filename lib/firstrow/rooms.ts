/**
 * Кімната «Перший ряд» ряду E (рішення 2026-10-28): відкривається через 15 хв після ПОПЕРЕДНЬОЇ півночі (найпізніша
 * різна північ серед переданих подій, раніша за північ E) і лишається відкритою до кінця ночі. Для першої — з відкриття
 * продажу. Тут же правило «одне місце на пояс, місто й країну».
 *
 * З 2026-11-05 ряд один на пояс: сюди передаємо ряди поясів (`zoneRows`), тож кімната відкривається тоді ж, коли ряд
 * стає поточним на сайті (через 15 хв після півночі попереднього ряду).
 */
import type { GuestFirstRowEntry, Ms, ScheduledEvent } from '@/lib/data/types';
import { FIRSTROW_SALE_OPEN, HANDOVER_AFTER } from '@/lib/engine/config';

type EventLite = Pick<ScheduledEvent, 'id' | 'cityId' | 'countryIso' | 'midnightMs'>;

/** Вікно, коли кімната «Перший ряд» події відкрита: `[opensAt, closesAt)`. */
export function roomWindow(events: readonly Pick<ScheduledEvent, 'midnightMs'>[], event: Pick<ScheduledEvent, 'midnightMs'>): { opensAt: Ms; closesAt: Ms } {
  let prev: Ms | null = null;
  let last = event.midnightMs;
  for (const e of events) {
    if (e.midnightMs < event.midnightMs && (prev === null || e.midnightMs > prev)) prev = e.midnightMs;
    if (e.midnightMs > last) last = e.midnightMs;
  }
  return { opensAt: prev === null ? FIRSTROW_SALE_OPEN : prev + HANDOVER_AFTER, closesAt: last + HANDOVER_AFTER };
}

export function isRoomOpen(events: readonly Pick<ScheduledEvent, 'midnightMs'>[], event: Pick<ScheduledEvent, 'midnightMs'>, now: Ms): boolean {
  const w = roomWindow(events, event);
  return now >= w.opensAt && now < w.closesAt;
}

/**
 * Кімната «Перший ряд» для чату: подія, на яку в гостя є місце й кімната відкрита зараз. Кілька — найближча майбутня північ,
 * інакше найновіша.
 */
export function pickSeatRoomEvent<E extends EventLite>(
  events: readonly E[],
  firstRow: Readonly<Record<string, GuestFirstRowEntry | undefined>>,
  now: Ms,
): E | null {
  let upcoming: E | null = null;
  let recent: E | null = null;
  for (const e of events) {
    if (firstRow[e.id]?.seat === undefined || !isRoomOpen(events, e, now)) continue;
    if (e.midnightMs > now) {
      if (!upcoming || e.midnightMs < upcoming.midnightMs) upcoming = e;
    } else if (!recent || e.midnightMs > recent.midnightMs) recent = e;
  }
  return upcoming ?? recent;
}

/**
 * Одне місце на людину в одному поясі (та сама північ), одному місті й одній країні. Повертає подію, де вже є місце
 * (або діюче утримання) і яка блокує купівлю на `target`; `null` — можна.
 */
export function seatConflict<E extends EventLite>(
  events: readonly E[],
  firstRow: Readonly<Record<string, GuestFirstRowEntry | undefined>>,
  target: EventLite,
  now: Ms,
): E | null {
  let found: E | null = null;
  for (const e of events) {
    if (e.id === target.id) continue;
    const entry = firstRow[e.id];
    const holds = entry?.seat !== undefined || (!!entry?.hold && entry.hold.until > now);
    if (!holds) continue;
    if (e.midnightMs === target.midnightMs || e.cityId === target.cityId || e.countryIso === target.countryIso) {
      if (!found || (entry?.seat !== undefined && firstRow[found.id]?.seat === undefined)) found = e;
    }
  }
  return found;
}
