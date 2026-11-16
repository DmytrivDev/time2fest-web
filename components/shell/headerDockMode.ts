/**
 * Режим шапки (`HeaderDock`): `flow` — у потоці, їде зі сторінкою; `sticky` — липка (сторінка без плеєра); `fixed` — закріплена
 * й з’їхала (минули плеєр); `leaving` — їде вгору, повертаючись у потік.
 */
export type HeaderMode = 'flow' | 'sticky' | 'fixed' | 'leaving';

export interface HeaderModeInput {
  current: HeaderMode;
  scrollY: number;
  /** Низ найнижчого плеєра сторінки (координата в документі); `null` — плеєра немає. */
  playerBottom: number | null;
  /** Плеєр сам липне до верху (планшет-альбом) — шапка не може його накрити. */
  pinned: boolean;
  reduced: boolean;
}

export function computeHeaderMode({ current, scrollY, playerBottom, pinned, reduced }: HeaderModeInput): HeaderMode {
  if (playerBottom === null) return 'sticky';
  const passed = !pinned && scrollY >= playerBottom;
  if (passed) return 'fixed';
  if (current === 'fixed') return reduced ? 'flow' : 'leaving';
  if (current === 'leaving') return 'leaving';
  return 'flow';
}
