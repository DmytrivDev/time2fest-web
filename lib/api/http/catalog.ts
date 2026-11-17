/**
 * Адаптер `http` домену `catalog` (SPEC-04): каталог вбудовано під час збирання з `GET /api/catalog`
 * (`next.config.ts` + `lib/data/catalogSource.mjs`, аліас `@/data/*.json`), тож читання синхронне, а `version()` —
 * версія, яку віддав сервер, і вона збігається з `catalogVersionOf(meta)`.
 */
import { getData } from '@/lib/data/load';
import { catalogVersionOf } from '../contracts/site';
import type { Catalog, CatalogService } from '../contracts/catalog';

export function createHttpCatalog(): CatalogService {
  return {
    catalog(): Catalog {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { chainsByEventId, ...catalog } = getData();
      return catalog;
    },
    version: () => catalogVersionOf(getData().meta),
  };
}
