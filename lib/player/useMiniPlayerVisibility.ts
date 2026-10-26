'use client';

/**
 * Коли показувати мініплеєр (C3). Окремий файл: `PlayerProvider` і `PlayerHost` не змінюються.
 * - слот `main` вийшов за екран під час прокрутки → мініплеєр видимий (лише десктоп, лише якщо є відео);
 * - × закриває мініплеєр до наступного повернення основного плеєра в екран;
 * - мініплеєр сам сідає на місце `main` у `PlayerProvider` (див. `MiniPlayer`), тому слот із
 *   `data-mini-player-slot` не вважається основним.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOptionalPlayer, useOptionalPlayerInternals } from './PlayerProvider';

export const MINI_SLOT_ATTR = 'data-mini-player-slot';

/** Резерв, якщо токен `--spacing-bp-desktop` недоступний (DESIGN: «десктоп від 1200 px»). */
const DESKTOP_FALLBACK_PX = 1200;

export function desktopQuery(): string {
  let px = DESKTOP_FALLBACK_PX;
  if (typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--spacing-bp-desktop').trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) px = parsed;
  }
  return `(min-width: ${px}px)`;
}

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia(desktopQuery());
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
const desktopSnapshot = () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(desktopQuery()).matches : false);

/** `true` на десктопі (мініплеєра на планшеті й телефоні немає: там плеєр закріплений угорі). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => false);
}

export interface MiniPlayerVisibilityOptions {
  /** Вимкнути зовсім (сторінка, де плеєр стартує сам, або TV). */
  enabled?: boolean;
}

export interface MiniPlayerVisibility {
  visible: boolean;
  /** × : закрити мініплеєр і зупинити відео не тут (зупинка — `usePlayerActions().pause()` у `MiniPlayer`). */
  dismiss: () => void;
  /** «Повернутися»: прокрутити основний слот у екран. */
  returnToPlayer: () => void;
}

export function useMiniPlayerVisibility({ enabled = true }: MiniPlayerVisibilityOptions = {}): MiniPlayerVisibility {
  const internals = useOptionalPlayerInternals();
  const player = useOptionalPlayer();
  const desktop = useIsDesktop();
  const slotElement = internals?.slotElement ?? null;
  const hasVideo = (player?.videoId ?? null) !== null;

  const [outOfView, setOutOfView] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Стежимо за основним слотом; слот самого мініплеєра ігноруємо (хост тимчасово сидить над ним).
  useEffect(() => {
    if (!slotElement || slotElement.hasAttribute(MINI_SLOT_ATTR)) return;
    mainRef.current = slotElement;
    observerRef.current?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      const out = !last.isIntersecting;
      setOutOfView(out);
      if (!out) setDismissed(false);
    });
    io.observe(slotElement);
    observerRef.current = io;
  }, [slotElement]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const dismiss = useCallback(() => setDismissed(true), []);
  const returnToPlayer = useCallback(() => {
    const main = mainRef.current;
    if (!main?.isConnected) return;
    const reduce = document.documentElement.getAttribute('data-reduce-motion') === 'true';
    main.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  return { visible: enabled && desktop && hasVideo && outOfView && !dismissed, dismiss, returnToPlayer };
}
