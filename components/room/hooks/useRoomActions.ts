/**
 * Дії над вікнами кімнати: прибрати / повернути, замінити (з сповіщенням у смузі вікна), перетягування, запуск.
 * Сповіщення — там, де сталася дія. Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { GuestRoomWindow } from '@/lib/data/types';
import { cityOf } from '@/lib/live/cityOf';
import { useGuestStore } from '@/stores/guest';
import { useRoomStore, type RoomTarget, type RoomViewport } from '@/stores/room';
import { useRoomDrag } from './useRoomDrag';

const NOTICE_MS = 6_000;
export const REPLACE_ID = 'O-ROOM-REPLACE';

export function useRoomActions({
  windows,
  soundSlot,
  soundLive,
  limit,
  viewport,
  main,
  applySound,
  titleOf,
}: {
  windows: readonly GuestRoomWindow[];
  soundSlot: number | null;
  soundLive: boolean;
  limit: number;
  viewport: RoomViewport;
  main: GuestRoomWindow | null;
  applySound: (list: readonly GuestRoomWindow[], target: number | null, skipTarget?: boolean) => void;
  titleOf: (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => string;
}) {
  const t = useTranslations('room.page');
  const tWin = useTranslations('room.window');
  const announce = useAnnounce();
  const overlay = useOverlay();

  // ── Сповіщення там, де сталася дія ──
  const [undo, setUndo] = useState<{
    win: GuestRoomWindow;
    pos: number;
    sound: boolean;
    title: string;
    until: number;
  } | null>(null);
  const [barNotice, setBarNotice] = useState<{
    slot: number;
    prev: RoomTarget;
    text: string;
    until: number;
  } | null>(null);
  useEffect(() => {
    const until = Math.min(undo?.until ?? Infinity, barNotice?.until ?? Infinity);
    if (!Number.isFinite(until)) return;
    const id = window.setTimeout(
      () => {
        const nowMs = Date.now();
        setUndo((u) => (u && u.until <= nowMs ? null : u));
        setBarNotice((b) => (b && b.until <= nowMs ? null : b));
      },
      Math.max(0, until - Date.now()) + 20,
    );
    return () => window.clearTimeout(id);
  }, [undo, barNotice]);

  // ── Дії ──
  const remove = useCallback(
    (slot: number) => {
      const index = windows.findIndex((w) => w.slot === slot);
      const removed = windows[index];
      if (!removed) return;
      const pos = removed.pos ?? index;
      const hadSound = soundSlot === slot;
      useRoomStore.getState().remove(slot);
      const after = useGuestStore.getState().room;
      if (hadSound && after.soundSlot !== null)
        applySound(after.windows.slice(0, limit), after.soundSlot);
      const title = titleOf(removed);
      setUndo({ win: removed, pos, sound: hadSound, title, until: Date.now() + NOTICE_MS });
      announce(t('removed', { city: cityOf(title) }));
    },
    [windows, soundSlot, applySound, limit, announce, t, titleOf],
  );

  const doUndo = useCallback(() => {
    if (!undo) return;
    useRoomStore.getState().restore(undo.win, undo.pos, viewport, undo.sound);
    setUndo(null);
  }, [undo, viewport]);

  const replaceInto = useCallback(
    (slot: number) => {
      const target = useRoomStore.getState().pickTarget;
      const old = windows.find((w) => w.slot === slot);
      if (!target || !old) return;
      useRoomStore.getState().replace(slot, target);
      overlay.close(REPLACE_ID);
      const text = tWin('replaced', { from: cityOf(titleOf(old)), to: cityOf(titleOf(target)) });
      setBarNotice({
        slot,
        prev: { sourceId: old.sourceId, eventId: old.eventId },
        text,
        until: Date.now() + NOTICE_MS,
      });
      announce(text);
    },
    [windows, overlay, tWin, titleOf, announce],
  );

  const undoReplace = useCallback(() => {
    if (!barNotice) return;
    useRoomStore.getState().replace(barNotice.slot, barNotice.prev);
    setBarNotice(null);
  }, [barNotice]);

  // Перетягування: на інше вікно — міняються місцями, на вільне місце — вікно переходить туди.
  const moveTo = useCallback(
    (slot: number, pos: number) => {
      // Господар PlayerHost не змінюється: позиція — лише порядок показу.
      if (useRoomStore.getState().hostSlot === null && main)
        useRoomStore.getState().setHostSlot(main.slot);
      useRoomStore.getState().move(slot, pos);
      // Перестановка не змінює, у якому вікні звук: підтверджуємо його у вікні зі звуком (і тиша в решті).
      if (soundLive && soundSlot !== null) {
        const after = useGuestStore.getState().room.windows.slice(0, limit);
        applySound(after, soundSlot);
      }
      // PlayerHost стежить за слотом через ResizeObserver; перестановка без зміни розміру — перемір вручну.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    },
    [main, soundLive, soundSlot, limit, applySound],
  );
  const drag = useRoomDrag(moveTo);

  const start = useCallback((slot: number) => useRoomStore.getState().markStarted(slot), []);

  return { undo, barNotice, remove, doUndo, replaceInto, undoReplace, drag, start };
}
