/**
 * Золотий тост за чайові (рішення власника 2026-11-01, «Тост у чаті»): власне повідомлення гостя в кімнаті «Світ»
 * з позначкою «тост». Оплата — наступний етап; поки тост з’являється одразу, лише на цьому пристрої (як власні
 * повідомлення імітатора).
 */
import type { ChatMessage, Ms } from '@/lib/data/types';
import { ownAuthor } from './send';
import { messageId } from './simulator';

export interface ToastInput {
  text: string;
  amount: number;
  now: Ms;
  guestId: string;
  nick?: string;
  flagCode?: string;
  hasPass: boolean;
}

export function buildToast({ text, amount, now, guestId, nick, flagCode, hasPass }: ToastInput): ChatMessage {
  return {
    id: messageId(now, 4_000, amount, 'world'),
    room: 'world',
    kind: 'regular',
    createdAt: now,
    author: ownAuthor({ guestId, nick, flagCode, hasPass }, 'world'),
    text: text.trim(),
    moderation: 'ok',
    toast: { amount },
  };
}
