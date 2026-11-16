'use client';

/**
 * Закриття шторки свайпом униз (Т9, 2026-11-16) — одна механіка для всіх шторок телефона.
 * `el` — елемент шторки (з callback-ref у `useState`: шторка в порталі з’являється пізніше за перший рендер).
 * Зона жесту — елементи з `data-swipe-zone` (ручка й шапка вікна; прокручуваний вміст не береться, тож жест не
 * б’ється з прокруткою) усередині `ref`. Нативні події: шапка вікна часто в порталі (у дереві React вона не
 * всередині шторки), а миша, на відміну від пальця, не «прилипає» до елемента під нею.
 * Повертає зсув шторки (px) за пальцем; закриває `close`, якщо протягнули далі `CLOSE_PX` або змахнули швидко.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const SWIPE_ZONE = '[data-swipe-zone]';
/** Скільки протягнути вниз (px), щоб шторка закрилась, якщо відпустили повільно. */
export const SWIPE_CLOSE_PX = 64;
/** Швидкість змаху (px/мс), яка закриває шторку навіть після короткого руху. */
export const SWIPE_FLICK = 0.45;
/** Скільки пройти (px), поки дотик ще вважається дотиком, а не жестом. */
export const SWIPE_MOVE_THRESHOLD = 6;

export function useSwipeDown(
  el: HTMLElement | null,
  enabled: boolean,
  close: () => void,
  opts: { zone?: string; when?: () => boolean } = {},
): number {
  const { zone = SWIPE_ZONE, when } = opts;
  const [dy, setDy] = useState(0);
  // Обробники живуть, поки шторка відкрита: свіжі `close`/`when` беремо з ref (інакше жест обірвався б перемальовкою).
  const latest = useRef({ close, when });
  useLayoutEffect(() => {
    latest.current = { close, when };
  });
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !el) return;
    window.clearTimeout(resetTimer.current);
    let drag: { id: number; startY: number; lastY: number; lastT: number; v: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(zone)) return;
      if (latest.current.when && !latest.current.when()) return;
      drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(d) < SWIPE_MOVE_THRESHOLD) return;
        drag.moved = true;
      }
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = 0.6 * drag.v + 0.4 * ((e.clientY - drag.lastY) / dt);
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      // Шторка їде за пальцем лише вниз (угору розгортати нікуди).
      setDy(Math.max(0, d));
    };
    const onEnd = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      const closing = d.moved && e.type !== 'pointercancel' && (d.lastY - d.startY > SWIPE_CLOSE_PX || d.v > SWIPE_FLICK);
      // Закриваємо — шторка їде вниз від місця, де її відпустили (без повернення вгору).
      if (!closing) setDy(0);
      if (!d.moved || e.type === 'pointercancel') return;
      // Після жесту клік (напр. по «×» чи ручці) не потрібен.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (closing) latest.current.close();
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      // Зсув скидаємо не одразу: шторка, що закривається, доїжджає вниз від місця, де її відпустили, а не стрибає вгору.
      resetTimer.current = window.setTimeout(() => setDy(0), 320);
    };
  }, [el, enabled, zone]);
  return dy;
}
