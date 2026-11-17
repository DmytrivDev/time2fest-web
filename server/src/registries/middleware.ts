/**
 * Middleware registry (AC-62): run in key order before every handler.
 * - `30-rate-limit`: a route with `rateLimit: '<row key>'` is counted against that row (AC-48 … AC-50).
 * - `40-idempotency`: a route with `idempotency: '<method>'` runs once per subject, method and
 *   `clientId` (AC-52 … AC-55).
 * A route naming an unknown row is a startup error (the dispatcher is not built).
 */
import { failure, originMiddleware, validateMiddleware } from '../endpoints/pipeline';
import type { Middleware, Outcome } from '../endpoints/types';
import { fastIdempotencyStore, idemKey, runOnce, type IdempotencyRow } from '../platform/idempotency';
import { checkLimit, type RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';
import { idempotencyRegistry } from './idempotency';
import { rateLimitRegistry } from './rateLimits';

const CLIENT_ID_MAX = 64;

export function rateLimitMiddleware(rows: readonly RateLimitRow[] = rateLimitRegistry): Middleware {
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
        { subject: ctx.subject, clock: ctx.clock },
        { fast: ctx.deps.redis, memory: ctx.deps.memory },
      );
      return verdict.ok ? next() : { ok: false, error: verdict.error };
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

export const middlewareRegistry: readonly Middleware[] = [
  originMiddleware,
  validateMiddleware,
  rateLimitMiddleware(),
  idempotencyMiddleware(),
];

assertRegistry('middleware', middlewareRegistry, (m) => m.key);
