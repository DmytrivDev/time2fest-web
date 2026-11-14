/**
 * Масштаб і переміщення мапи поясів (рішення власника 2026-11-02, дошка `Desk-Map-Base`): колесо миші, перетягування,
 * щипок двома пальцями, кнопки «−» / «+» / «Скинути»; масштаб 1–8×. `view` — масштаб `k` і зсув (x, y) у пікселях
 * рамки (`boxRef`); мапа з нього міняє `viewBox` SVG (векторно, без втрати якості), а точки — свої координати.
 * Мапа не виходить за рамку.
 * - Колесо на масштабі 100 % униз прокручує сторінку, а не мапу (щоб мапа не «ловила» прокрутку).
 * - Дотик: один палець завжди прокручує сторінку; два пальці — масштаб і рух мапою разом (рішення власника 2026-11-03:
 *   на телефоні кнопок масштабу немає, мапа не «ловить» прокрутку). Миша на десктопі тягне мапу як раніше.
 * - Після перетягування клік (по поясу, місту) не спрацьовує.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export const MIN_K = 1;
export const MAX_K = 8;
const WHEEL_SENS = 0.0015;
const STEP = 1.6;
const DRAG_PX = 4;

export interface MapView {
  k: number;
  x: number;
  y: number;
}

const START: MapView = { k: 1, x: 0, y: 0 };

function clampView(v: MapView, w: number, h: number): MapView {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
  const minX = w - w * k;
  const minY = h - h * k;
  return { k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

/** `ready` — рамка вже в DOM (геометрія завантажена): тоді й чіпляємо слухачі. */
export function useMapZoom(boxRef: RefObject<HTMLElement | null>, ready = true) {
  const [view, setViewState] = useState<MapView>(START);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const viewRef = useRef(view);
  const setView = useCallback((v: MapView) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const size = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 1, h: r?.height ?? 1, left: r?.left ?? 0, top: r?.top ?? 0 };
  };

  /** Масштаб `k` навколо точки (px, py) у координатах рамки. */
  const zoomAt = useCallback(
    (k: number, px: number, py: number) => {
      const { w, h } = size();
      const v = viewRef.current;
      const nk = Math.min(MAX_K, Math.max(MIN_K, k));
      const r = nk / v.k;
      setView(clampView({ k: nk, x: px - (px - v.x) * r, y: py - (py - v.y) * r }, w, h));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = size();
      zoomAt(viewRef.current.k * factor, w / 2, h / 2);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoomAt],
  );
  const zoomIn = useCallback(() => zoomBy(STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / STEP), [zoomBy]);
  const reset = useCallback(() => setView(START), [setView]);

  // Колесо: нативний слухач (passive: false), щоб preventDefault спрацював.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current;
      if (v.k <= MIN_K && e.deltaY > 0) return; // віддаляти нікуди — прокручуємо сторінку
      e.preventDefault();
      const { left, top } = size();
      zoomAt(v.k * Math.exp(-e.deltaY * WHEEL_SENS), e.clientX - left, e.clientY - top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRef, zoomAt, ready]);

  // Перетягування й щипок: вказівники (миша, палець, перо).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    // Два пальці: початкова відстань, середня точка й вигляд — масштаб навколо неї й рух за нею.
    let pinch: { d: number; mx: number; my: number; v: MapView } | null = null;
    let suppress = false;
    const local = (e: PointerEvent) => {
      const { left, top } = size();
      return { x: e.clientX - left, y: e.clientY - top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2, v: viewRef.current };
        drag = null;
        return;
      }
      // Один палець — прокрутка сторінки, мапу не тягнемо.
      if (e.pointerType === 'touch') return;
      const p = local(e);
      drag = { x: p.x, y: p.y, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mx = (a!.x + b!.x) / 2;
        const my = (a!.y + b!.y) / 2;
        suppress = true;
        const { w, h } = size();
        const v0 = pinch.v;
        const k = Math.min(MAX_K, Math.max(MIN_K, v0.k * (d / pinch.d)));
        // Точка мапи під початковою серединою пальців лишається під поточною серединою.
        setView(clampView({ k, x: mx - ((pinch.mx - v0.x) / v0.k) * k, y: my - ((pinch.my - v0.y) / v0.k) * k }, w, h));
        return;
      }
      if (!drag) return;
      const p = local(e);
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!drag.moved) {
        drag.moved = true;
        suppress = true;
        el.setPointerCapture?.(e.pointerId);
      }
      const { w, h } = size();
      setView(clampView({ k: viewRef.current.k, x: drag.vx + dx, y: drag.vy + dy }, w, h));
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) drag = null;
    };
    // Клік після перетягування чи щипка гаситься (не відкриваємо пояс чи місто випадково).
    const onClick = (e: MouseEvent) => {
      if (!suppress) return;
      suppress = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDownReset = () => {
      suppress = false;
    };
    // Два пальці — жест мапи, не сторінки: браузер їх не прокручує й не масштабує (один палець — як звичайно).
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length >= 2 && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouch, { passive: false });
    el.addEventListener('touchmove', onTouch, { passive: false });
    el.addEventListener('pointerdown', onDownReset, true);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    return () => {
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener('touchmove', onTouch);
      el.removeEventListener('pointerdown', onDownReset, true);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRef, zoomAt, ready]);

  // Зміна розміру рамки: тримаємо сцену в межах.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      const { w, h } = size();
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
      setView(clampView(viewRef.current, w, h));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRef, ready]);

  return { view, box, zoomIn, zoomOut, reset };
}
