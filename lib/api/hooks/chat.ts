'use client';

/**
 * Хуки домену «Чат» (`docs/backend/frontend-seam.md`, E5a) — єдине, що бачать компоненти чату й сторінки.
 * Стрічка кімнати — ресурс кешу з `peek` (без порожнього кадру), живе подіями `subscribeRoom`. Стан з’єднання й
 * повільний режим — синхронні знімки сервісу з підпискою. Дії повертають `ApiResult`; перевірки тексту й ніку поле
 * робить саме (чисті `lib/chat/send`, `lib/chat/nick`) — сервіс перевіряє ще раз.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { applyChatEvent, type ChatConnection, type ChatEvent, type ChatSendRequest } from '../contracts/chat';
import { createResource, useResource, type Resource } from '../resource';
import { getService } from '../services';
import type { Author, ChatMessage, Ms, ReactionId, RoomId } from '@/lib/data/types';

const EMPTY: readonly ChatMessage[] = [];
const rooms = new Map<RoomId, Resource<readonly ChatMessage[]>>();

/** Ресурс стрічки кімнати (один на кімнату, на всю вкладку). */
export function roomResource(room: RoomId): Resource<readonly ChatMessage[]> {
  let r = rooms.get(room);
  if (!r) {
    r = createResource<readonly ChatMessage[], ChatEvent>(() => {
      const svc = getService('chat');
      return {
        load: () => svc.history(room),
        subscribe: (cb) => svc.subscribeRoom(room, cb),
        reduce: applyChatEvent,
        peek: () => svc.peekRoom?.(room),
      };
    });
    rooms.set(room, r);
  }
  return r;
}

/** Повідомлення кімнати в порядку `(createdAt, id)`. */
export function useRoomMessages(room: RoomId): readonly ChatMessage[] {
  return useResource(roomResource(room)).data ?? EMPTY;
}

// ── Кімнати сторінки ────────────────────────────────────────────────────────
const pageRooms = new Map<RoomId, number>();
const pageListeners = new Set<() => void>();
function changePageRooms(room: RoomId, delta: 1 | -1): void {
  const n = (pageRooms.get(room) ?? 0) + delta;
  if (n > 0) pageRooms.set(room, n);
  else pageRooms.delete(room);
  pageListeners.forEach((l) => l());
}

/**
 * Кімнати, які показує сторінка (чат «Світ», країна): їхні стрічки живі, поки сторінка відкрита (у `sim` підписка
 * ще й «вмикає» імітацію кімнати). Раніше — `useChatSimulator(rooms)`.
 */
export function useChatRooms(list: readonly RoomId[]): void {
  const key = list.join('|');
  useEffect(() => {
    if (!key) return;
    const ids = key.split('|') as RoomId[];
    const offs = ids.map((room) => {
      const off = roomResource(room).subscribe(noop);
      changePageRooms(room, 1);
      return () => {
        off();
        changePageRooms(room, -1);
      };
    });
    return () => offs.forEach((off) => off());
  }, [key]);
}

let pageSnap: readonly (readonly ChatMessage[])[] = [];
function pageSnapshot(): readonly (readonly ChatMessage[])[] {
  const lists = [...pageRooms.keys()].sort().map((r) => roomResource(r).getSnapshot().data ?? EMPTY);
  if (lists.length !== pageSnap.length || lists.some((l, i) => l !== pageSnap[i])) pageSnap = lists;
  return pageSnap;
}
function subscribePage(cb: () => void): () => void {
  const offs = new Map<RoomId, () => void>();
  const sync = () => {
    for (const r of pageRooms.keys()) if (!offs.has(r)) offs.set(r, roomResource(r).subscribe(cb));
    for (const [r, off] of offs) if (!pageRooms.has(r)) {
      off();
      offs.delete(r);
    }
  };
  const onRooms = () => {
    sync();
    cb();
  };
  sync();
  pageListeners.add(onRooms);
  return () => {
    pageListeners.delete(onRooms);
    offs.forEach((off) => off());
  };
}
const NO_LISTS: readonly (readonly ChatMessage[])[] = [];

/** Стрічки всіх кімнат сторінки (лічильник відповідей мені, поки чат сховано). */
export function usePageRoomsMessages(): readonly (readonly ChatMessage[])[] {
  return useSyncExternalStore(subscribePage, pageSnapshot, () => NO_LISTS);
}

const noop = () => undefined;

/** Стан з’єднання кімнати («Чат тимчасово недоступний»). */
export function useChatConnection(room: RoomId): ChatConnection {
  // Стала функція підписки: інакше кожен рендер перепідписував би кімнату (і перезапускав імітацію).
  const subscribe = useCallback((cb: () => void) => getService('chat').subscribeRoom(room, noop, cb), [room]);
  return useSyncExternalStore(subscribe, () => getService('chat').connection(room), () => 'ok' as const);
}

/** Повільний режим кімнати на мить `at`, с. */
export function useSlowModeSeconds(room: RoomId, at: Ms): number {
  const subscribe = useCallback(
    (cb: () => void) => getService('chat').subscribeRoom(room, (e) => (e.type === 'slow-mode' ? cb() : undefined)),
    [room],
  );
  return useSyncExternalStore(subscribe, () => getService('chat').slowModeSeconds(room, at), () => 0);
}

export const chatActions = {
  send: (req: ChatSendRequest) => getService('chat').send(req),
  react: (room: RoomId, id: string, reaction: ReactionId, on: boolean) => getService('chat').react(room, id, reaction, on),
  remove: (room: RoomId, id: string) => getService('chat').remove(room, id),
  report: (room: RoomId, id: string) => getService('chat').report(room, id),
  translate: (id: string, text: string, from: string, to: string) => getService('chat').translate(id, text, from, to),
  /** Повільний режим кімнати на мить `at`, с (синхронно — для перевірки поля перед відправленням). */
  slowSeconds: (room: RoomId, at: Ms) => getService('chat').slowModeSeconds(room, at),
  /** Стан з’єднання кімнати (синхронно). */
  connection: (room: RoomId) => getService('chat').connection(room),
  /** Ніки-підказки «зайнято» для поля ніку (синхронно). */
  takenNicks: () => getService('chat').takenNickHints(),
  /** Шлях іншого автора для картки (з кешу; `undefined` — ще немає). */
  authorPath: (author: Author, at: Ms) => getService('chat').authorPath(author, at),
} as const;

/** Інструменти тестової панелі (лише `sim`). */
export const chatDev = {
  emitReply: (at: Ms) => getService('chat').dev?.emitReplyToMe(at) ?? null,
  forcedSlowNotice: (room: RoomId, at: Ms) => getService('chat').dev?.forcedSlowNotice(room, at),
} as const;
