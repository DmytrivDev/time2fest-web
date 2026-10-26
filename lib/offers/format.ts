/** Ціни пропозицій (FR-063). Пас — разово на сезон; чайові — три суми. */
export const PASS_PRICE = 4.99;
export const TIP_AMOUNTS = [2, 5, 10] as const;
export type TipAmount = (typeof TIP_AMOUNTS)[number];

/** «$4,99», «$5»: кома як десятковий роздільник, без зайвих нулів. */
export function formatUsd(amount: number): string {
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
  return `$${text}`;
}
