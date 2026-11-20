/**
 * Composition root: the only module that knows every ring. Builds the process dependencies
 * (lazy singletons on `globalThis`, so every module copy in the process shares them) and the
 * dispatcher of `/api/*`. Payload is initialised only on first use. The raw Payload accessor
 * never enters `Deps` (route handlers see ports only): it is kept on the deps object under a
 * private symbol, read by `payloadOf` for the adapters built here (idempotency, the doors' seed store).
 * Test doors are loaded by dynamic `import()` only when `shouldLoadDoors` is true (AC-29); no
 * request field takes part in that decision (AC-31).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { hostname } from 'node:os';
import type { JWTVerifyGetKey } from 'jose';
import type { Payload } from 'payload';
import { readHolders, resolveLockDir } from '../scripts/lib/lock.mjs';
import { createAccessGate, createDenyLog, type AccessGate } from './access/gate';
import type { IdentityMarker } from './access/ports';
import { createAccessVerifier, localKeys, remoteKeys } from './adapters/accessJwt';
import { createCentrifugoApi } from './adapters/centrifugoApi';
import { createHs256Signer } from './adapters/centrifugoToken';
import { noSessionSubjects } from './adapters/noSessionSubjects';
import { createIdentityMarker } from './adapters/identityMarker';
import { createPayloadCatalogStore } from './adapters/payloadCatalog';
import { createReadinessProbe } from './adapters/readiness';
import { createS3ObjectStore } from './adapters/s3';
import { createPayloadIdempotencyStore, createPayloadSeedStore } from './adapters/payload';
import { parseAccessConfig } from './domain/access/config';
import { parseRealtimeConfig } from './domain/realtime/config';
import { createMemoryStore, createRedisStore } from './adapters/redis';
import { createPayloadClockStateStore } from './adapters/payloadClockState';
import { createPayloadJournal } from './adapters/payloadJournal';
import { createPayloadMomentSource } from './adapters/payloadMoments';
import { createPgScheduler } from './adapters/pgScheduler';
import { seasonRunEpoch } from './domain/scheduler/consequence';
import { textRulesFor } from '@time2fest/rules/text';
import { fallbackVerdict } from '@time2fest/rules/text/fallback';
import { ANTHROPIC_MODERATION_MAX_TOKENS, ANTHROPIC_TRANSLATION_MAX_TOKENS, createAnthropicProvider } from './adapters/aiAnthropic';
import { createDeepseekProvider } from './adapters/aiDeepseek';
import { createPayloadModerationSettings } from './adapters/payloadModerationSettings';
import { createPgAiSpend } from './adapters/pgAiSpend';
import { aiPricesFrom } from './domain/moderation/spend';
import { createProviderLayer, perProcessRpm } from './moderation/providers';
import { createSpendCounter, type SpendCounter } from './moderation/spend';
import { createTranslationService } from './moderation/translate';
import { createVerdictService } from './moderation/verdict';
import { clockFor, monotonicClock, processClockCache, realClock } from './clock';
import { createDivergenceMeter } from './timekeeping/divergence';
import { createSharedClock, startClockRefresh, type ClockRefresh, type SharedClock } from './timekeeping/shared';
import { createDispatcher } from './endpoints/pipeline';
import { alarmStoreOf, catalogStoreOf, eventsOf, publisherOf, unattendedDepsOf } from './endpoints/deps';
import type { AppEnv, Deps, EventPorts, ModerationDeps, RouteRow } from './endpoints/types';
import { createEdgeGate, type EdgeGate } from './platform/edge';
import { startEventBus, type EventBus } from './events/bus';
import type { EventSubscriber } from './events/ports';
import type { CatalogCopyDeps } from './catalog/copy';
import { createPayloadAlarmStore } from './adapters/payloadAlarms';
import { createPayloadCorrectionReader, payloadCorrectionDeps } from './adapters/payloadCorrections';
import { createPayloadFanOutClaim, createPayloadSiteStore } from './adapters/payloadSiteState';
import { createCfPurge } from './adapters/cfPurge';
import { currentPatches } from './corrections/service';
import type { FanOutDeps } from './site/fanout';
import { payloadUnattendedDeps } from './adapters/payloadUnattended';
import { createAlarmService } from './alarms/service';
import { createPgEventLog, createPgEventPublisher, createPgEventSource, eventsChannel } from './adapters/pgEvents';
import { loadEnv, type RawEnv } from './platform/env';
import { daySalts } from './platform/fingerprint';
import { createAlarm, createLogger } from './platform/logger';
import type { Alarm, LockState, SeedStore } from './ports';
import { envRegistry } from './registries/env';
import { channelClassesFor } from './registries/channels';
import { middlewareRegistry } from './registries/middleware';
import { createChannelPublisher } from './realtime/publisher';
import { createSubjectInvalidator } from './realtime/invalidate';
import type { ChannelPublisher, Scheduler } from './realtime/ports';
import { isRevertible } from './registries/revertHandlers';
import { momentActionsFor } from './registries/moments';
import { routeRegistry } from './registries/routes';
import { subscriberRegistry } from './registries/subscribers';
import { createScheduler, type SchedulerHandle } from './scheduler/service';
import { evaluate } from './unattended/service';
import { startTicker, type Ticker } from './unattended/ticker';

const DEPS_KEY = Symbol.for('t2f.deps');
const DISPATCHER_KEY = Symbol.for('t2f.dispatcher');
const PAYLOAD_KEY = Symbol.for('t2f.payload');
const ACCESS_GATE_KEY = Symbol.for('t2f.accessGate');
const BACKGROUND_KEY = Symbol.for('t2f.background');
const UNATTENDED_TICKER_KEY = Symbol.for('t2f.unattendedTicker');
const CLOCK_REFRESH_KEY = Symbol.for('t2f.clockRefresh');
const MODERATION_TIMERS_KEY = Symbol.for('t2f.moderationTimers');
const BACKGROUND_RETRY_MS = 5_000;

/** The thin typed getters over the ports `createDeps` sets on `Deps` (re-exported for the callers of the root). */
export { alarmStoreOf, catalogStoreOf, eventsOf, unattendedDepsOf };
export type { EventPorts };

/** What a caller of `createDeps` may replace: any port or service of `Deps` and the lazy Payload accessor. */
export type DepsOverrides = Partial<Omit<Deps, 'env'>> & { payload?: () => Promise<Payload> };

type Dispatcher = (req: Request) => Promise<Response>;

/** Doors exist only in the `test` class with `T2F_TEST_DOORS=1` — never from a request field. */
export function shouldLoadDoors(env: AppEnv): boolean {
  return env.class === 'test' && env.vars.T2F_TEST_DOORS === '1';
}

/**
 * Read-only view of the machine integration lock. The folder is resolved on first use; any
 * failure to resolve or read it means "not held" (fail closed).
 */
export function createLockState(dir?: string, raw: RawEnv = process.env): LockState {
  let resolved = dir;
  return {
    holdsExclusive(owner) {
      try {
        resolved ??= resolveLockDir(process.cwd(), raw);
        return readHolders(resolved).some(
          (h) => h.mode === 'exclusive' && (h.owner === owner || h.owner.startsWith(`${owner}:`)),
        );
      } catch {
        return false;
      }
    },
  };
}

/**
 * An idle pooled client that loses its connection (Postgres restart, code 57P01) emits `error` on
 * the pool; with no listener Node treats it as an unhandled error and the process dies. The
 * listener only raises a log-level alarm (code only, never the message): the dead client is
 * dropped by `pg`, and the next query fails and surfaces as `unavailable` (AC-72).
 */
export function guardPool(payload: Payload, alarm: Alarm): void {
  const pool = (payload.db as unknown as { pool?: { on?: (ev: 'error', fn: (err: unknown) => void) => unknown } }).pool;
  pool?.on?.('error', (err: unknown) => {
    const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
    alarm.raise({
      level: 'log',
      source: 'postgres',
      code: 'pool_client_error',
      details: { pgCode: typeof code === 'string' ? code : 'unknown' },
    });
  });
}

/** Lazy Payload: initialised once on first use; a failed start is retried on the next call. */
function lazyPayload(alarm: Alarm): () => Promise<Payload> {
  let pending: Promise<Payload> | undefined;
  return () => {
    pending ??= (async () => {
      const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('@payload-config')]);
      const payload = await getPayload({ config });
      guardPool(payload, alarm);
      return payload;
    })().catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}

/** Global timers that never keep the process alive (a CLI exits with a batch still pending). */
const unrefTimers: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Builds the dependencies from a raw environment. Throws, naming variables only, when it is invalid. */
export function createDeps(raw: RawEnv, overrides: DepsOverrides = {}): Deps {
  const loaded = loadEnv(raw, envRegistry);
  if (!loaded.ok) throw new Error(`env: invalid ${loaded.failing.join(', ')}`);
  const env: AppEnv = { class: loaded.class, vars: loaded.env };
  const realtime = parseRealtimeConfig(raw, env.class);
  if (!realtime.ok) throw new Error(`env: invalid ${realtime.failing.join(', ')}`);
  const log = overrides.log ?? createLogger(loaded.secrets, { clock: realClock });
  // The store reaches Payload lazily, so the alarm exists before Payload (which reports through it).
  let payloadRef: () => Promise<Payload> = () => Promise.reject(new Error('payload: not wired'));
  const channel = eventsChannel(String(env.vars.DATABASE_URI ?? ''));
  // Shared virtual time (SPEC-07 AC-49): test and rehearsal only, over the process cache. Its store
  // has its own outbox publisher on real time, so the clock does not depend on itself.
  const sharedClock =
    env.class === 'production'
      ? undefined
      : (overrides.sharedClock ??
        createSharedClock({
          store: createPayloadClockStateStore({
            payload: () => payloadRef(),
            journal: createPayloadJournal(isRevertible),
            publisher: createPgEventPublisher(() => payloadRef(), realClock, channel),
            real: realClock,
          }),
          real: realClock,
          cache: processClockCache(),
        }));
  const clock = overrides.clock ?? clockFor(env.class, sharedClock);
  const alarmStore = overrides.alarmStore ?? createPayloadAlarmStore(() => payloadRef(), clock);
  const alarm = overrides.alarm ?? createAlarm(log, alarmStore);
  const payload = overrides.payload ?? lazyPayload(alarm);
  payloadRef = payload;
  const deps: Deps = {
    env,
    clock,
    log,
    alarm,
    lockState: overrides.lockState ?? createLockState(undefined, raw),
    redis: overrides.redis ?? createRedisStore(env.vars),
    // Windows of the in-process fallback run on real time, like Redis expiry.
    memory: overrides.memory ?? createMemoryStore(realClock),
    orderStore: overrides.orderStore ?? createPayloadIdempotencyStore(payload),
  };
  Object.defineProperty(deps, PAYLOAD_KEY, { value: payload, enumerable: false });
  if (sharedClock) deps.sharedClock = sharedClock;
  deps.divergence = overrides.divergence ?? createDivergenceMeter({ real: realClock, alarm, log });
  deps.events = overrides.events ?? {
    publisher: createPgEventPublisher(payload, clock, channel),
    log: createPgEventLog(payload),
    channel,
  };
  deps.alarmStore = alarmStore;
  deps.catalogStore = overrides.catalogStore ?? createPayloadCatalogStore(payload);
  // Services over the stores, built once: the request binding is the `tx` parameter of their methods.
  deps.alarmService = overrides.alarmService ?? createAlarmService(alarmStore, clock);
  deps.corrections = overrides.corrections ?? payloadCorrectionDeps({ publisher: deps.events.publisher, clock, isRevertible });
  deps.unattended =
    overrides.unattended ??
    payloadUnattendedDeps({ payload, alarms: alarmStore, publisher: deps.events.publisher, clock, isRevertible });
  deps.catalogCopy = overrides.catalogCopy ?? (() => catalogCopyDepsOf(deps));
  deps.siteFanOut = overrides.siteFanOut ?? (() => siteFanOutDepsOf(deps));
  deps.readiness = overrides.readiness ?? createReadinessProbe({ payload, fast: deps.redis });
  // Built in every process, started only by `startProcessBackground` (SPEC-07 W28).
  deps.scheduler = overrides.scheduler ?? createProcessScheduler(deps, payload, sharedClock);
  // Realtime (SPEC-06): no session yet (C5); the signer only with the token secret (else AC-19 in `test`).
  deps.subjects = overrides.subjects ?? noSessionSubjects;
  // Text moderation and AI (SPEC-09): built here, timers started only by `startProcessBackground`.
  deps.moderation = overrides.moderation ?? createModeration(env, payload, { clock, alarm, log });
  const tokenSecret = realtime.config.tokenSecret;
  // The server API (C4, C6) only with both the URL and the API key; else the getters throw.
  const { url: centrifugoUrl, apiKey: centrifugoApiKey } = realtime.config;
  const centrifugoApi =
    centrifugoUrl !== undefined && centrifugoApiKey !== undefined ? createCentrifugoApi({ url: centrifugoUrl, apiKey: centrifugoApiKey, log }) : undefined;
  deps.realtime = overrides.realtime ?? {
    ...(tokenSecret !== undefined ? { signer: createHs256Signer(tokenSecret) } : {}),
    random: () => randomInt(0, 2 ** 32) / 2 ** 32,
    prefix: realtime.config.prefix,
    ...(centrifugoApi !== undefined
      ? {
          publisher: createChannelPublisher({ api: centrifugoApi, rows: channelClassesFor(env.class), prefix: realtime.config.prefix, log,
            // The batcher (AC-37) runs on real time and `unref`'d timers; batch ids are random UUIDs.
            scheduler: unrefTimers, clock: realClock, makeId: () => crypto.randomUUID() }),
          invalidator: createSubjectInvalidator({ api: centrifugoApi, log }),
        }
      : {}),
  };
  return deps;
}

/**
 * The moment scheduler of the process (SPEC-07 AC-27 … AC-48), not started. Server time is the
 * shared clock's view in test/rehearsal (unless a test replaced `clock`), real time at speed 1 in
 * production; the lease and lag use the monotonic `performance.now()`. The run epoch is the clock
 * state's in test/rehearsal and the season key's year in production (C4).
 */
function createProcessScheduler(deps: Deps, payload: () => Promise<Payload>, shared: SharedClock | undefined): SchedulerHandle {
  const stores = createPgScheduler({ payload, journal: createPayloadJournal(isRevertible) });
  const virtual = shared !== undefined && deps.clock === shared ? shared : undefined;
  return createScheduler({
    // `since`: the last jump or speed change of a virtual clock, so a jump is not lag (AC-39).
    view: virtual
      ? () => {
          const s = virtual.state();
          return { ...virtual.view(), ...(s.virtual ? { since: s.anchorVirtual } : {}) };
        }
      : () => ({ now: deps.clock.now(), speed: 1, frozen: false }),
    mono: () => performance.now(),
    lease: stores.lease,
    runs: stores.runs,
    source: createPayloadMomentSource({ payload, catalog: catalogStoreOf(deps) }),
    rows: momentActionsFor(deps.env.class),
    alarm: deps.alarm,
    log: deps.log,
    holderId: `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`,
    cls: deps.env.class,
    runEpochOf: shared ? () => shared.state().runEpoch : (input) => seasonRunEpoch(input.seasonId),
  });
}

const REAL_AI_HOSTS = { anthropic: 'https://api.anthropic.com', deepseek: 'https://api.deepseek.com' } as const;

/**
 * Text moderation and AI (SPEC-09 W25): the two adapters from the environment, the provider layer,
 * the settings global, the spend counter and the two services. Keys come only from the secret
 * variables (AC-47); a missing key is a provider `not-configured`. The real hosts are the default
 * base address outside `test` only: in `test` a provider without a URL is not configured either.
 * Nothing starts here (no timer, no request).
 */
function createModeration(
  env: AppEnv,
  payload: () => Promise<Payload>,
  ports: { clock: Deps['clock']; alarm: Alarm; log: Deps['log'] },
): ModerationDeps {
  const v = env.vars;
  const str = (name: string): string | undefined => {
    const value = v[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const urlOf = (name: string, real: string) => str(name) ?? (env.class === 'test' ? undefined : real);
  const anthropicUrl = urlOf('T2F_AI_ANTHROPIC_URL', REAL_AI_HOSTS.anthropic);
  const deepseekUrl = urlOf('T2F_AI_DEEPSEEK_URL', REAL_AI_HOSTS.deepseek);
  const anthropic = createAnthropicProvider({
    url: anthropicUrl ?? '',
    apiKey: anthropicUrl === undefined ? undefined : str('ANTHROPIC_API_KEY'),
    model: String(v.T2F_AI_ANTHROPIC_MODEL),
    version: String(v.T2F_AI_ANTHROPIC_VERSION),
  });
  const deepseek = createDeepseekProvider({
    url: deepseekUrl ?? '',
    apiKey: deepseekUrl === undefined ? undefined : str('DEEPSEEK_API_KEY'),
    model: String(v.T2F_AI_DEEPSEEK_MODEL),
  });
  // The counter is built after the layer; probes reach it through this reference (AC-26).
  const sink: { spend?: SpendCounter } = {};
  const layer = createProviderLayer({
    providers: { moderation: [anthropic, deepseek], translation: [anthropic, deepseek] },
    clock: monotonicClock,
    alarm: ports.alarm,
    log: ports.log,
    onProbe: (provider, answer) => sink.spend?.recordProbe(provider, answer),
    // Account-level budgets split across the server processes (S7).
    ratePerMin: {
      anthropic: perProcessRpm(Number(v.T2F_AI_ANTHROPIC_RPM), Number(v.T2F_AI_PROCESSES)),
      deepseek: perProcessRpm(Number(v.T2F_AI_DEEPSEEK_RPM), Number(v.T2F_AI_PROCESSES)),
    },
    toastsRpmShare: Number(v.T2F_AI_TOASTS_RPM_SHARE),
  });
  const settings = createPayloadModerationSettings({ payload, journal: createPayloadJournal(isRevertible), clock: ports.clock });
  const counter = createSpendCounter({
    store: createPgAiSpend(payload),
    settings,
    layer,
    prices: aiPricesFrom({
      anthropic: {
        input: String(v.T2F_AI_ANTHROPIC_PRICE_INPUT),
        output: String(v.T2F_AI_ANTHROPIC_PRICE_OUTPUT),
        cacheRead: String(v.T2F_AI_ANTHROPIC_PRICE_CACHE_READ),
        cacheWrite: String(v.T2F_AI_ANTHROPIC_PRICE_CACHE_WRITE),
      },
      deepseek: {
        cacheMiss: String(v.T2F_AI_DEEPSEEK_PRICE_CACHE_MISS),
        cacheHit: String(v.T2F_AI_DEEPSEEK_PRICE_CACHE_HIT),
        output: String(v.T2F_AI_DEEPSEEK_PRICE_OUTPUT),
      },
    }),
    clock: ports.clock,
    alarm: ports.alarm,
    log: ports.log,
    toastsShare: Number(v.T2F_AI_TOASTS_SPEND_SHARE),
  });
  sink.spend = counter;
  return {
    layer,
    spend: counter,
    settings,
    verdict: createVerdictService({
      layer,
      spend: counter,
      rules: textRulesFor,
      fallback: fallbackVerdict,
      clock: monotonicClock,
      primary: anthropic.id,
      maxTokens: ANTHROPIC_MODERATION_MAX_TOKENS,
    }),
    translate: createTranslationService({
      layer,
      spend: counter,
      clock: monotonicClock,
      primary: anthropic.id,
      maxTokens: ANTHROPIC_TRANSLATION_MAX_TOKENS,
    }),
  };
}

/**
 * AC-47: in `rehearsal` and `production`, one `page` per AI provider without a key, at process start
 * (never in `createDeps`, which CLIs call too). Returns the providers it paged for.
 */
export function pageMissingAiKeys(deps: Deps): string[] {
  if (deps.env.class !== 'rehearsal' && deps.env.class !== 'production') return [];
  const missing: string[] = [];
  for (const [provider, name] of [
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['deepseek', 'DEEPSEEK_API_KEY'],
  ] as const) {
    const key = deps.env.vars[name];
    if (typeof key === 'string' && key !== '') continue;
    missing.push(provider);
    deps.alarm.raise({ level: 'page', source: 'mod', code: 'provider_not_configured', details: { provider } });
  }
  return missing;
}

/**
 * Starts the moderation timers of one process (SPEC-09): the layer's probes of providers that are down
 * and the spend counter's flush and refresh, both `unref`. `stop` writes what is pending.
 */
export function startModerationTimers(deps: Deps): { stop(): Promise<void> } | undefined {
  const m = deps.moderation;
  if (!m) return undefined;
  const probes = m.layer.start();
  const counter = m.spend.start();
  return {
    stop: async () => {
      await probes.stop();
      await counter.stop();
    },
  };
}

/**
 * What the R2 copy of the catalog needs (AC-72), or `undefined` when the environment has no bucket
 * configured (a class that does not require R2): then nothing is copied.
 */
export function catalogCopyDepsOf(deps: Deps): CatalogCopyDeps | undefined {
  const v = deps.env.vars;
  const endpoint = v.T2F_R2_ENDPOINT;
  const bucket = v.T2F_R2_BUCKET;
  const accessKeyId = v.T2F_R2_ACCESS_KEY_ID;
  const secretAccessKey = v.T2F_R2_SECRET_ACCESS_KEY;
  const prefix = v.T2F_R2_PREFIX;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !prefix) return undefined;
  return {
    store: catalogStoreOf(deps),
    objects: createS3ObjectStore({
      endpoint: String(endpoint),
      bucket: String(bucket),
      accessKeyId: String(accessKeyId),
      secretAccessKey: String(secretAccessKey),
    }),
    prefix: String(prefix),
    alarm: deps.alarm,
    log: deps.log,
  };
}

/**
 * What the after-commit fan-out of the `site` snapshot needs (SPEC-08 W12 … W14): the snapshot readers over
 * Payload, the fan-out claim, the realtime publisher (when configured), the edge purge only with token, zone
 * and site URL (else every change logs `site/purge-skipped`, AC-34), the catalog's bucket and prefix (else
 * `site/r2-copy-skipped`).
 */
export function siteFanOutDepsOf(deps: Deps): FanOutDeps {
  const payload = payloadOf(deps);
  const v = deps.env.vars;
  const catalog = catalogStoreOf(deps);
  const corrections = createPayloadCorrectionReader(payload);
  let publisher: ChannelPublisher | undefined;
  try {
    publisher = publisherOf(deps);
  } catch {
    publisher = undefined;
  }
  const token = v.T2F_CF_PURGE_TOKEN;
  const zoneId = v.T2F_CF_ZONE_ID;
  const siteUrl = v.T2F_SITE_URL;
  const bucket = deps.catalogCopy?.();
  return {
    snapshot: {
      store: createPayloadSiteStore({ payload, clock: realClock }),
      patches: async () => (await currentPatches(corrections)).patches,
      catalogMeta: async () => {
        const season = (await catalog.read()).season;
        return season ? { generatedAt: season.generatedAt, tzdbVersion: season.tzdbVersion } : null;
      },
    },
    claim: createPayloadFanOutClaim(payload),
    ...(publisher ? { publisher } : {}),
    ...(token && zoneId && siteUrl ? { purge: { sink: createCfPurge({ zoneId: String(zoneId), token: String(token) }), siteUrl: String(siteUrl) } } : {}),
    ...(bucket ? { copy: { objects: bucket.objects, prefix: bucket.prefix } } : {}),
    alarm: deps.alarm,
    log: deps.log,
  };
}

/**
 * Background work of one process: the internal-events delivery loop over the subscriber registry
 * (`testOnly` rows only in the `test` class). Called by `instrumentation.ts` once per process and
 * by integration helpers, which stop it themselves.
 */
export function startBackground(deps: Deps, subscribers: readonly EventSubscriber[] = subscriberRegistry): Promise<EventBus> {
  const uri = String(deps.env.vars.DATABASE_URI ?? '');
  return startEventBus({
    source: createPgEventSource({
      payload: payloadOf(deps),
      databaseUri: uri,
      channel: eventsOf(deps).channel,
      onError: (err) => {
        const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
        deps.alarm.raise({ level: 'log', source: 'events', code: 'listener_error', details: { pgCode: typeof code === 'string' ? code : 'unknown' } });
      },
    }),
    subscribers: subscribers.filter((s) => !s.testOnly || deps.env.class === 'test'),
    log: deps.log,
  });
}

/**
 * The unattended-mode ticker of one process (AC-32): `evaluate` every 10 s on the server clock. A
 * failing tick (database down) raises a log-level alarm (code only) and the ticker keeps going.
 */
export function startUnattendedTicker(deps: Deps, intervalMs?: number): Ticker {
  const unattended = unattendedDepsOf(deps);
  return startTicker({
    tick: () => evaluate(unattended, null),
    onError: (err) => {
      const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
      deps.alarm.raise({ level: 'log', source: 'unattended', code: 'tick_failed', details: { pgCode: typeof code === 'string' ? code : 'unknown' } });
    },
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });
}

/**
 * The clock refresh of one process (SPEC-07 AC-49, AC-50): loads the shared clock state now, then
 * every `intervalMs` (default 5 s) as a fallback to the `clock.changed` subscriber. A failed refresh
 * raises a log-level alarm (code only) and keeps the cache. Resolves to `undefined` in production
 * (no shared clock). Processes that start no background (CLI, tests) call it, or `refresh()`, themselves.
 */
export function startClockRefresher(deps: Deps, intervalMs?: number): Promise<ClockRefresh | undefined> {
  const shared = deps.sharedClock;
  if (!shared) return Promise.resolve(undefined);
  return startClockRefresh(shared, {
    onError: (err) => {
      const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
      deps.alarm.raise({ level: 'log', source: 'clock', code: 'refresh_failed', details: { pgCode: typeof code === 'string' ? code : 'unknown' } });
    },
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });
}

/**
 * Starts the process background once. First the shared clock is loaded (so nothing below starts
 * on a stale clock), then the internal-events delivery loop (a failed start, database down, is
 * retried every 5 s) and the unattended-mode ticker; once the delivery loop runs (so the
 * recompute rows reach it), the moment scheduler. Only `instrumentation.ts` calls it — never a CLI.
 */
export function startProcessBackground(): void {
  const g = globalThis as unknown as Record<symbol, true | Ticker | ClockRefresh | { stop(): Promise<void> } | undefined>;
  if (g[BACKGROUND_KEY]) return;
  g[BACKGROUND_KEY] = true;
  const attempt = () => {
    const deps = getDeps();
    startBackground(deps).then(() => deps.scheduler?.start(), () => {
      deps.alarm.raise({ level: 'log', source: 'events', code: 'background_start_failed' });
      setTimeout(attempt, BACKGROUND_RETRY_MS).unref?.();
    });
  };
  const rest = (refresher?: ClockRefresh) => {
    g[CLOCK_REFRESH_KEY] = refresher;
    g[UNATTENDED_TICKER_KEY] = startUnattendedTicker(getDeps());
    if (!g[MODERATION_TIMERS_KEY]) {
      pageMissingAiKeys(getDeps());
      g[MODERATION_TIMERS_KEY] = startModerationTimers(getDeps());
    }
    attempt();
  };
  // A failed refresh is reported by the refresher itself; the rest starts in either case.
  void startClockRefresher(getDeps()).then(rest, () => rest());
}

/** The lazy Payload accessor of deps built by `createDeps`. For the composition root and tests only. */
export function payloadOf(deps: Deps): () => Promise<Payload> {
  const payload = (deps as unknown as Record<symbol, (() => Promise<Payload>) | undefined>)[PAYLOAD_KEY];
  if (!payload) throw new Error('deps: not built by createDeps');
  return payload;
}

/** The row store the test doors seed through, over the Payload of `deps`. */
export function seedStoreOf(deps: Deps): SeedStore {
  // Resolved on first use, so building the doors never needs Payload.
  return createPayloadSeedStore(() => payloadOf(deps)());
}

/** The process dependencies, built once from `process.env`. */
export function getDeps(): Deps {
  const g = globalThis as unknown as Record<symbol, Deps | undefined>;
  return (g[DEPS_KEY] ??= createDeps(process.env));
}

/** The edge gate of `deps` (SPEC-05): active in rehearsal/production, and in test with a secret. */
export function edgeGateOf(deps: Deps): EdgeGate {
  const secret = deps.env.vars.T2F_EDGE_SECRET;
  const previousSecret = deps.env.vars.T2F_EDGE_SECRET_PREVIOUS;
  return createEdgeGate({
    envClass: deps.env.class,
    secret: typeof secret === 'string' ? secret : undefined,
    previousSecret: typeof previousSecret === 'string' ? previousSecret : undefined,
    salts: daySalts({ fast: deps.redis, clock: deps.clock }),
    clock: deps.clock,
  });
}

/** The dispatcher for `deps`: production routes, plus the doors when `shouldLoadDoors`. */
export async function buildDispatcher(deps: Deps, routes: readonly RouteRow[] = routeRegistry): Promise<Dispatcher> {
  const doors = shouldLoadDoors(deps.env) ? (await import('./test-doors/index')).createDoors(deps, seedStoreOf(deps)) : undefined;
  // With the doors only: the routes see `deps` plus the doors' own subject resolver (AC-57); `deps` itself stays as built.
  const served: Deps = doors ? Object.create(deps, { subjects: { value: doors.subjects, enumerable: true } }) : deps;
  return createDispatcher({ routes: [...routes, ...(doors?.routes ?? [])], middleware: middlewareRegistry, deps: served, edge: edgeGateOf(deps) });
}

/**
 * The Access gate for `deps` (AC-1 … AC-10). An invalid config refuses boot earlier
 * (`instrumentation.ts`); here it fails closed (no config → every gated path is 403). The test
 * signer is reached only through the dynamic `import()` of the `test-signer:` branch, and only
 * in the `test` class.
 */
export async function buildAccessGate(deps: Deps, raw: RawEnv): Promise<AccessGate> {
  const parsed = parseAccessConfig(raw, deps.env.class);
  const config = parsed.ok ? parsed.config : undefined;
  let keys: JWTVerifyGetKey | undefined;
  if (config?.jwks.kind === 'test-signer' && deps.env.class === 'test') {
    const { getTestSigner } = await import('./adapters/testSigner');
    keys = localKeys(await getTestSigner());
  } else if (config?.jwks.kind === 'remote') {
    keys = remoteKeys(config.jwks.url);
  }
  const verifier = keys
    ? createAccessVerifier({ issuer: config?.issuer ?? '', audience: config?.audience ?? '', keys, alarm: deps.alarm })
    : { verify: async () => ({ ok: false, reason: 'invalid' }) as const };
  return createAccessGate({ config: keys ? config : undefined, verifier, denyLog: createDenyLog(deps.log, realClock), cls: deps.env.class });
}

/** The Access gate of the process, built once. */
export function getAccessGate(): Promise<AccessGate> {
  const g = globalThis as unknown as Record<symbol, Promise<AccessGate> | undefined>;
  return (g[ACCESS_GATE_KEY] ??= buildAccessGate(getDeps(), process.env));
}

/** The identity marker of the process (its key is per process). */
export function getIdentityMarker(): IdentityMarker {
  return createIdentityMarker(realClock);
}

/** The dispatcher of the process, built once. */
export function getDispatcher(): Promise<Dispatcher> {
  const g = globalThis as unknown as Record<symbol, Promise<Dispatcher> | undefined>;
  return (g[DISPATCHER_KEY] ??= buildDispatcher(getDeps()));
}
