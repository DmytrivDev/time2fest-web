/**
 * Root Payload endpoints of the owner (SPEC-07 AC-51 … AC-53, AC-75, AC-77; C9), served under
 * `/cms-api/<path>` (Payload's REST handler matches root `endpoints` there). Payload glue (ring 4), thin:
 * the slice is `scheduler/festival.ts`, the clock actions `timekeeping/control.ts`.
 *
 * - `GET /cms-api/festival-state` → `{ ok, value: FestivalStateView }` in every class, read only.
 * - `POST /cms-api/clock` `{ action: 'set', at } | { action: 'real' } | { action: 'restart-night' }`
 *   → `{ ok, value: { now, speed, virtual, epoch } }`. Registered ONLY in `rehearsal` and `test`: in
 *   `production` the path does not exist, so Payload answers it exactly like an unknown path (AC-52).
 * Both: behind the Access gate (the proxy's identity marker, checked again here like every guarded
 * Payload endpoint) and the `owner` role, else 403 with nothing read or changed (AC-53, AC-77). The
 * POST also needs `content-type: application/json` (S4-01: a cross-site form cannot send it without
 * a preflight; the proxy checks Origin) and a body of at most 1 KB matching the strict C9 schema.
 * Speed is not an admin action: it exists only in the `ops` CLI (spec07-q1).
 */
import type { ClockControlValue } from '@time2fest/contracts';
import { ClockControlBodySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import { hasJsonContentType, passedGate } from '../access/payloadGuard';
import { roleOf } from '../access/policies';
import { clockControlDepsOf, festivalDepsOf, processDeps } from '../adapters/processDeps';
import { resolveActor } from '../audit/journal';
import type { Deps } from '../endpoints/types';
import type { EnvClass } from '../platform/env';
import { festivalState } from '../scheduler/festival';
import { CLOCK_CONTROL_CLASSES, controlClock } from '../timekeeping/control';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 1024;

type Code = 'forbidden' | 'validation' | 'unavailable';
const STATUS: Record<Code, number> = { forbidden: 403, validation: 400, unavailable: 503 };
const fail = (code: Code) => Response.json({ ok: false, error: { code } }, { status: STATUS[code], headers: NO_STORE });

/** Owner who passed the Access gate (or a server-side call carrying an owner user). */
const isOwner = (req: PayloadRequest) => passedGate(req) && roleOf(req.user) === 'owner';

/** The parsed C9 body, or `null` (wrong type, empty, over 1 KB, not JSON, not the strict schema). */
async function clockBodyOf(req: PayloadRequest) {
  if (!hasJsonContentType(req)) return null;
  // S07-02: refuse before reading when the declared length is missing, not a number or over the limit.
  const declared = req.headers.get('content-length');
  if (declared === null || !/^\d{1,9}$/.test(declared) || Number(declared) > MAX_BODY_BYTES) return null;
  try {
    const text = req.text ? await req.text() : '';
    if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
    const parsed = ClockControlBodySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function festivalStateEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/festival-state',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const deps = await resolve();
      const view = await festivalState(festivalDepsOf(deps, async () => req.payload));
      return Response.json({ ok: true, value: view }, { headers: NO_STORE });
    },
  };
}

function clockEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/clock',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await clockBodyOf(req);
      if (body === null) return fail('validation');
      const control = clockControlDepsOf(await resolve());
      if (!control) return fail('forbidden');
      try {
        const result = await controlClock(control, 'owner', { ...resolveActor(req.user, req.context), kind: 'owner' }, body);
        if (!result.ok) return fail(result.code);
        const { now, speed, virtual, epoch } = result.value;
        const value: ClockControlValue = { now, speed, virtual, epoch };
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        // The change is one transaction: a failed store wrote nothing.
        return fail('unavailable');
      }
    },
  };
}

/**
 * The root endpoints of class `cls`. `resolve` gives the process deps (tests may pass their own).
 * `POST /clock` exists only where clock control exists (`rehearsal`, `test`).
 */
export function cmsEndpointsFor(cls: EnvClass, resolve: () => Promise<Deps> = processDeps): Endpoint[] {
  const endpoints = [festivalStateEndpoint(resolve)];
  if (CLOCK_CONTROL_CLASSES.includes(cls)) endpoints.push(clockEndpoint(resolve));
  return endpoints;
}
