/**
 * Стан інтерфейсу чату (US4, пам’ять вкладки, не зберігається): відповідь на повідомлення, момент, з якого рахуємо
 * нові повідомлення, поки чат сховано («Чат 99+»), остання зміна емоції (раз на 10 с).
 * Що зберігається на пристрої — у `stores/guest` (`chatHidden`, `chat.lastRoom`, `chat.sentAt`, нік і прапор).
 */
import { create } from 'zustand';
import type { Ms, RoomId } from '@/lib/data/types';
import { useChatFeed } from '@/lib/chat-sim/store';
import { useTestControls } from '@/stores/testControls';
import { useChatPref } from './chatPrefs';
import { useGuestStore } from './guest';

export interface ReplyDraft {
  id: string;
  room: RoomId;
  nick: string;
  excerpt: string;
}

/** Як часто можна міняти емоцію «Першого ряду», мс. */
export const EMOTION_COOLDOWN_MS = 10_000;

export interface ChatUiState {
  /** Текст у полі введення: переживає перемикання вкладок і вікно ніка. */
  draft: string;
  setDraft(value: string | ((prev: string) => string)): void;
  replyTo: ReplyDraft | null;
  hiddenAt: Ms | null;
  emotionChangedAt: Ms | null;
  setReplyTo(reply: ReplyDraft | null): void;
  markHidden(at: Ms | null): void;
  markEmotionChanged(at: Ms): void;
  reset(): void;
}

export const useChatUi = create<ChatUiState>()((set) => ({
  draft: '',
  setDraft: (value) => set((s) => ({ draft: typeof value === 'function' ? value(s.draft) : value })),
  replyTo: null,
  hiddenAt: null,
  emotionChangedAt: null,
  setReplyTo: (replyTo) => set({ replyTo }),
  markHidden: (hiddenAt) => set({ hiddenAt }),
  markEmotionChanged: (emotionChangedAt) => set({ emotionChangedAt }),
  reset: () => set({ draft: '', replyTo: null, hiddenAt: null, emotionChangedAt: null }),
}));

/** Скільки повідомлень кімнати прийшло, відколи чат сховано (власні не рахуємо). */
export function useHiddenCount(room: RoomId): number {
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  // Поки чат недоступний, лічильника немає (повідомлень не видно).
  const available = useTestControls((s) => s.chatAvailable);
  return useChatFeed((s) => {
    if (hiddenAt === null || !available) return 0;
    let n = 0;
    for (const m of s.rooms[room] ?? []) if (m.createdAt > hiddenAt && !m.author?.isMine && m.kind !== 'system') n += 1;
    return n;
  });
}

/**
 * Скільки разів тобі відповіли, відколи чат сховано чи згорнуто («Сповіщати про відповіді», функція пасу).
 * Рахуємо в усіх кімнатах; відкрили чат — `hiddenAt` скидається, і позначка зникає.
 */
export function useRepliesToMe(): number {
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  const on = useChatPref('notifyReplies');
  const nick = useGuestStore((s) => s.nick);
  return useChatFeed((s) => {
    if (!on || hiddenAt === null || !nick) return 0;
    let n = 0;
    for (const list of Object.values(s.rooms)) {
      for (const m of list ?? []) if (m.createdAt > hiddenAt && !m.author?.isMine && m.replyTo?.nick === nick) n += 1;
    }
    return n;
  });
}

/** «99+» для лічильника на кнопці. */
export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** Скільки секунд лишилось до наступної зміни емоції (0 — можна). */
export function emotionWaitSec(changedAt: Ms | null, now: Ms): number {
  if (changedAt === null || changedAt > now + EMOTION_COOLDOWN_MS) return 0;
  const left = changedAt + EMOTION_COOLDOWN_MS - now;
  return left > 0 ? Math.ceil(left / 1_000) : 0;
}
