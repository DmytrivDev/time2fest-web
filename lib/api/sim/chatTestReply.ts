/**
 * Шов E5a: інструмент імітації (`chat.dev.emitReplyToMe`), раніше — `lib/chat/testReply`.
 * Тестова збірка: «Хтось відповів мені» — щоб перевірити «Сповіщати про відповіді» без живих людей.
 * Аміра відповідає на останнє своє повідомлення гостя (або просто згадує ніком у «Світі», якщо своїх ще немає).
 */
import { CHAT_SCRIPT } from '@/lib/chat-sim/script';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { ChatMessage, Ms, RoomId } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';

let seq = 0;

export function emitReplyToMe(now: Ms): ChatMessage | null {
  const guest = useGuestStore.getState();
  const nick = guest.nick;
  if (!nick) return null;
  const rooms = useChatFeed.getState().rooms;
  let mine: ChatMessage | undefined;
  for (const list of Object.values(rooms)) {
    for (const m of list ?? []) if (m.author?.isMine && m.kind === 'regular' && (!mine || m.createdAt > mine.createdAt)) mine = m;
  }
  const room: RoomId = mine?.room ?? guest.chat.lastRoom ?? 'world';
  const a = CHAT_SCRIPT.authors.find((x) => x.id === 'u_amira') ?? CHAT_SCRIPT.authors[0]!;
  seq += 1;
  const msg: ChatMessage = {
    id: `test-reply:${now}:${seq}`,
    room,
    kind: 'regular',
    createdAt: now,
    author: { id: a.id, nick: a.nick, flagCode: a.flagCode, badges: [...a.badges] },
    text: `І тебе з Новим роком, ${nick}!`,
    replyTo: { id: mine?.id ?? 'none', nick, excerpt: (mine?.text ?? '').slice(0, 60) },
    moderation: 'ok',
  };
  useChatFeed.getState().append([msg]);
  return msg;
}
