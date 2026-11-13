/**
 * Адаптер `sim` домену «Чат» (`docs/backend/frontend-seam.md`, E5a): обгортка над «сервером» імітації
 * `lib/chat-sim/store` (стрічки кімнат) і сценарієм `lib/chat-sim/script`. Поведінка — та сама, що була в `ChatPanel`:
 * - відправлення — `sendMessage` з тими самими перевірками (нік, посилання, довжина, повільний режим, «чат недоступний»);
 * - перемикачі тестової панелі й `window.__t2f` (`setChatAvailable`, `setChatSlow`, `setChatEmpty`, `emitReply`) читає
 *   адаптер: стан з’єднання, повільний режим, «порожня кімната «Країна»» (лише свої повідомлення);
 * - підписка на кімнату «вмикає» її імітацію (`ChatSimRuntime` у `SimRuntime` веде стрічки на такті годинника).
 */
import { fail, ok, type ApiError } from '../result';
import type { ChatConnection, ChatEvent, ChatService } from '../contracts/chat';
import { emitReplyToMe } from './chatTestReply';
import { buildAuthorPath } from '@/lib/chat/authorPath';
import { excerptOf, sendMessage, type SendError } from '@/lib/chat/send';
import { cannedTranslation } from '@/lib/chat/translate';
import { CHAT_SCRIPT } from '@/lib/chat-sim/script';
import { slowSecondsAt } from '@/lib/chat-sim/simulator';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { ChatMessage, Ms, RoomId } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

let siteNow: () => Ms = () => Date.now();
/** Годинник сайту (машина часу) для відправлення й повільного режиму — з `ChatSimRuntime`. */
export function setChatClock(now: () => Ms): void {
  siteNow = now;
}

// ── Кімнати, які «дивляться» (імітація веде лише їх) ────────────────────────
const roomCounts = new Map<RoomId, number>();
const roomListeners = new Set<() => void>();
let roomsKey = '';
function updateRoomsKey(): void {
  const next = [...roomCounts.keys()].sort().join('|');
  if (next === roomsKey) return;
  roomsKey = next;
  roomListeners.forEach((l) => l());
}
/** Ключ кімнат під імітацією (`ChatSimRuntime`, `useSyncExternalStore`). */
export const simChatRooms = {
  key: (): string => roomsKey,
  subscribe(l: () => void): () => void {
    roomListeners.add(l);
    return () => roomListeners.delete(l);
  },
};

// ── Стрічка кімнати з урахуванням «порожньої кімнати «Країна»» ─────────────
const EMPTY: readonly ChatMessage[] = [];
const viewCache = new Map<RoomId, { list: readonly ChatMessage[] | undefined; empty: boolean; out: readonly ChatMessage[] }>();
function roomView(room: RoomId): readonly ChatMessage[] {
  const list = useChatFeed.getState().rooms[room];
  const empty = useTestControls.getState().emptyCountry && room.startsWith('country:');
  const hit = viewCache.get(room);
  if (hit && hit.list === list && hit.empty === empty) return hit.out;
  const out = !list ? EMPTY : empty ? list.filter((m) => m.author?.isMine) : list;
  viewCache.set(room, { list, empty, out });
  return out;
}

function connectionNow(): ChatConnection {
  return useTestControls.getState().chatAvailable ? 'ok' : 'unavailable';
}

function slowNow(room: RoomId, at: Ms): number {
  return useTestControls.getState().slowForcedSec || slowSecondsAt(CHAT_SCRIPT, room, at);
}

function sendError(error: SendError, retryInSec?: number): ApiError {
  if (error === 'unavailable') return { code: 'unavailable' };
  if (error === 'slow-mode') return { code: 'rate_limited', reason: error, ...(retryInSec ? { retryAfterMs: retryInSec * 1000 } : {}) };
  if (error === 'banned' || error === 'room-forbidden') return { code: 'forbidden', reason: error };
  return { code: 'validation', reason: error };
}

function findMessage(id: string): ChatMessage | undefined {
  for (const list of Object.values(useChatFeed.getState().rooms)) {
    const m = list?.find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}

export function createSimChat(): ChatService {
  return {
    async history(room) {
      return ok(roomView(room));
    },
    peekRoom: (room) => roomView(room),
    subscribeRoom(room, onEvent: (event: ChatEvent) => void, onConnection) {
      roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1);
      updateRoomsKey();
      const offFeed = useChatFeed.subscribe((s, p) => {
        if (s.rooms[room] !== p.rooms[room]) onEvent({ type: 'snapshot', messages: roomView(room) });
      });
      const offControls = useTestControls.subscribe((s, p) => {
        if (s.emptyCountry !== p.emptyCountry) onEvent({ type: 'snapshot', messages: roomView(room) });
        if (s.slowForcedSec !== p.slowForcedSec) onEvent({ type: 'slow-mode', seconds: slowNow(room, siteNow()) });
        if (s.chatAvailable !== p.chatAvailable) onConnection?.(connectionNow());
      });
      return () => {
        offFeed();
        offControls();
        const n = (roomCounts.get(room) ?? 1) - 1;
        if (n > 0) roomCounts.set(room, n);
        else roomCounts.delete(room);
        updateRoomsKey();
      };
    },
    connection: () => connectionNow(),
    slowModeSeconds: (room, at) => slowNow(room, at),
    async send(req) {
      const now = siteNow();
      const g = useGuestStore.getState();
      const tc = useTestControls.getState();
      const reply = req.replyToId ? findMessage(req.replyToId) : undefined;
      const res = sendMessage(
        { clientId: req.clientId, room: req.room, text: req.text },
        {
          now,
          guestId: g.id,
          nick: g.nick,
          flagCode: g.flagCode ?? g.detectedFlag,
          hasPass: g.hasPass,
          canWrite: () => true,
          slowSeconds: slowNow(req.room, now),
          sentAt: g.chat.sentAt,
          available: tc.chatAvailable && !tc.offlineSimulated,
          ...(reply?.author ? { replyTo: { id: reply.id, nick: reply.author.nick, excerpt: excerptOf(reply.text ?? '') } } : {}),
        },
      );
      if (!res.ok) return { ok: false, error: sendError(res.error, res.retryInSec) };
      useChatFeed.getState().append([res.message]);
      return ok(res.message);
    },
    async react(room, id, reaction, on) {
      useChatFeed.getState().react(room, id, reaction, on);
      return ok(undefined);
    },
    async remove(room, id) {
      useChatFeed.getState().remove(room, id);
      return ok(undefined);
    },
    async report() {
      // Модерації в імітації немає: скаргу «прийнято» (інтерфейс показує підтвердження сам).
      return ok(undefined);
    },
    async translate(_id, text) {
      return ok(cannedTranslation(text) ?? `[переклад] ${text}`);
    },
    async checkNick(nick) {
      const taken = CHAT_SCRIPT.authors.some((a) => a.nick.toLowerCase() === nick.trim().toLowerCase());
      return taken ? fail('validation', { reason: 'taken' }) : ok(undefined);
    },
    takenNickHints: () => takenNicks(),
    authorPath(author, at) {
      return {
        points: buildAuthorPath(author, CHAT_SCRIPT, getData(), at),
        hidden: !!CHAT_SCRIPT.authors.find((x) => x.id === author.id)?.pathHidden,
      };
    },
    dev: {
      emitReplyToMe: (at) => emitReplyToMe(at),
      forcedSlowNotice(room, at) {
        const seconds = useTestControls.getState().slowForcedSec;
        if (!seconds) return;
        useChatFeed.getState().append([
          { id: `slow-forced:${room}:${at}`, room, kind: 'system', createdAt: at, system: { kind: 'slow-mode', seconds }, moderation: 'ok' },
        ]);
      },
    },
  };
}

let nicksCache: readonly string[] | null = null;
function takenNicks(): readonly string[] {
  if (!nicksCache) nicksCache = CHAT_SCRIPT.authors.map((a) => a.nick);
  return nicksCache;
}
