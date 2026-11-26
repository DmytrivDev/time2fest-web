/**
 * Ціни (FR-063). Пас — разово на Новий рік 2026/27 ($7, рішення власника 2026-11-26; було $5). Рівні тосту $2 / $5 / $10 —
 * `lib/toast/tiers.ts`.
 */
export const PASS_PRICE = 7;

/** «$2,50», «$5»: кома як десятковий роздільник, без зайвих нулів. */
export function formatUsd(amount: number): string {
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
  return `$${text}`;
}
