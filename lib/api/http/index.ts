/**
 * Адаптери `http` (справжній бекенд) — пишуться разом із бекендом, по домену (`docs/backend/frontend-seam.md`, E1…E5).
 * Поки порожньо: збірка з `NEXT_PUBLIC_API_MODE=http` впаде на першому ж `getService` із зрозумілою помилкою.
 */
import type { ServiceFactories } from '../services';

export const httpFactories: ServiceFactories = {};
