/**
 * Route registry (AC-62): sorted, unique rows. A domain wave adds its row here and nowhere else.
 */
import { catalogRoute } from '../endpoints/catalog';
import { timeRoute } from '../endpoints/time';
import type { RouteRow } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export const routeRegistry: readonly RouteRow[] = [catalogRoute, timeRoute];

assertRegistry('routes', routeRegistry, (r) => r.key);
