/**
 * Підміна `lib/api/simEntry.ts` у збірці `NEXT_PUBLIC_API_MODE=http` (`next.config.ts`, `turbopack.resolveAlias`):
 * жодного адаптера імітації — реєстр бачить лише `httpFactories`.
 */
import type { ServiceFactories } from '../services';

export const simFactories: ServiceFactories = {};
