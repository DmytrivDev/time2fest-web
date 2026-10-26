/** Розміщення `PlayerHost` над `PlayerSlot` (чиста функція, щоб покрити тестом). */

export const PLAYER_MIN_PX = 200;

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface HostPlacement {
  visible: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * - слот поза екраном → хост `visibility: hidden` (не `display: none`: деякі браузери ставлять відео на паузу);
 * - слот менший за 200×200 → хост схований (політика YouTube: мінімум 200×200 px);
 * - немає відео → схований.
 */
export function computeHostPlacement(
  rect: RectLike | null,
  viewport: { width: number; height: number },
  hasVideo: boolean,
): HostPlacement {
  if (!rect) return { visible: false, top: 0, left: 0, width: 0, height: 0 };
  const placement = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  const offscreen =
    rect.top + rect.height <= 0 || rect.left + rect.width <= 0 || rect.top >= viewport.height || rect.left >= viewport.width;
  const tooSmall = rect.width < PLAYER_MIN_PX || rect.height < PLAYER_MIN_PX;
  return { visible: hasVideo && !offscreen && !tooSmall, ...placement };
}
