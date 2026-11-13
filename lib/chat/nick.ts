/**
 * Перевірка ніка для O-NICK (US4, FR-051): 2–20 символів, без посилань; «зайнятий» і «заборонений» — стани вікна.
 * У цій області «зайнятий» — збіг з ніком когось із сценарію чату, «заборонений» — службові слова.
 */
import { hasLink, NICK_MAX, NICK_MIN } from './send';

export type NickIssue = 'short' | 'long' | 'link' | 'taken' | 'forbidden';

const FORBIDDEN = ['admin', 'moderator', 'time2fest', 'адмін', 'модератор', 'підтримка', 'support'];

export function validateNick(raw: string, takenNicks: readonly string[] = []): NickIssue | null {
  const nick = raw.trim();
  if (nick.length < NICK_MIN) return 'short';
  if (nick.length > NICK_MAX) return 'long';
  if (hasLink(nick)) return 'link';
  const lower = nick.toLowerCase();
  if (FORBIDDEN.some((w) => lower.includes(w))) return 'forbidden';
  if (takenNicks.some((n) => n.toLowerCase() === lower)) return 'taken';
  return null;
}
