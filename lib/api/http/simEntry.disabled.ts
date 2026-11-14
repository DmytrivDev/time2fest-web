/**
 * Підміна `lib/api/simEntry.ts` у збірці `NEXT_PUBLIC_API_MODE=http` (`next.config.ts`, `turbopack.resolveAlias`):
 * жодного адаптера імітації — реєстр бачить лише `httpFactories`.
 */
import type { ServiceFactories } from '../services';
import type { FaultControls } from '../sim/faults';

export const simFactories: ServiceFactories = {};

/** Затримок і відмов імітації в робочій збірці немає. */
export const simFaults: FaultControls | undefined = undefined;
