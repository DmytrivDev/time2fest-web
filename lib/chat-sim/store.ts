/**
 * Стрічки кімнат імітатора (пам’ять вкладки, не зберігається). Імітатор і власні повідомлення гостя (US4)
 * дописують сюди; `Chat` читає `useChatMessages(room)`. Повідомлення не мутуються, крім `reactions`, `moderation`
 * і видалення автором (`remove`, `applyDeletions`).
 */
import { create } from 'zustand';
import type { ChatMessage, ReactionId, RoomId } from '@/lib/data/types';
import { toggleReaction } from './send';
import { compareMessages } from './simulator';

/** Скільки повідомлень тримати в кімнаті. */
export const ROOM_HISTORY = 200;

export interface ChatFeedState {
  rooms: Partial<Record<RoomId, ChatMessage[]>>;
  append(messages: readonly ChatMessage[]): void;
  /** Замінити повідомлення (реакції, модерація) за `id`. */
  update(room: RoomId, id: string, patch: Pick<Partial<ChatMessage>, 'reactions' | 'moderation'>): void;
  /** Поставити/зняти реакцію гостя (лише на цьому пристрої). */
  react(room: RoomId, id: string, reaction: ReactionId, on: boolean): void;
  /** Автор видаляє повідомлення назавжди: текст, реакції й цитата зникають, лишається рядок «видалено». */
  remove(room: RoomId, id: string): void;
  /** Імітатор: видалити повідомлення інших людей, чий `deleteAt` настав. */
  applyDeletions(now: number): void;
  reset(): void;
}

export const useChatFeed = create<ChatFeedState>()((set) => ({
  rooms: {},
  append: (messages) =>
    set((s) => {
      if (!messages.length) return s;
      const rooms = { ...s.rooms };
      const byRoom = new Map<RoomId, ChatMessage[]>();
      for (const m of messages) byRoom.set(m.room, [...(byRoom.get(m.room) ?? []), m]);
      for (const [room, incoming] of byRoom) {
        const current = rooms[room] ?? [];
        const seen = new Set(current.map((m) => m.id));
        const fresh = incoming.filter((m) => !seen.has(m.id));
        if (!fresh.length) continue;
        rooms[room] = [...current, ...fresh].sort(compareMessages).slice(-ROOM_HISTORY);
      }
      return { rooms };
    }),
  update: (room, id, patch) =>
    set((s) => {
      const list = s.rooms[room];
      if (!list) return s;
      return { rooms: { ...s.rooms, [room]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)) } };
    }),
  react: (room, id, reaction, on) =>
    set((s) => {
      const list = s.rooms[room];
      if (!list) return s;
      return {
        rooms: { ...s.rooms, [room]: list.map((m) => (m.id === id ? { ...m, reactions: toggleReaction(m.reactions, reaction, on) } : m)) },
      };
    }),
  remove: (room, id) =>
    set((s) => {
      const list = s.rooms[room];
      if (!list) return s;
      return { rooms: { ...s.rooms, [room]: list.map((m) => (m.id === id ? deletedCopy(m) : m)) } };
    }),
  applyDeletions: (now) =>
    set((s) => {
      let changed = false;
      const rooms = { ...s.rooms };
      for (const [room, list] of Object.entries(s.rooms) as [RoomId, ChatMessage[]][]) {
        if (!list.some((m) => !m.deleted && m.deleteAt !== undefined && m.deleteAt <= now)) continue;
        changed = true;
        rooms[room] = list.map((m) => (!m.deleted && m.deleteAt !== undefined && m.deleteAt <= now ? deletedCopy(m) : m));
      }
      return changed ? { rooms } : s;
    }),
  reset: () => set({ rooms: {} }),
}));

/** Видалене повідомлення: лишаються автор і час (для рядка «видалено»), вміст — ні. */
function deletedCopy(m: ChatMessage): ChatMessage {
  return { id: m.id, room: m.room, kind: m.kind, createdAt: m.createdAt, author: m.author, moderation: m.moderation, deleted: true };
}

const EMPTY: ChatMessage[] = [];

/** Повідомлення кімнати в порядку `(createdAt, id)`. */
export function useChatMessages(room: RoomId): ChatMessage[] {
  return useChatFeed((s) => s.rooms[room] ?? EMPTY);
}
