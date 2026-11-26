/**
 * Адаптери `http` (справжній бекенд) — пишуться разом із бекендом, по домену (`docs/backend/frontend-seam.md`, E1…E5).
 * Ключі — рівно `HTTP_DOMAINS` (`./domains.ts`): тип не дасть пропустити чи додати домен повз список.
 */
import type { ServiceFactories, Services } from '../services';
// Повні шляхи: передстартова збірка підміняє адаптери входу й профілю (`resolveAlias` у `next.config.ts`).
import { createHttpAuth } from '@/lib/api/http/auth';
import { createHttpCatalog } from './catalog';
import { createHttpLive } from './live';
import { createHttpProfile } from '@/lib/api/http/profile';
import { createHttpSite } from './site';
import { buildSnapshot } from '../site/buildSnapshot';
import { getData } from '@/lib/data/load';
import type { HttpDomain } from './domains';

/** Літерал збирання: без `NEXT_PUBLIC_REALTIME_URL` гілка з `import()` мертва, і `centrifuge` у пакет не потрапляє (як `site.ts`). */
const realtimeLoader = process.env.NEXT_PUBLIC_REALTIME_URL
  ? () => import('./realtime').then((m) => m.getRealtimeTransport())
  : null;

const factories: { [K in HttpDomain]: () => Services[K] } = {
  auth: () => createHttpAuth({ transport: realtimeLoader }),
  profile: () => createHttpProfile({ transport: realtimeLoader }),
  catalog: () => createHttpCatalog(),
  // Запасний знімок збірки (FR-EDGE-06 крок 5) впорскуємо тут, щоб адаптер не тягнув `lib/data`.
  site: () => createHttpSite({ buildSnapshot: () => buildSnapshot(getData().meta) }),
  // Ланцюжки збірки — для передстартової збірки (без мережі); так само впорскуємо, щоб адаптер не тягнув `lib/data`.
  live: () => createHttpLive({ buildChains: () => [...getData().chainsByEventId.values()] }),
};

export const httpFactories: ServiceFactories = factories;
