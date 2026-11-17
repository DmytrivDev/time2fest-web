/** Чиста математика слайдера розкладу: доводка до краю картки, гумовий край, межі. */

/** Найближча позиція, кратна кроку картки, у межах `[0, max]`; біля кінця — рівно в кінець. */
export function snapPosition(target: number, step: number, max: number): number {
  if (max <= 0 || step <= 0) return 0;
  let pos = Math.max(0, Math.min(max, Math.round(target / step) * step));
  if (pos > max - step / 2) pos = max;
  return pos;
}

/** Позиція під час перетягування: за межами `[0, max]` рух у 3 рази повільніший («гумка»). */
export function rubberBand(pos: number, max: number): number {
  if (pos < 0) return pos / 3;
  if (pos > max) return max + (pos - max) / 3;
  return pos;
}

/** Видима частка треку (0..1) і зсув смужки прогресу (у % ширини смужки). */
export function progressBar(pos: number, max: number, visible: number, total: number): { widthPct: number; leftPct: number } {
  const vis = total > 0 ? Math.min(1, visible / total) : 1;
  const clamped = Math.max(0, Math.min(max, pos));
  return { widthPct: vis * 100, leftPct: max > 0 ? (clamped / max) * (100 - vis * 100) : 0 };
}
