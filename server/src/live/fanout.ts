/**
 * After-commit fan-out of the live chains (SPEC-12 AC-5, AC-6, AC-7, AC-14, AC-15), ring 3. No Payload import.
 * The same shape as `site/fanout.ts`.
 *
 * Subscriber rows of `live.changed` and `event-patch.changed`. Internal events exist only after their transaction
 * commits (`events/ports.ts`), so nothing here runs for a rolled-back change (AC-6). Every server instance receives
 * every event; the work is detached so the delivery loop is never blocked.
 *
 * `live.changed {version, eventIds, hidden?}`: the version is CLAIMED with a conditional update
 * (`lastFannedOut < v`); only the claimer fans it out. Claims and publishes of one process run in delivery order
 * (one queue), so a later version is never claimed before an earlier one. The claimer then:
 *  - publishes on `live:streams` one `chain` event per changed event (an event without a public chain — hidden —
 *    gets `sources: []`) and one `hide` event per hidden source, each stamped with the version; the chains come from
 *    `readChains` read after the claim, so they are at least as new as the version. A refusal or an unreachable
 *    Centrifugo writes exactly one `warn` `live/publish-failed {version}` plus one `log` alarm of that code
 *    (SPEC-13b AC-29) and the change stays (AC-7);
 *  - purges the edge by the tag `t2f-live-chains` at 0, 30, 120 s; after the third failure a `log` alarm
 *    `live/purge-failed`; without purge settings one `info` `live/purge-skipped` (AC-14);
 *  - copies the `readChains` body to `<prefix>live/chains.json` at 0, 30, 120, 300 s; each retry re-reads and writes
 *    only a version ≥ the one copied; after the fourth failure a `page` alarm `live/r2-copy-failed` (AC-15); without
 *    a bucket one `info` `live/r2-copy-skipped`.
 * Purge and copy run side by side, after the publish, outside the queue.
 *
 * `event-patch.changed` (a moment or `hidden` correction changes chains, AC-10, AC-58): when the patched event has
 * stored sources, one transaction bumps the live version and publishes `live.changed` for that event, which then fans
 * out as above. No log line carries a token or an error message.
 */
import { LIVE_CACHE_TAG, LIVE_R2_KEYS, LIVE_STREAMS_CLASS, type ChainsResponse, type StreamEvent } from '@time2fest/contracts';
import type { ObjectStore } from '../catalog/ports';
import { EVENT_PATCH_CHANGED_TOPIC } from '../corrections/service';
import type { EventPublisher, EventSubscriber, InternalEvent } from '../events/ports';
import type { Alarm, Clock, Logger } from '../ports';
import type { ChannelPublisher } from '../realtime/ports';
import { LIVE_CHANGED_TOPIC, type LiveChangedPayload } from './poller';
import type { LiveFanOutClaim, LiveStore } from './ports';
import { readChains, type ChainsReadDeps } from './snapshot';

export { LIVE_CACHE_TAG };
export const LIVE_FANOUT = 'live-fanout';
export const PUBLISH_FAILED = 'live/publish-failed';
export const PURGE_SKIPPED = 'live/purge-skipped';
export const PURGE_FAILED = 'live/purge-failed';
export const R2_COPY_SKIPPED = 'live/r2-copy-skipped';
export const R2_COPY_FAILED = 'live/r2-copy-failed';

/** Offsets from the change, in ms (AC-14): the request and two retries. */
export const PURGE_SCHEDULE: readonly number[] = [0, 30_000, 120_000];
/** Offsets from the change, in ms (AC-15): the write and three retries. */
export const COPY_SCHEDULE: readonly number[] = [0, 30_000, 120_000, 300_000];

export interface LiveFanOutDeps {
  chains: ChainsReadDeps;
  claim: LiveFanOutClaim;
  /** The server clock: `now` of the chains read. */
  clock: Clock;
  /** The realtime publish port; `undefined` in a process without realtime (one `info` line instead). */
  publisher?: ChannelPublisher;
  /** The edge purge of `LIVE_CACHE_TAG`; `undefined` when the token, zone or site URL is missing. `siteUrl` is for log lines only. */
  purge?: { sink: { purge(): Promise<void> }; siteUrl: string };
  /** The environment bucket and its `<slug>/` prefix; `undefined` when no bucket is configured. */
  copy?: { objects: ObjectStore; prefix: string };
  /** The version bump of a correction (`event-patch.changed`); absent → corrections do not move the live version. */
  versions?: { store: Pick<LiveStore, 'inTransaction' | 'state' | 'sources' | 'bumpVersion'>; events: EventPublisher };
  alarm: Alarm;
  log: Logger;
  /** Tests inject short schedules and a fake sleep; never real 30 s waits. */
  purgeSchedule?: readonly number[];
  copySchedule?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface LiveFanOutOutcome {
  /** The version this call fanned out, or `undefined` when it claimed none. */
  version?: number;
  /** Events published (all of them, or up to the first refusal). */
  published?: number;
  purge?: { ok: boolean; attempts: number } | 'skipped';
  copy?: { ok: boolean; attempts: number } | 'skipped';
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

/** Runs `attempt` at each offset of `schedule` until it succeeds; the number of attempts made. */
async function onSchedule(
  schedule: readonly number[],
  sleep: (ms: number) => Promise<void>,
  attempt: (n: number) => Promise<void>,
  onFail: (n: number, err: unknown) => void,
): Promise<{ ok: boolean; attempts: number }> {
  let attempts = 0;
  for (const [index, offset] of schedule.entries()) {
    const wait = offset - (schedule[index - 1] ?? 0);
    if (wait > 0) await sleep(wait);
    attempts += 1;
    try {
      await attempt(attempts);
      return { ok: true, attempts };
    } catch (err) {
      onFail(attempts, err);
    }
  }
  return { ok: false, attempts };
}

/** The `live:streams` events of one change, in order: chains first, then hidden sources. */
export function streamEventsOf(change: LiveChangedPayload, body: ChainsResponse): StreamEvent[] {
  const { version } = change;
  const byId = new Map(body.chains.map((c) => [c.eventId, c]));
  const out: StreamEvent[] = [];
  for (const eventId of new Set(change.eventIds)) {
    const chain = byId.get(eventId) ?? { eventId, sources: [] };
    out.push({ type: 'chain', chain: { ...chain, version }, version });
  }
  for (const h of change.hidden ?? []) out.push({ type: 'hide', eventId: h.eventId, sourceId: h.sourceId, version });
  return out;
}

async function publish(deps: LiveFanOutDeps, version: number, events: readonly StreamEvent[]): Promise<number> {
  if (!deps.publisher) {
    deps.log.info({ event: 'live/publish-skipped', version });
    return 0;
  }
  let sent = 0;
  for (const event of events) {
    let status: string;
    try {
      status = (await deps.publisher.publish(LIVE_STREAMS_CLASS, undefined, { type: event.type, id: `live:${version}:${sent}`, version, data: event })).status;
    } catch {
      // The port never throws; this keeps AC-7's single line even if an adapter does.
      status = 'unavailable';
    }
    if (status !== 'ok' && status !== 'queued') {
      // One line per version: the rest of this version would meet the same refusal; a client re-reads the chains.
      deps.log.warn({ event: PUBLISH_FAILED, version, result: status });
      // AC-29 (SPEC-13b): the same failure is also a `log` alarm (`log-alarms`, throttled per kind).
      deps.alarm.raise({ level: 'log', source: 'live', code: PUBLISH_FAILED, details: { version } });
      return sent;
    }
    sent += 1;
  }
  return sent;
}

async function purge(deps: LiveFanOutDeps, version: number): Promise<LiveFanOutOutcome['purge']> {
  const target = deps.purge;
  if (!target) {
    deps.log.info({ event: PURGE_SKIPPED, version });
    return 'skipped';
  }
  const schedule = deps.purgeSchedule ?? PURGE_SCHEDULE;
  const outcome = await onSchedule(
    schedule,
    deps.sleep ?? realSleep,
    () => target.sink.purge(),
    (attempt, err) => deps.log.warn({ event: 'live/purge-attempt-failed', version, site: target.siteUrl, attempt, of: schedule.length, err: errName(err) }),
  );
  if (!outcome.ok) deps.alarm.raise({ level: 'log', source: 'live', code: PURGE_FAILED, details: { version, attempts: outcome.attempts } });
  return outcome;
}

async function copy(deps: LiveFanOutDeps, version: number, body: ChainsResponse): Promise<LiveFanOutOutcome['copy']> {
  const bucket = deps.copy;
  if (!bucket) {
    deps.log.info({ event: R2_COPY_SKIPPED, version });
    return 'skipped';
  }
  const key = `${bucket.prefix}${LIVE_R2_KEYS.chains}`;
  const schedule = deps.copySchedule ?? COPY_SCHEDULE;
  const outcome = await onSchedule(
    schedule,
    deps.sleep ?? realSleep,
    async (attempt) => {
      let current = body;
      if (attempt > 1) {
        // A retry re-reads: it may carry a newer version, never an older one.
        const fresh = await readChains(deps.chains, deps.clock.now());
        if (fresh.version >= body.version) current = fresh;
      }
      await bucket.objects.put(key, JSON.stringify(current), 'application/json');
    },
    (attempt, err) => deps.log.warn({ event: 'live/r2-copy-attempt-failed', version, attempt, of: schedule.length, err: errName(err) }),
  );
  if (!outcome.ok) deps.alarm.raise({ level: 'page', source: 'live', code: R2_COPY_FAILED, details: { version, attempts: outcome.attempts } });
  return outcome;
}

/** Claim and publish (the ordered part); the body read after the claim, or `undefined` when nothing was claimed. */
async function claimAndPublish(deps: LiveFanOutDeps, change: LiveChangedPayload): Promise<{ body: ChainsResponse; published: number } | undefined> {
  if (!(await deps.claim.claim(change.version))) return undefined;
  const body = await readChains(deps.chains, deps.clock.now());
  const published = await publish(deps, change.version, streamEventsOf(change, body));
  return { body, published };
}

/** One fan-out pass of one committed change: claim, publish, then purge and copy side by side. */
export async function fanOutLive(deps: LiveFanOutDeps, change: LiveChangedPayload): Promise<LiveFanOutOutcome> {
  const done = await claimAndPublish(deps, change);
  if (!done) return {};
  const [purged, copied] = await Promise.all([purge(deps, change.version), copy(deps, change.version, done.body)]);
  return { version: change.version, published: done.published, purge: purged, copy: copied };
}

/** A correction of an event with stored sources moves the live version and announces the event (one transaction). */
export async function bumpForPatch(deps: LiveFanOutDeps, eventId: string): Promise<number | undefined> {
  const v = deps.versions;
  if (!v) return undefined;
  return v.store.inTransaction(null, async (tx) => {
    await v.store.state(tx);
    if ((await v.store.sources({ eventIds: [eventId] }, tx)).length === 0) return undefined;
    const version = await v.store.bumpVersion(tx);
    const payload: LiveChangedPayload = { version, eventIds: [eventId] };
    await v.events.publish(tx, LIVE_CHANGED_TOPIC, payload);
    return version;
  });
}

function changeOf(payload: unknown): LiveChangedPayload | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.version !== 'number' || !Number.isInteger(p.version) || !Array.isArray(p.eventIds)) return undefined;
  const eventIds = p.eventIds.filter((e): e is string => typeof e === 'string');
  const hidden = Array.isArray(p.hidden)
    ? p.hidden.filter((h): h is { eventId: string; sourceId: string } => typeof h === 'object' && h !== null && typeof h.eventId === 'string' && typeof h.sourceId === 'string')
    : [];
  return { version: p.version, eventIds, ...(hidden.length ? { hidden: hidden.map((h) => ({ eventId: h.eventId, sourceId: h.sourceId })) } : {}) };
}

const inFlight = new Set<Promise<unknown>>();

/** Resolves when every fan-out started in this process has finished (tests and a clean shutdown). */
export async function settleLiveFanOuts(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

function track<T>(task: Promise<T>): void {
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

/**
 * The two subscriber rows (keys `live-fanout-change`, `live-fanout-patch`). `resolve` returns the deps lazily (the
 * registry does not import the composition root); `undefined` → nothing to do.
 */
export function createLiveFanOutSubscribers(resolve: () => Promise<LiveFanOutDeps | undefined>): readonly [EventSubscriber, EventSubscriber] {
  // Claims and publishes of this process, in delivery order.
  let queue: Promise<unknown> = Promise.resolve();

  const change: EventSubscriber = {
    key: `${LIVE_FANOUT}-change`,
    topic: LIVE_CHANGED_TOPIC,
    handle(event: InternalEvent) {
      const parsed = changeOf(event.payload);
      if (!parsed) return;
      const depsP = resolve().catch(() => undefined);
      const ordered = queue.then(async () => {
        const deps = await depsP;
        if (!deps) return undefined;
        try {
          return { deps, done: await claimAndPublish(deps, parsed) };
        } catch (err) {
          // The database was unreachable for the claim or the read; the next change fans out again.
          deps.log.warn({ event: 'live/fanout-failed', version: parsed.version, err: errName(err) });
          return undefined;
        }
      });
      queue = ordered.catch(() => undefined);
      const task = ordered
        .then(async (r) => {
          if (!r?.done) return;
          await Promise.all([purge(r.deps, parsed.version), copy(r.deps, parsed.version, r.done.body)]);
        })
        .catch(() => undefined);
      track(task);
    },
  };

  const patch: EventSubscriber = {
    key: `${LIVE_FANOUT}-patch`,
    topic: EVENT_PATCH_CHANGED_TOPIC,
    handle(event: InternalEvent) {
      const p = event.payload as { eventId?: unknown } | null;
      const eventId = typeof p?.eventId === 'string' ? p.eventId : undefined;
      if (!eventId) return;
      const task = resolve()
        .then(async (deps) => {
          if (!deps) return;
          try {
            await bumpForPatch(deps, eventId);
          } catch (err) {
            deps.log.warn({ event: 'live/patch-bump-failed', err: errName(err) });
          }
        })
        .catch(() => undefined);
      track(task);
    },
  };

  return [change, patch] as const;
}
