/**
 * Catalog rebuild after a catalog change (SPEC-08 AC-61 … AC-66), ring 3. No Payload import.
 *
 * - The `catalog.changed` subscriber (every instance receives every event) moves the persisted due time to
 *   `committedAt + 150 s`, never earlier than a due time already stored, so a later change pushes the launch
 *   and a restart keeps it (AC-61). A deferred launch stays at the window's end while changes keep arriving
 *   inside the freeze window, so they add no launch and no second `site/rebuild-frozen` line.
 * - A ticker (every 15 s on the server clock; virtual time in `test`) reads the due time and decides AT THE
 *   LAUNCH: before it → nothing; in the freeze window → the due time moves to the window's end, the launch is
 *   marked deferred, one `site/rebuild-frozen` (AC-62); else the launch is CLAIMED with a conditional update
 *   on the due time just read, so exactly one instance launches it (AC-63).
 * - The claimer checks the gate: `production` without `T2F_REBUILD_PRODUCTION` → `site/rebuild-disabled`
 *   (AC-64); no token → `site/rebuild-not-configured` (AC-65); else the launch, retried at 60 s and 300 s,
 *   and after the third failure a `page` alarm `site/rebuild-failed` (AC-66).
 * No log line carries a token or an error message (status names only).
 */
import { CATALOG_CHANGED_TOPIC } from '../catalog/service';
import {
  decide,
  dueAfter,
  freezeEnd,
  inFreeze,
  launchGate,
  REBUILD_RETRY_SCHEDULE,
  type LaunchGate,
} from '../domain/site/rebuild';
import type { EventSubscriber, InternalEvent } from '../events/ports';
import type { EnvClass } from '../platform/env';
import type { Alarm, Clock, Logger } from '../ports';
import type { RebuildLauncher, RebuildStore } from './ports';

export const SITE_REBUILD = 'site-rebuild';
export const REBUILD_FROZEN = 'site/rebuild-frozen';
export const REBUILD_DISABLED = 'site/rebuild-disabled';
export const REBUILD_NOT_CONFIGURED = 'site/rebuild-not-configured';
export const REBUILD_FAILED = 'site/rebuild-failed';

export interface RebuildDeps {
  store: RebuildStore;
  /** The server clock: virtual in `test`/`rehearsal`, real in `production`. */
  clock: Clock;
  envClass: EnvClass;
  /** `T2F_REBUILD_PRODUCTION === '1'`. */
  productionFlag: boolean;
  /** `undefined` without `T2F_GITHUB_DISPATCH_TOKEN`. */
  launcher?: RebuildLauncher;
  /** The catalog version the launch names (`catalogVersionOf(meta)`); `null` without a catalog. */
  catalogVersion: () => Promise<string | null>;
  alarm: Alarm;
  log: Logger;
  /** Tests inject a short schedule and a fake sleep; never real 60 s waits. */
  retrySchedule?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export type TickOutcome =
  | { kind: 'idle' | 'wait' | 'lost' }
  | { kind: 'frozen'; until: number }
  | { kind: Exclude<LaunchGate, 'go'> }
  | { kind: 'launched'; task: Promise<LaunchOutcome> };

export interface LaunchOutcome {
  ok: boolean;
  attempts: number;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');
const iso = (ms: number) => new Date(ms).toISOString();

/** A committed catalog change: the launch is due 150 s after it (AC-61). */
export async function scheduleRebuild(deps: Pick<RebuildDeps, 'store'>, committedAt: number): Promise<void> {
  await deps.store.schedule(dueAfter(committedAt), inFreeze(committedAt));
}

async function launchWithRetries(deps: RebuildDeps, launcher: RebuildLauncher): Promise<LaunchOutcome> {
  let catalogVersion = 'unknown';
  try {
    catalogVersion = (await deps.catalogVersion()) ?? 'unknown';
  } catch {
    // The launch still goes out; the version is only a label of the run.
  }
  const schedule = deps.retrySchedule ?? REBUILD_RETRY_SCHEDULE;
  const sleep = deps.sleep ?? realSleep;
  let attempts = 0;
  for (const [index, offset] of schedule.entries()) {
    const wait = offset - (schedule[index - 1] ?? 0);
    if (wait > 0) await sleep(wait);
    attempts += 1;
    try {
      await launcher.launch(catalogVersion);
      deps.log.info({ event: 'site/rebuild-launched', catalogVersion, attempt: attempts });
      return { ok: true, attempts };
    } catch (err) {
      deps.log.warn({ event: 'site/rebuild-attempt-failed', catalogVersion, attempt: attempts, of: schedule.length, err: errName(err) });
    }
  }
  deps.alarm.raise({ level: 'page', source: 'site', code: REBUILD_FAILED, details: { catalogVersion, attempts } });
  return { ok: false, attempts };
}

const inFlight = new Set<Promise<LaunchOutcome>>();

/** Resolves when every launch (with its retries) started in this process has finished (tests, shutdown). */
export async function settleRebuilds(): Promise<LaunchOutcome[]> {
  return Promise.all([...inFlight]);
}

/** One ticker pass: decide at the launch moment, claim, gate, launch (the retries run detached). */
export async function tickRebuild(deps: RebuildDeps): Promise<TickOutcome> {
  const pending = await deps.store.pending();
  if (!pending) return { kind: 'idle' };
  const now = deps.clock.now();
  const decision = decide(now, pending.dueAt);
  if (decision === 'wait') return { kind: 'wait' };
  if (decision === 'frozen') {
    const until = freezeEnd(now);
    if (!(await deps.store.claim(pending.dueAt, until))) return { kind: 'lost' };
    deps.log.info({ event: REBUILD_FROZEN, dueAt: iso(pending.dueAt), until: iso(until) });
    return { kind: 'frozen', until };
  }
  if (!(await deps.store.claim(pending.dueAt, null))) return { kind: 'lost' };
  const gate = launchGate({ envClass: deps.envClass, productionFlag: deps.productionFlag, hasToken: deps.launcher !== undefined });
  if (gate === 'disabled') {
    deps.log.info({ event: REBUILD_DISABLED, dueAt: iso(pending.dueAt) });
    return { kind: 'disabled' };
  }
  if (gate === 'not-configured' || !deps.launcher) {
    deps.log.warn({ event: REBUILD_NOT_CONFIGURED, dueAt: iso(pending.dueAt) });
    return { kind: 'not-configured' };
  }
  const task = launchWithRetries(deps, deps.launcher);
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return { kind: 'launched', task };
}

/**
 * The subscriber row of `catalog.changed` (key `site-rebuild`). `resolve` returns the deps lazily (the
 * registry does not import the composition root); `undefined` → nothing to do. A failed write is logged
 * (name only); the next change schedules again.
 */
export function createRebuildSubscriber(resolve: () => Promise<RebuildDeps | undefined>): EventSubscriber {
  return {
    key: SITE_REBUILD,
    topic: CATALOG_CHANGED_TOPIC,
    async handle(event: InternalEvent) {
      const deps = await resolve().catch(() => undefined);
      if (!deps) return;
      try {
        await scheduleRebuild(deps, event.committedAt);
      } catch (err) {
        deps.log.warn({ event: 'site/rebuild-schedule-failed', err: errName(err) });
      }
    },
  };
}
