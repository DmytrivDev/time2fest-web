/**
 * Реєстр сервісів шва (`docs/backend/frontend-seam.md`): хук бере свій сервіс тут — `getService('notifications')`.
 * Адаптер обирає `API_MODE` (`sim` | `http`); тести підміняють будь-який сервіс через `setServicesForTest`.
 * Домен потрапляє у фабрики, коли його перенесено (етапи E1…E5); до того `getService` для нього кидає помилку —
 * отже старий код домену ще не мусить ходити через шов.
 */
import { IS_TEST_BUILD } from '@/lib/env';
import { domainServer, MIGRATED_DOMAINS, splitDomains, type DomainRule, type DomainServer, type DomainSplit } from './domains';
import { API_MODE, type ApiMode } from './mode';
import { resetAllResources } from './resource';
import type { AuthService } from './contracts/auth';
import type { CatalogService } from './contracts/catalog';
import type { ChatService } from './contracts/chat';
import type { CheckoutService } from './contracts/checkout';
import type { LiveService } from './contracts/live';
import type { NotificationsService } from './contracts/notifications';
import type { PassportService } from './contracts/passport';
import type { ProfileService } from './contracts/profile';
import type { RatingService } from './contracts/rating';
import type { SiteService } from './contracts/site';
import type { ToastsService } from './contracts/toasts';
import { httpFactories } from './http';
// Імітація — лише через `simEntry` (у робочій збірці `http` його підміняє `next.config.ts`, і `sim` не потрапляє в пакет;
// в інтеграційній — test + http — лишається для доменів без адаптера `http`).
import { simFactories, simFaults } from '@/lib/api/simEntry';
import type { FaultControls } from './sim/faults';

export interface Services {
  catalog: CatalogService;
  live: LiveService;
  chat: ChatService;
  toasts: ToastsService;
  checkout: CheckoutService;
  auth: AuthService;
  profile: ProfileService;
  passport: PassportService;
  rating: RatingService;
  notifications: NotificationsService;
  site: SiteService;
}

export type ServiceName = keyof Services;
export type ServiceFactories = { [K in ServiceName]?: () => Services[K] };

export { MIGRATED_DOMAINS };

/** Правило збірки (`lib/api/domains.ts`) над справжніми фабриками. */
function ruleOf(mode: ApiMode, testBuild: boolean): DomainRule {
  return { mode, testBuild, hasHttp: (d) => !!httpFactories[d], hasSim: (d) => !!simFactories[d] };
}

/** Хто обслуговує домен у цій збірці: `http`, `sim` (режим `sim` або інтеграційна збірка) чи `null` — нікого. */
export function domainSource(name: ServiceName, mode: ApiMode = API_MODE, testBuild = IS_TEST_BUILD): DomainServer | null {
  return domainServer(name, ruleOf(mode, testBuild));
}

/** Розклад перенесених доменів за сервером (тести й `window.__t2f.apiDomains`). */
export function apiDomains(mode: ApiMode = API_MODE, testBuild = IS_TEST_BUILD): DomainSplit {
  return splitDomains(ruleOf(mode, testBuild));
}

/** Перенесені домени без адаптера в цій збірці (у робочій `http` — усі, яких ще немає на бекенді). */
export function missingDomains(mode: ApiMode = API_MODE, testBuild = IS_TEST_BUILD): ServiceName[] {
  return apiDomains(mode, testBuild).missing;
}

const instances: Partial<Services> = {};
let overrides: Partial<Services> = {};

export function getService<K extends ServiceName>(name: K): Services[K] {
  const injected = overrides[name];
  if (injected) return injected as Services[K];
  const ready = instances[name];
  if (ready) return ready as Services[K];
  const by = domainSource(name);
  const factory = by === 'http' ? httpFactories[name] : by === 'sim' ? simFactories[name] : undefined;
  if (!factory) throw new Error(`[api] домен «${name}» ще не перенесено на шов у режимі ${API_MODE}`);
  const made = factory() as Services[K];
  instances[name] = made;
  return made;
}

/** Тести: підмінити сервіси (кеші ресурсів скидаються). Повертає функцію відновлення. */
export function setServicesForTest(partial: Partial<Services>): () => void {
  const before = overrides;
  overrides = { ...overrides, ...partial };
  resetAllResources();
  return () => {
    overrides = before;
    resetAllResources();
  };
}

/**
 * Затримки й відмови імітованих сервісів (`window.__t2f.api`): у `sim` і в інтеграційній збірці (там діють лише на домени,
 * що лишилися на імітації); у робочій `http` — немає.
 */
export function faultControls(mode: ApiMode = API_MODE, testBuild = IS_TEST_BUILD): FaultControls | undefined {
  return mode === 'sim' || testBuild ? (simFaults as FaultControls | undefined) : undefined;
}
