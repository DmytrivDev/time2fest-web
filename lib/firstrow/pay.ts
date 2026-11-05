/**
 * Імітована оплата «Першого ряду» і переходи місця (T112, `data-model.md` 1.7, EXPERIENCE O-FIRST-ROW / O-PAY).
 * Усе тут — чисті функції над `GuestFirstRowEntry`; запис у `guest.firstRow` робить `stores/firstRow`.
 *
 * Переходи: `free → held` (`startHold`) → `taken` (`settle('success')`); прямого `free → taken` немає.
 * Утримання — `HOLD_MS` (10 хв), продовжити можна один раз на `HOLD_EXTENSION` (5 хв, припущення data-model 1.7).
 * Одне місце на гостя на подію. Результат за замовчуванням — `success`; у тестовій збірці перемикається
 * `window.__t2f.setPayResult` / панеллю часу (`stores/testControls`).
 */
import type { GuestFirstRowEntry, Ms, PayResult } from '@/lib/data/types';
import { HOLD_EXTENSION, HOLD_MS } from '@/lib/engine/config';

/** Що показує вікно «Першого ряду». `declined` і `expired` — та сама форма з рядком причини. */
export type PayPhase = 'form' | 'pending' | 'success' | 'declined' | 'soldout' | 'expired' | 'edit';

/** Ціна місця, USD (`FIRSTROW_PRICE`). */
export type Price = number;

/** Зміна емоції — не частіше ніж раз на 10 с (O-EMOJI). */
export const EMOJI_COOLDOWN_MS = 10_000;
/** «Чекаємо підтвердження оплати» в імітації: після стількох мс (часу сайту) — підтверджено. */
export const PENDING_CONFIRM_MS = 30_000;
/** Імітований перехід на PayPro і назад (реальний час, мс). */
export const PAY_ROUNDTRIP_MS = 900;

export type HoldError = 'has-seat' | 'no-seat';

/** `free → held`: нове утримання на 10 хв, ціна фіксується. Одне місце на гостя. */
export function startHold(
  entry: GuestFirstRowEntry,
  seat: number | undefined,
  now: Ms,
  price: Price,
): { ok: true; entry: GuestFirstRowEntry } | { ok: false; error: HoldError } {
  if (entry.seat !== undefined) return { ok: false, error: 'has-seat' };
  if (seat === undefined) return { ok: false, error: 'no-seat' };
  return { ok: true, entry: { ...entry, hold: { seat, until: now + HOLD_MS, extended: false }, priceLocked: price } };
}

export function holdActive(entry: GuestFirstRowEntry | undefined, now: Ms): boolean {
  return !!entry?.hold && entry.seat === undefined && entry.hold.until > now;
}

/** Продовжити утримання — один раз; повторний виклик нічого не змінює. */
export function extendHold(entry: GuestFirstRowEntry, now: Ms): GuestFirstRowEntry {
  const h = entry.hold;
  if (!h || h.extended || h.until <= now || entry.seat !== undefined) return entry;
  return { ...entry, hold: { ...h, until: h.until + HOLD_EXTENSION, extended: true } };
}

/** `held → free` (час вийшов, «Скасувати», розпродано). Дані форми лишаються. */
export function releaseHold(entry: GuestFirstRowEntry): GuestFirstRowEntry {
  const rest = { ...entry };
  delete rest.hold;
  delete rest.priceLocked;
  return rest;
}

export interface SettleContext {
  now: Ms;
  /** Місце гостя зайняв інший покупець (`simulateSeats().holdLost`). */
  holdLost?: boolean;
}

export interface SettleOutcome {
  phase: Exclude<PayPhase, 'form' | 'edit'>;
  entry: GuestFirstRowEntry;
}

/**
 * Результат імітованої оплати.
 * - `success` — `held → taken` (лише з активним утриманням; інакше — `expired`, а без місця — `soldout`);
 * - `pending` — утримання лишається, місце видається після підтвердження (`confirmPending`);
 * - `declined` — гроші не списано, утримання й дані лишаються;
 * - `soldout` — утримання знято, дані лишаються;
 * - `expired` — утримання знято (повернулися зі сторінки оплати, коли час вийшов).
 */
export function settle(result: PayResult, entry: GuestFirstRowEntry, ctx: SettleContext): SettleOutcome {
  if (entry.seat !== undefined) return { phase: 'success', entry };
  const active = holdActive(entry, ctx.now);
  if (result === 'soldout' || ctx.holdLost) return { phase: 'soldout', entry: releaseHold(entry) };
  if (result === 'expired' || !active) return { phase: 'expired', entry: releaseHold(entry) };
  switch (result) {
    case 'success':
      return { phase: 'success', entry: takeSeat(entry) };
    case 'pending':
      return { phase: 'pending', entry };
    case 'declined':
      return { phase: 'declined', entry };
  }
}

/** Оплату в очікуванні підтверджено: місце видається навіть якщо утримання саме щойно минуло. */
export function confirmPending(entry: GuestFirstRowEntry, ctx: SettleContext): SettleOutcome {
  if (entry.seat !== undefined) return { phase: 'success', entry };
  if (!entry.hold || ctx.holdLost) return { phase: 'soldout', entry: releaseHold(entry) };
  return { phase: 'success', entry: takeSeat(entry) };
}

function takeSeat(entry: GuestFirstRowEntry): GuestFirstRowEntry {
  const rest = releaseHold(entry);
  return { ...rest, seat: entry.hold!.seat };
}

/** Секунд до наступної дозволеної зміни емоції (0 — можна). */
export function emojiWaitSec(lastChangedAt: Ms | null | undefined, now: Ms): number {
  if (lastChangedAt === null || lastChangedAt === undefined) return 0;
  const left = lastChangedAt + EMOJI_COOLDOWN_MS - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Змінити емоцію учасника; `null`, якщо ще не минуло 10 с. */
export function changeEmoji(
  entry: GuestFirstRowEntry,
  emojiId: string,
  now: Ms,
  lastChangedAt: Ms | null | undefined,
): GuestFirstRowEntry | null {
  if (emojiWaitSec(lastChangedAt, now) > 0) return null;
  const draft = entry.draft ?? { name: '', greeting: '' };
  return { ...entry, draft: { ...draft, emojiId } };
}

// ── Поля форми ─────────────────────────────────────────────────────────────

/** Ім’я на стіні — як нік у чаті: від 2 до 20 символів (рішення 2026-10-29). */
export const NAME_MIN = 2;
export const NAME_MAX = 20;
export const GREETING_MAX = 84;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|ua|io|me|xyz)\b)/i;

export interface FormErrors {
  email?: 'email';
  name?: 'name';
  greeting?: 'moderation';
}

/** Перевірка перед «Оплатити». Модерація привітання імітується: посилання не проходять. */
export function validateForm(v: { email: string; name: string; greeting: string }): FormErrors {
  const errors: FormErrors = {};
  if (!EMAIL_RE.test(v.email.trim())) errors.email = 'email';
  if (v.name.trim().length < NAME_MIN || v.name.length > NAME_MAX) errors.name = 'name';
  if (v.greeting.length > GREETING_MAX || LINK_RE.test(v.greeting)) errors.greeting = 'moderation';
  return errors;
}

/** Ціна до оплати: знижка пасу −50% (округлення вниз до цента) лише з купленим пасом. */
export function payAmount(price: Price, discounted: number | undefined): number {
  return discounted ?? price;
}
