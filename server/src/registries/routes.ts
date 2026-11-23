/**
 * Route registry (AC-62): sorted, unique rows. A domain wave adds its row here and nowhere else.
 */
import { catalogRoute } from '../endpoints/catalog';
import { healthRoute } from '../endpoints/health';
import { liveChainsRoute } from '../endpoints/liveChains';
import { liveSourceErrorsRoute } from '../endpoints/liveSourceErrors';
import { realtimeTokenRoute } from '../endpoints/realtimeToken';
import { siteStateRoute } from '../endpoints/siteState';
import { timeRoute } from '../endpoints/time';
import { toastsCheckRoute } from '../endpoints/toastsCheck';
import type { RouteRow } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export const routeRegistry: readonly RouteRow[] = [
  catalogRoute,
  healthRoute,
  liveChainsRoute,
  liveSourceErrorsRoute,
  realtimeTokenRoute,
  siteStateRoute,
  timeRoute,
  toastsCheckRoute,
];

assertRegistry('routes', routeRegistry, (r) => r.key);
