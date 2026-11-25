/**
 * Middleware registry (AC-62): run in key order before every handler.
 * - `05-edge-time`: feeds the edge-divergence meter from a verified edge mark (SPEC-07 AC-10 … AC-14).
 * - `25-subject`: `ctx.subject` from the session cookie (SPEC-10 AC-30); a `subject: 'required'` route without a
 *   session creates a guest first (AC-4, [П-6]); every later step runs in the auth scope (session events, merge).
 * - `30-rate-limit`: a route with `rateLimit: '<row key>'` is counted against that row (AC-48 … AC-50) by
 *   `subject`, `device` and `ipDay`.
 * - `40-idempotency`: a route with `idempotency: '<method>'` runs once per subject, method and
 *   `clientId` (AC-52 … AC-55).
 * A route naming an unknown row is a startup error (the dispatcher is not built).
 */
import { startGuestSession } from '../adapters/sessionSubjects';
import { runInAuthScope } from '../auth/scope';
import { ipHeaderValue } from '../auth/request';
import { AUTH_BASE_PATH, AUTH_IP_HEADER } from '../auth/instance';
import { authOf } from '../endpoints/deps';
import { failure, originMiddleware, toResponse, validateMiddleware } from '../endpoints/pipeline';
import type { Ctx, Middleware, Outcome } from '../endpoints/types';
import { DEVICE_COOKIE } from '../platform/device';
import { fastIdempotencyStore, idemKey, runOnce, type IdempotencyRow } from '../platform/idempotency';
import { checkKeyedLimit, checkLimit, type RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';
import { EDGE_NOW_HEADER, parseEdgeNow } from '../timekeeping/divergence';
import { idempotencyRegistry } from './idempotency';
import { rateLimitRegistry } from './rateLimits';

const CLIENT_ID_MAX = 64;

/** Longest window of an `ipDay` row: the fingerprint salt lives one UTC day (SPEC-05 AC-29). */
const IP_DAY_MAX_WINDOW_MS = 86_400_000;

export function rateLimitMiddleware(rows: readonly RateLimitRow[] = rateLimitRegistry): Middleware {
  for (const r of rows) {
    if (r.keys.includes('ipDay') && r.windowMs > IP_DAY_MAX_WINDOW_MS) {
      throw new Error(`rate-limits: ${r.key} ipDay window exceeds 24 h`);
    }
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    key: '30-rate-limit',
    check(routes) {
      for (const route of routes) {
        if (route.rateLimit !== undefined && !byKey.has(route.rateLimit)) {
          throw new Error(`routes: ${route.key} names unknown rate-limit row ${route.rateLimit}`);
        }
      }
    },
    async run(ctx, next) {
      const name = ctx.route.rateLimit;
      if (name === undefined) return next();
      const row = byKey.get(name);
      if (!row) return failure('unknown');
      const verdict = await checkLimit(
        row,
        { subject: ctx.subject, device: ctx.device, ipDay: row.keys.includes('ipDay') ? await ctx.client.ipDay() : undefined },
        { fast: ctx.deps.redis, memory: ctx.deps.memory },
      );
      return verdict.ok ? next() : { ok: false, error: verdict.error };
    },
  };
}

/** The limit rows of guest creation: per client (`ipDay`) and per IPv6 /48 (IPv4 /24), S10-08. */
export const GUEST_CREATE_ROW = 'auth-guest-create';
export const GUEST_CREATE_IP48_ROW = 'auth-guest-create-ip48';
const USER_AGENT_MAX = 128;

/** The only headers a server-side guest start sends: device cookie, client IP header, user agent. */
async function guestHeaders(ctx: Ctx): Promise<Headers> {
  const headers = new Headers();
  headers.set('cookie', `${DEVICE_COOKIE}=${ctx.device}`);
  headers.set(AUTH_IP_HEADER, ipHeaderValue(await ctx.client.ipDay()));
  const ua = ctx.req.headers.get('user-agent');
  if (ua !== null) headers.set('user-agent', ua.slice(0, USER_AGENT_MAX));
  return headers;
}

/**
 * `25-subject` (SPEC-10 [П-6]). Resolves the subject through `Deps.subjects` for every non-public row outside
 * `/api/auth/*` (Better Auth reads its own session there; skipping saves a second read per sign-in call).
 * A `subject: 'required'` row without a subject: `auth-guest-create` is counted (61st per client in 10 min →
 * `rate_limited`), a guest is created on the request's device and its session cookie added to the answer.
 */
export function subjectMiddleware(rows: readonly RateLimitRow[] = rateLimitRegistry): Middleware {
  const guestRow = rows.find((r) => r.key === GUEST_CREATE_ROW);
  const ip48Row = rows.find((r) => r.key === GUEST_CREATE_IP48_ROW);
  return {
    key: '25-subject',
    check(routes) {
      for (const route of routes) {
        if (route.subject !== 'required') continue;
        if (route.public) throw new Error(`routes: ${route.key} needs a subject but is public`);
        if (!guestRow) throw new Error(`routes: ${route.key} needs a subject but rate-limit row ${GUEST_CREATE_ROW} is missing`);
      }
    },
    run(ctx, next) {
      return runInAuthScope(async () => {
        if (ctx.route.public !== true && !ctx.url.pathname.startsWith(`${AUTH_BASE_PATH}/`) && ctx.subject === undefined) {
          const found = await ctx.deps.subjects?.resolve(ctx.req);
          if (found) ctx.subject = found.id;
        }
        if (ctx.route.subject !== 'required' || ctx.subject !== undefined) return next();
        if (!guestRow) return failure('unknown');
        const stores = { fast: ctx.deps.redis, memory: ctx.deps.memory };
        const verdict = await checkLimit(guestRow, { ipDay: await ctx.client.ipDay() }, stores);
        if (!verdict.ok) return { ok: false, error: verdict.error };
        const ip48 = await ctx.client.ip48Day();
        if (ip48Row && !ip48.startsWith('noaddr:')) {
          const wide = await checkKeyedLimit(ip48Row, ip48, stores, ctx.clock.now());
          if (!wide.ok) return { ok: false, error: wide.error };
        }
        const guest = await startGuestSession(authOf(ctx.deps), await guestHeaders(ctx));
        ctx.subject = guest.id;
        const res = toResponse(await next());
        const headers = new Headers(res.headers);
        for (const line of guest.cookies) headers.append('set-cookie', line);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      });
    },
  };
}

export function idempotencyMiddleware(rows: readonly IdempotencyRow[] = idempotencyRegistry): Middleware {
  const byMethod = new Map(rows.map((r) => [r.method, r]));
  return {
    key: '40-idempotency',
    check(routes) {
      for (const route of routes) {
        if (route.idempotency === undefined) continue;
        if (!byMethod.has(route.idempotency)) {
          throw new Error(`routes: ${route.key} names unknown idempotency method ${route.idempotency}`);
        }
        if (!route.body) throw new Error(`routes: ${route.key} is idempotent but has no body schema for clientId`);
      }
    },
    async run(ctx, next) {
      const method = ctx.route.idempotency;
      if (method === undefined) return next();
      const row = byMethod.get(method);
      if (!row) return failure('unknown');
      const clientId = (ctx.body as { clientId?: unknown } | undefined)?.clientId;
      if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > CLIENT_ID_MAX) {
        return failure('validation', { reason: 'invalid-input', message: 'clientId' });
      }
      // The stored result is keyed by subject: without one there is nobody to remember it for.
      if (ctx.subject === undefined || ctx.subject === '') return failure('unauthorized');
      const stores = { chat: fastIdempotencyStore(ctx.deps.redis), order: ctx.deps.orderStore };
      return runOnce<Outcome>(
        row,
        idemKey(ctx.subject, row.method, clientId),
        async () => {
          const out = await next();
          if (out instanceof Response) throw new Error(`idempotent route ${ctx.route.key} returned a raw Response`);
          return out;
        },
        stores,
      );
    },
  };
}

/**
 * `05-edge-time`: a request that carries the valid edge secret and a well-formed `x-t2f-edge-now` feeds the
 * divergence meter (SPEC-07 AC-10, AC-11). Without the secret the header is ignored, silently.
 */
export const edgeTimeMiddleware: Middleware = {
  key: '05-edge-time',
  async run(ctx, next) {
    if (ctx.client.edgeVerified && ctx.deps.divergence) {
      const mark = parseEdgeNow(ctx.req.headers.get(EDGE_NOW_HEADER));
      if (mark !== undefined) ctx.deps.divergence.sample(mark);
    }
    return next();
  },
};

export const middlewareRegistry: readonly Middleware[] = [
  edgeTimeMiddleware,
  originMiddleware,
  validateMiddleware,
  subjectMiddleware(),
  rateLimitMiddleware(),
  idempotencyMiddleware(),
];

assertRegistry('middleware', middlewareRegistry, (m) => m.key);
