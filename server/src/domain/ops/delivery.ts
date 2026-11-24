/**
 * Правила доставки тривог у Telegram (SPEC-13b AC-4, AC-6, AC-7), ring 1 — чисті функції; час — параметр.
 *
 * - Повтори (AC-4): спроби через 5, 10 і 20 с від `raise`, далі кожні 60 с (80, 140, … с), доки спроба
 *   не пізніше 10 хв від `raise`; `429` — не раніше `retry_after` (≤300 с); `400` / `403` (`fatal`) — без повторів.
 * - Злиття (AC-6): той самий вид протягом 10 хв після надісланого повідомлення → лише лічильник повторів
 *   на тому рядку; наступне повідомлення виду несе «повторилось N разів».
 * - Шторм (AC-7): за 10 хв — не більше 20 повідомлень тривог; решта чекає підсумку на межі 10-хвилинного вікна.
 */
import type { AlarmDeliveryOutcome } from '../../alarms/ports';

const SEC = 1_000;
/** Зсуви перших повторів від `raise`, с. */
const FIRST_RETRY_OFFSETS_S: readonly number[] = [5, 10, 20];
/** Крок наступних повторів, с. */
const RETRY_STEP_S = 60;
/** Остання спроба — не пізніше цього від `raise` (10 хв). */
export const DELIVERY_WINDOW_MS = 600 * SEC;
/** Найдовше очікування за `retry_after` (5 хв). */
export const RETRY_AFTER_CAP_S = 300;
/** Вікно злиття повторів і вікно шторму (10 хв). */
export const COALESCE_WINDOW_MS = 600 * SEC;
export const STORM_WINDOW_MS = 600 * SEC;
/** Стеля повідомлень тривог за `STORM_WINDOW_MS`. */
export const STORM_CEILING = 20;

/** Зсув `n`-го повтору від `raise` (n = 1 — перший повтор), мс. */
export function retryOffsetMs(n: number): number {
  const first = FIRST_RETRY_OFFSETS_S[n - 1];
  if (first !== undefined) return first * SEC;
  const last = FIRST_RETRY_OFFSETS_S[FIRST_RETRY_OFFSETS_S.length - 1] ?? 0;
  return (last + (n - FIRST_RETRY_OFFSETS_S.length) * RETRY_STEP_S) * SEC;
}

export type NextAttempt =
  | { kind: 'delivered' }
  | { kind: 'retry'; at: number }
  | { kind: 'failed'; reason: 'fatal' | 'expired' };

/**
 * Що робити після спроби: `attempts` — скільки спроб уже зроблено, разом із цією (перша спроба — одразу
 * після `raise`); `now` — мить, коли прийшла відповідь. Наступна спроба ніколи не в минулому; якщо вона
 * виходить за 10 хв від `raise` — рядок остаточно не доставлено (AC-5).
 */
export function nextAttemptAt(input: {
  raisedAt: number;
  attempts: number;
  outcome: AlarmDeliveryOutcome;
  now: number;
}): NextAttempt {
  const { raisedAt, attempts, outcome, now } = input;
  if (outcome.result === 'ok') return { kind: 'delivered' };
  if (outcome.result === 'fatal') return { kind: 'failed', reason: 'fatal' };
  let at = Math.max(raisedAt + retryOffsetMs(attempts), now);
  if (outcome.retryAfterSec !== undefined && Number.isFinite(outcome.retryAfterSec) && outcome.retryAfterSec > 0) {
    at = Math.max(at, now + Math.min(outcome.retryAfterSec, RETRY_AFTER_CAP_S) * SEC);
  }
  if (at > raisedAt + DELIVERY_WINDOW_MS) return { kind: 'failed', reason: 'expired' };
  return { kind: 'retry', at };
}

/** Останній надісланий рядок того самого виду (з `Outbox.latestDeliveredOfKind`). */
export interface DeliveredOfKind {
  id: string;
  deliveredAt: number | null;
  repeatCount: number;
}

export type CoalesceDecision =
  | { action: 'repeat'; id: string }
  | { action: 'new'; repeatsSincePrevious: number };

/**
 * AC-6: підйом протягом 10 хв після надісланого повідомлення того самого виду → `repeat` (лічильник
 * на тому рядку); інакше новий рядок, що несе повтори попереднього повідомлення в текст.
 */
export function coalesce(previous: DeliveredOfKind | null, now: number): CoalesceDecision {
  if (previous === null || previous.deliveredAt === null) return { action: 'new', repeatsSincePrevious: 0 };
  if (now - previous.deliveredAt <= COALESCE_WINDOW_MS) return { action: 'repeat', id: previous.id };
  return { action: 'new', repeatsSincePrevious: Math.max(0, previous.repeatCount) };
}

/** AC-7: `deliveredInLast10Min` — повідомлень тривог (не контрольних) за останні 10 хв. */
export function stormGate(deliveredInLast10Min: number): 'send' | 'hold' {
  return deliveredInLast10Min < STORM_CEILING ? 'send' : 'hold';
}

/** Скільки ще тривог можна надіслати в поточному вікні. */
export function stormBudget(deliveredInLast10Min: number): number {
  return Math.max(0, STORM_CEILING - deliveredInLast10Min);
}

/** Початок 10-хвилинного вікна (за UTC-годинником) для `now`. */
export function stormWindowStart(now: number): number {
  return Math.floor(now / STORM_WINDOW_MS) * STORM_WINDOW_MS;
}

/** Ключ слоту підсумку шторму ([П-3]): `storm:<UTC ISO початку вікна>`. */
export function stormSlotKey(windowStart: number): string {
  return `storm:${new Date(windowStart).toISOString()}`;
}
