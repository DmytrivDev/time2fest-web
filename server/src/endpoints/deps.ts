/**
 * Typed getters over the ports `createDeps` builds once (`Deps.events`, `.catalogStore`, …). The fields are
 * optional on `Deps` only so that a test can build a plain `Deps`; a getter throws a clear error when the
 * deps were not built by `createDeps`. Route handlers read them from `ctx.deps`.
 */
import type { AlarmService } from '../alarms/service';
import type { AlarmStore } from '../alarms/ports';
import type { AuthWiring } from '../auth/instance';
import { presenceDbOf, rightsDbOf } from '../auth/pool';
import { seasonKeyOfEnd, type SeasonCtx } from '../domain/rights/passSeason';
import { createBanMarks } from '../rights/banMarks';
import { createBanService, type BanService } from '../rights/bans';
import { publishSessionEvent } from '../auth/events';
import { publishPassEvent, publishProfileEvent } from '../rights/events';
import type { RightsLinkPorts } from '../rights/links';
import { createPassService, type PassService } from '../rights/passes';
import { createScheduleService, type ScheduleService } from '../rights/schedule';
import { scheduleCatalogFrom } from '../domain/rights/schedule';
import type { ScheduleCatalog } from '@time2fest/rules/schedule';
import { createProfileService, type CatalogRefs, type ProfileService } from '../rights/profiles';
import type { CatalogStore } from '../catalog/ports';
import type { CorrectionDeps } from '../corrections/service';
import type { ReadinessProbe } from '../health/ports';
import type { MailService } from '../mail/ports';
import type { ChannelPublisher, SubjectInvalidator } from '../realtime/ports';
import type { SubjectResolver } from '../realtime/ports';
import type { UnattendedDeps } from '../unattended/service';
import type { Deps, EventPorts, LiveWiring, ModerationDeps, SiteWiring } from './types';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { presenceCatalogOf } from '../domain/presence/eventValidity';
import { createBeatService, type BeatService, type PresenceCatalogView } from '../presence/beats';
import { faultyFastStore, presenceFaults } from '../presence/faults';
import { createNodeIntake, createWindowIntake, type NodeIntake, type WindowIntake } from '../presence/intake';
import { createMomentBook, createSqlMomentStore, type MomentBook } from '../presence/moments';
import { createProofWriter, createSqlProofStore, type ProofWriter } from '../presence/proofs';
import { createDowntimeNotifier, createDowntimeService, createSqlDowntimeStore, PRESENCE_DOWNTIME_TOPIC, type DowntimeService } from '../presence/downtime';
import { createFinaliser, createSqlHealthStore, type Finaliser } from '../presence/health';
import { createSampler, createSqlSampleStore, type Sampler } from '../presence/samples';
import { createSubjectAges, type SubjectAges } from '../presence/subjectAges';
import { createSqlStampStore, createStampService, type StampService } from '../presence/stamps';
import { createAchievementService, createSqlAchievementStore, type AchievementLookups } from '../presence/achievements';
import { createGrantEvents } from '../presence/events';
import type { PresenceLinkPorts } from '../presence/links';
import { createAuthorIds, type AuthorIds } from '../presence/authorIds';
import { createAuthorPathService, type AuthorPathService } from '../presence/authorPath';
import { stampCatalogOf, type StampCatalog } from '../domain/passport/stampView';

function built<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`deps: ${name} missing (deps not built by createDeps)`);
  return value;
}

/** The internal-events ports (AC-40 … AC-42). */
export const eventsOf = (deps: Deps): EventPorts => built(deps.events, 'events');
/** The alarm store (AC-37 … AC-39). */
export const alarmStoreOf = (deps: Deps): AlarmStore => built(deps.alarmStore, 'alarmStore');
/** The alarm use cases over `alarmStoreOf`. */
export const alarmServiceOf = (deps: Deps): AlarmService => built(deps.alarmService, 'alarmService');
/** The catalog read port (AC-63). */
export const catalogStoreOf = (deps: Deps): CatalogStore => built(deps.catalogStore, 'catalogStore');
/** The correction service dependencies (AC-53 … AC-62). */
export const correctionsOf = (deps: Deps): CorrectionDeps => built(deps.corrections, 'corrections');
/** The realtime ports (SPEC-06): signer, random source, channel prefix. */
export const realtimeOf = (deps: Deps): NonNullable<Deps['realtime']> => built(deps.realtime, 'realtime');
/** The publish port (C4); absent without `T2F_CENTRIFUGO_URL` and `T2F_CENTRIFUGO_API_KEY`. */
export const publisherOf = (deps: Deps): ChannelPublisher => built(deps.realtime?.publisher, 'realtime publisher');
/** `invalidateSubject` (C6); absent without `T2F_CENTRIFUGO_URL` and `T2F_CENTRIFUGO_API_KEY`. */
export const invalidatorOf = (deps: Deps): SubjectInvalidator => built(deps.realtime?.invalidator, 'realtime invalidator');
/** Who a realtime token is for (C5). */
export const subjectsOf = (deps: Deps): SubjectResolver => built(deps.subjects, 'subjects');
/** The unattended-mode service dependencies (AC-31 … AC-36). */
export const unattendedDepsOf = (deps: Deps): UnattendedDeps => built(deps.unattended, 'unattended');
/** The readiness probe of `GET /api/health` (SPEC-13a AC-5/AC-6). */
export const readinessOf = (deps: Deps): ReadinessProbe => built(deps.readiness, 'readiness');
/** Text moderation and AI (SPEC-09): verdict, translation, provider layer, spend counter, settings. */
export const moderationOf = (deps: Deps): ModerationDeps => built(deps.moderation, 'moderation');
/** The site state service and snapshot readers (SPEC-08). */
export const siteOf = (deps: Deps): SiteWiring => built(deps.site, 'site');
/** The live air (SPEC-12): stores, lease, configuration, the status source when configured. */
export const liveOf = (deps: Deps): LiveWiring => built(deps.live, 'live');
/** Sign-in (SPEC-10): the lazy Better Auth instance and its session rules. */
export const authOf = (deps: Deps): AuthWiring => built(deps.auth, 'auth');
/** Mail (SPEC-10): primary SMTP with the fallback, day counters and alarms; absent without `SMTP_HOST`. */
export const mailOf = (deps: Deps): MailService => built(deps.mail, 'mail');

/** The rights services (SPEC-11): built lazily per `deps` over Better Auth's pool, the season clock and the events. */
export interface RightsServices {
  passes: PassService;
  bans: BanService;
  profiles: ProfileService;
  schedule: ScheduleService;
}
const rightsCache = new WeakMap<Deps, RightsServices>();

/** The season of the passes: the current key from the season end (`T2F_SEASON_END`, `2027-01-15` → `2026-27`). */
export function seasonCtxOf(deps: Deps): SeasonCtx {
  const end = authOf(deps).seasonEnd;
  return { currentKey: seasonKeyOfEnd(end), currentEndMs: end };
}

const REFS_TTL_MS = 30_000;
const refsCache = new WeakMap<Deps, { at: number; refs: CatalogRefs }>();

/** Country ISOs and zone ids of the stored catalog, read at most every 30 s per `deps` (profile validation). */
async function catalogRefsOf(deps: Deps): Promise<CatalogRefs> {
  const hit = refsCache.get(deps);
  const now = deps.clock.now();
  if (hit !== undefined && now - hit.at < REFS_TTL_MS && now >= hit.at) return hit.refs;
  const stored = await catalogStoreOf(deps).read();
  const str = (v: unknown): string[] => (typeof v === 'string' ? [v] : []);
  const refs: CatalogRefs = {
    countryIsos: new Set(stored.countries.flatMap((c) => str(c.iso))),
    zoneIds: new Set(stored.zones.flatMap((z) => str(z.zoneId))),
  };
  refsCache.set(deps, { at: now, refs });
  return refs;
}

const scheduleCatCache = new WeakMap<Deps, { at: number; cat: ScheduleCatalog }>();

/** The schedule rule's catalog (SPEC-11 W23), rebuilt from the stored catalog at most every 30 s per `deps`. */
async function scheduleCatalogOf(deps: Deps): Promise<ScheduleCatalog> {
  const hit = scheduleCatCache.get(deps);
  const now = deps.clock.now();
  if (hit !== undefined && now - hit.at < REFS_TTL_MS && now >= hit.at) return hit.cat;
  const cat = scheduleCatalogFrom(await catalogStoreOf(deps).read());
  scheduleCatCache.set(deps, { at: now, cat });
  return cat;
}

/** The ports of the guest-merge rows (`rights/links.ts`, A3). */
export function rightsLinkPortsOf(deps: Deps): RightsLinkPorts {
  const rights = rightsOf(deps);
  return {
    db: () => rightsDbOf(deps),
    bans: rights.bans,
    passes: rights.passes,
    catalog: () => catalogStoreOf(deps).read(),
    publishProfile: (subject) => publishProfileEvent(deps, subject),
  };
}

/** The ports of the guest-merge row `stamps` (`presence/links.ts`, SPEC-14 W31). */
export function presenceLinkPortsOf(deps: Deps): PresenceLinkPorts {
  const presence = presenceOf(deps);
  return {
    db: () => rightsDbOf(deps),
    now: () => deps.clock.now(),
    season: (now) => presence.season(now),
    snapshot: (subject, now) => presence.stamps.list(subject, now),
    channel: () => deps.realtime?.publisher,
    internal: () => deps.events?.publisher,
    log: { warn: (f) => deps.log.warn(f) },
  };
}

/** Passes, bans, profiles (SPEC-11 [П-2]); "now" is the server's season clock `deps.clock`. */
export function rightsOf(deps: Deps): RightsServices {
  let built = rightsCache.get(deps);
  if (built === undefined) {
    built = {
      passes: createPassService({
        db: () => rightsDbOf(deps),
        now: () => deps.clock.now(),
        season: () => seasonCtxOf(deps),
        publish: (db, targets, reason) =>
          publishPassEvent({ session: (id, r) => publishSessionEvent(deps, id, r), log: deps.log }, db, targets, reason),
      }),
      bans: createBanService({
        db: () => rightsDbOf(deps),
        // Read on each call: a test may swap `deps.redis`.
        marks: createBanMarks(() => deps.redis),
        alarm: { raise: (a) => deps.alarm.raise(a) },
        now: () => deps.clock.now(),
      }),
      profiles: createProfileService({
        db: () => rightsDbOf(deps),
        verdict: () => moderationOf(deps).verdict,
        refs: () => catalogRefsOf(deps),
        publish: (subject) => publishProfileEvent(deps, subject),
      }),
      schedule: createScheduleService({
        db: () => rightsDbOf(deps),
        hasPass: (subject, device) => built!.passes.hasPass(subject, device),
        catalog: () => scheduleCatalogOf(deps),
        publish: (subject) => publishProfileEvent(deps, subject),
      }),
    };
    rightsCache.set(deps, built);
  }
  return built;
}

/**
 * The presence services (SPEC-14 [П-2], [П-3]): built lazily per `deps` over the rights pool, the fast store (read on
 * each call: a test may swap `deps.redis`; the `presence-fault` switch gates it), the alarm port and the server clock.
 * One node intake and one node id per `deps` — the sampler, the finaliser and the downtime records (P6) share them.
 */
export interface PresenceServices {
  beats: BeatService;
  proofs: ProofWriter;
  moments: MomentBook;
  intake: NodeIntake;
  windows: WindowIntake;
  /** `users.created_at` cache of the established-subject rule (S14-01, S14-10); primed by the session fast path. */
  subjectAges: SubjectAges;
  /** The presence view of the catalog, rebuilt at most every 30 s per `deps`. */
  catalog(now: number): Promise<PresenceCatalogView>;
  /** The intake sampler of this node (ticked by the background job of a server process, or the `presence-tick` door). */
  sampler: Sampler;
  /** Window finalisation of the health log. */
  finaliser: Finaliser;
  /** Manual and edge-region downtime records. */
  downtimes: DowntimeService;
  /** Stamp claims and the passport list (P8). */
  stamps: StampService;
  /** The current season key and the achievement lookups of the catalog (30 s cache; the guest merge, P10). */
  season(now: number): Promise<{ key: string | null; lookups: AchievementLookups }>;
  /** Drops the catalog and moment caches (tests, the worktree reset). */
  clear(): void;
  nodeId: string;
}
const presenceCache = new WeakMap<Deps, PresenceServices>();

/** Presence events of the current season: stored catalog rows joined with the live air's patched moments. */
async function readPresenceCatalog(deps: Deps): Promise<{ view: PresenceCatalogView; stamps: StampCatalog; lookups: AchievementLookups }> {
  const [stored, live] = await Promise.all([catalogStoreOf(deps).read(), liveOf(deps).events.events()]);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const countryOf = new Map(stored.events.map((e) => [str(e.eventId), str(e.countryIso)]));
  const patched = live.map((e) => ({ eventId: e.eventId, countryIso: countryOf.get(e.eventId) ?? '', zoneId: e.zoneId, moment: e.moment, hidden: e.hidden }));
  const zoneOfEvent = new Map(stored.events.map((e) => [str(e.eventId), str(e.zoneId)]));
  const zoneOrder = new Map(stored.zones.filter((z) => Number.isFinite(Number(z.order))).map((z) => [str(z.zoneId), Number(z.order)]));
  const zones = stored.zones.map((z) => ({ midnightMs: Date.parse(str(z.midnightUtc)) })).filter((z) => Number.isFinite(z.midnightMs));
  return {
    view: { catalog: presenceCatalogOf(stored.season?.key ?? null, stored.events, patched), zones: { zones } },
    stamps: stampCatalogOf(stored),
    lookups: {
      zoneOf: (id) => zoneOfEvent.get(id) ?? '',
      countryOf: (id) => countryOf.get(id) ?? '',
      orderOf: (zoneId) => zoneOrder.get(zoneId) ?? NaN,
    },
  };
}

/**
 * Per-boot part of the presence node id (W3): a crash and restart with the same hostname and pid (containers) is a new
 * node, so its lost in-memory counts show as a `sample-gap` of the old node instead of being silently continued.
 */
const PRESENCE_BOOT_ID = randomUUID();

/**
 * The deps a test dispatcher derives with `Object.create(deps, …)` (doors' subject resolver) share the base's
 * presence services: the routes, the sampler and the doors must see one node intake.
 */
function presenceRootOf(deps: Deps): Deps {
  let root = deps;
  for (;;) {
    const proto: unknown = Object.getPrototypeOf(root);
    if (typeof proto === 'object' && proto !== null && Object.prototype.hasOwnProperty.call(proto, 'env')) root = proto as Deps;
    else return root;
  }
}

export function presenceOf(served: Deps): PresenceServices {
  const deps = presenceRootOf(served);
  let built = presenceCache.get(deps);
  if (built === undefined) {
    // S14-03: presence reads and writes run on their own small pool with connect / statement timeouts.
    const db = () => presenceDbOf(deps);
    const fast = () => faultyFastStore(deps.redis, presenceFaults);
    const intake = createNodeIntake();
    const windows = createWindowIntake(fast);
    const moments = createMomentBook({ db, store: createSqlMomentStore() });
    const nodeId = `${hostname()}:${process.pid}:${PRESENCE_BOOT_ID}`;
    const proofs = createProofWriter({
      db,
      fast,
      store: createSqlProofStore(),
      alarm: { raise: (a) => deps.alarm.raise(a) },
      clock: { now: () => deps.clock.now() },
      intake,
      nodeId,
    });
    let cat: { at: number; view: PresenceCatalogView; stamps: StampCatalog; lookups: AchievementLookups } | undefined;
    // One rebuild at a time: under load the beats that find the cache stale share it (no read stampede).
    let reading: Promise<NonNullable<typeof cat>> | undefined;
    const readCatalog = async (now: number) => {
      if (cat !== undefined && now - cat.at < REFS_TTL_MS && now >= cat.at) return cat;
      reading ??= readPresenceCatalog(deps)
        .then((v) => (cat = { at: now, ...v }))
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
    const catalog = async (now: number): Promise<PresenceCatalogView> => (await readCatalog(now)).view;
    const alarm = { raise: (a: Parameters<Deps['alarm']['raise']>[0]) => deps.alarm.raise(a) };
    const notifier = createDowntimeNotifier({
      alarm,
      publish: async (payload) => {
        // No open transaction: the event gets its own (the records live on the rights pool, not Payload's).
        await deps.events?.publisher.publish({}, PRESENCE_DOWNTIME_TOPIC, payload);
      },
    });
    const stampStore = createSqlStampStore();
    const achievements = createAchievementService({ store: createSqlAchievementStore(), stamps: (q, subject, season) => stampStore.listForSubject(q, subject, season) });
    const grantEvents = createGrantEvents({
      channel: () => deps.realtime?.publisher,
      internal: () => deps.events?.publisher,
      log: { warn: (f) => deps.log.warn(f) },
    });
    const downtimeStore = createSqlDowntimeStore();
    const downtimes = createDowntimeService({ db, store: downtimeStore, catalog, notifier });
    const sampleStore = createSqlSampleStore();
    const healthStore = createSqlHealthStore();
    const subjectAges = createSubjectAges({ db });
    built = {
      beats: createBeatService({ catalog, moments, proofs, windows, intake, subjectCreatedAt: (id) => subjectAges.createdAt(id) }),
      proofs,
      moments,
      intake,
      windows,
      subjectAges,
      catalog,
      sampler: createSampler({ db, fast, store: sampleStore, intake, nodeId, alarm }),
      finaliser: createFinaliser({ db, store: healthStore, samples: sampleStore, downtimeStore, downtimes, windows, catalog, notifier, alarm, nodeId }),
      downtimes,
      stamps: createStampService({
        db,
        catalog,
        stampCatalog: async (now) => (await readCatalog(now)).stamps,
        moments,
        proofs: createSqlProofStore(),
        health: healthStore,
        downtimes: downtimeStore,
        store: stampStore,
        evidence: windows,
        // Consequences of a fresh stamp (AC-39 .. AC-41): achievements first, then the events with the new keys.
        onGranted: async (granted) => {
          let newKeys: string[] = [];
          try {
            newKeys = await achievements.grant(await db(), {
              subjectId: granted.subjectId,
              season: granted.season,
              now: granted.issuedAt,
              lookups: (await readCatalog(granted.issuedAt)).lookups,
            });
          } catch {
            // A failed achievement write never undoes the stamp; the next grant catches the keys up.
          }
          await grantEvents.stampGranted(granted, newKeys);
        },
      }),
      season: async (now) => {
        const c = await readCatalog(now);
        return { key: c.view.catalog.season, lookups: c.lookups };
      },
      clear() {
        cat = undefined;
        reading = undefined;
        moments.clear();
      },
      nodeId,
    };
    presenceCache.set(deps, built);
  }
  return built;
}

const authorServices = new WeakMap<Deps, { ids: AuthorIds; path: AuthorPathService }>();

function authorServicesOf(served: Deps) {
  const deps = presenceRootOf(served);
  let built = authorServices.get(deps);
  if (built === undefined) {
    const db = () => rightsDbOf(deps);
    const ids = createAuthorIds({ db });
    const rights = rightsOf(deps);
    const presence = presenceOf(deps);
    built = {
      ids,
      path: createAuthorPathService({
        db,
        authorIds: ids,
        passes: rights.passes,
        bans: rights.bans,
        catalog: (now) => presence.catalog(now),
        stampedEventIds: async (subject, now) => (await presence.stamps.list(subject, now)).map((s) => s.eventId),
      }),
    };
    authorServices.set(deps, built);
  }
  return built;
}

/** Opaque author ids of the chat (SPEC-14 [П-9]): `authorIdOf` / `subjectOfAuthor` for SPEC-15. */
export const authorIdsOf = (deps: Deps): AuthorIds => authorServicesOf(deps).ids;

/** The author path of the chat card (SPEC-14 [А14]). */
export const authorPathOf = (deps: Deps): AuthorPathService => authorServicesOf(deps).path;
