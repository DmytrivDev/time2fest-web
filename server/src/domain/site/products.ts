/**
 * Product choice (SPEC-08 AC-19, AC-20; C6), ring 1 — pure.
 *
 * The owner picks, per key, one product the products port already lists; the snapshot then carries that
 * product's price and the key's `priceVersion` grows by one. No price is ever entered by hand (AC-21).
 */
import type { Money, ProductKey } from '@time2fest/contracts';

export const PRODUCT_KEYS: readonly ProductKey[] = ['pass', 'toast:2', 'toast:5', 'toast:10'];

/** A product as the products port lists it (created outside this server, SPEC-17). */
export interface CatalogProduct {
  id: string;
  key: ProductKey;
  price: Money;
}

/** The chosen product of one key. */
export interface ProductSelection {
  productId: string;
  price: Money;
  priceVersion: number;
}

export type ProductSelections = Readonly<Partial<Record<ProductKey, ProductSelection>>>;

export type ProductRefusal = 'unknown-product' | 'other-key';

export const isProductKey = (key: unknown): key is ProductKey => typeof key === 'string' && (PRODUCT_KEYS as readonly string[]).includes(key);

/**
 * Chooses `productId` for `key`: the product must be in `list` and belong to `key`, else a refusal (AC-20).
 * The new selection has the product's price and `priceVersion` = the key's previous one + 1 (AC-19).
 */
export function chooseProduct(
  list: readonly CatalogProduct[],
  key: ProductKey,
  productId: string,
  selections: ProductSelections,
): { ok: true; selection: ProductSelection; selections: ProductSelections } | { ok: false; refuse: ProductRefusal } {
  const product = list.find((p) => p.id === productId);
  if (!product) return { ok: false, refuse: 'unknown-product' };
  if (product.key !== key) return { ok: false, refuse: 'other-key' };
  const selection: ProductSelection = {
    productId: product.id,
    price: { amount: product.price.amount, currency: product.price.currency },
    priceVersion: (selections[key]?.priceVersion ?? 0) + 1,
  };
  return { ok: true, selection, selections: { ...selections, [key]: selection } };
}

/** The selections without `key` (a revert to «no product chosen»). */
export function clearProduct(key: ProductKey, selections: ProductSelections): ProductSelections {
  const { [key]: _dropped, ...rest } = selections;
  void _dropped;
  return rest;
}
