/**
 * Route registry (AC-62): sorted, unique rows. A domain wave adds its row here and nowhere else.
 */
import { authRoutes } from '../endpoints/auth';
import { catalogRoute } from '../endpoints/catalog';
import { chatNickCheckRoute } from '../endpoints/chatNick';
import { healthRoute } from '../endpoints/health';
import { liveChainsRoute } from '../endpoints/liveChains';
import { liveSourceErrorsRoute } from '../endpoints/liveSourceErrors';
import { liveViewerTokenRoute } from '../endpoints/liveViewerToken';
import { liveViewersRoute } from '../endpoints/liveViewers';
import { meRoutes } from '../endpoints/me';
import { meAccountRoutes } from '../endpoints/meAccount';
import { presenceBeatRoute } from '../endpoints/presence';
import { realtimeTokenRoute } from '../endpoints/realtimeToken';
import { siteStateRoute } from '../endpoints/siteState';
import { stampRoutes } from '../endpoints/stamps';
import { timeRoute } from '../endpoints/time';
import { toastsCheckRoute } from '../endpoints/toastsCheck';
import type { RouteRow } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export const routeRegistry: readonly RouteRow[] = [
  ...authRoutes,
  catalogRoute,
  chatNickCheckRoute,
  healthRoute,
  liveChainsRoute,
  liveSourceErrorsRoute,
  liveViewerTokenRoute,
  liveViewersRoute,
  ...meAccountRoutes,
  ...meRoutes,
  presenceBeatRoute,
  realtimeTokenRoute,
  siteStateRoute,
  ...stampRoutes,
  timeRoute,
  toastsCheckRoute,
];

assertRegistry('routes', routeRegistry, (r) => r.key);
