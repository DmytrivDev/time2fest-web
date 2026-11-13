/** Шов E5a: адаптер `sim` чату (перевірки, тестові перемикачі, кімнати під імітацією) і хуки стрічки. */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChatEvent } from '@/lib/api/contracts/chat';
import { roomResource, useChatRooms, useRoomMessages } from '@/lib/api/hooks/chat';
import { createSimChat, setChatClock, simChatRooms } from '@/lib/api/sim/chat';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { ChatMessage } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);
const msg = (id: string, at: number, mine = false): ChatMessage => ({
  id,
  room: 'world',
  kind: 'regular',
  createdAt: at,
  author: { id: mine ? 'me' : 'a1', nick: mine ? 'Олена' : 'Emma', flagCode: 'GB', badges: [], ...(mine ? { isMine: true } : {}) },
  text: 'Привіт',
  moderation: 'ok',
});

beforeEach(() => {
  useChatFeed.getState().reset();
  useTestControls.setState({ chatAvailable: true, offlineSimulated: false, slowForcedSec: 0, emptyCountry: false });
  useGuestStore.setState({ nick: 'Олена', flagCode: 'UA', chat: { lastRoom: 'world', sentAt: [] } });
  setChatClock(() => T0);
});

describe('sim-адаптер чату', () => {
  it('відправлення: ті самі причини відмови, що й у полі; успіх — повідомлення в стрічці', async () => {
    const svc = createSimChat();
    expect(await svc.send({ clientId: 'c1', room: 'world', text: 'див. example.com' })).toEqual({ ok: false, error: { code: 'validation', reason: 'link-forbidden' } });
    useGuestStore.setState({ nick: undefined });
    expect(await svc.send({ clientId: 'c2', room: 'world', text: 'Привіт' })).toEqual({ ok: false, error: { code: 'validation', reason: 'nick-required' } });
    useGuestStore.setState({ nick: 'Олена' });
    useTestControls.setState({ chatAvailable: false });
    expect(await svc.send({ clientId: 'c3', room: 'world', text: 'Привіт' })).toEqual({ ok: false, error: { code: 'unavailable' } });
    useTestControls.setState({ chatAvailable: true, slowForcedSec: 15 });
    useGuestStore.setState({ chat: { lastRoom: 'world', sentAt: [T0 - 5_000] } });
    const slow = await svc.send({ clientId: 'c4', room: 'world', text: 'Привіт' });
    expect(slow).toEqual({ ok: false, error: { code: 'rate_limited', reason: 'slow-mode', retryAfterMs: 10_000 } });
    useTestControls.setState({ slowForcedSec: 0 });
    const sent = await svc.send({ clientId: 'c5', room: 'world', text: ' Привіт ' });
    expect(sent.ok && sent.value).toMatchObject({ text: 'Привіт', author: { isMine: true, nick: 'Олена' } });
    expect(useChatFeed.getState().rooms.world?.map((m) => m.text)).toEqual(['Привіт']);
  });

  it('відповідь: цитата з повідомлення за replyToId', async () => {
    useChatFeed.getState().append([msg('m1', T0 - 1_000)]);
    const res = await createSimChat().send({ clientId: 'r', room: 'world', text: 'І тебе', replyToId: 'm1' });
    expect(res.ok && res.value.replyTo).toEqual({ id: 'm1', nick: 'Emma', excerpt: 'Привіт' });
  });

  it('підписка: знімок на зміну стрічки, «порожня кімната «Країна»», стан з’єднання й повільний режим; кімната — під імітацією', () => {
    const svc = createSimChat();
    const events: string[] = [];
    const conn: string[] = [];
    const off = svc.subscribeRoom('country:FR', (e) => events.push(e.type), (c) => conn.push(c));
    expect(simChatRooms.key()).toBe('country:FR');
    useChatFeed.getState().append([{ ...msg('f1', T0), room: 'country:FR' }, { ...msg('f2', T0 + 1, true), room: 'country:FR' }]);
    expect(svc.peekRoom?.('country:FR')?.length).toBe(2);
    useTestControls.setState({ emptyCountry: true });
    expect(svc.peekRoom?.('country:FR')?.map((m) => m.id)).toEqual(['f2']);
    useTestControls.setState({ chatAvailable: false, slowForcedSec: 30 });
    expect(conn).toEqual(['unavailable']);
    expect(svc.connection('country:FR')).toBe('unavailable');
    expect(svc.slowModeSeconds('country:FR', T0)).toBe(30);
    expect(events).toEqual(['snapshot', 'snapshot', 'slow-mode']);
    off();
    expect(simChatRooms.key()).toBe('');
  });

  it('реакція й видалення свого; ніки-підказки; переклад зі сценарію', async () => {
    const svc = createSimChat();
    useChatFeed.getState().append([msg('m1', T0), msg('m2', T0 + 1, true)]);
    await svc.react('world', 'm1', 'heart', true);
    await svc.remove('world', 'm2');
    const [a, b] = useChatFeed.getState().rooms.world!;
    expect(a!.reactions?.heart).toEqual({ count: 1, mine: true });
    expect(b!.deleted).toBe(true);
    expect(svc.takenNickHints().length).toBeGreaterThan(0);
    expect(await svc.translate('m1', 'Happy New Year, everyone!', 'en', 'uk')).toEqual({ ok: true, value: 'З Новим роком усіх!' });
  });
});

describe('хуки стрічки', () => {
  it('peek: наявна стрічка видна в першому кадрі; нове — подією; сторінкові кімнати під імітацією', () => {
    useChatFeed.getState().append([msg('m1', T0)]);
    roomResource('world').reset();
    const { result, unmount } = renderHook(() => {
      useChatRooms(['world', 'country:FR']);
      return useRoomMessages('world');
    });
    expect(result.current.map((m) => m.id)).toEqual(['m1']);
    expect(simChatRooms.key()).toBe('country:FR|world');
    act(() => useChatFeed.getState().append([msg('m2', T0 + 1)]));
    expect(result.current.map((m) => m.id)).toEqual(['m1', 'm2']);
    unmount();
    expect(simChatRooms.key()).toBe('');
  });

  it('applyChatEvent: без дублів, за часом; оновлення й видалення', () => {
    const list = [msg('a', 1), msg('c', 3)];
    expect(applyChatEvent(list, { type: 'messages', messages: [msg('b', 2), msg('a', 1)] }).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(applyChatEvent(list, { type: 'update', id: 'a', patch: { moderation: 'hidden' } })[0]!.moderation).toBe('hidden');
    expect(applyChatEvent(list, { type: 'deleted', id: 'c' })[1]!.deleted).toBe(true);
    expect(applyChatEvent(list, { type: 'slow-mode', seconds: 5 })).toBe(list);
  });
});
