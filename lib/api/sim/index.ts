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

export const simFactories: ServiceFactories = {
  passport: createSimPassport,
  notifications: createSimNotifications,
  rating: createSimRating,
  live: createSimLive,
  auth: createSimAuth,
  profile: createSimProfile,
  checkout: createSimCheckout,
  toasts: createSimToasts,
  chat: createSimChat,
};
