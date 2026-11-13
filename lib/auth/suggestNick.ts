/**
 * Нік, який підставляємо в кроці «Як тебе показувати» після створення акаунта (рішення власника 2026-11-08):
 * гостьовий нік з чату → ім’я з Google (лише перше слово) → перше слово з пошти до «@» (слова за «.», «_», «-», «+»;
 * лише літери, щонайменше 2, з великої, до 20 символів) → `null` (тоді — «Гість NNNN»).
 * Усю частину пошти до «@» не показуємо ніколи: прізвище й рік лишаються приватними.
 */
import { validateNick } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';

const cap = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1);

/** Перше «слово» з ≥ 2 літер; цифри й символи відкидаються. */
function firstWord(parts: string[]): string | null {
  for (const p of parts) {
    const letters = p.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 2) return cap(letters.toLocaleLowerCase()).slice(0, NICK_MAX);
  }
  return null;
}

export function suggestNick({ email, googleName, chatNick }: { email: string; googleName?: string; chatNick?: string }): string | null {
  const ok = (n: string | null) => (n && !validateNick(n) ? n : null);
  if (chatNick && ok(chatNick.trim())) return chatNick.trim();
  if (googleName) {
    const g = ok(firstWord(googleName.trim().split(/\s+/)));
    if (g) return g;
  }
  const local = email.split('@')[0] ?? '';
  return ok(firstWord(local.split(/[._\-+]+/)));
}

/** «Гість 4821» — коли з пошти не вийшло імені. */
export function generatedNick(prefix: string, rand: () => number = Math.random): string {
  return `${prefix} ${1000 + Math.floor(rand() * 9000)}`;
}
