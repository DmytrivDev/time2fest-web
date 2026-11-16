/**
 * Shapes of the HTTP pipeline (ring 4, driving adapter): route rows, middleware rows, the
 * request context and the dependencies the composition root hands to every handler.
 * Routes never import `pg` or Payload: they reach a dependency through `ctx.deps` (onion ban 1).
 */
import type { ApiError } from '@time2fest/contracts';
import type { Payload } from 'payload';
import type { ZodType } from 'zod';
import type { EnvClass } from '../platform/env';
import type { Alarm, Clock, LockState, Logger } from '../ports';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A refusal, in the `ApiResult` failure shape (AC-22). */
export interface ApiFailure {
  ok: false;
  error: ApiError;
}

export interface ApiSuccess<T = unknown> {
  ok: true;
  value: T;
}

/** What a handler returns: a raw `Response` (bare bodies such as `/api/time`) or an `ApiResult`. */
export type Outcome = Response | ApiSuccess | ApiFailure;

/** The validated environment of the process. */
export interface AppEnv {
  class: EnvClass;
  vars: Readonly<Record<string, unknown>>;
}

/** What the composition root provides. Every field is a port or a lazy accessor. */
export interface Deps {
  env: AppEnv;
  clock: Clock;
  log: Logger;
  alarm: Alarm;
  /** Payload, initialised on first use only (by a `needs: ['db']` route). */
  payload(): Promise<Payload>;
  lockState: LockState;
}

export interface Ctx {
  req: Request;
  url: URL;
  env: AppEnv;
  clock: Clock;
  deps: Deps;
  log: Logger;
  route: RouteRow;
  /** The parsed body, set by `20-validate` when the row has a `body` schema. */
  body?: unknown;
  /** The parsed query, set by `20-validate` when the row has a `query` schema. */
  query?: unknown;
  subject?: string;
}

export interface RouteRow {
  key: string;
  method: HttpMethod;
  path: string;
  body?: ZodType;
  query?: ZodType;
  needs?: readonly ('db' | 'redis')[];
  /** The only way to skip the same-origin check (AC-28). */
  sameOriginExempt?: true;
  rateLimit?: string;
  idempotency?: string;
  handler(ctx: Ctx): Promise<Outcome>;
}

export interface Middleware {
  key: string;
  run(ctx: Ctx, next: () => Promise<Outcome>): Promise<Outcome>;
}
