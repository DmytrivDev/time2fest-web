/**
 * Адаптери `http` (справжній бекенд) — пишуться разом із бекендом, по домену (`docs/backend/frontend-seam.md`, E1…E5).
 * Ключі — рівно `HTTP_DOMAINS` (`./domains.ts`): тип не дасть пропустити чи додати домен повз список.
 */
import type { ServiceFactories, Services } from '../services';
import { createHttpCatalog } from './catalog';
import { createHttpLive } from './live';
import { createHttpSite } from './site';
import { buildSnapshot } from '../site/buildSnapshot';
import { getData } from '@/lib/data/load';
import type { HttpDomain } from './domains';

const factories: { [K in HttpDomain]: () => Services[K] } = {
  catalog: () => createHttpCatalog(),
  // Запасний знімок збірки (FR-EDGE-06 крок 5) впорскуємо тут, щоб адаптер не тягнув `lib/data`.
  site: () => createHttpSite({ buildSnapshot: () => buildSnapshot(getData().meta) }),
  // Ланцюжки збірки — для передстартової збірки (без мережі); так само впорскуємо, щоб адаптер не тягнув `lib/data`.
  live: () => createHttpLive({ buildChains: () => [...getData().chainsByEventId.values()] }),
};

export const httpFactories: ServiceFactories = factories;
