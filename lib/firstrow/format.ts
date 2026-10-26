/** Формати «Першого ряду»: ціна «$4,99» і табло утримання «1:58». */

/** «$4,99» (кома — десятковий роздільник, як у макетах). */
export function formatPrice(amount: number): string {
  return '$' + amount.toFixed(2).replace('.', ',');
}

/** Залишок утримання «m:ss» (вниз до секунди, не менше 0:00). */
export function formatHoldLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
