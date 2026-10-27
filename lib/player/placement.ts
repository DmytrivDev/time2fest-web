/** Розміщення `PlayerHost` над `PlayerSlot` (чиста функція, щоб покрити тестом). */

export const PLAYER_MIN_PX = 200;

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * `absolute` — у системі координат оболонки макета (прокрутка нічого не змінює) ·
 * `fixed` — слот нерухомий відносно вікна (телефонний закріплений плеєр).
 */
export type HostMode = 'absolute' | 'fixed';

export interface HostPlacement {
  mode: HostMode;
  visible: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * - `rect` — прямокутник слоту у вікні; `origin` — лівий верхній кут оболонки у вікні (для `absolute`) або `{0, 0}`;
 * - слот менший за 200×200 → хост схований (політика YouTube: мінімум 200×200 px);
 * - немає відео → схований (`visibility: hidden`, не `display: none`: деякі браузери ставлять відео на паузу).
 */
export function computeHostPlacement(
  rect: RectLike | null,
  origin: { top: number; left: number },
  mode: HostMode,
  hasVideo: boolean,
): HostPlacement {
  if (!rect) return { mode, visible: false, top: 0, left: 0, width: 0, height: 0 };
  const tooSmall = rect.width < PLAYER_MIN_PX || rect.height < PLAYER_MIN_PX;
  return {
    mode,
    visible: hasVideo && !tooSmall,
    top: rect.top - origin.top,
    left: rect.left - origin.left,
    width: rect.width,
    height: rect.height,
  };
}
