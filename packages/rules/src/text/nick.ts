/**
 * Перевірка ніка (US4, FR-051): 2–20 символів, без посилань; «зайнятий» і «заборонений» — стани вікна.
 * «Заборонений» — службові слова і невидимі символи (S11-08).
 */
import { hasLink } from './links';
import { NICK_MAX, NICK_MIN } from './limits';

export type NickIssue = 'short' | 'long' | 'link' | 'taken' | 'forbidden';

export const NICK_SERVICE_WORDS: readonly string[] = ['admin', 'moderator', 'time2fest', 'адмін', 'модератор', 'підтримка', 'support'];

/**
 * Invisible characters (S11-08): format characters (`\p{Cf}`: zero-width space/joiners, bidi controls, BOM, word
 * joiner, tags) and control characters. `Ліра` + U+200B would look like `Ліра` in chat under another key. A zero-width
 * joiner BETWEEN two pictographs (an emoji sequence) is allowed.
 */
const INVISIBLE = /(?!(?<=\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic}))[\p{Cf}\p{Cc}\u2028\u2029]/u;

export function hasInvisible(raw: string): boolean {
  return INVISIBLE.test(raw);
}

export function validateNick(raw: string, takenNicks: readonly string[] = []): NickIssue | null {
  const nick = raw.trim();
  if (hasInvisible(nick)) return 'forbidden';
  if (nick.length < NICK_MIN) return 'short';
  if (nick.length > NICK_MAX) return 'long';
  if (hasLink(nick)) return 'link';
  const lower = nick.toLowerCase();
  if (NICK_SERVICE_WORDS.some((w) => lower.includes(w))) return 'forbidden';
  if (takenNicks.some((n) => n.toLowerCase() === lower)) return 'taken';
  return null;
}
