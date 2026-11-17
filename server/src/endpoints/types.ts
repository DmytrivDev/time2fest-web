/**
 * Shapes of the HTTP pipeline (ring 4, driving adapter): route rows, middleware rows, the
 * request context and the dependencies the composition root hands to every handler.
 * Routes never import `pg` or Payload: they reach a dependency through `ctx.deps` (onion ban 1),
 * and `Deps` holds ports only — the raw Payload accessor stays in `container.ts`.
 */
import type { ApiError } from '@time2fest/contracts';
import type { ZodType } from 'zod';
import type { ClientContext } from '../platform/edge';
import type { EnvClass } from '../platform/env';
import type { Alarm, Clock, FastStore, IdempotencyStore, LockState, Logger } from '../ports';

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

/** What the composition root provides to route handlers. Every field is a port; no raw Payload. */
export interface Deps {
  env: AppEnv;
  clock: Clock;
  log: Logger;
  alarm: Alarm;
  lockState: LockState;
  /** The fast store (Redis, this slot's database and key prefix); lazy — connects on first use. */
  redis: FastStore;
  /** The in-process store of the `memory` rate-limit policy (AC-50). */
  memory: FastStore;
  /** `order`-class idempotency records (Postgres, AC-55). */
  orderStore: IdempotencyStore;
}

export interface Ctx {
  req: Request;
  url: URL;
  env: AppEnv;
  clock: Clock;
  deps: Deps;
  log: Logger;
  route: RouteRow;
  /** The client as admitted by the edge gate: country and daily fingerprint, never the address (AC-23). */
  client: ClientContext;
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
  /** The only way to skip the same-origin check (AC-28). Never set on a test door. */
  sameOriginExempt?: true;
  /**
   * A test door (set by `doorRoutes` only): no `Origin` is allowed for tooling, but a present
   * `Origin` must be allowed, a mutating call must be `application/json`, and `Host` must be loopback.
   */
  testDoor?: true;
  /** A public route: cacheable at the edge, its `Set-Cookie` stripped (SPEC-05 W15). */
  public?: true;
  /**
   * The edge probe door (set only by door rows, SPEC-05 W16). Only on a `testDoor` and only with a
   * verified edge secret, `10-origin` accepts a non-loopback `Host` and a non-JSON body.
   */
  edgeProbe?: true;
  /** Largest accepted request body in bytes; default `DEFAULT_MAX_BODY_BYTES` (16 KiB). */
  maxBodyBytes?: number;
  rateLimit?: string;
  idempotency?: string;
  handler(ctx: Ctx): Promise<Outcome>;
}

export interface Middleware {
  key: string;
  /** Startup check of the route table; a throw stops the dispatcher from being built. */
  check?(routes: readonly RouteRow[]): void;
  run(ctx: Ctx, next: () => Promise<Outcome>): Promise<Outcome>;
}
