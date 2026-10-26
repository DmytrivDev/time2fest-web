'use client';

/**
 * Ширина для кімнати перегляду: телефон (< 768 px) — до 2 вікон, інакше до 4 (FR-030).
 * І «+» зі сторінки країни: додати трансляцію в кімнату (`stores/room`) і відкрити кімнату.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useSyncExternalStore } from 'react';
import { useRoomStore, type RoomTarget, type RoomViewport } from '@/stores/room';

export const ROOM_HREF = '/room/';
const PHONE_QUERY = '(max-width: 767.98px)';

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function snapshot(): RoomViewport {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches ? 'phone' : 'desktop';
}

export function useRoomViewport(): RoomViewport {
  return useSyncExternalStore(subscribe, snapshot, () => 'desktop');
}

/**
 * «+» / «Додати нове вікно трансляції» / «Відкрити кімнату» на сторінці країни.
 * `main` — те, що зараз грає головне вікно: порожня кімната починається з нього. Повна кімната → кімната
 * відкривається в режимі вибору вікна (десктоп) чи з поясненням «до 2 вікон» (телефон).
 */
export function useAddToRoom(): (target: RoomTarget, main: RoomTarget | null) => void {
  const router = useRouter();
  const add = useRoomStore((s) => s.add);
  return useCallback(
    (target, main) => {
      add(target, snapshot(), main);
      router.push(ROOM_HREF);
    },
    [add, router],
  );
}
