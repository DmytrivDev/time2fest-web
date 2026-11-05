'use client';

/**
 * «+» у кімнату перегляду (дошка `Desk-Room-Plus-2`, рішення власника 2026-11-05).
 * Десктоп: «+» додає трансляцію у вікна кімнати без переходу (картка отримує ✓), повторний натиск — прибирає; що
 * зібрано — у панелі кімнати знизу колонки (`RoomTray`). Порожня кімната починається з того, що грає зараз.
 * Телефон: «+» відкриває підтвердження під рядком (`RoomAddConfirm`), «Відкрити кімнату» — додати й перейти.
 * «+» — лише на трансляціях наживо (кімната показує тільки відео), і не на тій, що вже грає.
 */
import { createContext, useCallback } from 'react';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { useGuestStore } from '@/stores/guest';
import { ROOM_LIMIT, useRoomStore, type RoomTarget } from '@/stores/room';
import { openRoomTray } from './RoomTray';

/**
 * Сторінка кімнати перегляду: «+» на картках («Поточні трансляції») додає вікно одразу — і на телефоні (без
 * підтвердження під карткою), а коли кімната повна, кімната відкриває «Що замінити?». ✓ — уже у вікні.
 */
export const RoomPageContext = createContext<{ toggle(target: RoomTarget): void } | null>(null);

/** Що зараз грає головний плеєр сторінки (перше вікно порожньої кімнати). */
export function usePlayingTarget(): RoomTarget | null {
  const player = useOptionalPlayer();
  const sel = player?.selection;
  return player?.eventId && sel?.kind === 'source'
    ? { sourceId: sel.source.id, eventId: player.eventId }
    : null;
}

export interface RoomToggle {
  /** Ця трансляція вже у вікнах кімнати. */
  has(sourceId: string): boolean;
  /** Кімната повна (4 вікна на десктопі): нові «+» неактивні. */
  full: boolean;
  toggle(target: RoomTarget): void;
}

export function useRoomToggle(main?: RoomTarget | null): RoomToggle {
  const windows = useGuestStore((s) => s.room.windows);
  const add = useRoomStore((s) => s.add);
  const remove = useRoomStore((s) => s.remove);
  const playing = usePlayingTarget();
  const seed = main === undefined ? playing : main;
  const has = useCallback(
    (sourceId: string) => windows.some((w) => w.sourceId === sourceId),
    [windows],
  );
  const toggle = useCallback(
    (target: RoomTarget) => {
      const w = windows.find((x) => x.sourceId === target.sourceId);
      if (w) remove(w.slot);
      else {
        add(target, 'desktop', seed);
        openRoomTray();
      }
    },
    [windows, add, remove, seed],
  );
  return { has, full: windows.length >= ROOM_LIMIT.desktop, toggle };
}

/** Чи рядок можна додати в кімнату: лише наживо. */
export function canAddToRoom(status: string | undefined): boolean {
  return status === 'live';
}
