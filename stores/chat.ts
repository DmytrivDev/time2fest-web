/**
 * Стан інтерфейсу чату (US4, пам’ять вкладки, не зберігається): відповідь на повідомлення, момент, з якого рахуємо
 * нові повідомлення, поки чат сховано («Чат 99+»).
 * Що зберігається на пристрої — у `stores/guest` (`chatHidden`, `chat.lastRoom`, `chat.sentAt`, нік і прапор).
 */
import { create } from 'zustand';
import type { Ms, RoomId } from '@/lib/data/types';
import { useMemo } from 'react';
import { useChatConnection, usePageRoomsMessages, useRoomMessages } from '@/lib/api/hooks/chat';
import { useChatPref } from './chatPrefs';
import { useGuestStore } from './guest';

export interface ReplyDraft {
  id: string;
  room: RoomId;
  nick: string;
  excerpt: string;
}

export interface ChatUiState {
  /** Текст у полі введення: переживає перемикання вкладок і вікно ніка. */
  draft: string;
  setDraft(value: string | ((prev: string) => string)): void;
  replyTo: ReplyDraft | null;
  hiddenAt: Ms | null;
  setReplyTo(reply: ReplyDraft | null): void;
  markHidden(at: Ms | null): void;
  reset(): void;
}

export const useChatUi = create<ChatUiState>()((set) => ({
  draft: '',
  setDraft: (value) => set((s) => ({ draft: typeof value === 'function' ? value(s.draft) : value })),
  replyTo: null,
  hiddenAt: null,
  setReplyTo: (replyTo) => set({ replyTo }),
  markHidden: (hiddenAt) => set({ hiddenAt }),
  reset: () => set({ draft: '', replyTo: null, hiddenAt: null }),
}));

/** Скільки повідомлень кімнати прийшло, відколи чат сховано (власні не рахуємо). */
export function useHiddenCount(room: RoomId): number {
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  // Поки чат недоступний, лічильника немає (повідомлень не видно). Стрічка й стан — через шов чату (E5a).
  const available = useChatConnection(room) !== 'unavailable';
  const list = useRoomMessages(room);
  return useMemo(() => {
    if (hiddenAt === null || !available) return 0;
    let n = 0;
    for (const m of list) if (m.createdAt > hiddenAt && !m.author?.isMine && m.kind !== 'system') n += 1;
    return n;
  }, [hiddenAt, available, list]);
}

/**
 * Скільки разів тобі відповіли, відколи чат сховано чи згорнуто («Сповіщати про відповіді», функція пасу).
 * Рахуємо в усіх кімнатах сторінки; відкрили чат — `hiddenAt` скидається, і позначка зникає.
 */
export function useRepliesToMe(room: RoomId): number {
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  const on = useChatPref('notifyReplies');
  const nick = useGuestStore((s) => s.nick);
  const pageLists = usePageRoomsMessages();
  const own = useRoomMessages(room);
  return useMemo(() => {
    if (!on || hiddenAt === null || !nick) return 0;
    let n = 0;
    // Кімнати сторінки й кімната цього чату (без повторів).
    for (const list of pageLists.includes(own) ? pageLists : [...pageLists, own]) {
      for (const m of list) if (m.createdAt > hiddenAt && !m.author?.isMine && m.replyTo?.nick === nick) n += 1;
    }
    return n;
  }, [on, hiddenAt, nick, pageLists, own]);
}

/** «99+» для лічильника на кнопці. */
export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}
