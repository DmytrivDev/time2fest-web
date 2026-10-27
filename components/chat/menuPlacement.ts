/** Відступ меню «⋯» від повідомлення, px. */
export const MENU_GAP = 4;
/** Висота меню до першого виміру (5 рядів: дії, три ряди емодзі, «Поскаржитись»), px. */
export const MENU_HEIGHT_GUESS = 250;

export type MenuPlacement = 'below' | 'above';

/**
 * Куди відкривати меню: під повідомленням, якщо між його низом і видимим низом стрічки вистачає місця на меню
 * (з відступом), інакше — над ним. Усі координати — в одній системі (viewport).
 */
export function chooseMenuPlacement(input: { anchorBottom: number; viewBottom: number; menuHeight: number; gap?: number }): MenuPlacement {
  const gap = input.gap ?? MENU_GAP;
  return input.viewBottom - input.anchorBottom - gap >= input.menuHeight ? 'below' : 'above';
}

/** Верх меню в координатах контейнера; не виходить за межі контейнера (колонка чату). */
export function menuTopInContainer(input: {
  placement: MenuPlacement;
  anchorTop: number;
  anchorBottom: number;
  containerTop: number;
  containerHeight: number;
  menuHeight: number;
  gap?: number;
}): number {
  const gap = input.gap ?? MENU_GAP;
  const raw =
    input.placement === 'below'
      ? input.anchorBottom - input.containerTop + gap
      : input.anchorTop - input.containerTop - gap - input.menuHeight;
  const max = Math.max(0, input.containerHeight - input.menuHeight);
  return Math.min(Math.max(0, raw), max);
}
