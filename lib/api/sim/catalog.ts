/** Адаптер `sim` домену `catalog`: набір даних збірки без ланцюжків трансляцій. */
import { getData } from '@/lib/data/load';
import { catalogVersionOf } from '../contracts/site';
import type { Catalog, CatalogService } from '../contracts/catalog';

export function createSimCatalog(): CatalogService {
  return {
    catalog(): Catalog {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { chainsByEventId, ...catalog } = getData();
      return catalog;
    },
    version: () => catalogVersionOf(getData().meta),
  };
}
