'use client';

/**
 * Середовище ТВ: чи є мережа (`offline`), чи сторінка в повному екрані (підказка «Натисни F11…»).
 * Обидва стани читаються через `useSyncExternalStore`, тож без гідратаційних розбіжностей.
 */
import { useSyncExternalStore } from 'react';

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** `false` — немає з’єднання (стан `offline`: відлік іде далі, відео й чат повернуться самі). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

const FULLSCREEN_QUERY = '(display-mode: fullscreen)';

function subscribeFullscreen(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  const mq = window.matchMedia(FULLSCREEN_QUERY);
  mq.addEventListener('change', cb);
  window.addEventListener('resize', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    mq.removeEventListener('change', cb);
    window.removeEventListener('resize', cb);
  };
}

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement) || window.matchMedia(FULLSCREEN_QUERY).matches;
}

/**
 * Сторінка в повному екрані (API або F11 у браузері)? Браузер не дає програмно ввімкнути повний екран
 * без жесту, тому стан `fullscreen-denied` — це просто «не в повному екрані»: показуємо підказку.
 */
export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
}
