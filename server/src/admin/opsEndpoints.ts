/**
 * The owner's monitoring endpoints (SPEC-13b AC-30, AC-31, AC-36, AC-66), Payload glue (ring 4), thin: the overview is
 * `ops/overview.ts`, its sources `adapters/overviewSources.ts`. Served under `/cms-api/ops/*` in every class.
 *
 * - `GET /cms-api/ops/overview` → `{ ok, value: Overview }`, `Cache-Control: no-store`, at most 64 KB. A failing
 *   provider is `errors:[<block>]` in the value, never a failed request.
 * - `POST /cms-api/ops/settings` → changes the parameters of the global `ops-settings` (ceilings, prices, heartbeat
 *   minute, digest time), a subset of the keys, strict. One transaction: the update, `version + 1` and one journal row
 *   `ops.settings` (before / after of the changed keys).
 * Both: behind the Access gate and the `owner` role (agents → 403 `forbidden`, nothing read or changed); the POST also
 * needs `content-type: application/json` and a body of at most 1 KB (`admin/cmsHttp.ts`).
 */
import { commitTransaction, initTransaction, killTransaction } from 'payload';
import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { overviewSourcesOf } from '../adapters/overviewSources';
import { createPayloadJournal } from '../adapters/payloadJournal';
import { resolveActor } from '../audit/journal';
import type { Deps } from '../endpoints/types';
import { buildOverview } from '../ops/overview';
import { isRevertible } from '../registries/revertHandlers';
import { fail, isOwner, jsonBodyOf, NO_STORE } from './cmsHttp';

export const OPS_SETTINGS = 'ops-settings';
export const OPS_SETTINGS_ACTION = 'ops.settings';
const CONTEXT = { t2fTrusted: true, t2fInternal: true };

const money = z.number().finite().min(0).max(1_000_000);
/** The editable keys of `ops-settings` (everything but `version`); a request carries a non-empty subset. */
export const OpsSettingsBodySchema = z
  .object({
    serverCeilingUsd: money,
    cloudflareCeilingUsd: money,
    mailCeilingUsd: money,
    priceStoragePerGbUsd: money,
    priceClassAPerMillionUsd: money,
    priceClassBPerMillionUsd: money,
    freeClassA: money,
    freeClassB: money,
    freeStorageGb: money,
    heartbeatMinute: z.number().int().min(0).max(59),
    digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0);
export type OpsSettingsBody = z.infer<typeof OpsSettingsBodySchema>;

function overviewEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/ops/overview',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      try {
        const overview = await buildOverview(await overviewSourcesOf(await resolve()));
        return Response.json({ ok: true, value: overview }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

/** Updates the changed keys, `version + 1` and the journal row in one transaction on `req`. Returns the new version. */
export async function saveOpsSettings(req: PayloadRequest, body: OpsSettingsBody, now: () => number): Promise<{ version: number; changed: boolean }> {
  const started = await initTransaction(req);
  try {
    const own = { ...req, context: { ...req.context, ...CONTEXT } } as PayloadRequest;
    const before = (await own.payload.findGlobal({ slug: OPS_SETTINGS, req: own, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>;
    const keys = Object.keys(body) as (keyof OpsSettingsBody)[];
    const changedKeys = keys.filter((k) => before[k] !== body[k]);
    const version = typeof before.version === 'number' ? before.version : 0;
    if (changedKeys.length === 0) {
      if (started) await commitTransaction(req);
      return { version, changed: false };
    }
    const data = Object.fromEntries(changedKeys.map((k) => [k, body[k]]));
    await own.payload.updateGlobal({ slug: OPS_SETTINGS, data: { ...data, version: version + 1 } as never, req: own, depth: 0, overrideAccess: true });
    await createPayloadJournal(isRevertible).append(own, {
      actor: ownerActor(req),
      action: OPS_SETTINGS_ACTION,
      target: { collection: OPS_SETTINGS, id: OPS_SETTINGS },
      at: now(),
      before: Object.fromEntries(changedKeys.map((k) => [k, before[k] ?? null])),
      after: data,
      revertOf: null,
    });
    if (started) await commitTransaction(req);
    return { version: version + 1, changed: true };
  } catch (err) {
    if (started) await killTransaction(req);
    throw err;
  }
}

function settingsEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/ops/settings',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, OpsSettingsBodySchema);
      if (body === null) return fail('validation');
      try {
        const deps = await resolve();
        const result = await saveOpsSettings(req, body, () => deps.clock.now());
        return Response.json({ ok: true, value: result }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

/** The monitoring endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function opsEndpoints(resolve: () => Promise<Deps>): Endpoint[] {
  return [overviewEndpoint(resolve), settingsEndpoint(resolve)];
}
