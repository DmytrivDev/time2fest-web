/**
 * Shapes of the HTTP pipeline (ring 4, driving adapter): route rows, middleware rows, the
 * request context and the dependencies the composition root hands to every handler.
 * Routes never import `pg` or Payload: they reach a dependency through `ctx.deps` (onion ban 1),
 * and `Deps` holds ports only — the raw Payload accessor stays in `container.ts`.
 */
import type { R2Meter } from '../ops/meter';
import type { DumpRunner } from '../ops/ports';
import type { OpsRunner, OpsWiring } from '../ops/runner';
import type { ApiError } from '@time2fest/contracts';
import type { ZodType } from 'zod';
import type { AlarmService } from '../alarms/service';
import type { AuthWiring } from '../auth/instance';
import type { MailService } from '../mail/ports';
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
import type { LiveConfig } from '../domain/live/config';
import type { CallerContext } from '../domain/live/quota';
import type { ChannelSource, LiveEventSource, LiveLease, LiveStore, PlaylistSource, QuotaStore, SearchSource, VideoStatusSource } from '../live/ports';
import type { ClientContext } from '../platform/edge';
import type { EnvClass } from '../platform/env';
import type { Alarm, Clock, FastStore, IdempotencyStore, LockState, Logger } from '../ports';
import type { AuthLinkHandler } from '../registries/authLinks';
import type { ChannelPublisher, RandomSource, SubjectInvalidator, SubjectResolver, TokenSigner } from '../realtime/ports';
import type { SchedulerHandle } from '../scheduler/service';
import type { FanOutDeps } from '../site/fanout';
import type { LiveFanOutDeps } from '../live/fanout';
import type { ViewerTokenDeps, ViewersAggregator } from '../live/viewers';
import type { RebuildDeps } from '../site/rebuild';
import type { CatalogProduct } from '../site/ports';
import type { SiteDeps } from '../site/service';
import type { SnapshotReadDeps } from '../site/snapshot';
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

/**
 * The site state (SPEC-08), built once by `createDeps`: the toggle / product-choice service deps, the snapshot
 * readers of `GET /api/site/state`, and — in the `test` class only — the products fake and the reset the
 * `POST /api/_test/site` door uses. `products` is the empty port in every class; in `test` it is the fake,
 * empty until a door call fills it (AC-18).
 */
export interface SiteWiring extends SiteDeps {
  snapshot: SnapshotReadDeps;
  /** `test` class only: the settable products list behind `products`. */
  testProducts?: { set(list: readonly CatalogProduct[]): void };
  /** `test` class only: the record back to its defaults (version 1, nothing fanned out yet). */
  resetForTests?: () => Promise<void>;
}

/**
 * The live air (SPEC-12): stores, lease, configuration and, only with `T2F_YOUTUBE_BASE_URL`, the status source the
 * poller calls (without it no poller runs and statuses stay as imported).
 */
export interface LiveWiring {
  store: LiveStore;
  quota: QuotaStore;
  lease: LiveLease;
  events: LiveEventSource;
  cfg: LiveConfig;
  caller: CallerContext;
  /**
   * The YouTube source (fake only in this wave): statuses for the poller; channels, playlists and search for the
   * sources watch (SPEC-21a [П-4]). Absent = neither the poller nor the watch runs.
   */
  statuses?: VideoStatusSource & SearchSource & ChannelSource & PlaylistSource;
  /** The viewers aggregator and the viewer-token deps (SPEC-12 S9); set by `createDeps` once realtime is wired. */
  viewers?: { aggregator: ViewersAggregator; token: ViewerTokenDeps };
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
  /** What the after-commit fan-out of the live chains needs (SPEC-12 AC-5 … AC-7, AC-14, AC-15). */
  liveFanOut?: () => LiveFanOutDeps;
  /** What the catalog rebuild launch needs (SPEC-08 AC-61 … AC-66). */
  rebuild?: () => RebuildDeps;
  /** The site state service and snapshot readers (SPEC-08); read through `siteOf`. */
  site?: SiteWiring;
  /** The live air (SPEC-12); read through `liveOf`. */
  live?: LiveWiring;
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
  /** Operations (SPEC-13b): the Telegram outbox and sink, `log-alarms`, the ops leases; the runner starts only in `startProcessBackground`. */
  ops?: OpsWiring;
  /** Process-wide count of our own R2 operations (SPEC-13b AC-39); every store of `catalogCopyDepsOf` is metered. */
  r2Meter?: R2Meter;
  /** The ops jobs over `ops` (SPEC-13b W18), no timer: ticked by `startProcessBackground` and the `ops-tick` door. */
  opsRunner?: OpsRunner;
  /**
   * Test seams of the backup job (SPEC-13b [П-8]): the `pg_dump` runner (default: the local binary) and the
   * multipart part size (default 16 MB). Never set in production code.
   */
  backupTuning?: { dump?: DumpRunner; partBytes?: number };
  /** Sign-in (SPEC-10): the Better Auth instance (lazy) and its session rules; read through `authOf`. */
  auth?: AuthWiring;
  /** Mail (SPEC-10 W20): one service over the primary and the fallback SMTP; read through `mailOf`. */
  mail?: MailService;
  /** Guest-merge handlers (SPEC-10 W30); absent → `authLinkRegistry`. Tests inject their own rows here. */
  authLinks?: readonly AuthLinkHandler[];
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
  /**
   * The device id (SPEC-10 [П-3]): from a valid `t2f_device` cookie, or fresh. A fresh id is set as a cookie on a
   * non-public response (`deviceIsNew`, AC-1).
   */
  device: string;
  /** The request carried no valid `t2f_device` cookie: `finalize` sets one on a non-public response. */
  deviceIsNew: boolean;
  /** The parsed body, set by `20-validate` when the row has a `body` schema. */
  body?: unknown;
  /** The parsed query, set by `20-validate` when the row has a `query` schema. */
  query?: unknown;
  /** The session's subject id (account or guest), set by `25-subject` (SPEC-10 AC-30). */
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
  /** SPEC-10 [П-6]: the route needs a subject — without a session `25-subject` creates a guest (AC-4). */
  subject?: 'required';
  handler(ctx: Ctx): Promise<Outcome>;
}

export interface Middleware {
  key: string;
  /** Startup check of the route table; a throw stops the dispatcher from being built. */
  check?(routes: readonly RouteRow[]): void;
  run(ctx: Ctx, next: () => Promise<Outcome>): Promise<Outcome>;
}
