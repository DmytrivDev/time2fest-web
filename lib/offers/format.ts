/**
 * Ціни (FR-063). Пас — разово на сезон ($5, рішення власника 2026-11-12; було $4,99). Рівні тосту $2 / $5 / $10 —
 * `lib/toast/tiers.ts`.
 */
export const PASS_PRICE = 5;

/** «$2,50», «$5»: кома як десятковий роздільник, без зайвих нулів. */
export function formatUsd(amount: number): string {
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
  return `$${text}`;
}
