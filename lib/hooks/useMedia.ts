'use client';

/**
 * Медіазапити для JS-розмітки (там, де одного CSS мало). Один запит «телефон» на весь сайт: межа збігається з
 * Tailwind `md` (48rem = 768 px), тож телефон — усе, що вужче за 768 px.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** Телефон: до 768 px (дробова межа — щоб не було «щілини» між `max-width` і `min-width: 768px`). */
export const PHONE_QUERY = '(max-width: 767.98px)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

/**
 * Чи збігається медіазапит. Без `matchMedia` (SSR, старі середовища) — `serverValue` (за замовчуванням `false`);
 * `null` дозволяє розрізнити «ще невідомо» (статичний рендер і гідратація).
 */
export function useMedia(query: string): boolean;
export function useMedia(query: string, serverValue: boolean | null): boolean | null;
export function useMedia(query: string, serverValue: boolean | null = false): boolean | null {
  const subscribe = useCallback(
    (cb: () => void): (() => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore<boolean | null>(subscribe, () => matches(query), () => serverValue);
}

/** Телефон за шириною вікна (< 768 px). */
export function usePhone(): boolean {
  return useMedia(PHONE_QUERY);
}
