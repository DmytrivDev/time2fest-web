/**
 * The status poller of the live air (SPEC-12 AC-9, AC-10, AC-24 … AC-36, AC-43, AC-44, AC-54, AC-58, AC-73), ring 3.
 * No Payload import, no `Date.now()`: time is the `now` of each tick (the server clock of the caller).
 *
 * The ticker calls `tick(now)` every few seconds; only the holder of the `live-poller` lease works, and a tick never
 * overlaps itself.
 * - Every pass: the queued ad-hoc checks (AC-43): an id already asked in the current status cycle or checked less
 *   than one cycle ago is not asked again; the ad-hoc ceiling refuses the rest without a call (AC-44).
 * - Every `tickMs`: one merged cycle over the open windows (hidden events excluded, AC-10, AC-25), then the due
 *   off-window checks when the quota allows them (AC-26, AC-32), then once a day the retention pass (AC-73).
 * - Each call is charged before its answer is read, so a failed call counts too (AC-31); the first crossing of the
 *   alarm ratio raises one `live/quota-80` `page` (AC-34); `quotaExceeded` stops the bucket until the quota day ends
 *   and writes one `live/quota-exceeded` line, statuses stay (AC-35).
 * - A source under `override` keeps its status; a disagreeing answer writes one `live/override-kept` line (AC-9).
 * - The public chains after the writes (at `now`, with zone-live) are compared with the stored rows before them, taken
 *   at the previous pass's time, so time alone also counts as a change (−5 min rule AC-28, long news, retention); any
 *   change bumps `live-state.version` in the same transaction and publishes ONE `live.changed` (AC-5).
 * - No fresh check for longer than `staleMs`: `live/statuses-stale` `page` for an open window, `log` outside (AC-36).
 * Logs and alarms carry codes and counts only: never an id list or a key.
 */
import type { StreamChain } from '@time2fest/contracts';
import type { CorrectionReader } from '../corrections/ports';
import { publicChain, type StoredSource } from '../domain/live/chain';
import type { LiveConfig } from '../domain/live/config';
import { liveEventOf, openWindowEvents, windowOf, type LiveEvent } from '../domain/live/moment';
import { allow, chargeCalls, markExceeded as markExceededState, nextDayBoundary, quotaDay, staleLevel, type CallerContext, type QuotaClass, type QuotaState } from '../domain/live/quota';
import { batchesOf, nextOffWindowCheckAt, planTick, type ScheduledSource } from '../domain/live/schedule';
import { asStreamStatus, statusFromCheck, type YoutubeVideoState } from '../domain/live/status';
import type { EventPublisher } from '../events/ports';
import type { Alarm } from '../ports';
import type { Actor, Journal } from '../audit/ports';
import { candidateOnSourceStatus, transition } from '../domain/live/candidates';
import type { LiveEventSource, LiveLease, LiveSource, LiveStore, QuotaStore, SourceCheck, StreamsStore, Tx, VideoStatusSource } from './ports';
import { expiredSources, RETENTION_RUN_MS, runRetention, type Refreshed } from './retention';

export const LIVE_CHANGED_TOPIC = 'live.changed';
export const LIVE_POLLER_LEASE = 'live-poller';
/** How often the ticker calls `tick` (the ad-hoc queue latency, AC-43: ≤10 s). */
export const LIVE_PASS_MS = 5_000;
/** Lease term: three passes, so one slow pass does not hand the lease over. */
const LEASE_TTL_MS = 3 * LIVE_PASS_MS;
const ALARM_SOURCE = 'live';
const POLLER_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'live-poller', label: 'live-poller' });

/** Payload of `live.changed`: the new version and the events whose public chain changed. */
export interface LiveChangedPayload {
  version: number;
  eventIds: string[];
  hidden?: { eventId: string; sourceId: string }[];
}

export interface LivePollerDeps {
  store: LiveStore;
  quota: QuotaStore;
  lease: LiveLease;
  statuses: VideoStatusSource;
  events: LiveEventSource;
  publisher: EventPublisher;
  alarm: Alarm;
  cfg: LiveConfig;
  caller: CallerContext;
  /**
   * SPEC-21a AC-10: with it, an approved candidate follows its source in the same transaction (`approved` → `active`
   * on the first `live`, → `dead` when the source dies), one journal row each (actor `system`).
   */
  streams?: StreamsStore;
  journal?: Journal;
}

export interface TickReport {
  /** False when another instance holds the lease, or a tick was still running. */
  ran: boolean;
  /** True when this pass ran the status cycle. */
  cycle: boolean;
  /** `videos.list` calls made (each one charged). */
  calls: number;
  /** The new version when a public chain changed. */
  version?: number;
}

export interface LivePoller {
  tick(now: number): Promise<TickReport>;
  /** Lets the lease go (graceful stop). */
  release(): Promise<void>;
}

/** The events of the catalog with their corrections, as the live air reads them (AC-10, AC-58). */
export function liveEventsFrom(reader: CorrectionReader): LiveEventSource {
  return {
    async events() {
      const [bases, patches] = await Promise.all([reader.allEvents(), reader.allPatches()]);
      const byId = new Map(patches.map((p) => [p.eventId, p.state]));
      const out: LiveEvent[] = [];
      for (const b of bases) {
        const at = new Date(b.moment).toISOString();
        const e = liveEventOf({ eventId: b.eventId, zoneId: b.zoneId, slot: b.slot, midnightUtc: at, startsAt: at, patch: byId.get(b.eventId) ?? null });
        if (e) out.push(e);
      }
      return out;
    },
  };
}

/** What a check answer writes onto a source: the [А20] verdict, unless an `override` holds it (AC-9). */
export function checkOf(source: LiveSource, item: YoutubeVideoState | undefined, now: number, cfg: LiveConfig): SourceCheck {
  const outcome = statusFromCheck(item, now);
  const fields = item
    ? {
        liveBroadcastContent: item.liveBroadcastContent ?? null,
        privacyStatus: item.privacyStatus ?? null,
        embeddable: item.embeddable ?? null,
        scheduledStartTime: item.scheduledStartTime ?? null,
        actualStartTime: item.actualStartTime ?? null,
        actualEndTime: item.actualEndTime ?? null,
      }
    : { liveBroadcastContent: null, privacyStatus: null, embeddable: null, scheduledStartTime: null, actualStartTime: null, actualEndTime: null };
  const check: SourceCheck = {
    sourceId: source.sourceId,
    youtube: { fields, fetchedAt: now },
    lastChecked: now,
    nextOffWindowCheckAt: nextOffWindowCheckAt(now, cfg),
  };
  if (source.override) return check;
  check.verdict =
    outcome.kind === 'alive'
      ? { status: outcome.status, ...(outcome.startsAt ? { startsAt: Date.parse(outcome.startsAt) } : {}), dead: false, deadReason: null }
      : { status: asStreamStatus(source.status), dead: true, deadReason: outcome.reason };
  return check;
}

/** Does the answer disagree with the override (AC-9: one line)? */
function overrideDisagrees(source: LiveSource, item: YoutubeVideoState | undefined, now: number): boolean {
  const outcome = statusFromCheck(item, now);
  if (source.override === 'live') return !(outcome.kind === 'alive' && outcome.status === 'live');
  return outcome.kind === 'alive';
}

/** The comparable content of a chain: everything but the check time (a check alone is not a change). */
function chainKey(chain: StreamChain | null): string {
  if (!chain) return 'hidden';
  return JSON.stringify(chain.sources.map((source) => ({ ...source, lastChecked: '' })));
}

function chainKeys(events: readonly LiveEvent[], sources: readonly StoredSource[], now: number, cfg: LiveConfig, zoneLive: LiveStateZone): Map<string, string> {
  const byEvent = new Map<string, StoredSource[]>();
  for (const s of sources) {
    const list = byEvent.get(s.eventId);
    if (list) list.push(s);
    else byEvent.set(s.eventId, [s]);
  }
  const keys = new Map<string, string>();
  for (const e of events) {
    const own = byEvent.get(e.eventId);
    if (own) keys.set(e.eventId, chainKey(publicChain(e, own, { now, cfg, zoneLive })));
  }
  return keys;
}
type LiveStateZone = Awaited<ReturnType<LiveStore['state']>>['zoneLive'];

function changedEvents(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const ids = new Set<string>();
  for (const [id, key] of after) if (before.get(id) !== key) ids.add(id);
  for (const id of before.keys()) if (!after.has(id)) ids.add(id);
  return [...ids].sort();
}

const pollable = (s: LiveSource): s is LiveSource & { videoId: string } => s.platform === 'youtube' && !!s.videoId;

export function createLivePoller(deps: LivePollerDeps): LivePoller {
  const { cfg } = deps;
  let running = false;
  let lastCycleAt: number | null = null;
  let cycleIds = new Set<string>();
  let events: LiveEvent[] | null = null;
  /** The time of the previous commit: the chains before the writes are evaluated at it (time-only changes count). */
  let lastNow: number | null = null;
  let lastRetentionAt: number | null = null;
  let windowStale = false;
  let offFailSince: number | null = null;
  let offStaleLogged = false;
  const overrideLogged = new Set<string>();

  const raise = (level: 'page' | 'log', code: string, details?: Record<string, unknown>) =>
    deps.alarm.raise({ level, source: ALARM_SOURCE, code, ...(details ? { details } : {}) });

  /** One counted call per batch; returns the answers of the batches that succeeded. */
  async function callBatches(cls: QuotaClass, batches: readonly string[][], now: number, q: { state: QuotaState; stopped: boolean; calls: number }): Promise<Refreshed> {
    const answers = new Map<string, YoutubeVideoState | undefined>();
    const day = quotaDay(now, cfg.dayTimeZone);
    for (const batch of batches) {
      if (q.stopped) break;
      const decision = allow(q.state, cls, now, cfg, deps.caller, 1);
      if (!decision.ok) {
        if (decision.reason === 'quota-exceeded') q.stopped = true;
        break;
      }
      // Charged before the answer is read (AC-31): a failed call counts too.
      const used = await deps.quota.charge(day, 'queries', decision.units);
      if (cls === 'ad-hoc') await deps.quota.charge(day, 'ad-hoc', decision.units);
      const mirrored = chargeCalls(q.state, cls, 1, now, cfg).state;
      const queries = mirrored.queries;
      q.state = queries ? { ...mirrored, queries: { ...queries, used } } : mirrored;
      q.calls += 1;
      if (used >= cfg.alarmRatio * cfg.buckets.queries.perDay && (await deps.quota.mark80(day, 'queries', now))) {
        raise('page', 'live/quota-80', { bucket: 'queries' });
      }
      const result = await deps.statuses.list(batch);
      if ('error' in result) {
        if (result.error === 'quota-exceeded') {
          const until = nextDayBoundary(now, cfg.dayTimeZone);
          if (await deps.quota.markExceeded(day, 'queries', until)) raise('log', 'live/quota-exceeded', { bucket: 'queries' });
          q.state = markExceededState(q.state, 'queries', now, cfg);
          q.stopped = true;
        }
        continue;
      }
      const byId = new Map(result.items.map((v) => [v.videoId, v]));
      for (const id of batch) answers.set(id, byId.get(id));
    }
    return answers;
  }

  function checksFor(sources: readonly LiveSource[], answers: Refreshed, now: number): SourceCheck[] {
    const checks: SourceCheck[] = [];
    for (const s of sources) {
      if (!pollable(s) || !answers.has(s.videoId)) continue;
      const item = answers.get(s.videoId);
      if (s.override) {
        const key = `${s.sourceId}:${s.override}`;
        if (overrideDisagrees(s, item, now)) {
          if (!overrideLogged.has(key)) {
            overrideLogged.add(key);
            raise('log', 'live/override-kept', { override: s.override });
          }
        } else overrideLogged.delete(key);
      }
      checks.push(checkOf(s, item, now, cfg));
    }
    return checks;
  }

  /** AC-10: the approved candidates of the checked sources follow their status, in the poller's transaction. */
  async function followSources(tx: Tx, checks: readonly SourceCheck[], after: readonly LiveSource[], now: number): Promise<void> {
    const streams = deps.streams;
    if (!streams) return;
    const candidates = await streams.candidates({ sourceIds: checks.map((c) => c.sourceId), states: ['approved', 'active'] }, tx);
    if (candidates.length === 0) return;
    const bySource = new Map(after.map((s) => [s.sourceId, s]));
    for (const c of candidates) {
      const source = c.sourceId ? bySource.get(c.sourceId) : undefined;
      if (!source) continue;
      const next = candidateOnSourceStatus(c.state, source.status === 'live' && source.dead !== true, source.dead === true);
      if (!next || !transition(c.state, next, 'server').ok) continue;
      await streams.saveCandidate(tx, { videoId: c.videoId, state: next }, `system:${POLLER_ACTOR.id}`, now);
      await deps.journal?.append(tx, {
        actor: POLLER_ACTOR,
        action: 'streams.candidate',
        target: { collection: 'stream-candidates', id: c.videoId },
        at: now,
        before: { videoId: c.videoId, state: c.state, reason: c.reason ?? null, eventId: c.eventId ?? null, foundBy: [...c.foundBy] },
        after: { videoId: c.videoId, state: next, reason: c.reason ?? null, eventId: c.eventId ?? null, foundBy: [...c.foundBy] },
        revertOf: null,
      });
    }
  }

  /** Writes the checks and, when a public chain changed, the new version and one `live.changed`. */
  async function commit(evts: readonly LiveEvent[], before: readonly LiveSource[], checks: readonly SourceCheck[], now: number): Promise<{ version?: number; after: LiveSource[] }> {
    const then = lastNow !== null && lastNow <= now ? lastNow : now;
    const out = await deps.store.inTransaction(null, async (tx: Tx) => {
      const state = await deps.store.state(tx);
      const baseline = chainKeys(evts, before, then, cfg, state.zoneLive);
      await deps.store.applyChecks(tx, checks);
      const after = checks.length ? await deps.store.sources(undefined, tx) : [...before];
      if (checks.length) await followSources(tx, checks, after, now);
      const changed = changedEvents(baseline, chainKeys(evts, after, now, cfg, state.zoneLive));
      if (changed.length === 0) return { after };
      const version = await deps.store.bumpVersion(tx);
      const payload: LiveChangedPayload = { version, eventIds: changed };
      await deps.publisher.publish(tx, LIVE_CHANGED_TOPIC, payload);
      return { version, after };
    });
    lastNow = now;
    return out;
  }

  function staleAlarms(evts: readonly LiveEvent[], sources: readonly LiveSource[], now: number): void {
    let stale = false;
    for (const e of openWindowEvents(evts, now, cfg)) {
      const from = windowOf(e.moment, cfg).from;
      const own = sources.filter((s) => s.eventId === e.eventId && pollable(s));
      if (own.length === 0) continue;
      const oldest = Math.min(...own.map((s) => s.lastChecked ?? from));
      if (staleLevel({ inOpenWindow: true, since: Math.max(from, oldest) }, now, cfg) === 'page') stale = true;
    }
    if (stale && !windowStale) raise('page', 'live/statuses-stale', { scope: 'window' });
    windowStale = stale;
  }

  async function run(now: number): Promise<TickReport> {
    if (!(await deps.lease.acquire(LIVE_POLLER_LEASE, LEASE_TTL_MS))) return { ran: false, cycle: false, calls: 0 };
    const cycle = lastCycleAt === null || now < lastCycleAt || now - lastCycleAt >= cfg.tickMs;
    const pending = await deps.store.claimPendingChecks();
    if (!cycle && pending.length === 0) return { ran: true, cycle: false, calls: 0 };
    if (cycle || events === null) events = await deps.events.events();
    const evts = events;
    const sources = await deps.store.sources();
    const day = quotaDay(now, cfg.dayTimeZone);
    const q = { state: await deps.quota.read(day), stopped: false, calls: 0 };
    const answers = new Map<string, YoutubeVideoState | undefined>();
    const merge = (a: Refreshed) => {
      for (const [id, v] of a) answers.set(id, v);
    };

    let offDue: string[] = [];
    if (cycle) {
      const scheduled: ScheduledSource[] = sources.filter(pollable).map((s) => ({ eventId: s.eventId, videoId: s.videoId, nextOffWindowCheckAt: s.nextOffWindowCheckAt ?? null }));
      const plan = planTick(evts, scheduled, now, cfg);
      merge(await callBatches('statuses', batchesOf(plan.windowIds, cfg.batchSize), now, q));
      cycleIds = new Set(plan.windowIds);
      lastCycleAt = now;
      offDue = plan.offWindowIds;
    }

    // Ad-hoc checks (AC-43): not an id of the current cycle, not one checked less than a cycle ago.
    if (pending.length) {
      const bySource = new Map(sources.map((s) => [s.sourceId, s]));
      const ids = new Set<string>();
      for (const p of pending) {
        const s = bySource.get(p.sourceId);
        if (!s || !pollable(s) || cycleIds.has(s.videoId) || answers.has(s.videoId)) continue;
        if (s.lastChecked != null && now - s.lastChecked < cfg.tickMs) continue;
        ids.add(s.videoId);
      }
      if (ids.size) merge(await callBatches('ad-hoc', batchesOf([...ids], cfg.batchSize), now, q));
    }

    if (offDue.length) {
      const off = await callBatches('off-window', batchesOf(offDue, cfg.batchSize), now, q);
      merge(off);
      if (off.size === offDue.length) {
        offFailSince = null;
        offStaleLogged = false;
      } else offFailSince ??= now;
    }

    const checks = checksFor(sources, answers, now);
    if (cycle && (lastRetentionAt === null || now < lastRetentionAt || now - lastRetentionAt >= RETENTION_RUN_MS)) {
      lastRetentionAt = now;
      const checked = new Set(checks.map((c) => c.sourceId));
      const expired = expiredSources(sources, now, cfg, checked);
      const retention = await runRetention(expired, now, cfg, (ids) => callBatches('off-window', batchesOf(ids, cfg.batchSize), now, q), (s, item) =>
        checksFor([s], new Map([[s.videoId ?? '', item]]), now)[0] ?? checkOf(s, item, now, cfg),
      );
      checks.push(...retention.checks);
    }

    const result = await commit(evts, sources, checks, now);
    if (cycle) {
      staleAlarms(evts, result.after, now);
      if (offFailSince !== null && !offStaleLogged && staleLevel({ inOpenWindow: false, since: offFailSince }, now, cfg) === 'log') {
        offStaleLogged = true;
        raise('log', 'live/statuses-stale', { scope: 'off-window' });
      }
    }
    return { ran: true, cycle, calls: q.calls, ...(result.version !== undefined ? { version: result.version } : {}) };
  }

  return {
    async tick(now) {
      if (running) return { ran: false, cycle: false, calls: 0 };
      running = true;
      try {
        return await run(now);
      } finally {
        running = false;
      }
    },
    release: () => deps.lease.release(LIVE_POLLER_LEASE),
  };
}
