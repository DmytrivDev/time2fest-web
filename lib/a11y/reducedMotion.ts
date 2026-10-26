'use client';

/**
 * «Зменшити рух» (принцип V; research.md, розділ 9): діє, якщо ввімкнено в системі
 * АБО на сайті (`GuestState.reducedMotion`). Атрибут `<html data-reduce-motion="true|false">`
 * виставляє вбудований скрипт до гідратації (`REDUCED_MOTION_INIT_SCRIPT`) і далі тримає
 * `useReducedMotionAttribute()`. Варіанти Tailwind `calm:` / `lively:` — у `styles/motion.css`.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useGuestStore } from '@/stores/guest';
import { REDUCE_MOTION_ATTR, REDUCED_MOTION_QUERY } from './reducedMotionScript';

export { REDUCE_MOTION_ATTR, REDUCED_MOTION_INIT_SCRIPT, REDUCED_MOTION_QUERY } from './reducedMotionScript';

/** Ефективне значення: система АБО сайт. */
export function computeReduceMotion(system: boolean, site: boolean): boolean {
  return system || site;
}

function mediaQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  } catch {
    return null;
  }
}

function subscribeSystem(cb: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => undefined;
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const getSystem = () => mediaQuery()?.matches ?? false;

/** Системне `prefers-reduced-motion` (`matchMedia` + `change`). */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribeSystem, getSystem, () => false);
}

/** Ефективне «зменшити рух» для JS-анімацій (Embla autoplay, конфеті, лічильники). */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const site = useGuestStore((s) => s.reducedMotion);
  return computeReduceMotion(system, site);
}

export function applyReduceMotionAttribute(value: boolean, root: HTMLElement = document.documentElement): void {
  root.setAttribute(REDUCE_MOTION_ATTR, value ? 'true' : 'false');
}

/** Тримає атрибут `<html data-reduce-motion>` у відповідності до системи й перемикача сайту. */
export function useReducedMotionAttribute(): boolean {
  const value = useReducedMotion();
  const site = useGuestStore((s) => s.reducedMotion);
  useEffect(() => {
    // Свіже значення (а не знімок гідратації), щоб не скинути атрибут, виставлений скриптом.
    applyReduceMotionAttribute(computeReduceMotion(getSystem(), site));
  }, [value, site]);
  return value;
}
