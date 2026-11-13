/**
 * Адаптери `sim`: обгортки над імітаторами прототипу (`docs/backend/frontend-seam.md`). Лише для `lib/api/*`:
 * компонентам і сторінкам імпортувати звідси заборонено (`no-restricted-imports` в `eslint.config.mjs`).
 */
import type { ServiceFactories } from '../services';
import { createSimNotifications } from './notifications';

export const simFactories: ServiceFactories = {
  notifications: createSimNotifications,
};
