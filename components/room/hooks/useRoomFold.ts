/**
 * Телефон, 2 вікна: розгорнутий чат або будь-яка шторка — вікно без звуку згортається в мініатюру й стає на паузу,
 * сторінка — нагору, шторка починається під мініатюрою (не накриває жодного вікна). Чат і шторки працюють лише так.
 * Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useEffect, useRef } from 'react';
import { useChatDockControls } from '@/components/chat/ChatDock';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { GuestRoomWindow } from '@/lib/data/types';
import type { useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useChatDock } from '@/stores/chatDock';
import { roomPlayers } from '@/components/room/parts/RoomWindowPlayer';

/** Чат розгорнуто (телефон) — для згортання вікна без звуку. */
function useChatExpanded(): boolean {
  return useChatDock((st) => st.expanded);
}

export function useRoomFold({
  phone,
  windows,
  soundSlot,
  started,
  isHost,
  actions,
}: {
  phone: boolean;
  windows: readonly GuestRoomWindow[];
  soundSlot: number | null;
  started: readonly number[];
  isHost: (w: GuestRoomWindow) => boolean;
  actions: ReturnType<typeof useOptionalPlayerActions>;
}) {
  const overlay = useOverlay();
  const chatExpanded = useChatExpanded();
  const { collapse: collapseChat } = useChatDockControls();
  const sheetOpen = phone && overlay.current !== null && overlay.current.kind !== 'inflow';
  const foldSlot =
    phone && (chatExpanded || sheetOpen) && windows.length === 2
      ? (windows.find((w) => w.slot !== soundSlot)?.slot ?? null)
      : null;
  // «Розгорнути» на мініатюрі — чат і шторка повністю закриваються, обидва вікна знову грають.
  const unfold = () => {
    collapseChat();
    if (overlay.current) overlay.close(overlay.current.id);
  };
  const prevFold = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevFold.current;
    prevFold.current = foldSlot;
    const handle = (slot: number) =>
      windows.find((w) => w.slot === slot && isHost(w)) ? null : roomPlayers.get(slot);
    if (foldSlot !== null && prev !== foldSlot) {
      window.scrollTo({ top: 0 });
      const h = handle(foldSlot);
      if (h) h.pause();
      else actions?.pause();
    }
    if (prev !== null && foldSlot === null) {
      const h = handle(prev);
      // Вікно, яке людина ще не запускала (готове, на фасаді), після згортання не стартує.
      if (h) {
        if (started.includes(prev)) h.play();
      } else actions?.play();
    }
  }, [foldSlot, windows, actions, isHost, started]);

  return { foldSlot, unfold };
}
