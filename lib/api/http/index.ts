/**
 * Адаптери `http` (справжній бекенд) — пишуться разом із бекендом, по домену (`docs/backend/frontend-seam.md`, E1…E5).
 * Ключі — рівно `HTTP_DOMAINS` (`./domains.ts`): тип не дасть пропустити чи додати домен повз список.
 */
import type { ServiceFactories, Services } from '../services';
import { createHttpCatalog } from './catalog';
import type { HttpDomain } from './domains';

const factories: { [K in HttpDomain]: () => Services[K] } = {
  catalog: () => createHttpCatalog(),
};

export const httpFactories: ServiceFactories = factories;
