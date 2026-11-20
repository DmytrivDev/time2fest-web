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
 *
 * SPEC-08 (AC-10, AC-16, AC-17, AC-19 … AC-21), every class, the same gate, role, JSON and 1 KB rules:
 * - `POST /cms-api/site/switch` `SiteSwitchBody` → toggle-with-reason, mode always `manual`;
 * - `POST /cms-api/site/product` `SiteProductBody` → the choice of a product the products port lists;
 * - `GET /cms-api/site/view` → `{ state, paymentsPause, products, selections }` for the owner's slice.
 * A write runs in one transaction on the request (record, journal row, outbox event). Refusals:
 * `invalid` → 400 `validation` (with `reason`, e.g. `unknown-product`), `forbidden` → 403. No endpoint
 * accepts an amount: a price is always the listed product's.
 */
import type { ClockControlValue } from '@time2fest/contracts';
import { ClockControlBodySchema, SiteProductBodySchema, SiteSwitchBodySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import type { ZodType } from 'zod';
import { hasJsonContentType, passedGate } from '../access/payloadGuard';
import { roleOf } from '../access/policies';
import { clockControlDepsOf, festivalDepsOf, processDeps } from '../adapters/processDeps';
import { resolveActor } from '../audit/journal';
import { siteOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import type { EnvClass } from '../platform/env';
import { festivalState } from '../scheduler/festival';
import { chooseProduct, toggle, type SiteResult } from '../site/service';
import { readSnapshot } from '../site/snapshot';
import { CLOCK_CONTROL_CLASSES, controlClock } from '../timekeeping/control';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 1024;

type Code = 'forbidden' | 'validation' | 'unavailable';
const STATUS: Record<Code, number> = { forbidden: 403, validation: 400, unavailable: 503 };
const fail = (code: Code, reason?: string) =>
  Response.json({ ok: false, error: reason ? { code, reason } : { code } }, { status: STATUS[code], headers: NO_STORE });

/** Owner who passed the Access gate (or a server-side call carrying an owner user). */
const isOwner = (req: PayloadRequest) => passedGate(req) && roleOf(req.user) === 'owner';

/** The body as text, read at most `MAX_BODY_BYTES + 1` bytes; `null` when it is longer than the limit. */
async function boundedText(req: PayloadRequest): Promise<string | null> {
  const body = (req as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== 'function') return req.text ? req.text() : '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The parsed body of `schema`, or `null` (wrong type, empty, over 1 KB, not JSON, not the strict schema). */
async function jsonBodyOf<T>(req: PayloadRequest, schema: ZodType<T>): Promise<T | null> {
  if (!hasJsonContentType(req)) return null;
  // S07-02: a declared length over the limit (or malformed) is refused before reading; without a declared
  // length (the request may arrive re-wrapped by Next/Payload) the body is read as a stream and cut at the limit.
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  try {
    const text = await boundedText(req);
    if (text === null || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
    const parsed = schema.safeParse(JSON.parse(text));
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
      // The owner's view is authoritative: re-read the shared clock instead of trusting this process's cache
      // (a process without the background refresher, or a change made a moment ago on another instance).
      await deps.sharedClock?.refresh().catch(() => undefined);
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
      const body = await jsonBodyOf(req, ClockControlBodySchema);
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

/** A site service result as the owner's answer. */
function siteAnswer(result: SiteResult): Response {
  if (!result.ok) return result.reason === 'forbidden' ? fail('forbidden') : fail('validation', result.detail);
  return Response.json({ ok: true, value: { version: result.version, changed: result.changed } }, { headers: NO_STORE });
}

/** The owner from the request, as the journal names them. */
const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

function siteSwitchEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/site/switch',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, SiteSwitchBodySchema);
      if (body === null) return fail('validation');
      const site = siteOf(await resolve());
      try {
        // The request is the transaction: the record, its journal row and the outbox event commit together.
        return siteAnswer(await toggle(site, req, ownerActor(req), body, 'manual'));
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function siteProductEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/site/product',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, SiteProductBodySchema);
      if (body === null) return fail('validation');
      const site = siteOf(await resolve());
      try {
        return siteAnswer(await chooseProduct(site, req, ownerActor(req), body));
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function siteViewEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/site/view',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const site = siteOf(await resolve());
      try {
        const [read, record, products] = await Promise.all([readSnapshot(site.snapshot), site.store.read(), site.products.list()]);
        if (!read.ok) return fail('unavailable', read.reason);
        const value = { state: read.state, paymentsPause: record.paymentsPause, products, selections: record.productSelections };
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
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
  // SPEC-08: the owner's site-state endpoints exist in every class.
  endpoints.push(siteProductEndpoint(resolve), siteSwitchEndpoint(resolve), siteViewEndpoint(resolve));
  return endpoints;
}
