'use client';

/**
 * Жести закріпленого вікна чату: свайп/дотик на шапці вікна (`useDockSwipe`) і свайп униз з ручки чи шапки шару
 * вікон поза чатом (`useLayerSwipe`).
 */
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { measureSheetTop, stableViewportH } from '@/lib/overlay/sheetTop';
import {
  COLLAPSED_ROW,
  FLICK_PX_PER_MS,
  INTERACTIVE,
  LAYER_CLOSE_PX,
  LAYER_ZONE,
  MOVE_THRESHOLD,
  ZONE,
  type DragState,
} from './chatDockGeometry';

export function useDockSwipe(o: {
  sectionRef: RefObject<HTMLElement | null>;
  expanded: boolean;
  top: number;
  setTop: (v: number) => void;
  landFlow: boolean;
  expand: () => void;
  collapse: () => void;
}) {
  const { sectionRef, expanded, top, setTop, landFlow, expand, collapse } = o;
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [dragH, setDragH] = useState<number | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const el = sectionRef.current;
    if (!el) return;
    const inCollapsedRow = !!target.closest('.t2f-dock-collapsed');
    if (!inCollapsedRow && !target.closest(ZONE)) return;
    const collapsedH = !expanded && el.offsetHeight ? el.offsetHeight : COLLAPSED_ROW + 12;
    const expandedH = Math.max(collapsedH + 1, stableViewportH() - (expanded ? top : measureSheetTop('chat')));
    dragRef.current = {
      id: e.pointerId,
      startY: e.clientY,
      startH: el.offsetHeight,
      collapsedH,
      expandedH,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      moved: false,
      h: el.offsetHeight,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    // Кнопку відпущено поза вікном (модальне меню перехопило pointerup) — жесту немає.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < MOVE_THRESHOLD) return;
      d.moved = true;
      if (d.startH <= d.collapsedH + 1) setTop(measureSheetTop('chat'));
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = 0.6 * d.v + 0.4 * ((e.clientY - d.lastY) / dt);
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.h = Math.max(d.collapsedH, Math.min(d.expandedH, d.startH - dy));
    // Чат у потоці (альбом) не тягнеться за пальцем: свайп униз лише згортає.
    if (!landFlow) setDragH(d.h);
  };
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const dyTotal = d.lastY - d.startY;
    const progress = (d.h - d.collapsedH) / (d.expandedH - d.collapsedH);
    const goExpanded = landFlow
      ? !(dyTotal > 60 || d.v > FLICK_PX_PER_MS)
      : Math.abs(d.v) > FLICK_PX_PER_MS
        ? d.v < 0
        : progress > 0.5;
    setDragH(null);
    if (e.type === 'pointercancel') return;
    if (goExpanded && !expanded) expand();
    else if (!goExpanded && expanded) collapse();
  };

  // Дотик до шапки поза кнопками перемикає стан (кадр 3 макета); після жесту клік гаситься.
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!expanded) return;
    if (!target.closest(ZONE) || target.closest(INTERACTIVE)) return;
    collapse();
  };

  return { dragH, onPointerDown, onPointerMove, onPointerEnd, onClickCapture, onClick };
}

/**
 * Шар вікон: свайп униз з ручки чи шапки закриває вікно. Нативні події: шапка вікна — у порталі
 * (у дереві React вона не всередині вікна чату), а миша, на відміну від пальця, не «прилипає» до елемента під нею.
 * Повертає зсув шару (px) за пальцем.
 */
export function useLayerSwipe(layerRef: RefObject<HTMLDivElement | null>, layerOpen: boolean, land: boolean, closeLayer: () => void) {
  const [layerDy, setLayerDy] = useState(0);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layerOpen || !layer) return;
    let drag: { id: number; startY: number; lastY: number; lastT: number; v: number; moved: boolean } | null = null;
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(LAYER_ZONE)) return;
      drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dy) < MOVE_THRESHOLD) return;
        drag.moved = true;
      }
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = 0.6 * drag.v + 0.4 * ((e.clientY - drag.lastY) / dt);
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      // Шар їде за пальцем лише вниз (угору розгортати нікуди).
      setLayerDy(Math.max(0, dy));
    };
    const onEnd = (e: globalThis.PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      const closing = d.moved && e.type !== 'pointercancel' && (d.lastY - d.startY > LAYER_CLOSE_PX || d.v > FLICK_PX_PER_MS);
      // Закриваємо — шар їде вниз від того місця, де його відпустили (без повернення вгору).
      if (!closing) setLayerDy(0);
      if (!d.moved || e.type === 'pointercancel') return;
      // Після жесту клік (напр. по «×» чи ручці) не потрібен.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (closing) closeLayer();
    };
    layer.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      layer.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setLayerDy(0);
    };
  }, [layerRef, layerOpen, land, closeLayer]);
  return layerDy;
}
