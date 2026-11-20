import type { SiteState } from '@/lib/api/contracts/site';
import { PASS_PRICE } from './format';
import { TOAST_TIERS } from '@/lib/toast/tiers';

export interface SitePrices {
  pass: number;
  tiers: Record<2 | 5 | 10, number>;
}

/** Ціни у доларах зі знімка (`amount` — центи). Відсутній ключ — значення збірки, тож порожній список виглядає як раніше. */
export function sitePrices(state: Pick<SiteState, 'products'> | undefined): SitePrices {
  const cents = (key: string): number | undefined => state?.products.find((p) => p.key === key)?.price.amount;
  const dollars = (key: string, fallback: number): number => {
    const c = cents(key);
    return c === undefined ? fallback : c / 100;
  };
  const [t2, t5, t10] = TOAST_TIERS;
  return {
    pass: dollars('pass', PASS_PRICE),
    tiers: { 2: dollars('toast:2', t2), 5: dollars('toast:5', t5), 10: dollars('toast:10', t10) },
  };
}
