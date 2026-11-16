/**
 * Тост у чаті «Світ» (рішення власника 2026-11-12, дошки `Desk-Toast-New`, `Phone-Toast-New`): золоте повідомлення з
 * позначкою «тост»; рівень (`toast.amount` — $2 / $5 / $10) визначає яскравість рамки й позначки під текстом. Суми в чаті
 * не показуємо. Свій тост — `author.isMine` (видно лише на цьому пристрої, як власні повідомлення імітатора).
 */
import type { AuthorBadge, ChatMessage, RoomId } from '@/lib/data/types';
import type { ToastRecord } from '@/lib/toast/feed';
import { messageId } from './message';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_048_576;
  return h;
}

/** Повідомлення тосту (імітованого чи свого) в кімнаті `room` («Світ» за замовчуванням). */
export function toastMessage(t: ToastRecord, ownId?: string, room: RoomId = 'world'): ChatMessage {
  const badges: AuthorBadge[] = t.pass ? ['pass'] : [];
  return {
    id: t.mine ? messageId(t.createdAt, 4_000, hashString(t.id), room) : room === 'world' ? t.id : `${t.id}:${room}`,
    room,
    kind: 'regular',
    createdAt: t.createdAt,
    author: { id: t.authorId ?? ownId ?? t.id, nick: t.nick, flagCode: t.flagCode, badges, ...(t.mine ? { isMine: true } : {}) },
    text: t.text.trim(),
    moderation: 'ok',
    toast: { amount: t.tier },
  };
}

/** Кімнати тосту: «Світ» і чати країн, де його сказано (`ToastRecord.countries`). */
export function toastRooms(t: Pick<ToastRecord, 'countries'>): RoomId[] {
  return ['world', ...(t.countries ?? []).map((iso) => `country:${iso}` as RoomId)];
}

/** Повідомлення тосту в усіх його кімнатах: один тост — кілька повідомлень, по одному на кімнату. */
export function toastMessages(t: ToastRecord, ownId?: string): ChatMessage[] {
  return toastRooms(t).map((room) => toastMessage(t, ownId, room));
}
