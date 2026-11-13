/**
 * Фільтр тосту (рішення власника 2026-11-12, дошки `Desk-Toast-New`, `Phone-Toast-New`): текст пишуть ДО оплати, а
 * перевіряють на «Оплатити» — гроші не беремо за тост, який не покажемо. Посилання — та сама перевірка, що в чаті
 * (`lib/chat-sim/send.ts`: `findLink`), плюс контакти (пошта, телефон, @нік) і слова, які ми не показуємо.
 * Повертає вид і місце першої проблеми — його вікно підкреслює хвилястою лінією.
 */
import { findLink } from '@/lib/chat/send';

export type ToastIssueKind = 'link' | 'contact' | 'word';

export interface ToastIssue {
  kind: ToastIssueKind;
  start: number;
  end: number;
}

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/u;
const PHONE = /\+?\d[\d\s()-]{7,}\d/;
const HANDLE = /(?:^|[^\p{L}\d])(@[\p{L}\d_.]{3,})/u;
/** Корені слів, яких у тості не показуємо (лайка). Перевірка — без урахування регістру, усередині слова теж. */
const WORDS = ['хуй', 'хуя', 'хує', 'пизд', 'їбан', 'йоб', 'єба', 'ебат', 'ебан', 'бляд', 'сука', 'суки', 'fuck', 'shit', 'bitch', 'cunt', 'dick'];

function at(re: RegExp, text: string, group = 0): { start: number; end: number } | null {
  const m = re.exec(text);
  if (!m) return null;
  const part = m[group] ?? m[0];
  const start = m.index + m[0].indexOf(part);
  return { start, end: start + part.length };
}

/** Перша проблема в тексті тосту; `null` — можна оплачувати. Порожній текст відсікає сама кнопка. */
export function checkToastText(text: string): ToastIssue | null {
  const link = findLink(text);
  const email = at(EMAIL, text);
  // Пошта схожа й на посилання (домен) — показуємо як контакт, підкреслюючи всю адресу.
  if (email && (!link || link.start >= email.start)) return { kind: 'contact', ...email };
  if (link) return { kind: 'link', ...link };
  const phone = at(PHONE, text);
  if (phone) return { kind: 'contact', ...phone };
  const handle = at(HANDLE, text, 1);
  if (handle) return { kind: 'contact', ...handle };
  const lower = text.toLowerCase();
  for (const w of WORDS) {
    const i = lower.indexOf(w);
    if (i < 0) continue;
    // Підкреслюємо слово цілком.
    let start = i;
    let end = i + w.length;
    while (start > 0 && /[\p{L}\d]/u.test(text[start - 1]!)) start--;
    while (end < text.length && /[\p{L}\d]/u.test(text[end]!)) end++;
    return { kind: 'word', start, end };
  }
  return null;
}
