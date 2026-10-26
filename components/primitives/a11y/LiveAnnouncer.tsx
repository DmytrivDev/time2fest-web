'use client';

/**
 * P31. LiveAnnouncer — ОДНА ввічлива live-область на сторінку (research.md 9, ІНВ 5.6).
 * - лише зміни фаз і віхи (10 хв / 1 хв / 10 с / північ), не щосекундний таймер;
 * - черга: не частіше ніж раз на `minIntervalMs` (5–10 с), той самий текст двічі поспіль не повторюється;
 * - `late` події (пропущені, вкладка спала) не оголошуються (contracts/ui-events.md);
 * - фокус не переносить.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** Віхи відліку до півночі, мс (задаються в lib/engine; тут — для `milestoneCrossed`). */
export const COUNTDOWN_MILESTONES_MS = [10 * 60_000, 60_000, 10_000, 0] as const;

/**
 * Яку віху перетнуто між двома зчитуваннями залишку (мс до півночі), або `null`.
 * Береться найменша перетнута — після стрибка часу оголошується лише актуальна.
 */
export function milestoneCrossed(prevRemainingMs: number, remainingMs: number): number | null {
  let hit: number | null = null;
  for (const m of COUNTDOWN_MILESTONES_MS) {
    if (prevRemainingMs > m && remainingMs <= m) hit = m;
  }
  return hit;
}

export interface AnnounceOptions {
  /** Запізніла подія — не оголошувати. */
  late?: boolean;
}

type Announce = (text: string, opts?: AnnounceOptions) => void;

const AnnounceContext = createContext<Announce | null>(null);

export interface LiveAnnouncerProps {
  children?: ReactNode;
  /** Мінімальна пауза між повідомленнями (5–10 с). */
  minIntervalMs?: number;
}

export function LiveAnnouncer({ children, minIntervalMs = 7_000 }: LiveAnnouncerProps) {
  const [message, setMessage] = useState('');
  const queue = useRef<string[]>([]);
  const lastText = useRef<string>('');
  const lastAt = useRef<number>(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const step = () => {
      timer.current = null;
      const next = queue.current.shift();
      if (next === undefined) return;
      lastText.current = next;
      lastAt.current = performance.now();
      setMessage(next);
      if (queue.current.length) timer.current = setTimeout(step, minIntervalMs);
    };
    step();
  }, [minIntervalMs]);

  const announce = useCallback<Announce>(
    (text, opts) => {
      const t = text.trim();
      if (!t || opts?.late) return;
      const tail = queue.current[queue.current.length - 1] ?? lastText.current;
      if (t === tail) return;
      queue.current.push(t);
      if (timer.current) return;
      const wait = Math.max(0, lastAt.current + minIntervalMs - performance.now());
      timer.current = setTimeout(flush, wait);
    },
    [flush, minIntervalMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-live-announcer="">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Оголосити через спільну область. Поза LiveAnnouncer — тиха заглушка (історії, тести). */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext) ?? noop;
}

function noop() {}

/** Синонім: одна ввічлива live-область сторінки. */
export const LiveRegion = LiveAnnouncer;
