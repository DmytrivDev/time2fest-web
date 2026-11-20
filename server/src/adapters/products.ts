/**
 * Adapters of the products port (SPEC-08 AC-18), ring 4. No real provider here: the real adapter and the
 * product import come with SPEC-17. `emptyProducts` is the default of every class; `createFakeProducts`
 * is a settable in-memory list used only by the test door in the `test` class.
 */
import type { CatalogProduct, ProductCatalog } from '../site/ports';

export const emptyProducts: ProductCatalog = Object.freeze({
  list: async (): Promise<readonly CatalogProduct[]> => [],
});

export interface FakeProducts extends ProductCatalog {
  /** Replaces the whole list (a copy is kept). */
  set(list: readonly CatalogProduct[]): void;
}

export function createFakeProducts(initial: readonly CatalogProduct[] = []): FakeProducts {
  const copy = (list: readonly CatalogProduct[]) => list.map((p) => ({ id: p.id, key: p.key, price: { amount: p.price.amount, currency: p.price.currency } }));
  let current = copy(initial);
  return {
    async list() {
      return copy(current);
    },
    set(list) {
      current = copy(list);
    },
  };
}
