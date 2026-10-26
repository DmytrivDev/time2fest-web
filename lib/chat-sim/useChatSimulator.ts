'use client';

/**
 * Підключення імітатора до спільного годинника: на кожному такті нові повідомлення кімнат
 * потрапляють у `useChatFeed`. Ставиться один раз на сторінку (головна — `['world']`).
 * Системне повідомлення й привітання «+15 с» з’являються в тому самому такті, що й `moment:stamp`.
 */
import { useEffect } from 'react';
import chatScript from '@/data/chat-script.json';
import type { ChatScriptFile, RoomId } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { useClock } from '@/lib/time/TimeProvider';
import { buildMomentContexts, createChatSimulator, type MomentContext } from './simulator';
import { useChatFeed } from './store';

export const CHAT_SCRIPT = chatScript as unknown as ChatScriptFile;

let momentsCache: MomentContext[] | null = null;
export function chatMoments(): MomentContext[] {
  if (!momentsCache) momentsCache = buildMomentContexts(getData());
  return momentsCache;
}

export function useChatSimulator(rooms: readonly RoomId[]): void {
  const clock = useClock();
  const key = rooms.join('|');
  useEffect(() => {
    if (!key) return;
    const sim = createChatSimulator({ script: CHAT_SCRIPT, moments: chatMoments(), rooms: key.split('|') as RoomId[] });
    const run = () => {
      const batch = sim.advance(clock.getSnapshot());
      if (batch.length) useChatFeed.getState().append(batch);
    };
    run();
    return clock.subscribe(run);
  }, [clock, key]);
}
