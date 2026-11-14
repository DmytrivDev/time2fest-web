/**
 * Реєстр сервісів шва (`docs/backend/frontend-seam.md`): хук бере свій сервіс тут — `getService('notifications')`.
 * Адаптер обирає `API_MODE` (`sim` | `http`); тести підміняють будь-який сервіс через `setServicesForTest`.
 * Домен потрапляє у фабрики, коли його перенесено (етапи E1…E5); до того `getService` для нього кидає помилку —
 * отже старий код домену ще не мусить ходити через шов.
 */
import { API_MODE } from './mode';
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
import type { ToastsService } from './contracts/toasts';
import { httpFactories } from './http';
// Імітація — лише через `simEntry` (у збірці `http` його підміняє `next.config.ts`, і `sim` не потрапляє в пакет).
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
}

export type ServiceName = keyof Services;
export type ServiceFactories = { [K in ServiceName]?: () => Services[K] };

/** Домени, які інтерфейс уже бере через шов (E0–E5): без їхніх адаптерів сайт працювати не може. */
export const MIGRATED_DOMAINS: readonly ServiceName[] = ['notifications', 'rating', 'live', 'auth', 'profile', 'checkout', 'toasts', 'chat', 'passport'];

/** Перенесені домени без адаптера в поточному режимі (у `http` зараз — усі: бекенду ще немає). */
export function missingDomains(mode = API_MODE): ServiceName[] {
  const factories = mode === 'http' ? httpFactories : simFactories;
  return MIGRATED_DOMAINS.filter((d) => !factories[d]);
}

const instances: Partial<Services> = {};
let overrides: Partial<Services> = {};

export function getService<K extends ServiceName>(name: K): Services[K] {
  const injected = overrides[name];
  if (injected) return injected as Services[K];
  const ready = instances[name];
  if (ready) return ready as Services[K];
  const factory = (API_MODE === 'http' ? httpFactories : simFactories)[name];
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

/** Лише `sim` (тестова й демо-збірка): затримки й відмови сервісів для станів мережі (`window.__t2f.api`). */
export function faultControls(): FaultControls | undefined {
  return API_MODE === 'sim' ? (simFaults as FaultControls | undefined) : undefined;
}
