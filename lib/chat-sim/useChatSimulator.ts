'use client';

/**
 * Підключення імітатора до спільного годинника: на кожному такті нові повідомлення кімнат
 * потрапляють у `useChatFeed`. Ставиться один раз на сторінку (головна — `['world']`).
 * Разом із моментами тече фоновий потік `ambient` і повільний режим (US4).
 * Системне повідомлення й привітання «+15 с» з’являються в тому самому такті, що й `moment:stamp`.
 */
import { useEffect } from 'react';
import chatScript from '@/data/chat-script.json';
import type { ChatScriptFile, RoomId } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { useClock, useTimeSource } from '@/lib/time/TimeProvider';
import { useToastStore } from '@/stores/toast';
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
  const source = useTimeSource();
  const key = rooms.join('|');
  useEffect(() => {
    if (!key) return;
    const sim = createChatSimulator({
      script: CHAT_SCRIPT,
      moments: chatMoments(),
      rooms: key.split('|') as RoomId[],
      ambient: true,
      getSpeed: () => source.speed,
      // Свої тости: у «Світі» після перезавантаження й у привітанні опівночі (рішення 2026-11-12).
      ownToasts: () => useToastStore.getState().said,
    });
    const run = () => {
      const now = clock.getSnapshot();
      if (!(now > 0)) return; // час ще невідомий (до першої синхронізації)
      const batch = sim.advance(now);
      if (batch.length) useChatFeed.getState().append(batch);
      useChatFeed.getState().applyDeletions(now);
    };
    run();
    return clock.subscribe(run);
  }, [clock, source, key]);
}
