/**
 * Відправлення з чату (US4, FR-051/052, `contracts/chat.md`, «Повідомлення клієнта → сервер»).
 * Чисті функції: «зараз» і стан гостя приходять аргументами. Імітатор виконує ті самі перевірки, що й майбутній сервер:
 * `nick-required`, `link-forbidden`, `too-long`, `slow-mode`, `banned`, `room-forbidden`, `unavailable`.
 * Власне повідомлення створюється одразу (оптимістично, `author.isMine`) і лишається видимим лише на цьому пристрої.
 */
import type { Author, AuthorBadge, ChatMessage, Ms, ReactionId, RoomId } from '@/lib/data/types';
import { messageId } from './message';

export const MAX_TEXT = 200;
/** З якого символу показуємо лічильник; оголошення на 180, 195, 200. */
export const COUNTER_FROM = 180;
export const ANNOUNCE_AT = [180, 195, 200] as const;
export const EXCERPT_MAX = 60;
export const NICK_MIN = 2;
export const NICK_MAX = 20;

export const REACTIONS: readonly ReactionId[] = ['clap', 'heart', 'glasses', 'fireworks', 'laugh', 'hug'];

export interface SendMessageRequest {
  clientId: string;
  room: RoomId;
  text: string;
  replyToId?: string;
}

export type SendMessageError =
  | 'nick-required'
  | 'link-forbidden'
  | 'too-long'
  | 'slow-mode'
  | 'banned'
  | 'room-forbidden'
  | 'unavailable';

/** Порожній текст відсікає сам інтерфейс; функція все одно його не пропускає. */
export type SendError = SendMessageError | 'empty';

export interface SendContext {
  now: Ms;
  guestId: string;
  nick?: string;
  flagCode?: string;
  hasPass: boolean;
  /** Кімнати, до яких людина має доступ. */
  canWrite: (room: RoomId) => boolean;
  /** Повільний режим кімнати зараз, с (0 — вимкнено). */
  slowSeconds: number;
  /** Моменти останніх відправлень гостя (`guest.chat.sentAt`). */
  sentAt: readonly Ms[];
  available: boolean;
  banned?: boolean;
  /** Цитата для `replyTo`. */
  replyTo?: { id: string; nick: string; excerpt: string };
}

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: SendError; /** Для `slow-mode`: скільки секунд лишилось. */ retryInSec?: number };

const TLDS =
  'com|net|org|info|io|me|ua|ru|de|uk|fr|es|pl|co|tv|ly|gl|gg|app|dev|xyz|biz|site|online|link|club|top|shop|store|cc|nl|ch|eu|us|ca|au|jp|cn|br|tk|ml|ws';
/** `http(s)://`, `www.`, «домен.зона» (в тому числі з `[.]` і пробілом перед крапкою не ловимо — це текст). */
const LINK_RE = new RegExp(
  String.raw`(?:https?://|www\.|(?:^|[^\p{L}\d@-])[a-z\d-]+(?:\.[a-z\d-]+)*\.(?:${TLDS})(?![\p{L}\d]))`,
  'iu',
);

export function hasLink(text: string): boolean {
  return LINK_RE.test(text);
}

/**
 * Перше посилання в тексті — `[start, end)` до найближчого пробілу (вікно тосту підкреслює «t.me/olena_ny» цілим,
 * дошка `Desk-Toast-New`, 2026-11-12). Межу слова перед доменом, яку захоплює вираз, не рахуємо.
 */
export function findLink(text: string): { start: number; end: number } | null {
  const m = LINK_RE.exec(text);
  if (!m) return null;
  const start = m.index + (/^[^\p{L}\d]/u.test(m[0]) ? 1 : 0);
  const rest = text.slice(m.index + m[0].length).search(/\s/);
  return { start, end: rest < 0 ? text.length : m.index + m[0].length + rest };
}

/** Скільки секунд лишилось до наступного відправлення (0 — можна). */
export function slowRemainingSec(sentAt: readonly Ms[], now: Ms, seconds: number): number {
  if (seconds <= 0 || sentAt.length === 0) return 0;
  const last = Math.max(...sentAt);
  const until = last + seconds * 1_000;
  // Час відкотили назад («машина часу») — старе відправлення не блокує.
  if (last > now + seconds * 1_000) return 0;
  return until > now ? Math.ceil((until - now) / 1_000) : 0;
}

export function excerptOf(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= EXCERPT_MAX ? t : `${t.slice(0, EXCERPT_MAX - 1).trimEnd()}…`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_048_576;
  return h;
}

export function ownAuthor(ctx: Pick<SendContext, 'guestId' | 'nick' | 'flagCode' | 'hasPass'>): Author {
  const badges: AuthorBadge[] = [];
  if (ctx.hasPass) badges.push('pass');
  return {
    id: ctx.guestId,
    nick: ctx.nick ?? '',
    flagCode: ctx.flagCode ?? 'earth',
    badges,
    isMine: true,
  };
}

/** Перевірки відправлення; `null` — можна. Порядок: доступність → заборона → текст → нік → повільний режим. */
export function validateSend(req: SendMessageRequest, ctx: SendContext): { error: SendError; retryInSec?: number } | null {
  if (!ctx.available) return { error: 'unavailable' };
  if (ctx.banned) return { error: 'banned' };
  if (!ctx.canWrite(req.room)) return { error: 'room-forbidden' };
  const text = req.text.trim();
  if (!text) return { error: 'empty' };
  if (req.text.length > MAX_TEXT || text.length > MAX_TEXT) return { error: 'too-long' };
  if (hasLink(text)) return { error: 'link-forbidden' };
  if (!ctx.nick || ctx.nick.trim().length < NICK_MIN) return { error: 'nick-required' };
  const wait = slowRemainingSec(ctx.sentAt, ctx.now, ctx.slowSeconds);
  if (wait > 0) return { error: 'slow-mode', retryInSec: wait };
  return null;
}

/** Відправити: або власне повідомлення (оптимістично), або причина відмови. Текст при відмові не стирається (це справа поля). */
export function sendMessage(req: SendMessageRequest, ctx: SendContext): SendResult {
  const bad = validateSend(req, ctx);
  if (bad) return { ok: false, ...bad };
  const text = req.text.trim();
  const message: ChatMessage = {
    id: messageId(ctx.now, 3_000 + (hashString(req.clientId) % 1_000), hashString(req.clientId), req.room),
    room: req.room,
    kind: 'regular',
    createdAt: ctx.now,
    author: ownAuthor(ctx),
    text,
    moderation: 'ok',
    ...(ctx.replyTo ? { replyTo: { ...ctx.replyTo, excerpt: excerptOf(ctx.replyTo.excerpt) } } : {}),
  };
  return { ok: true, message };
}

/** Поставити або зняти реакцію: нові `reactions` повідомлення. */
export function toggleReaction(
  reactions: ChatMessage['reactions'],
  reaction: ReactionId,
  on: boolean,
): NonNullable<ChatMessage['reactions']> {
  const next = { ...(reactions ?? {}) };
  const cur = next[reaction] ?? { count: 0, mine: false };
  if (on === cur.mine) return next;
  const count = Math.max(0, cur.count + (on ? 1 : -1));
  if (count === 0 && !on) delete next[reaction];
  else next[reaction] = { count, mine: on };
  return next;
}
