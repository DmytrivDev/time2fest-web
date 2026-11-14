'use client';

/**
 * Ширина для кімнати перегляду: телефон (< 768 px) — до 2 вікон, інакше до 4 (FR-030).
 * І «+» зі сторінки країни: додати трансляцію в кімнату (`stores/room`) і відкрити кімнату.
 */
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { usePhone } from '@/lib/hooks/useMedia';
import { useRoomStore, type RoomTarget, type RoomViewport } from '@/stores/room';

export const ROOM_HREF = '/room/';

export function useRoomViewport(): RoomViewport {
  return usePhone() ? 'phone' : 'desktop';
}

/**
 * «+» / «Додати нове вікно трансляції» / «Відкрити кімнату» на сторінці країни.
 * `main` — те, що зараз грає головне вікно: порожня кімната починається з нього. Повна кімната → кімната
 * відкривається в режимі вибору вікна (десктоп) чи з поясненням «до 2 вікон» (телефон).
 */
export function useAddToRoom(): (target: RoomTarget, main: RoomTarget | null) => void {
  const router = useRouter();
  const add = useRoomStore((s) => s.add);
  const viewport = useRoomViewport();
  return useCallback(
    (target, main) => {
      add(target, viewport, main);
      router.push(ROOM_HREF);
    },
    [add, router, viewport],
  );
}
