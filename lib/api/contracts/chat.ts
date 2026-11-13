/**
 * Контракт домену «Чат» (`docs/backend/frontend-seam.md`; схема — `stack.md`, розділ 3): клієнт пише через `chat-api`
 * (HTTP), читає лише з Centrifugo (публікація з клієнта вимкнена). Модерація може прибрати повідомлення вже після показу
 * (подія `update` з `moderation: 'hidden'`).
 * Перевірки тексту й ніку, які зараз живуть у `lib/chat-sim/send.ts` і `nick.ts`, — чиста логіка: переїжджають у
 * `lib/chat/` і працюють на клієнті як підказка, а остаточно перевіряє сервер (той самий перелік причин нижче).
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { ChatMessage, ReactionId, RoomId } from '@/lib/data/types';

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
  /** Реакції чи модерація змінились. */
  | { type: 'update'; id: string; patch: Pick<Partial<ChatMessage>, 'reactions' | 'moderation'> }
  /** Автор видалив своє повідомлення. */
  | { type: 'deleted'; id: string }
  /** Повільний режим кімнати (0 — вимкнено). */
  | { type: 'slow-mode'; seconds: number };

export type ChatConnection = 'ok' | 'slow' | 'unavailable' | 'offline';

export interface ChatService {
  /** Останні повідомлення кімнати. `GET /api/chat/rooms/:room/history?limit=` (чи історія Centrifugo при підписці). */
  history(room: RoomId, opts?: { limit?: number }): Promise<ApiResult<readonly ChatMessage[]>>;
  /** Realtime: `chat:world`, `chat:country.<ISO>`. `onConnection` — стан з’єднання для смуги «Чат недоступний». */
  subscribeRoom(room: RoomId, onEvent: (event: ChatEvent) => void, onConnection?: (state: ChatConnection) => void): Unsubscribe;
  /** `POST /chat/send` (`chat-api`). Повертає повідомлення, як його побачать інші (після нормалізації). */
  send(req: ChatSendRequest): Promise<ApiResult<ChatMessage>>;
  /** `POST /chat/react` `{ room, id, reaction, on }`. */
  react(room: RoomId, messageId: string, reaction: ReactionId, on: boolean): Promise<ApiResult<void>>;
  /** `DELETE /chat/messages/:id` — лише своє. */
  remove(room: RoomId, messageId: string): Promise<ApiResult<void>>;
  /** Переклад повідомлення (пас). `POST /api/chat/translate` — кеш на сервері за `messageId + to`. */
  translate(messageId: string, text: string, to: string): Promise<ApiResult<string>>;
  /** Перевірити нік до збереження (унікальність). `POST /api/chat/nick-check`. */
  checkNick(nick: string): Promise<ApiResult<void>>;
}
