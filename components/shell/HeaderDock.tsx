'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isReducedMotionNow } from '@/lib/a11y/reducedMotion';
import { computeHeaderMode, type HeaderMode } from './headerDockMode';
import styles from './headerDock.module.css';

const PLAYER_SELECTOR = '[data-player-slot],[data-sk-player]';

/** Змінна на `<html>`: висота шапки, поки вона закріплена (липка / fixed), інакше 0 — від неї відступають липкі колонки. */
export const HEADER_STUCK_VAR = '--header-stuck';

function measurePlayers(): { bottom: number | null; pinned: boolean } {
  const slots = document.querySelectorAll<HTMLElement>(PLAYER_SELECTOR);
  let bottom: number | null = null;
  let pinned = false;
  for (const el of slots) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    if (getComputedStyle(el).position === 'sticky') pinned = true;
    const b = r.bottom + window.scrollY;
    bottom = bottom === null ? b : Math.max(bottom, b);
  }
  return { bottom, pinned };
}

/**
 * Шапка, що ховається й повертається (власник 2026-11-16, Н1). Сторінка з плеєром (головна, країна, кімната): угорі шапка
 * стоїть у потоці й їде зі сторінкою — відео вона не накриває; щойно верх екрана минув низ плеєра, шапка з’їжджає зверху
 * закріпленою (`fixed`, місце в потоці лишається — стрибка немає); назад угору, до плеєра, — з’їжджає й повертається в потік.
 * Сторінка без плеєра — липка завжди. Плеєр, що сам липне (планшет-альбом), шапку не випускає: вона б його накрила.
 */
export function HeaderDock({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const dock = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<HeaderMode>('flow');
  const modeRef = useRef<HeaderMode>('flow');
  const height = useRef(0);
  const frame = useRef(0);

  const apply = useCallback((next: HeaderMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const update = useCallback(() => {
    const el = dock.current;
    if (!el) return;
    const header = el.firstElementChild as HTMLElement | null;
    const current = modeRef.current;
    if (header && (current === 'flow' || current === 'sticky')) height.current = header.offsetHeight;
    const { bottom, pinned } = measurePlayers();
    const next = computeHeaderMode({ current, scrollY: window.scrollY, playerBottom: bottom, pinned, reduced: isReducedMotionNow() });
    if (next !== current) apply(next);
  }, [apply]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      update();
    });
  }, [update]);

  useLayoutEffect(() => {
    update();
  }, [update, pathname]);

  useEffect(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Сторінка змінила висоту (завантажилась, з’явилися блоки) — низ плеєра міг зсунутись.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    // Сторінка щойно змонтувала слот плеєра (перехід без зміни висоти).
    const timers = [80, 400, 1200].map((ms) => window.setTimeout(schedule, ms));
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      timers.forEach(clearTimeout);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [schedule, pathname]);

  // Висота шапки, поки вона закріплена, — для липких колонок (чат) і `scroll-padding-top`.
  useEffect(() => {
    const root = document.documentElement;
    const stuck = mode === 'fixed' || mode === 'sticky';
    root.style.setProperty(HEADER_STUCK_VAR, stuck ? `${height.current || 0}px` : '0px');
  }, [mode]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(HEADER_STUCK_VAR);
    },
    [],
  );

  // Запасний вихід, якщо `animationend` не прийшов (рух зменшили посеред анімації).
  useEffect(() => {
    if (mode !== 'leaving') return;
    const id = window.setTimeout(() => apply('flow'), 320);
    return () => clearTimeout(id);
  }, [mode, apply]);

  const fixed = mode === 'fixed' || mode === 'leaving';
  return (
    <div
      ref={dock}
      className={styles.dock}
      data-header-dock={mode}
      style={fixed && height.current ? { height: height.current } : undefined}
      onAnimationEnd={(e) => {
        if (modeRef.current === 'leaving' && e.target === dock.current?.firstElementChild) apply('flow');
      }}
    >
      {children}
    </div>
  );
}
