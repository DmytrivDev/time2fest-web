/**
 * Контракт домену «Чат» (`docs/backend/frontend-seam.md`, E5a; схема — `stack.md`, розділ 3): клієнт пише через
 * `chat-api` (HTTP), читає лише з Centrifugo (публікація з клієнта вимкнена). Модерація може прибрати повідомлення вже
 * після показу (подія `update` з `moderation: 'hidden'`).
 * Перевірки тексту й ніку — чиста логіка `lib/chat/` (`send.ts`, `nick.ts`): на клієнті — підказка (поле не чекає
 * сервера), остаточно перевіряє сервер тим самим переліком причин нижче.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { PathPoint } from '@/lib/chat/authorPath';
import { compareMessages, deletedCopy } from '@/lib/chat/message';
import type { Author, ChatMessage, Ms, ReactionId, RoomId } from '@/lib/data/types';

/** Причини відмови відправлення (`ApiError.reason`): `validation` — link-forbidden | too-long | nick-required | empty;
 *  `rate_limited` — slow-mode (`retryAfterMs`); `forbidden` — banned | room-forbidden; `unavailable` — чат вимкнено. */
export type ChatSendReason = 'nick-required' | 'link-forbidden' | 'too-long' | 'empty' | 'slow-mode' | 'banned' | 'room-forbidden';

/** Причини відмови ніку (`ApiError.reason` з кодом `validation`); `taken` знає лише сервер. */
export type NickReason = 'short' | 'long' | 'link' | 'taken' | 'forbidden';

export interface ChatSendRequest {
  /** Ідемпотентність: повтор з тим самим `clientId` не дублює повідомлення. */
  clientId: string;
  room: RoomId;
  text: string;
  replyToId?: string;
}

export type ChatEvent =
  /** Пакет нових повідомлень (сервер шле раз на 250–500 мс). */
  | { type: 'messages'; messages: readonly ChatMessage[] }
  /** Уся стрічка кімнати (після відновлення з’єднання без історії; `sim` шле лише її). */
  | { type: 'snapshot'; messages: readonly ChatMessage[] }
  /** Реакції чи модерація змінились. */
  | { type: 'update'; id: string; patch: Pick<Partial<ChatMessage>, 'reactions' | 'moderation'> }
  /** Автор видалив своє повідомлення. */
  | { type: 'deleted'; id: string }
  /** Повільний режим кімнати (0 — вимкнено). */
  | { type: 'slow-mode'; seconds: number };

export type ChatConnection = 'ok' | 'slow' | 'unavailable' | 'offline';

/** Шлях автора для картки O-AUTHOR (публічний профіль). */
export interface AuthorPathInfo {
  points: readonly PathPoint[];
  /** Автор сховав шлях у налаштуваннях. */
  hidden: boolean;
}

/** Скільки повідомлень кімнати тримає клієнт. */
export const ROOM_HISTORY = 200;

export interface ChatService {
  /** Останні повідомлення кімнати. `GET /api/chat/rooms/:room/history?limit=` (чи історія Centrifugo при підписці). */
  history(room: RoomId, opts?: { limit?: number }): Promise<ApiResult<readonly ChatMessage[]>>;
  /** Остання відома стрічка без запиту (кеш на пристрої) — перший кадр без порожнього чату. */
  peekRoom?(room: RoomId): readonly ChatMessage[] | undefined;
  /**
   * Realtime: `chat:world`, `chat:country.<ISO>`. `onConnection` — стан з’єднання для «Чат недоступний».
   * У `sim` підписка ще й «вмикає» імітацію кімнати (сервер у `http` пише в кімнату незалежно від глядачів).
   */
  subscribeRoom(room: RoomId, onEvent: (event: ChatEvent) => void, onConnection?: (state: ChatConnection) => void): Unsubscribe;
  /** Останній відомий стан з’єднання кімнати (синхронно; зміни — `onConnection`). */
  connection(room: RoomId): ChatConnection;
  /** Повільний режим кімнати на мить `at`, с (останній відомий; зміни — подія `slow-mode`). */
  slowModeSeconds(room: RoomId, at: Ms): number;
  /** `POST /chat/send` (`chat-api`). Повертає повідомлення, як його побачать інші (після нормалізації). */
  send(req: ChatSendRequest): Promise<ApiResult<ChatMessage>>;
  /** `POST /chat/react` `{ room, id, reaction, on }`. */
  react(room: RoomId, messageId: string, reaction: ReactionId, on: boolean): Promise<ApiResult<void>>;
  /** `DELETE /chat/messages/:id` — лише своє. */
  remove(room: RoomId, messageId: string): Promise<ApiResult<void>>;
  /** Скарга на повідомлення чи автора. `POST /chat/reports` `{ room, id }`. */
  report(room: RoomId, messageId: string): Promise<ApiResult<void>>;
  /** Переклад повідомлення (пас). `POST /api/chat/translate` — кеш на сервері за `messageId + to`. */
  translate(messageId: string, text: string, from: string, to: string): Promise<ApiResult<string>>;
  /** Перевірити нік до збереження (унікальність). `POST /api/chat/nick-check`. */
  checkNick(nick: string): Promise<ApiResult<void>>;
  /** Ніки, відомі як зайняті, для підказки під полем без запиту (у `http` — порожньо; остаточно — `checkNick`). */
  takenNickHints(): readonly string[];
  /**
   * Шлях автора (картка O-AUTHOR) з кешу на мить `at`; `undefined` — ще не завантажено (`http`:
   * `GET /api/chat/authors/:id/path`; потрібен вигляд завантаження картки — див. документ).
   */
  authorPath(author: Author, at: Ms): AuthorPathInfo | undefined;
  /** Лише `sim` у тестовій збірці: інструменти тестової панелі й `window.__t2f`. */
  dev?: {
    /** «Хтось відповів мені» (`emitReply`). */
    emitReplyToMe(at: Ms): ChatMessage | null;
    /** Перемикач «Повільний режим» увімкнено — системне повідомлення в кімнаті, як на початку вікна сценарію. */
    forcedSlowNotice(room: RoomId, at: Ms): void;
  };
}

/** Застосувати подію до стрічки кімнати (сервер і клієнт однаково): без дублів, за часом, останні `ROOM_HISTORY`. */
export function applyChatEvent(list: readonly ChatMessage[], event: ChatEvent): readonly ChatMessage[] {
  switch (event.type) {
    case 'snapshot':
      return event.messages;
    case 'messages': {
      const seen = new Set(list.map((m) => m.id));
      const fresh = event.messages.filter((m) => !seen.has(m.id));
      return fresh.length ? [...list, ...fresh].sort(compareMessages).slice(-ROOM_HISTORY) : list;
    }
    case 'update':
      return list.some((m) => m.id === event.id) ? list.map((m) => (m.id === event.id ? { ...m, ...event.patch } : m)) : list;
    case 'deleted':
      return list.some((m) => m.id === event.id) ? list.map((m) => (m.id === event.id ? deletedCopy(m) : m)) : list;
    default:
      return list;
  }
}
