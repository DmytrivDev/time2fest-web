/**
 * Адаптери `sim`: обгортки над імітаторами прототипу (`docs/backend/frontend-seam.md`). Лише для `lib/api/*`:
 * компонентам і сторінкам імпортувати звідси заборонено (`no-restricted-imports` в `eslint.config.mjs`).
 */
import type { ServiceFactories } from '../services';
import { createSimAuth } from './auth';
import { createSimChat } from './chat';
import { createSimCheckout } from './checkout';
import { createSimLive } from './live';
import { createSimNotifications } from './notifications';
import { createSimPassport } from './passport';
import { createSimProfile } from './profile';
import { createSimToasts } from './toasts';
import { createSimRating } from './rating';
import { withFaults } from './faults';

export { simFaults } from './faults';

/** Кожен адаптер — під обгорткою затримок і відмов (`faults.ts`): стани мережі видно й у `sim`. */
export const simFactories: ServiceFactories = {
  passport: () => withFaults('passport', createSimPassport()),
  notifications: () => withFaults('notifications', createSimNotifications()),
  rating: () => withFaults('rating', createSimRating()),
  live: () => withFaults('live', createSimLive()),
  auth: () => withFaults('auth', createSimAuth()),
  profile: () => withFaults('profile', createSimProfile()),
  checkout: () => withFaults('checkout', createSimCheckout()),
  toasts: () => withFaults('toasts', createSimToasts()),
  chat: () => withFaults('chat', createSimChat()),
};
