/**
 * Константи, зона жестів, пошук опори й розрахунок геометрії закріпленого вікна чату (`ChatDock`).
 * Чисті функції без React і сторів: стиль вікна й стиль шару вікон за готовими числами.
 */
import type { CSSProperties } from 'react';
import { CLOSE_MS } from '@/components/shell/OverlayManager';

/** Висота зони жестів у згорнутому стані: ручка + рядок. */
export const COLLAPSED_ROW = 46;
export const MOVE_THRESHOLD = 6;
/** Найменша висота розгорнутого вікна під смугою; менше — чат займає всю видиму область (накриває відео й смугу). */
export const MIN_DOCK = 300;
/** Скільки висоти має «з’їсти» екранна клавіатура, щоб вважати її відкритою. */
export const KB_MIN = 80;
export const FIELD = '[data-composer] textarea, [data-composer] input';
export const FLICK_PX_PER_MS = 0.5;
/** Усе, що в шапці працює саме по собі (дотик не перемикає вікно). */
export const INTERACTIVE = 'button, a, input, textarea, select, [role="radiogroup"], [role="group"], [role="menu"]';
export const ZONE = '[data-dock-grip], .t2f-dock-grip-handle';
/** Зона жестів шару вікон: ручка й шапка вікна. */
export const LAYER_ZONE = '.t2f-layer-grip, [data-window-layer] [data-board-header]';
/** Скільки протягнути шар униз (px), щоб він закрився, якщо відпустили повільно. */
export const LAYER_CLOSE_PX = 80;

/**
 * Телефон-альбом: усе, що лишається над чатом (відео, рядок часу й позначене `data-dock-above`), — прямі діти `<main>`; беремо
 * останнього з них (за порядком у DOM). Чат у потоці стає одразу після нього.
 */
export function findAnchor(main: HTMLElement | null): HTMLElement | null {
  if (!main) return null;
  let last: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>('[data-dock-above]').forEach((el) => {
    let n: HTMLElement | null = el;
    while (n && n.parentElement !== main) n = n.parentElement;
    if (n) last = n;
  });
  if (last) return last;
  return main.querySelector<HTMLElement>(':scope > [data-player-slot="main"]');
}

/** Стан жесту на шапці вікна чату. */
export interface DragState {
  id: number;
  startY: number;
  startH: number;
  collapsedH: number;
  expandedH: number;
  lastY: number;
  lastT: number;
  v: number;
  moved: boolean;
  h: number;
}

/** Видима область: висота, зсув, висота вікна браузера й висота без клавіатури. */
export interface DockViewport {
  h: number;
  off: number;
  inner: number;
  idle: number;
}

/** Інлайн-стиль вікна чату: верх під рядком часу, висота над клавіатурою чи за пальцем. */
export function dockStyle(o: {
  open: boolean;
  land: boolean;
  landFlow: boolean;
  kbOpen: boolean;
  vv: DockViewport;
  inset: number;
  top: number;
  dragH: number | null;
}): CSSProperties & Record<'--dock-top', string> {
  const { open, land, landFlow, kbOpen, vv, inset, top, dragH } = o;
  // Портрет, розгорнутий, відкрита клавіатура: чат у видимій області над нею; замало місця під смугою — на всю видиму
  // область. Без клавіатури висота завжди одна — під рядком часу (рішення 2026-10-28).
  let geo: CSSProperties | null = null;
  if (open && !land && vv.h > 0 && inset > 0) {
    const free = vv.h - top;
    geo = { height: free >= MIN_DOCK ? free : vv.h, bottom: inset };
  }
  // Альбом, розгорнутий, клавіатура: блок чату = видима область; решту прокручуємо вгору (див. ефект нижче).
  if (landFlow && kbOpen) geo = { height: vv.h };
  return {
    '--dock-top': `${top}px`,
    ...geo,
    ...(dragH !== null ? { height: dragH } : null),
  };
}

/**
 * Шар вікон: портрет — вікна чату під рядком часу (як розгорнутий чат), решта — під відео; альбом — весь екран;
 * клавіатура — видима область.
 */
export function layerStyle(o: {
  land: boolean;
  layerKb: boolean;
  layerTall: boolean;
  layerClosing: boolean;
  layerDy: number;
  vv: DockViewport;
  inset: number;
  top: number;
  videoTop: number;
}): CSSProperties {
  const { land, layerKb, layerTall, layerClosing, layerDy, vv, inset, top, videoTop } = o;
  let layerGeo: CSSProperties;
  if (land) layerGeo = layerKb ? { top: vv.off, bottom: 'auto', height: vv.h } : { top: 0, height: '100svh', borderRadius: 0 };
  else if (layerKb) {
    const free = vv.h - (layerTall ? videoTop : top);
    layerGeo = { height: free >= MIN_DOCK ? free : vv.h, bottom: inset };
  } else layerGeo = { height: `calc(100svh - ${layerTall ? videoTop : top}px)` };
  if (layerDy) layerGeo = { ...layerGeo, transform: `translateY(${layerDy}px)`, transition: 'none' };
  if (layerClosing) layerGeo = { ...layerGeo, transform: 'translateY(100%)', transition: `transform ${CLOSE_MS}ms ease-out` };
  return layerGeo;
}
