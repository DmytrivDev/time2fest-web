import { describe, expect, it } from 'vitest';
import { sitePrices } from '@/lib/offers/prices';

describe('sitePrices', () => {
  it('порожні продукти — ціни збірки', () => {
    const p = sitePrices({ products: [] });
    expect([p.pass, p.tiers[2], p.tiers[5], p.tiers[10]]).toEqual([7, 2, 5, 10]);
  });
  it('без знімка — ціни збірки', () => {
    expect(sitePrices(undefined).pass).toBe(7);
  });
  it('продукт у центах — у доларах', () => {
    const p = sitePrices({ products: [{ key: 'pass', price: { amount: 700, currency: 'USD' }, priceVersion: 1 }] });
    expect(p.pass).toBe(7);
    expect(p.tiers[10]).toBe(10);
  });
});
