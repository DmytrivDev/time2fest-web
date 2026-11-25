/**
 * Typed getters over the ports `createDeps` builds once (`Deps.events`, `.catalogStore`, …). The fields are
 * optional on `Deps` only so that a test can build a plain `Deps`; a getter throws a clear error when the
 * deps were not built by `createDeps`. Route handlers read them from `ctx.deps`.
 */
import type { AlarmService } from '../alarms/service';
import type { AlarmStore } from '../alarms/ports';
import type { AuthWiring } from '../auth/instance';
import { rightsDbOf } from '../auth/pool';
import { seasonKeyOfEnd, type SeasonCtx } from '../domain/rights/passSeason';
import { createBanMarks } from '../rights/banMarks';
import { createBanService, type BanService } from '../rights/bans';
import { publishPassEvent } from '../rights/events';
import { createPassService, type PassService } from '../rights/passes';
import type { CatalogStore } from '../catalog/ports';
import type { CorrectionDeps } from '../corrections/service';
import type { ReadinessProbe } from '../health/ports';
import type { MailService } from '../mail/ports';
import type { ChannelPublisher, SubjectInvalidator } from '../realtime/ports';
import type { SubjectResolver } from '../realtime/ports';
import type { UnattendedDeps } from '../unattended/service';
import type { Deps, EventPorts, LiveWiring, ModerationDeps, SiteWiring } from './types';

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
}
const rightsCache = new WeakMap<Deps, RightsServices>();

/** The season of the passes: the current key from the season end (`T2F_SEASON_END`, `2027-01-15` → `2026-27`). */
export function seasonCtxOf(deps: Deps): SeasonCtx {
  const end = authOf(deps).seasonEnd;
  return { currentKey: seasonKeyOfEnd(end), currentEndMs: end };
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
        publish: (db, targets, reason) => publishPassEvent(deps, db, targets, reason),
      }),
      bans: createBanService({
        db: () => rightsDbOf(deps),
        // Read on each call: a test may swap `deps.redis`.
        marks: createBanMarks(() => deps.redis),
        alarm: { raise: (a) => deps.alarm.raise(a) },
        now: () => deps.clock.now(),
      }),
    };
    rightsCache.set(deps, built);
  }
  return built;
}
