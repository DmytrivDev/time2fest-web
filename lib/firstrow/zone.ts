/**
 * «Перший ряд» — один на часовий пояс (рішення власника 2026-11-05; було — на кожну подію-північ міста).
 *
 * Пояс = одна мить півночі для всіх його країн (UTC+0 — Лондон, Лісабон…). Ряд поясу «живе» на одній події-носії:
 * головне святкування поясу з «Першим рядом» у розкладі (`firstRow.saleEnabled`), найпопулярніше. Її `id` — ключ ряду
 * всюди, де він був і раніше: місце й утримання гостя (`guest.firstRow[id]`), імітація місць (`firstRowSeed`),
 * кімната чату `firstrow:<id>`, адреса форми. Пояс без жодної події з «Першим рядом» ряду не має.
 *
 * Поточний ряд — один на весь сайт (головна, сторінка країни, кімната перегляду, ТВ): ряд найближчого поясу, чия
 * північ ще не минула більш як на `HANDOVER_AFTER` (15 хв — стіна й листівка ще на екрані). Після останнього ряду ночі —
 * `null`.
 */
import type { Dataset, Event, GuestFirstRowEntry, Ms, ScheduledEvent } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { utcLabel } from '@/lib/i18n/time';

type RowEvent = Pick<ScheduledEvent, 'id' | 'zoneId' | 'cityId' | 'midnightMs' | 'isMainCelebration' | 'popularity' | 'firstRow'>;

interface ZoneIndex<E extends RowEvent> {
  /** Ряди поясів у порядку півночі. */
  rows: E[];
  /** zoneId → подія-носій ряду. */
  byZone: Map<string, E>;
  /** zoneId → міста з «Першим рядом» за популярністю (для назви ряду). */
  cities: Map<string, string[]>;
}

const cache = new WeakMap<readonly RowEvent[], ZoneIndex<RowEvent>>();

const hasFirstRow = (e: RowEvent): boolean => !!e.firstRow?.saleEnabled;

/** Хто з двох подій поясу краще несе ряд: головне святкування, потім популярніше; при рівності — перша в розкладі. */
function better(a: RowEvent, b: RowEvent): boolean {
  if (a.isMainCelebration !== b.isMainCelebration) return a.isMainCelebration;
  return (a.popularity ?? 0) > (b.popularity ?? 0);
}

function indexOf<E extends RowEvent>(events: readonly E[]): ZoneIndex<E> {
  const known = cache.get(events);
  if (known) return known as unknown as ZoneIndex<E>;
  const byZone = new Map<string, E>();
  const members = new Map<string, E[]>();
  for (const e of events) {
    if (!hasFirstRow(e)) continue;
    const cur = byZone.get(e.zoneId);
    if (!cur || better(e, cur)) byZone.set(e.zoneId, e);
    const list = members.get(e.zoneId) ?? [];
    list.push(e);
    members.set(e.zoneId, list);
  }
  const cities = new Map<string, string[]>();
  for (const [zoneId, list] of members) {
    const ordered = [...list].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    cities.set(zoneId, [...new Set(ordered.map((e) => e.cityId))]);
  }
  const rows = [...byZone.values()].sort((a, b) => a.midnightMs - b.midnightMs);
  const index: ZoneIndex<E> = { rows, byZone, cities };
  cache.set(events, index as unknown as ZoneIndex<RowEvent>);
  return index;
}

/** Ряди всіх поясів (події-носії), у порядку півночі. */
export function zoneRows<E extends RowEvent>(data: { events: readonly E[] }): readonly E[] {
  return indexOf(data.events).rows;
}

/** Ряд поясу події (або поясу за id); `null` — у поясі «Першого ряду» немає. */
export function zoneRowOf<E extends RowEvent>(data: { events: readonly E[] }, of: Pick<Event, 'zoneId'> | string): E | null {
  const zoneId = typeof of === 'string' ? of : of.zoneId;
  return indexOf(data.events).byZone.get(zoneId) ?? null;
}

/** Чи подія — носій ряду свого поясу. */
export function isZoneRow(data: { events: readonly RowEvent[] }, eventId: string): boolean {
  return indexOf(data.events).rows.some((e) => e.id === eventId);
}

/** Ряд поточного поясу на `now`: найближча північ, що минула не більш як на 15 хв; після останньої — `null`. */
export function currentZoneRow<E extends RowEvent>(data: { events: readonly E[] }, now: Ms): E | null {
  for (const row of indexOf(data.events).rows) if (now < row.midnightMs + HANDOVER_AFTER) return row;
  return null;
}

/** Скільки міст називати в назві ряду; далі — «…». */
export const LABEL_CITIES = 2;

type LabelData = Pick<Dataset, 'events' | 'zonesById' | 'citiesById'>;

/**
 * Назва ряду поясу без «Перший ряд»: «UTC+0 · Лондон, Лісабон», «UTC+1 · Париж, Берлін…», «UTC+13 · Окленд».
 * Іде на місце колишнього міста в усіх рядках («Перший ряд · {city}», квиток, листівка, штамп, чат).
 */
export function zoneRowLabel(data: LabelData, row: Pick<Event, 'zoneId' | 'cityId'>): string {
  const zone = data.zonesById.get(row.zoneId);
  const ids = indexOf(data.events).cities.get(row.zoneId) ?? [row.cityId];
  const names = ids.map((id) => data.citiesById.get(id)?.name.uk).filter((n): n is string => !!n);
  const shown = names.slice(0, LABEL_CITIES).join(', ') + (names.length > LABEL_CITIES ? '…' : '');
  if (!zone) return shown;
  return shown ? `${utcLabel(zone.offsetMinutes)} · ${shown}` : utcLabel(zone.offsetMinutes);
}

/** Назва ряду за id будь-якої події поясу (для чату, штампів). Порожньо — подію не знайдено. */
export function zoneRowLabelOf(data: LabelData & Pick<Dataset, 'eventsById'>, eventId: string): string {
  const e = data.eventsById.get(eventId);
  return e ? zoneRowLabel(data, e) : '';
}

/** Місце гостя в ряду поясу події (штамп «Перший ряд» — за будь-яку подію цього поясу). */
export function zoneSeatOf(
  data: { events: readonly RowEvent[] },
  firstRow: Readonly<Record<string, GuestFirstRowEntry | undefined>>,
  event: Pick<Event, 'zoneId'>,
): number | undefined {
  const row = zoneRowOf(data, event);
  return row ? firstRow[row.id]?.seat : undefined;
}
