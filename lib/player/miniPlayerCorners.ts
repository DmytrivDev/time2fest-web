/** Кути мініплеєра й вибір кута, у якому він не закриває елемент у фокусі (чиста логіка, покрита тестом). */

export type MiniPlayerCorner = 'bottom-left' | 'top-left' | 'bottom-right' | 'top-right';

/** Відеообласть 356×200 (DESIGN `mini-player`) + рамка 1 px + смуга керування 44 px. */
export const MINI_VIDEO_WIDTH = 356;
export const MINI_VIDEO_HEIGHT = 200;
export const MINI_BAR_HEIGHT = 44;
export const MINI_BORDER = 1;
export const MINI_WIDTH = MINI_VIDEO_WIDTH + MINI_BORDER * 2;
export const MINI_HEIGHT = MINI_VIDEO_HEIGHT + MINI_BAR_HEIGHT + MINI_BORDER * 2;
/** Відступ від краю вікна (токен spacing.6 = 24 px; `bottom-6 start-6` у класах). */
export const MINI_INSET = 24;
/** Відступ згори під шапку (висота шапки десктопа 64 px + spacing.4; клас `top-20` = 80 px). */
export const MINI_INSET_TOP = 80;

/** Колонка чату праворуч, тому типовий набір кутів — ліві. */
export const DEFAULT_CORNERS: readonly MiniPlayerCorner[] = ['bottom-left', 'top-left'];

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function cornerBox(corner: MiniPlayerCorner, viewport: { width: number; height: number }): Box {
  const left = corner.endsWith('left') ? MINI_INSET : viewport.width - MINI_INSET - MINI_WIDTH;
  const top = corner.startsWith('top') ? MINI_INSET_TOP : viewport.height - MINI_INSET - MINI_HEIGHT;
  return { top, left, width: MINI_WIDTH, height: MINI_HEIGHT };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/** Наступний кут зі списку по колу (для кнопки «Перемістити в інший кут»). */
export function nextCorner(current: MiniPlayerCorner, corners: readonly MiniPlayerCorner[] = DEFAULT_CORNERS): MiniPlayerCorner {
  if (corners.length === 0) return current;
  const i = corners.indexOf(current);
  return corners[(i + 1) % corners.length] ?? current;
}

/**
 * Якщо фокус потрапив під мініплеєр, переходимо в перший за колом кут, де елемент не закритий.
 * `null` — переносити не треба (немає перекриття або вільного кута).
 */
export function cornerAvoiding(
  current: MiniPlayerCorner,
  corners: readonly MiniPlayerCorner[],
  focusBox: Box,
  viewport: { width: number; height: number },
): MiniPlayerCorner | null {
  if (!boxesOverlap(cornerBox(current, viewport), focusBox)) return null;
  const start = Math.max(0, corners.indexOf(current));
  for (let step = 1; step < corners.length; step += 1) {
    const candidate = corners[(start + step) % corners.length];
    if (candidate && !boxesOverlap(cornerBox(candidate, viewport), focusBox)) return candidate;
  }
  return null;
}
