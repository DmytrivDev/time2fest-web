/**
 * After-commit fan-out of the `site` snapshot (SPEC-08 AC-5 … AC-7, AC-33 … AC-37), ring 3. No Payload import.
 *
 * Subscriber rows of `site.changed`, `catalog.changed` and `event-patch.changed`. Internal events exist only
 * after their transaction commits (`events/ports.ts`), so nothing here runs for a rolled-back change (AC-6).
 * Every server instance receives every event; the work is detached so the delivery loop is never blocked.
 *
 * One fan-out per version across instances: the snapshot is read, then its version is CLAIMED with a
 * conditional update (`lastFannedOut < v`); only the claimer publishes. A later event that reads the same
 * version, or an older one, claims nothing. The claimer then:
 *  - publishes `{type:'snapshot', id:'site:<v>', version:v, data}` on `site:state`; a refusal or an
 *    unreachable Centrifugo writes exactly one `warn` `site/publish-failed` and the change stays (AC-7);
 *  - purges the edge by its cache tag at 0, 30, 120 s; after the third failure a `log` alarm
 *    `site/purge-failed` (AC-35); without purge settings one `info` `site/purge-skipped` (AC-34);
 *  - copies the snapshot to `<prefix>site/latest.json` at 0, 30, 120, 300 s; each retry re-reads the
 *    snapshot and writes only a version ≥ the one being copied; after the fourth failure a `page` alarm
 *    `site/r2-copy-failed` (AC-36); without a bucket one `info` `site/r2-copy-skipped`.
 * Purge and copy run side by side, after the publish. No log line carries a token or an error message.
 */
import { SITE_CHANNEL_CLASS, SITE_R2_KEYS, siteEventId, type SiteState } from '@time2fest/contracts';
import type { ObjectStore } from '../catalog/ports';
import { CATALOG_CHANGED_TOPIC } from '../catalog/service';
import { EVENT_PATCH_CHANGED_TOPIC } from '../corrections/service';
import type { EventSubscriber } from '../events/ports';
import type { Alarm, Logger } from '../ports';
import type { ChannelPublisher } from '../realtime/ports';
import type { FanOutClaim, SnapshotSink } from './ports';
import { SITE_CHANGED_TOPIC } from './service';
import { readSnapshot, type SnapshotReadDeps } from './snapshot';

export const SITE_FANOUT = 'site-fanout';
export const PUBLISH_FAILED = 'site/publish-failed';
export const PURGE_SKIPPED = 'site/purge-skipped';
export const PURGE_FAILED = 'site/purge-failed';
export const R2_COPY_SKIPPED = 'site/r2-copy-skipped';
export const R2_COPY_FAILED = 'site/r2-copy-failed';

/** Offsets from the change, in ms (AC-35): the request and two retries. */
export const PURGE_SCHEDULE: readonly number[] = [0, 30_000, 120_000];
/** Offsets from the change, in ms (AC-36): the write and three retries (as `catalog/copy.ts`). */
export const COPY_SCHEDULE: readonly number[] = [0, 30_000, 120_000, 300_000];

export interface FanOutDeps {
  snapshot: SnapshotReadDeps;
  claim: FanOutClaim;
  /** The realtime publish port; `undefined` in a process without realtime (one `info` line instead). */
  publisher?: ChannelPublisher;
  /** The edge purge; `undefined` when the token, zone or site URL is missing. `siteUrl` is for log lines only. */
  purge?: { sink: Pick<SnapshotSink, 'purge'>; siteUrl: string };
  /** The environment bucket and its `<slug>/` prefix; `undefined` when no bucket is configured. */
  copy?: { objects: ObjectStore; prefix: string };
  alarm: Alarm;
  log: Logger;
  /** Tests inject short schedules and a fake sleep; never real 30 s waits. */
  purgeSchedule?: readonly number[];
  copySchedule?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface FanOutOutcome {
  /** The version this call fanned out, or `undefined` when it claimed none. */
  version?: number;
  published?: boolean;
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

async function publish(deps: FanOutDeps, state: SiteState): Promise<boolean> {
  const { version } = state;
  if (!deps.publisher) {
    deps.log.info({ event: 'site/publish-skipped', version });
    return false;
  }
  let status: string;
  try {
    status = (await deps.publisher.publish(SITE_CHANNEL_CLASS, undefined, { type: 'snapshot', id: siteEventId(version), version, data: state })).status;
  } catch {
    // The port never throws; this keeps AC-7's single line even if an adapter does.
    status = 'unavailable';
  }
  if (status === 'ok' || status === 'queued') return true;
  deps.log.warn({ event: PUBLISH_FAILED, version, result: status });
  return false;
}

async function purge(deps: FanOutDeps, version: number): Promise<FanOutOutcome['purge']> {
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
    (attempt, err) => deps.log.warn({ event: 'site/purge-attempt-failed', version, site: target.siteUrl, attempt, of: schedule.length, err: errName(err) }),
  );
  if (!outcome.ok) deps.alarm.raise({ level: 'log', source: 'site', code: PURGE_FAILED, details: { version, attempts: outcome.attempts } });
  return outcome;
}

async function copy(deps: FanOutDeps, state: SiteState): Promise<FanOutOutcome['copy']> {
  const bucket = deps.copy;
  if (!bucket) {
    deps.log.info({ event: R2_COPY_SKIPPED, version: state.version });
    return 'skipped';
  }
  const key = `${bucket.prefix}${SITE_R2_KEYS.latest}`;
  const schedule = deps.copySchedule ?? COPY_SCHEDULE;
  const outcome = await onSchedule(
    schedule,
    deps.sleep ?? realSleep,
    async (attempt) => {
      let body = state;
      if (attempt > 1) {
        // A retry re-reads: it may carry a newer version, never an older one.
        const fresh = await readSnapshot(deps.snapshot);
        if (!fresh.ok) throw new Error('catalog-unavailable');
        if (fresh.state.version >= state.version) body = fresh.state;
      }
      await bucket.objects.put(key, JSON.stringify(body), 'application/json');
    },
    (attempt, err) => deps.log.warn({ event: 'site/r2-copy-attempt-failed', version: state.version, attempt, of: schedule.length, err: errName(err) }),
  );
  if (!outcome.ok) deps.alarm.raise({ level: 'page', source: 'site', code: R2_COPY_FAILED, details: { version: state.version, attempts: outcome.attempts } });
  return outcome;
}

/** One fan-out pass: read, claim, publish, then purge and copy side by side. */
export async function fanOut(deps: FanOutDeps): Promise<FanOutOutcome> {
  const read = await readSnapshot(deps.snapshot);
  if (!read.ok) {
    deps.log.warn({ event: 'site/snapshot-unavailable', reason: read.reason });
    return {};
  }
  const { state } = read;
  if (!(await deps.claim.claim(state.version))) return {};
  const published = await publish(deps, state);
  const [purged, copied] = await Promise.all([purge(deps, state.version), copy(deps, state)]);
  return { version: state.version, published, purge: purged, copy: copied };
}

const inFlight = new Set<Promise<FanOutOutcome>>();

/** Resolves when every fan-out started in this process has finished (tests and a clean shutdown). */
export async function settleFanOuts(): Promise<FanOutOutcome[]> {
  return Promise.all([...inFlight]);
}

/**
 * The three subscriber rows, one per topic (keys `site-fanout-catalog`, `-patch`, `-site`). `resolve` returns
 * the deps lazily (the registry does not import the composition root); `undefined` → nothing to do.
 */
export function createSiteFanOutSubscribers(resolve: () => Promise<FanOutDeps | undefined>): readonly [EventSubscriber, EventSubscriber, EventSubscriber] {
  const row = (suffix: string, topic: string): EventSubscriber => ({
    key: `${SITE_FANOUT}-${suffix}`,
    topic,
    handle() {
      const task = resolve()
        .then((deps) =>
          deps
            ? fanOut(deps).catch((err: unknown): FanOutOutcome => {
                // The database was unreachable for the read or the claim; the next change fans out again.
                deps.log.warn({ event: 'site/fanout-failed', topic, err: errName(err) });
                return {};
              })
            : {},
        )
        .catch((): FanOutOutcome => ({}));
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    },
  });
  return [row('catalog', CATALOG_CHANGED_TOPIC), row('patch', EVENT_PATCH_CHANGED_TOPIC), row('site', SITE_CHANGED_TOPIC)] as const;
}
