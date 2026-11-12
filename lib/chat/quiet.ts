/**
 * Тихий режим чату (FR-38, функція пасу): ховає банальні привітання будь-якою мовою й лічильники однакових привітань,
 * лишає змістовні повідомлення. Ніколи не ховає свої повідомлення, відповіді тобі й повідомлення власників пасу,
 * «VIP» (FR-88), а також системні повідомлення, крім лічильника привітань.
 */
import type { ChatMessage } from '@/lib/data/types';

/** Банальні привітання (нижній регістр, без розділових знаків і емодзі). */
const GREETINGS = [
  'з новим роком',
  'зі новим роком',
  'вітаю з новим роком',
  'щасливого нового року',
  'happy new year',
  'bonne année',
  'feliz año nuevo',
  'feliz ano novo',
  'frohes neues jahr',
  'yeni yılınız kutlu olsun',
  'szczęśliwego nowego roku',
  'buon anno',
  '明けましておめでとう',
  '새해 복 많이 받으세요',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[!¡?.,;:…«»"'’()—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Банальне: привітання і щонайбільше два слова поруч («Happy New Year, everyone!», «З Новим роком!»). */
export function isBanalText(text: string | undefined): boolean {
  if (!text) return false;
  const n = normalize(text);
  if (!n) return true; // лише емодзі
  const hit = GREETINGS.find((g) => n.includes(g));
  if (!hit) return false;
  const rest = n.replace(hit, ' ').trim();
  return rest === '' || rest.split(' ').filter(Boolean).length <= 2;
}

/** Повідомлення, які тихий режим ховає. `myNick` — щоб не сховати відповідь тобі. */
export function isQuietHidden(m: ChatMessage, myNick?: string | null): boolean {
  if (m.kind === 'system') return m.system?.kind === 'greetings-counter';
  if (m.kind !== 'regular' || !m.author || m.author.isMine) return false;
  if (m.author.badges.length > 0) return false;
  if (myNick && m.replyTo?.nick === myNick) return false;
  return isBanalText(m.text);
}

/** Скільки привітань сховано: лічильник однакових привітань рахується повністю. */
export function quietHiddenCount(messages: readonly ChatMessage[], myNick?: string | null): number {
  let n = 0;
  for (const m of messages) {
    if (!isQuietHidden(m, myNick)) continue;
    n += m.kind === 'system' && m.system?.kind === 'greetings-counter' ? m.system.count : 1;
  }
  return n;
}
