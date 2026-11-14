/**
 * Імітація входу без бекенда. Пошта — лише код із 6 цифр (рішення власника 2026-11-13): людина вводить пошту, «сервер»
 * надсилає код, людина вписує його на тій самій сторінці. Посилань у листі й входу без підтвердження немає — і для нової
 * адреси, і для наявної, і для зміни пошти в кабінеті. Google — одразу успішний (або «скасовано» з машини часу).
 * Справжні Google, листи й сесії — у технічному завданні (Better Auth `emailOTP`).
 * Правила коду: діє 10 хвилин; 5 невдалих спроб — код згорає, потрібен новий; новий код — не частіше ніж раз на 30 с;
 * не більше 5 кодів за 10 хвилин (далі «Забагато спроб» до часу, коли найстаріший вийде з вікна).
 */
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_GAP_MS = 30_000;
export const SEND_LIMIT = 5;
export const SEND_WINDOW_MS = 10 * 60_000;
/** Адреса імітованого акаунта Google. */
export const GOOGLE_DEMO_EMAIL = 'you@gmail.com';
/** Ім’я, яке віддає імітований Google (у крок «Як тебе показувати» йде лише перше слово). */
export const GOOGLE_DEMO_NAME = 'Олена Коваленко';
/** Скільки триває імітований перехід до Google. */
export const GOOGLE_DELAY_MS = 1_500;

export type { AuthIntent } from '@/lib/api/contracts/auth';
// Чисті правила пошти — у `lib/auth/email.ts` (інтерфейс імпортує їх звідти, не з імітації).
export { isEmail, normalizeEmail } from './email';

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

/** Код із листа (6 цифр). */
export function newCode(): string {
  return randomDigits(CODE_LENGTH);
}
