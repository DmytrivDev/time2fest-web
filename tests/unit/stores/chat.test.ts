import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { ChatMessage } from '@/lib/data/types';
import { emotionWaitSec, EMOTION_COOLDOWN_MS, formatCount, useChatUi, useHiddenCount } from '@/stores/chat';

const T = Date.parse('2027-01-01T00:10:00Z');
const msg = (id: string, at: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  room: 'world',
  kind: 'regular',
  createdAt: at,
  text: id,
  author: { id: 'u', nick: 'Аміра', flagCode: 'CA', badges: [] },
  moderation: 'ok',
  ...over,
});

beforeEach(() => {
  useChatFeed.getState().reset();
  useChatUi.getState().reset();
});

describe('stores/chat — лічильник сховано, відповідь, чернетка', () => {
  it('рахує лише нові чужі повідомлення відтоді, як чат сховано', () => {
    useChatFeed.getState().append([msg('a', T - 5_000), msg('b', T + 1_000), msg('c', T + 2_000, { author: { id: 'me', nick: 'Я', flagCode: 'UA', badges: [], isMine: true } })]);
    useChatFeed.getState().append([msg('s', T + 3_000, { kind: 'system', author: undefined })]);
    const { result, rerender } = renderHook(() => useHiddenCount('world'));
    expect(result.current).toBe(0); // чат не сховано
    useChatUi.getState().markHidden(T);
    rerender();
    expect(result.current).toBe(1); // лише «b»: власне «c» і системне «s» не рахуються
    useChatFeed.getState().append([msg('d', T + 4_000)]);
    rerender();
    expect(result.current).toBe(2);
  });

  it('«99+» від ста', () => {
    expect(formatCount(7)).toBe('7');
    expect(formatCount(99)).toBe('99');
    expect(formatCount(100)).toBe('99+');
  });

  it('емоцію можна міняти раз на 10 с', () => {
    expect(emotionWaitSec(null, T)).toBe(0);
    expect(emotionWaitSec(T - 3_000, T)).toBe(7);
    expect(emotionWaitSec(T - EMOTION_COOLDOWN_MS, T)).toBe(0);
    expect(emotionWaitSec(T + 3_600_000, T)).toBe(0);
  });

  it('чернетка приймає і значення, і функцію; відповідь скидається', () => {
    useChatUi.getState().setDraft('Привіт');
    useChatUi.getState().setDraft((v) => `${v} @Аміра `);
    expect(useChatUi.getState().draft).toBe('Привіт @Аміра ');
    useChatUi.getState().setReplyTo({ id: 'a', room: 'world', nick: 'Аміра', excerpt: 'Привіт' });
    expect(useChatUi.getState().replyTo?.nick).toBe('Аміра');
    useChatUi.getState().reset();
    expect(useChatUi.getState().draft).toBe('');
    expect(useChatUi.getState().replyTo).toBeNull();
  });

  it('реакція у стрічці: ставиться й знімається лише для обраного повідомлення', () => {
    useChatFeed.getState().append([msg('a', T, { reactions: { clap: { count: 2, mine: false } } }), msg('b', T + 1_000)]);
    useChatFeed.getState().react('world', 'a', 'clap', true);
    const [a, b] = useChatFeed.getState().rooms.world!;
    expect(a!.reactions!.clap).toEqual({ count: 3, mine: true });
    expect(b!.reactions).toBeUndefined();
  });
});
