/**
 * HTTP pipeline (ring 4, driving adapter): exact route match, middleware in registry order,
 * the error model and its status map (AC-22 … AC-28, AC-60, AC-72).
 * - Unknown method + path → one 404 body, also used for test doors outside the test class (AC-30).
 * - A failure body keeps only the wire fields; `message` survives only as a field path or a log id.
 * - An unexpected throw is logged with a log id and answered `unknown`, never with its text (AC-26).
 * - A body larger than the row's `maxBodyBytes` (16 KiB by default) is refused `invalid-input`
 *   before it is read whole: by `content-length` first, then by a hard cap while streaming.
 */
import { randomBytes } from 'node:crypto';
import type { ApiError, ApiErrorCode } from '@time2fest/contracts';
import { DependencyUnavailable } from '../ports';
import type { ApiFailure, Ctx, Deps, HttpMethod, Middleware, Outcome, RouteRow } from './types';

/** Status of every error code. `network` is never produced by the server. */
export const errors: Readonly<Record<ApiErrorCode, number>> = Object.freeze({
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  unknown: 500,
  network: 503,
});

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

const MUTATING: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const METHODS: ReadonlySet<string> = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FIELD_PATH = /^[A-Za-z0-9_.[\]]+$/;
export const LOG_ID = /^log_[a-z0-9]{10}$/;
const LOG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CONNECTION_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ETIMEDOUT', '57P01']);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Default request-body limit of a route row (`RouteRow.maxBodyBytes`). */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export function failure(code: ApiErrorCode, extra: Omit<ApiError, 'code'> = {}): ApiFailure {
  return { ok: false, error: { code, ...extra } };
}

export function newLogId(): string {
  const bytes = randomBytes(10);
  let id = 'log_';
  for (const b of bytes) id += LOG_ALPHABET[b % LOG_ALPHABET.length];
  return id;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS } });
}

/** The 404 of every unknown `/api/*` path — and of every door outside the test class. */
export function notFoundResponse(): Response {
  return json({ ok: false, error: { code: 'not_found' } }, 404);
}

/** Only the wire fields of `ApiError`, each with its wire type (AC-27). */
function cleanError(e: ApiError): ApiError {
  const out: ApiError = { code: e.code in errors ? e.code : 'unknown' };
  if (typeof e.reason === 'string' && /^[a-z0-9-]+$/.test(e.reason)) out.reason = e.reason;
  if (Number.isInteger(e.retryAfterMs) && (e.retryAfterMs as number) > 0) out.retryAfterMs = e.retryAfterMs;
  if (Number.isInteger(e.attemptsLeft) && (e.attemptsLeft as number) >= 0) out.attemptsLeft = e.attemptsLeft;
  if (typeof e.message === 'string' && (FIELD_PATH.test(e.message) || LOG_ID.test(e.message))) out.message = e.message;
  return out;
}

function toResponse(outcome: Outcome): Response {
  if (outcome instanceof Response) return outcome;
  if (outcome.ok) return json({ ok: true, value: outcome.value }, 200);
  const error = cleanError(outcome.error);
  return json({ ok: false, error }, errors[error.code]);
}

/** A connection-level failure of Postgres or Redis, possibly wrapped (`cause`, `AggregateError`). */
export function isDependencyFailure(err: unknown, depth = 0): boolean {
  if (depth > 4 || err === null || typeof err !== 'object') return false;
  if (err instanceof DependencyUnavailable) return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && (CONNECTION_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) return true;
  const nested = [(err as { cause?: unknown }).cause, ...((err as { errors?: unknown[] }).errors ?? [])];
  return nested.some((e) => isDependencyFailure(e, depth + 1));
}

function firstIssuePath(error: unknown): string | undefined {
  const issues = (error as { issues?: { path?: PropertyKey[] }[] }).issues;
  const path = issues?.[0]?.path;
  if (!path || path.length === 0) return undefined;
  return path.map(String).join('.');
}

function invalidInput(path?: string): ApiFailure {
  return failure('validation', { reason: 'invalid-input', ...(path ? { message: path } : {}) });
}

/** The `Host` header (or the URL host when there is none) names this machine; any port. */
export function isLoopbackHost(req: Request, url: URL): boolean {
  const host = req.headers.get('host') ?? url.host;
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isJsonContentType(req: Request): boolean {
  const type = req.headers.get('content-type');
  return type !== null && type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * `10-origin`: a mutating request needs an allowed `Origin`, unless its row is exempt (AC-28).
 * A test door is never exempt: its `Host` must be loopback (no DNS rebinding), a mutating call
 * must be `application/json` (a cross-site form or no-cors fetch cannot send it without a
 * preflight), and an `Origin`, when present, must be allowed; only a missing `Origin` (tooling)
 * passes without one.
 */
export const originMiddleware: Middleware = {
  key: '10-origin',
  async run(ctx, next) {
    const { req, route } = ctx;
    if (route.testDoor) {
      if (!isLoopbackHost(req, ctx.url)) return failure('forbidden');
      if (MUTATING.has(req.method) && !isJsonContentType(req)) return failure('forbidden');
    }
    if (!MUTATING.has(req.method) || (route.sameOriginExempt && !route.testDoor)) return next();
    const allowed = ctx.env.vars.T2F_ALLOWED_ORIGINS;
    const origin = req.headers.get('origin');
    if (origin === null && route.testDoor) return next();
    if (origin === null || !Array.isArray(allowed) || !allowed.includes(origin)) return failure('forbidden');
    return next();
  },
};

/** The body as text, or `undefined` when it is over `max` bytes (declared or actually streamed). */
async function readBody(req: Request, max: number): Promise<string | undefined> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > max)) return undefined;
  if (req.body === null) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** `20-validate`: body and query against the row schemas; the handler does not run on failure (AC-24). */
export const validateMiddleware: Middleware = {
  key: '20-validate',
  async run(ctx, next) {
    const { route } = ctx;
    if (route.body) {
      const text = await readBody(ctx.req, route.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
      if (text === undefined) return invalidInput();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return invalidInput();
      }
      const parsed = route.body.safeParse(raw);
      if (!parsed.success) return invalidInput(firstIssuePath(parsed.error));
      ctx.body = parsed.data;
    }
    if (route.query) {
      const parsed = route.query.safeParse(Object.fromEntries(ctx.url.searchParams));
      if (!parsed.success) return invalidInput(firstIssuePath(parsed.error));
      ctx.query = parsed.data;
    }
    return next();
  },
};

export interface DispatcherInput {
  routes: readonly RouteRow[];
  middleware: readonly Middleware[];
  deps: Deps;
}

/** Builds the request handler of the process. Throws on a duplicate key or `method + path`. */
export function createDispatcher({ routes, middleware, deps }: DispatcherInput): (req: Request) => Promise<Response> {
  const table = new Map<string, RouteRow>();
  const keys = new Set<string>();
  for (const row of routes) {
    const id = `${row.method} ${row.path}`;
    if (keys.has(row.key) || table.has(id)) throw new Error(`routes: duplicate ${row.key} (${id})`);
    keys.add(row.key);
    table.set(id, row);
  }
  for (const mw of middleware) mw.check?.(routes);

  return async function dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = METHODS.has(req.method) ? table.get(`${req.method} ${url.pathname}`) : undefined;
    if (!route) return notFoundResponse();

    const ctx: Ctx = { req, url, env: deps.env, clock: deps.clock, deps, log: deps.log, route };
    const run = (i: number): Promise<Outcome> => {
      const mw = middleware[i];
      return mw ? mw.run(ctx, () => run(i + 1)) : route.handler(ctx);
    };

    try {
      return toResponse(await run(0));
    } catch (err) {
      if (isDependencyFailure(err)) {
        deps.log.warn({ event: 'dependency-unavailable', route: route.key, err });
        return toResponse(failure('unavailable'));
      }
      const logId = newLogId();
      deps.log.error({ event: 'unhandled', route: route.key, logId, err });
      return toResponse(failure('unknown', { message: logId }));
    }
  };
}
