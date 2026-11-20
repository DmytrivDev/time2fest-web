/**
 * Shapes of the HTTP pipeline (ring 4, driving adapter): route rows, middleware rows, the
 * request context and the dependencies the composition root hands to every handler.
 * Routes never import `pg` or Payload: they reach a dependency through `ctx.deps` (onion ban 1),
 * and `Deps` holds ports only — the raw Payload accessor stays in `container.ts`.
 */
import type { ApiError } from '@time2fest/contracts';
import type { ZodType } from 'zod';
import type { AlarmService } from '../alarms/service';
import type { AlarmStore } from '../alarms/ports';
import type { CatalogCopyDeps } from '../catalog/copy';
import type { CatalogStore } from '../catalog/ports';
import type { CorrectionDeps } from '../corrections/service';
import type { EventLog, EventPublisher } from '../events/ports';
import type { ReadinessProbe } from '../health/ports';
import type { ProviderLayer } from '../moderation/providers';
import type { ModerationSettingsStore, SpendCounter } from '../moderation/spend';
import type { TranslationService } from '../moderation/translate';
import type { VerdictService } from '../moderation/verdict';
import type { ClientContext } from '../platform/edge';
import type { EnvClass } from '../platform/env';
import type { Alarm, Clock, FastStore, IdempotencyStore, LockState, Logger } from '../ports';
import type { ChannelPublisher, RandomSource, SubjectInvalidator, SubjectResolver, TokenSigner } from '../realtime/ports';
import type { SchedulerHandle } from '../scheduler/service';
import type { FanOutDeps } from '../site/fanout';
import type { SharedClock } from '../timekeeping/shared';
import type { DivergenceMeter } from '../timekeeping/divergence';
import type { UnattendedDeps } from '../unattended/service';

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

/** The internal-events ports (AC-40 … AC-42). */
export interface EventPorts {
  publisher: EventPublisher;
  log: EventLog;
  channel: string;
}

/** The realtime ports (SPEC-06). `signer` is absent only in a `test` class without the token secret (AC-19). */
export interface RealtimePorts {
  signer?: TokenSigner;
  random: RandomSource;
  /** Channel prefix `<slug>_` in `test`; `''` everywhere else. */
  prefix: string;
  publisher?: ChannelPublisher;
  invalidator?: SubjectInvalidator;
}

/** Text moderation and AI (SPEC-09): the services and what the doors and the admin slice read. */
export interface ModerationDeps {
  verdict: VerdictService;
  translate: TranslationService;
  layer: ProviderLayer;
  spend: SpendCounter;
  settings: ModerationSettingsStore;
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
  /**
   * Ports and services built once by `createDeps` (optional only so that a test can build a plain `Deps`;
   * read them through the getters of `endpoints/deps.ts`, which throw when a field is absent).
   */
  catalogStore?: CatalogStore;
  events?: EventPorts;
  alarmStore?: AlarmStore;
  alarmService?: AlarmService;
  corrections?: CorrectionDeps;
  unattended?: UnattendedDeps;
  /** What the R2 copy needs, or `undefined` when the environment has no bucket (AC-72). */
  catalogCopy?: () => CatalogCopyDeps | undefined;
  /** What the after-commit fan-out of the `site` snapshot needs (SPEC-08 AC-5 … AC-7, AC-33 … AC-36). */
  siteFanOut?: () => FanOutDeps;
  /** Whether the database and the fast store answer (SPEC-13a AC-5/AC-6). */
  readiness?: ReadinessProbe;
  /** Who a realtime token is for (C5): no session in production until SPEC-10; the doors' resolver in tests. */
  subjects?: SubjectResolver;
  realtime?: RealtimePorts;
  /**
   * The shared server clock of the process (SPEC-07 AC-49): set by `createDeps` in `test` and
   * `rehearsal` (it is then also `clock`, unless `clock` is overridden); absent in `production`,
   * which has no virtual time.
   */
  sharedClock?: SharedClock;
  /** Edge-to-origin divergence of trusted requests on real time (SPEC-07 AC-11); read by the admin slice. */
  divergence?: DivergenceMeter;
  /**
   * The moment scheduler of the process (SPEC-07 AC-27 … AC-48): built by `createDeps` in every
   * process, started only by `startProcessBackground` (never in a CLI). `status()` is the view the
   * doors and the festival-state slice read; `pause`/`resume` are the doors' lease controls.
   */
  scheduler?: SchedulerHandle;
  /** Text moderation and AI (SPEC-09): built by `createDeps`; timers started only by `startProcessBackground`. */
  moderation?: ModerationDeps;
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
