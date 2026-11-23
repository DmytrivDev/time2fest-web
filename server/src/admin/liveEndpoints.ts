/**
 * The owner's live-air endpoints (SPEC-12 AC-50 … AC-56, AC-58; [А12]), Payload glue (ring 4), thin: the actions and
 * the view are `live/actions.ts`. Served under `/cms-api/live/*` in every class.
 *
 * - `GET /cms-api/live/view` → `{ ok, value: LiveView }` with the quota percent added: the live sources of the current
 *   and next midnight slot, the available actions, the three quota buckets (used, %, reset time UTC).
 * - `POST /cms-api/live/{hide,unhide,main,override,zone-live,replace}` `LiveActionBody` (strict; its `action` must be
 *   the path's) → `{ ok, value: { version, changed } }`.
 * Both: behind the Access gate (the proxy's identity marker) and the `owner` role, else 403 `forbidden` with nothing
 * read or changed (agent keys included, AC-56). The POST also needs `content-type: application/json` and a body of at
 * most 1 KB, refused before parsing (`admin/cmsHttp.ts`). Refusals: `invalid` → 400 `validation` (with `reason`),
 * `not-found` → 404. The request is the transaction: the change, its journal row and the outbox event commit together.
 */
import type { LiveActionBody } from '@time2fest/contracts';
import { LiveActionBodySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import { resolveActor } from '../audit/journal';
import { liveOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { applyLiveAction, LIVE_ACTION_NAMES, liveView, type LiveActionResult } from '../live/actions';
import { liveActionsOf } from '../registries/revertHandlers';
import { fail, isOwner, jsonBodyOf, NO_STORE } from './cmsHttp';

const PERCENT = 100;

/** The owner from the request, as the journal names them. */
const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

function answer(result: LiveActionResult): Response {
  if (result.ok) return Response.json({ ok: true, value: { version: result.version, changed: result.changed } }, { headers: NO_STORE });
  if (result.reason === 'forbidden') return fail('forbidden');
  if (result.reason === 'not-found') return fail('not-found');
  return fail('validation', result.detail);
}

function viewEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/live/view',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      try {
        const deps = await resolve();
        const view = await liveView(liveActionsOf(deps), liveOf(deps).quota);
        const quota = view.quota.map((q) => ({ ...q, percent: Math.floor(q.ratio * PERCENT) }));
        return Response.json({ ok: true, value: { ...view, quota } }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function actionEndpoint(action: LiveActionBody['action'], resolve: () => Promise<Deps>): Endpoint {
  return {
    path: `/live/${action}`,
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, LiveActionBodySchema);
      if (body === null || body.action !== action) return fail('validation');
      const deps = liveActionsOf(await resolve());
      try {
        return answer(await applyLiveAction(deps, req, ownerActor(req), body));
      } catch {
        // One transaction: a failed store wrote nothing.
        return fail('unavailable');
      }
    },
  };
}

/** The live endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function liveEndpoints(resolve: () => Promise<Deps>): Endpoint[] {
  return [viewEndpoint(resolve), ...LIVE_ACTION_NAMES.map((action) => actionEndpoint(action, resolve))];
}
