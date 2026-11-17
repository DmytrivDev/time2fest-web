/**
 * Route registry (AC-62): sorted, unique rows. A domain wave adds its row here and nowhere else.
 */
import { timeRoute } from '../endpoints/time';
import type { RouteRow } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export const routeRegistry: readonly RouteRow[] = [timeRoute];

assertRegistry('routes', routeRegistry, (r) => r.key);
