/**
 * Присутність для штампа (`data-model.md` 1.10, 3.6; FR-060, FR-STAMP-03). Чисті функції: `now` — серверний час.
 *
 * Поверхня (`PresenceSurface`) — відкрита сторінка, що показує події: ефір (головна), сторінка країни,
 * вікно кімнати, ТВ. Правила:
 * - присутність фіксується в момент півночі події; поверхня, відкрита до півночі й не закрита до неї, — присутня;
 * - відкриття поверхні в межах `STAMP_DELAY` (15 с) після півночі теж зараховується (пільговий інтервал = затримка відео);
 * - якщо людина пішла між північчю й «+15 с», присутність уже зафіксована — штамп однаково нараховується;
 * - пауза відео не має значення (стану плеєра тут немає взагалі);
 * - штамп один на подію (ключ `eventId`), `grantedAt = midnightUtc + 15 с`, а не момент перегляду.
 */
import { STAMP_DELAY } from './constants';
import { midnightOf } from './event';
import { assertPulseInterval, assertTolerance } from './tolerance';
import type { EventLike, Ms, PresenceSource, Pulse } from './types';

export interface PresenceSurface {
  source: PresenceSource;
  /** Події, які поверхня показує (ефір — одна; кімната — за кожне вікно). */
  eventIds: readonly string[];
  /** Коли поверхня почала показувати ці події (серверний час). */
  openedAt: Ms;
  /** Коли поверхню закрито; `undefined` — ще відкрита. */
  closedAt?: Ms;
}

type PresenceEvent = Pick<EventLike, 'id' | 'midnightUtc'> & { midnightMs?: Ms };

/**
 * Чи присутня поверхня на події в момент `now`: `source` або `null`.
 * `null` до півночі (присутність ще не настала), якщо поверхня не показує подію,
 * відкрита пізніше ніж через 15 с після півночі або закрита до півночі.
 */
export function presenceOf(surface: PresenceSurface, now: Ms, event: PresenceEvent): PresenceSource | null {
  if (!surface.eventIds.includes(event.id)) return null;
  const t0 = midnightOf(event);
  if (now < t0) return null;
  if (surface.openedAt > t0 + STAMP_DELAY) return null;
  if (surface.closedAt !== undefined && surface.closedAt < t0) return null;
  // Відкрита після півночі (у пільговому інтервалі) — присутня лише з моменту відкриття.
  if (surface.openedAt > now) return null;
  return surface.source;
}

/** Момент, яким позначається присутність: північ або (у пільговому інтервалі) відкриття поверхні. */
export function presenceMoment(surface: PresenceSurface, event: PresenceEvent): Ms {
  return Math.max(midnightOf(event), surface.openedAt);
}

/** Пріоритет джерела, коли подію показують кілька поверхонь одночасно. */
const PRIORITY: Readonly<Record<PresenceSource, number>> = { country: 4, room: 3, air: 2, tv: 1 };

/**
 * Присутність за подіями з кількох поверхонь у момент `at` (для `EngineScheduler.getPresence`).
 * `events` — подія за id (лише ті, що передано, перевіряються).
 */
export function presentEvents(
  surfaces: readonly PresenceSurface[],
  events: readonly PresenceEvent[],
  at: Ms,
): Record<string, PresenceSource> {
  const out: Record<string, PresenceSource> = {};
  for (const event of events) {
    for (const s of surfaces) {
      const src = presenceOf(s, at, event);
      if (src && (!out[event.id] || PRIORITY[src] > PRIORITY[out[event.id]!])) out[event.id] = src;
    }
  }
  return out;
}

/** Момент видачі штампа за подію з північчю `m`: завжди `m + STAMP_DELAY`, незалежно від моменту присутності (AC-26). */
export function stampGrantedAt(m: Ms): Ms {
  return m + STAMP_DELAY;
}

/** Остання мить, коли сервер ще приймає присутність для штампа: `m + STAMP_DELAY + Δ` (включно). */
export function stampAcceptUntil(m: Ms, delta = 0): Ms {
  assertTolerance(delta);
  return m + STAMP_DELAY + delta;
}

export interface PulsePresenceInput {
  /** Північ події `m` (серверний час). */
  readonly moment: Ms;
  /** Пульси суб’єкта з цією подією. */
  readonly pulses: readonly Pulse[];
  /** Інтервал пульсу `I`, мс (> 0). */
  readonly intervalMs: number;
  /** Допуск годинника Δ, мс (≥ 0); типово 0. */
  readonly delta?: number;
}

/**
 * Серверне правило присутності за пульсами (FR-STAMP-03): присутній тоді й лише тоді, коли хоча б один серверний час
 * отримання пульсу (`receivedAt`) лежить у закритому вікні `[m − 2·I − Δ; m + 15 с + Δ]`.
 * Клієнтські поля часу пульсу (усе, крім `receivedAt`) — недовірені підказки: правило їх не читає, тож вони не можуть
 * розширити вікно (AC-25). `RangeError` — для від’ємного чи не скінченного Δ або не додатного I (AC-22).
 */
export function isPresentByPulses({ moment, pulses, intervalMs, delta = 0 }: PulsePresenceInput): boolean {
  assertTolerance(delta);
  assertPulseInterval(intervalMs);
  const from = moment - 2 * intervalMs - delta;
  const until = stampAcceptUntil(moment, delta);
  return pulses.some((p) => p.receivedAt >= from && p.receivedAt <= until);
}
