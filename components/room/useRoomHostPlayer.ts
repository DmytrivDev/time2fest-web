'use client';

/**
 * Головний плеєр = спільний PlayerHost у вікні `host`: перше входження (підхоплює те, що грало до кімнати), ланцюг
 * джерел господаря, скидання господаря, коли його вікно прибране. Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import type { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useGuestStore } from '@/stores/guest';
import { useRoomStore, type RoomViewport } from '@/stores/room';
import { chainInput } from './roomShare';

export function useRoomHostPlayer({
  known,
  data,
  viewport,
  host,
  hostSlot,
  windows,
  player,
  actions,
}: {
  known: boolean;
  data: Dataset;
  viewport: RoomViewport;
  host: GuestRoomWindow | null;
  hostSlot: number | null;
  windows: readonly GuestRoomWindow[];
  player: ReturnType<typeof useOptionalPlayer>;
  actions: ReturnType<typeof useOptionalPlayerActions>;
}) {
  const searchParams = useSearchParams();
  const adoptedRef = useRef(false);
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });
  const hostSource = host?.sourceId;
  const hostEvent = host?.eventId;
  useEffect(() => {
    if (!known || !actions) return;
    if (!adoptedRef.current) {
      adoptedRef.current = true;
      const p = playerRef.current;
      const sel = p?.selection;
      if (!searchParams?.get('w') && p?.eventId && sel && sel.kind !== 'countdown-scene') {
        useRoomStore
          .getState()
          .adoptMain({ sourceId: sel.source.id, eventId: p.eventId }, viewport);
        useRoomStore.getState().setHostSlot(null);
      }
    }
    const st = useGuestStore.getState().room.windows;
    const hs = useRoomStore.getState().hostSlot;
    const h = st.find((w) => w.slot === hs) ?? st[0];
    if (h) actions.setChain(chainInput(data, h.eventId, h.sourceId));
  }, [known, actions, data, viewport, hostEvent, hostSource, searchParams]);

  // Вікно-господар прибране → господарем стає перше вікно.
  useEffect(() => {
    if (hostSlot !== null && !windows.some((w) => w.slot === hostSlot))
      useRoomStore.getState().setHostSlot(null);
  }, [hostSlot, windows]);
}
