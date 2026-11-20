/**
 * Перевірка ніка (US4, FR-051): 2–20 символів, без посилань; «зайнятий» і «заборонений» — стани вікна.
 * «Заборонений» — службові слова.
 */
import { hasLink } from './links';
import { NICK_MAX, NICK_MIN } from './limits';

export type NickIssue = 'short' | 'long' | 'link' | 'taken' | 'forbidden';

export const NICK_SERVICE_WORDS: readonly string[] = ['admin', 'moderator', 'time2fest', 'адмін', 'модератор', 'підтримка', 'support'];

export function validateNick(raw: string, takenNicks: readonly string[] = []): NickIssue | null {
  const nick = raw.trim();
  if (nick.length < NICK_MIN) return 'short';
  if (nick.length > NICK_MAX) return 'long';
  if (hasLink(nick)) return 'link';
  const lower = nick.toLowerCase();
  if (NICK_SERVICE_WORDS.some((w) => lower.includes(w))) return 'forbidden';
  if (takenNicks.some((n) => n.toLowerCase() === lower)) return 'taken';
  return null;
}
