'use client';

/**
 * «Сервер» чату імітації (`docs/backend/frontend-seam.md`, E5a; раніше — хук `useChatSimulator` на кожній сторінці):
 * на кожному такті спільного годинника нові повідомлення кімнат, які зараз дивляться (`subscribeRoom`), потрапляють у
 * стрічки `lib/chat-sim/store`. Разом із моментами тече фоновий потік, повільний режим, тости й «новий лідер рейтингу».
 * Системне повідомлення й привітання «+15 с» з’являються в тому самому такті, що й `moment:stamp`.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { createChatSimulator } from '@/lib/chat-sim/simulator';
import { CHAT_SCRIPT, chatMoments } from '@/lib/chat-sim/script';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { RoomId } from '@/lib/data/types';
import { useClock, useTimeSource } from '@/lib/time/TimeProvider';
import { useToastStore } from '@/stores/toast';
import { setChatClock, simChatRooms } from './chat';

const serverKey = () => '';

export function ChatSimRuntime() {
  const clock = useClock();
  const source = useTimeSource();
  const key = useSyncExternalStore(simChatRooms.subscribe, simChatRooms.key, serverKey);
  useEffect(() => setChatClock(() => source.now()), [source]);
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
  return null;
}
