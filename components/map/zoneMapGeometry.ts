// Чисті допоміжні речі мапи поясів (`ZoneMap`): класи станів, позиція плашки, відображення масштабу у viewBox і рамку.
import type { ZoneState } from '@time2fest/rules/time';
import type { MapView } from './hooks/useMapZoom';

export const FILL_CLASS: Record<ZoneState, string> = {
  past: 'is-past',
  live: 'is-live',
  next: 'is-next',
  future: 'is-ahead',
};
export const MARKER_CLASS: Record<ZoneState, string> = {
  past: 'bg-border border-border-strong',
  live: 'bg-zone-live border-background',
  next: 'bg-zone-next border-background',
  future: 'bg-zone-future border-background',
};

/** Плашка за курсором: праворуч-знизу (16 / 18 px), біля правого чи нижнього краю мапи — дзеркально. */
export function placeTipAt(
  el: HTMLElement | null,
  box: HTMLElement | null,
  p: { x: number; y: number } | null,
) {
  if (!el || !box || !p) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = p.x + 16;
  if (x + w > box.clientWidth - 8) x = Math.max(8, p.x - 16 - w);
  let y = p.y + 18;
  if (y + h > box.clientHeight - 8) y = Math.max(8, p.y - 10 - h);
  // Над точкою — закріплена шапка (мапа частково під нею): плашка лишається під курсором, а не ховається під шапку.
  if (y < coveredTop(box) + 8) y = p.y + 18;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** Скільки верху рамки мапи (px) зараз під закріпленою шапкою сторінки (`fixed` / `sticky`); 0 — не накрито. */
function coveredTop(box: HTMLElement): number {
  if (typeof document === 'undefined') return 0;
  const header = document.querySelector('header');
  if (!header) return 0;
  let el: HTMLElement | null = header;
  let pinned = false;
  for (let i = 0; el && i < 3; i += 1, el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') pinned = true;
  }
  if (!pinned) return 0;
  const bottom = header.getBoundingClientRect().bottom;
  return Math.max(0, bottom - box.getBoundingClientRect().top);
}

/** Видима частина мапи (координати мапи): масштаб — через viewBox, тож усе лишається векторним і чітким. */
export function viewBoxOf(zoom: MapView, box: { w: number }, mw: number, mh: number) {
  const pxToMap = box.w > 0 ? mw / box.w : 0;
  return {
    x: (-zoom.x * pxToMap) / zoom.k,
    y: (-zoom.y * pxToMap) / zoom.k,
    w: mw / zoom.k,
    h: mh / zoom.k,
  };
}

/** Точка мапи (відсотки повної мапи) → відсотки рамки з урахуванням масштабу й зсуву. */
export function placeOnMap(
  zoom: MapView,
  box: { w: number; h: number },
  leftPct: number,
  topPct: number,
) {
  return {
    left: `${leftPct * zoom.k + (box.w > 0 ? (zoom.x / box.w) * 100 : 0)}%`,
    top: `${topPct * zoom.k + (box.h > 0 ? (zoom.y / box.h) * 100 : 0)}%`,
  };
}
