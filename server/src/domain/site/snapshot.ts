/**
 * Snapshot assembly (SPEC-08 AC-8, AC-9, AC-18, AC-42), ring 1 — pure.
 *
 * The `site` snapshot is the stored site record (version, switches, product selections) plus the
 * effective event patches of the corrections and the catalog version. `products` come from the
 * selections only, which are made only from the products port (AC-18: an empty port → `products: []`).
 */
import { catalogVersionOf, type SiteEventPatch, type SiteProduct, type SiteState, type SiteSwitches } from '@time2fest/contracts';
import { PRODUCT_KEYS, type ProductSelections } from './products';
import { DEFAULT_SWITCHES, type PaymentsPause } from './switches';

/** The stored site record, as the site store returns it. */
export interface SiteRecord {
  /** Grows by at least one with every committed change (AC-4); 1 before the first. */
  version: number;
  /** ISO time of the last change; `null` before the first. */
  at: string | null;
  switches: SiteSwitches;
  paymentsPause: PaymentsPause;
  productSelections: ProductSelections;
}

export const DEFAULT_SITE_RECORD: SiteRecord = Object.freeze({
  version: 1,
  at: null,
  switches: DEFAULT_SWITCHES,
  paymentsPause: null,
  productSelections: Object.freeze({}),
});

export interface SnapshotInput {
  record: SiteRecord;
  /** Effective event patches by event id (the corrections' read port, `currentPatches`). */
  patches: Readonly<Record<string, SiteEventPatch>>;
  catalogMeta: { generatedAt: string; tzdbVersion: string };
}

/** The products of the snapshot, in key order. */
export function productsOf(selections: ProductSelections): SiteProduct[] {
  return PRODUCT_KEYS.flatMap((key) => {
    const s = selections[key];
    return s ? [{ key, price: { amount: s.price.amount, currency: s.price.currency }, priceVersion: s.priceVersion }] : [];
  });
}

/**
 * The snapshot. `at` is the record's last change; a record never changed has none, so the catalog's
 * `generatedAt` stands in (deterministic: the same version always gives the same body).
 */
export function buildSnapshot({ record, patches, catalogMeta }: SnapshotInput): SiteState {
  return {
    version: record.version,
    at: record.at ?? catalogMeta.generatedAt,
    switches: record.switches,
    products: productsOf(record.productSelections),
    catalogVersion: catalogVersionOf(catalogMeta),
    eventPatches: { ...patches },
  };
}

/** The prepared technical file's body (AC-42): the state with `outage: 'technical'`. */
export function technicalOf(state: SiteState): SiteState {
  return { ...state, outage: 'technical' };
}
