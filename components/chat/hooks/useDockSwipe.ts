/**
 * Жести закріпленого вікна чату: свайп/дотик на шапці вікна (`useDockSwipe`) і свайп униз з ручки чи шапки шару
 * вікон поза чатом (`useLayerSwipe`).
 */
import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { useSwipeDown } from '@/lib/overlay/useSwipeDown';
import { measureSheetTop, stableViewportH } from '@/lib/overlay/sheetTop';
import {
  COLLAPSED_ROW,
  DOCK_SNAP_DOWN_PX,
  DOCK_SNAP_UP_PX,
  FLICK_PX_PER_MS,
  INTERACTIVE,
  LAYER_ZONE,
  SLOT_ZONE,
  MOVE_THRESHOLD,
  ZONE,
  type DragState,
} from '@/components/chat/chatDockGeometry';

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
    if (!inCollapsedRow && !target.closest(ZONE) && !target.closest(SLOT_ZONE)) return;
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
    const goExpanded = landFlow
      ? !(dyTotal > 60 || d.v > FLICK_PX_PER_MS)
      : Math.abs(d.v) > FLICK_PX_PER_MS
        ? d.v < 0
        : // Т9 (2026-11-16): рішення за напрямком і короткою відстанню, а не «півшляху» (розгорнутий чат — майже на весь екран,
          // і до половини його було важко дотягнути): вниз від розгорнутого — від 64 px, угору від згорнутого — від 40 px.
          expanded
          ? dyTotal < DOCK_SNAP_DOWN_PX
          : dyTotal < -DOCK_SNAP_UP_PX;
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
 * Шар вікон: свайп униз з ручки чи шапки закриває вікно (спільна механіка шторок — `useSwipeDown`).
 * Повертає зсув шару (px) за пальцем.
 */
export function useLayerSwipe(layerEl: HTMLDivElement | null, layerOpen: boolean, land: boolean, closeLayer: () => void) {
  void land;
  return useSwipeDown(layerEl, layerOpen, closeLayer, { zone: LAYER_ZONE });
}
