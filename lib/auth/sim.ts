/**
 * Імітація входу без бекенда (рішення 2026-10-29; без коду з листа — рішення власника 2026-10-30):
 * нова адреса — акаунт створюється й людина входить одразу (лист «ти увійшов» з посиланням для інших пристроїв);
 * адреса, на яку вже є акаунт, — лише посилання з листа. Google — одразу успішний (або «скасовано» з машини часу).
 * Справжні Google, листи й сесії — у технічному завданні.
 * Правила посилання: лист діє 15 хвилин і спрацьовує раз; новий лист — не частіше ніж раз на хвилину;
 * не більше 3 листів за 10 хвилин (далі «Забагато спроб» до часу, коли найстаріший лист вийде з вікна).
 */
export const LETTER_TTL_MS = 15 * 60_000;
export const RESEND_GAP_MS = 60_000;
export const SEND_LIMIT = 3;
export const SEND_WINDOW_MS = 10 * 60_000;
/** Адреса імітованого акаунта Google. */
export const GOOGLE_DEMO_EMAIL = 'you@gmail.com';
/** Ім’я, яке віддає імітований Google (у крок «Як тебе показувати» йде лише перше слово). */
export const GOOGLE_DEMO_NAME = 'Олена Коваленко';
/** Скільки триває імітований перехід до Google. */
export const GOOGLE_DELAY_MS = 1_500;

export type AuthIntent = 'signin' | 'signup';

/** Проста перевірка: щось@домен.зона, без пробілів. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function randomDigits(n: number): string {
  let out = '';
  try {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    for (const v of buf) out += String(v % 10);
    return out;
  } catch {
    for (let i = 0; i < n; i++) out += String(Math.floor(Math.random() * 10));
    return out;
  }
}

export function newToken(): string {
  return randomDigits(12);
}
