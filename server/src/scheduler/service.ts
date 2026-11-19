/**
 * The moment scheduler of one process (SPEC-07 AC-1, AC-25 … AC-48, NFR-7, NFR-8), ring 3: ports only.
 *
 * Two loops on injected, unref'd timers:
 * - **lease** — the holder runs `acquireOrRenew` every 2 s REAL time; a standby tries again right
 *   after the current term ends (the store says when; else every 1 s) (AC-44). The term is the store's (database clock); the
 *   process trusts it only until its own MONOTONIC clock says the term (minus a safety margin,
 *   counted from the moment the request was sent) has run out (`holds`). Virtual time never enters.
 *   A holder that cannot reach the store stops acting when the term runs out and raises `page`
 *   `scheduler/lease_unreachable` once per outage (AC-46). Every takeover is logged (and journaled
 *   by the store in its transaction, AC-48).
 * - **tick** — at most every 250 ms real (sooner when the next moment is closer at the current
 *   speed; never faster than that while frozen): nothing until the moment list is loaded (NFR-8)
 *   and while not holding the lease (AC-43); otherwise the due groups by SERVER time, in C1 order:
 *   late rule → `skipped` rows (journaled by the store); ONE `claim` transaction for every group
 *   due at that look (fenced by lease epoch, AC-45) → run the action once per group, in order
 *   (AC-30), with its consequence id (C4, reused after a crash, AC-29) → ONE `finish done`
 *   transaction. Groups that came due meanwhile are taken by the next look of the same pass, never
 *   after a sleep (AC-32 at ×600). An action that throws (also on a publisher result
 *   `unavailable`/`rejected`) is retried ≥1 s apart while its late rule allows, then settled as
 *   `failed` (journaled) — other groups keep running meanwhile (AC-40). A settled pair never runs
 *   again in the same run epoch (AC-26, AC-37).
 * - **lag** (AC-39, AC-41): only the holder, never while frozen; real lag of a due, not-started group
 *   = real time since its moment came due = server time since `max(at, since)` ÷ speed, where `since`
 *   is the instant the clock last jumped or changed speed (a virtual jump is not "lag"). Moments a
 *   dead holder left behind DO count (AC-39 has no takeover exemption): the new holder pages if they
 *   are over 2 s late. One `page` `scheduler/lag` per lagging episode.
 */
import { seasonMoments, type SeasonInput, type SeasonMoment } from '@time2fest/rules/time';
import { consequenceFor, pairKey } from '../domain/scheduler/consequence';
import { LAG_ALARM_MS, lagMs, type LateSkipReason } from '../domain/scheduler/late';
import { applyRenew, holds, LEASE_RENEW_MS, NO_LEASE, nextAttemptMs, type LeaseView, type RenewOutcome } from '../domain/scheduler/lease';
import { buildPlan, dueGroups, nextDueAt, splitLate, wakeDelayMs, type DueGroup, type SchedulePlan } from '../domain/scheduler/plan';
import type { EnvClass } from '../platform/env';
import type { Alarm, Logger } from '../ports';
import type { LeaseStore, MomentActionRow, MomentSource, RunFinalStatus, RunStore } from './ports';

/** Upper bound of one tick, real ms. */
export const SCHEDULER_TICK_MS = 250;
/** Minimum real ms between two attempts of a failed action (AC-40). */
export const SCHEDULER_RETRY_MS = 1_000;
const MIN_DELAY_MS = 5;
const LOAD_RETRY_MS = 1_000;

export interface ClockView {
  now: number;
  speed: number;
  frozen: boolean;
  /**
   * Server instant since which the clock has run continuously at `speed` (the anchor of a virtual
   * clock: every jump or speed change re-anchors). Absent = always (real time).
   */
  since?: number;
}

export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SchedulerDeps {
  /** Server time (virtual in test/rehearsal): instant, speed, frozen. Lateness and due-ness only. */
  view: () => ClockView;
  /** Monotonic REAL ms (`performance.now`): the lease term, retries and lag. */
  mono: () => number;
  lease: LeaseStore;
  runs: RunStore;
  source: MomentSource;
  /** Moment-action rows of this class (`momentActionsFor(cls)`). */
  rows: readonly MomentActionRow[];
  alarm: Alarm;
  log: Logger;
  /** `<hostname>:<pid>:<random>`: unique per process start. */
  holderId: string;
  cls: EnvClass;
  /** Run epoch of the loaded season: production the season key's year, test/rehearsal the clock state's. */
  runEpochOf: (input: SeasonInput) => number;
  timers?: SchedulerTimers;
  tickMs?: number;
  renewMs?: number;
  retryMs?: number;
}

export interface SchedulerMomentRef {
  action: string;
  at: number;
  keys: string[];
}

export interface SchedulerLastRun extends SchedulerMomentRef {
  status: RunFinalStatus;
  /** Server instant the run was settled. */
  finishedAt: number;
  consequenceId?: string;
  reason?: string;
}

export interface SchedulerCounters {
  /** Pairs settled by this process, per status. */
  done: number;
  skipped: number;
  failed: number;
  /** Failed attempts that will be retried. */
  retries: number;
  /** Claims or finishes refused by the fencing check. */
  stale: number;
  /** Times this process became the holder. */
  acquired: number;
  lagAlarms: number;
  loadFailures: number;
}

export interface SchedulerStatus {
  holderId: string;
  state: 'stopped' | 'running' | 'paused';
  lease: {
    /** The store's last answer said this process holds the lease. */
    held: boolean;
    /** Held AND the local monotonic term allows acting now. */
    acting: boolean;
    epoch: number | null;
    /** Local term left, real ms. */
    termLeftMs: number;
    /** The last renew attempt could not reach the store. */
    unreachable: boolean;
  };
  /** The moment list has been loaded at least once (NFR-8). */
  loaded: boolean;
  moments: number;
  seasonId: string | null;
  runEpoch: number | null;
  /** First group after server now with an unsettled pair (as this process knows them). */
  next: SchedulerMomentRef | null;
  last: SchedulerLastRun | null;
  /** Largest real lag of a due, not-started group seen by the last pass (0 when not acting). */
  lagMs: number;
  counters: SchedulerCounters;
}

export interface SchedulerHandle {
  start(): void;
  /** Stops both loops, waits for the running pass, lets the lease go. */
  stop(): Promise<void>;
  /** Stops renewing and acting (the `pause` door, AC-45); the lease then expires by itself. */
  pause(): void;
  resume(): void;
  /** Marks the moment list stale (patch, catalog change): reloaded by the next pass (AC-25). */
  recompute(): void;
  status(): SchedulerStatus;
  /** One evaluation pass now (tests, doors); resolves when it ended. */
  tick(): Promise<void>;
}

const defaultTimers: SchedulerTimers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A code for logs and run rows — never the error message (it may carry data). */
function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    if ((err as { name?: unknown }).name === 'DependencyUnavailable') return 'unavailable';
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code.slice(0, 64);
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') return name.slice(0, 64);
  }
  return 'error';
}

export function createScheduler(d: SchedulerDeps): SchedulerHandle {
  const tickMs = d.tickMs ?? SCHEDULER_TICK_MS;
  const renewMs = d.renewMs ?? LEASE_RENEW_MS;
  const retryMs = d.retryMs ?? SCHEDULER_RETRY_MS;
  const timers = d.timers ?? defaultTimers;
  const rowsByKey = new Map(d.rows.map((r) => [r.key, r]));
  const ctx = { cls: d.cls, log: d.log };

  let state: SchedulerStatus['state'] = 'stopped';
  let lease: LeaseView = NO_LEASE;
  let unreachable = false;
  let renewTimer: unknown;
  let tickTimer: unknown;
  let renewing: Promise<void> | null = null;
  let passing: Promise<void> | null = null;
  /** The last pass threw (store down): wait a whole tick before the next look. */
  let passFailed = false;

  // Moment list (NFR-8): reloaded whenever `dirty` moved past `loadedGen`.
  let dirty = 1;
  let loadedGen = 0;
  let loadRetryAt = -Infinity;
  let input: SeasonInput | null = null;
  let plan: SchedulePlan | null = null;
  let momentCount = 0;

  // What this process knows of the run epoch (reloaded on epoch change, takeover, doubt).
  let runEpoch: number | null = null;
  let ledgerFresh = false;
  let settled = new Set<string>();
  let started = new Map<string, string>();
  const failures = new Map<string, { nextMono: number; attempts: number; code: string }>();

  // Lag bookkeeping (real time).
  let lagging = false;
  let lastLag = 0;
  let epochError = false;

  let last: SchedulerLastRun | null = null;
  const counters: SchedulerCounters = { done: 0, skipped: 0, failed: 0, retries: 0, stale: 0, acquired: 0, lagAlarms: 0, loadFailures: 0 };

  const acting = () => holds(lease, d.mono());

  // ---- lease loop ---------------------------------------------------------------------------

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const h = timers.setTimeout(() => resolve(undefined), ms);
      p.then(
        (v) => {
          timers.clearTimeout(h);
          resolve(v);
        },
        (e: unknown) => {
          timers.clearTimeout(h);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  /** One acquire/renew attempt; resolves with what the store answered (for the next attempt's timing). */
  async function renew(): Promise<RenewOutcome> {
    const sentAt = d.mono();
    let outcome: RenewOutcome;
    let failure: string | undefined;
    try {
      const g = await withTimeout(d.lease.acquireOrRenew(d.holderId), renewMs * 2);
      if (g === undefined) failure = 'timeout';
      outcome =
        g === undefined
          ? { ok: false }
          : {
              ok: true,
              held: g.held,
              epoch: g.epoch,
              expiresInMs: g.expiresInMs,
              ...(g.previousHolder ? { previousHolder: g.previousHolder } : {}),
              ...(g.freeInMs !== undefined ? { freeInMs: g.freeInMs } : {}),
            };
    } catch (err) {
      failure = errorCode(err);
      outcome = { ok: false };
    }
    if (state === 'stopped') return outcome;
    const wasHeld = lease.held;
    const step = applyRenew(lease, outcome, sentAt);
    lease = step.view;
    if (step.change !== 'unreachable') unreachable = false;
    switch (step.change) {
      case 'acquired':
        counters.acquired += 1;
        d.log.info({
          msg: 'scheduler-takeover',
          holder: d.holderId,
          previousHolder: step.takeover?.previousHolder ?? null,
          epoch: step.takeover?.epoch ?? lease.epoch,
        });
        // Another holder may have settled pairs: start from the store's ledger.
        ledgerFresh = false;
        failures.clear();
        lagging = false;
        kick();
        break;
      case 'lost':
        d.log.warn({ msg: 'scheduler-lease-lost', holder: d.holderId });
        lastLag = 0;
        break;
      case 'unreachable':
        if (wasHeld && !unreachable) {
          unreachable = true;
          d.log.error({ msg: 'scheduler-lease-unreachable', holder: d.holderId, code: failure ?? 'error' });
          d.alarm.raise({ level: 'page', source: 'scheduler', code: 'lease_unreachable', details: { cause: failure ?? 'error' } });
        }
        break;
      default:
        break;
    }
    return outcome;
  }

  function scheduleRenew(ms: number): void {
    if (state !== 'running') return;
    if (renewTimer !== undefined) timers.clearTimeout(renewTimer);
    renewTimer = timers.setTimeout(() => {
      renewTimer = undefined;
      if (state !== 'running' || renewing) return;
      const sentAt = d.mono();
      // The holder renews every `renewMs`; a standby tries again right when the current term ends.
      let outcome: RenewOutcome = { ok: false };
      renewing = renew()
        .then((o) => {
          outcome = o;
        })
        .finally(() => {
          renewing = null;
          scheduleRenew(nextAttemptMs(lease, outcome, renewMs, d.mono() - sentAt));
        });
    }, ms);
  }

  // ---- moment list --------------------------------------------------------------------------

  async function load(): Promise<void> {
    if (d.mono() < loadRetryAt) return;
    const gen = dirty;
    try {
      const loaded = await d.source.load();
      const moments = seasonMoments(loaded);
      plan = buildPlan(moments, d.rows, d.cls);
      input = loaded;
      momentCount = moments.length;
      loadedGen = gen;
      epochError = false;
      d.log.info({ msg: 'scheduler-moments-loaded', season: loaded.seasonId, moments: moments.length });
    } catch (err) {
      counters.loadFailures += 1;
      loadRetryAt = d.mono() + LOAD_RETRY_MS;
      d.log.warn({ msg: 'scheduler-moments-load-failed', code: errorCode(err) });
      d.alarm.raise({ level: 'log', source: 'scheduler', code: 'moments_load_failed', details: { cause: errorCode(err) } });
    }
  }

  // ---- one group ----------------------------------------------------------------------------

  async function settle(group: DueGroup, keys: string[], status: RunFinalStatus, epoch: number, extra: { reason?: string; consequenceId?: string }): Promise<'finished' | 'stale'> {
    const finishedAt = d.view().now;
    const r = await d.runs.finish({
      leaseEpoch: lease.epoch ?? -1,
      holder: d.holderId,
      runEpoch: epoch,
      action: group.action,
      keys,
      status,
      plannedAt: group.at,
      finishedAt,
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      ...(extra.consequenceId !== undefined ? { consequenceId: extra.consequenceId } : {}),
    });
    if (r === 'stale') return fenced('finish');
    for (const k of keys) {
      const pk = pairKey(group.action, k);
      settled.add(pk);
      started.delete(pk);
      failures.delete(pk);
    }
    counters[status] += keys.length;
    last = { action: group.action, at: group.at, keys, status, finishedAt, ...extra };
    return 'finished';
  }

  function fenced(step: 'claim' | 'finish'): 'stale' {
    counters.stale += 1;
    d.log.warn({ msg: 'scheduler-fenced', holder: d.holderId, epoch: lease.epoch, step });
    // The store says the epoch is no longer current: stop acting until the next renew says otherwise.
    lease = { ...NO_LEASE, epoch: lease.epoch };
    ledgerFresh = false;
    return 'stale';
  }

  /** A due group cleared by its late rule, ready to be claimed and run. */
  interface Ready {
    group: DueGroup;
    run: readonly SeasonMoment[];
    keys: string[];
    lateMs: number;
    consequenceId: string;
  }

  /**
   * Late rule, skips and failures of one due group (settled at once), retry spacing and the lag
   * alarm: the runnable part of the group, or why there is none.
   */
  async function prepare(p: SchedulePlan, group: DueGroup, epoch: number, v: ClockView): Promise<Ready | 'ok' | 'deferred' | 'stale'> {
    const split = splitLate(p, group, v.now);

    // Late: never-tried moments are skipped, moments whose attempts failed are settled as failed.
    const skips = new Map<string, string[]>();
    const fails = new Map<string, string[]>();
    for (const { moment, verdict } of split.skip) {
      const failure = failures.get(pairKey(group.action, moment.key));
      const into = failure ? fails : skips;
      const reason: string = failure ? failure.code : (verdict.reason satisfies LateSkipReason);
      into.set(reason, [...(into.get(reason) ?? []), moment.key]);
    }
    for (const [reason, keys] of skips) {
      d.log.info({ msg: 'scheduler-skip', action: group.action, keys, lateMs: split.lateMs, reason });
      if ((await settle(group, keys, 'skipped', epoch, { reason })) === 'stale') return 'stale';
    }
    for (const [reason, keys] of fails) {
      d.log.warn({ msg: 'scheduler-failed', action: group.action, keys, lateMs: split.lateMs, reason });
      d.alarm.raise({ level: 'log', source: 'scheduler', code: 'action_failed', details: { action: group.action, reason } });
      const consequenceId = started.get(pairKey(group.action, keys[0] ?? ''));
      if ((await settle(group, keys, 'failed', epoch, { reason, ...(consequenceId ? { consequenceId } : {}) })) === 'stale') return 'stale';
    }
    if (split.run.length === 0) return 'ok';

    const keys = split.run.map((m) => m.key);
    const nowMono = d.mono();
    const retrying = keys.some((k) => failures.has(pairKey(group.action, k)));
    if (keys.some((k) => (failures.get(pairKey(group.action, k))?.nextMono ?? -Infinity) > nowMono)) return 'deferred';

    if (!retrying) {
      const lag = lagMs(group.at, v.now, v.speed, v.since === undefined ? undefined : (v.now - v.since) / v.speed);
      lastLag = Math.max(lastLag, lag);
      if (lag > LAG_ALARM_MS && !lagging && acting()) {
        lagging = true;
        counters.lagAlarms += 1;
        d.log.warn({ msg: 'scheduler-lag', action: group.action, at: group.at, lagMs: Math.round(lag) });
        d.alarm.raise({ level: 'page', source: 'scheduler', code: 'lag', details: { action: group.action, at: group.at, lagMs: Math.round(lag) } });
      }
    }
    return { group, run: split.run, keys, lateMs: split.lateMs, consequenceId: consequenceFor(group.action, epoch, keys, started) };
  }

  /**
   * The due groups of one look, in C1 order: ONE claim transaction for all of them (one fencing
   * check, AC-45), each action run once, in order (AC-30), then ONE finish transaction for the runs
   * that succeeded. Groups that come due meanwhile are taken by the next look of the same pass.
   */
  async function runDue(groups: readonly DueGroup[], epoch: number): Promise<{ deferred: boolean; stale: boolean }> {
    const p = plan;
    const v = d.view();
    if (!p || v.frozen) return { deferred: false, stale: false };
    let deferred = false;
    const ready: Ready[] = [];
    for (const group of groups) {
      const r = await prepare(p, group, epoch, v);
      if (r === 'stale') return { deferred, stale: true };
      if (r === 'deferred') deferred = true;
      else if (r !== 'ok') ready.push(r);
    }
    if (ready.length === 0) return { deferred, stale: false };

    const startedAt = d.view().now;
    const claims = await d.runs.claimGroups(
      ready.map((r) => ({
        leaseEpoch: lease.epoch ?? -1,
        holder: d.holderId,
        runEpoch: epoch,
        action: r.group.action,
        keys: r.keys,
        consequenceId: r.consequenceId,
        plannedAt: r.group.at,
        startedAt,
      })),
    );
    if (claims === 'stale') {
      fenced('claim');
      return { deferred, stale: true };
    }

    const claimed: Ready[] = [];
    ready.forEach((r, i) => {
      if (claims[i] === 'claimed') {
        for (const k of r.keys) started.set(pairKey(r.group.action, k), r.consequenceId);
        claimed.push(r);
        return;
      }
      // Every pair already settled (by another holder): trust the store's ledger from the next pass on.
      for (const k of r.keys) settled.add(pairKey(r.group.action, k));
      ledgerFresh = false;
    });

    const done: Ready[] = [];
    let stale = false;
    for (const r of claimed) {
      // The claim was fenced by the store; the local term must still allow acting before publishing.
      // A holder that ran out leaves the pairs `started`: the next holder reruns them with the same id.
      if (state !== 'running' || !acting()) {
        stale = true;
        break;
      }
      const row = rowsByKey.get(r.group.action);
      try {
        if (!row) throw Object.assign(new Error('moment action not registered'), { code: 'no_row' });
        const now = d.view().now;
        await row.run({ action: r.group.action, at: r.group.at, moments: r.run, consequenceId: r.consequenceId, now, lateMs: r.lateMs, runEpoch: epoch }, ctx);
        done.push(r);
      } catch (err) {
        const code = errorCode(err);
        counters.retries += 1;
        for (const k of r.keys) {
          const pk = pairKey(r.group.action, k);
          failures.set(pk, { nextMono: d.mono() + retryMs, attempts: (failures.get(pk)?.attempts ?? 0) + 1, code });
        }
        d.log.warn({ msg: 'scheduler-action-error', action: r.group.action, keys: r.keys, code, attempts: failures.get(pairKey(r.group.action, r.keys[0] ?? ''))?.attempts });
        deferred = true;
      }
    }
    if (done.length > 0 && (await settleDone(done, epoch)) === 'stale') stale = true;
    return { deferred, stale };
  }

  /** `done` for every group that ran, in one transaction. */
  async function settleDone(done: readonly Ready[], epoch: number): Promise<'finished' | 'stale'> {
    const finishedAt = d.view().now;
    const r = await d.runs.finishGroups(
      done.map((x) => ({
        leaseEpoch: lease.epoch ?? -1,
        holder: d.holderId,
        runEpoch: epoch,
        action: x.group.action,
        keys: x.keys,
        status: 'done' as const,
        consequenceId: x.consequenceId,
        plannedAt: x.group.at,
        finishedAt,
      })),
    );
    if (r === 'stale') return fenced('finish');
    for (const x of done) {
      for (const k of x.keys) {
        const pk = pairKey(x.group.action, k);
        settled.add(pk);
        started.delete(pk);
        failures.delete(pk);
      }
      counters.done += x.keys.length;
      last = { action: x.group.action, at: x.group.at, keys: x.keys, status: 'done', finishedAt, consequenceId: x.consequenceId };
    }
    return 'finished';
  }

  // ---- one pass -----------------------------------------------------------------------------

  const groupId = (g: DueGroup) => `${g.action}|${g.at}`;

  async function pass(): Promise<void> {
    if (loadedGen < dirty) await load();
    const p = plan;
    const season = input;
    if (!p || !season || !acting()) {
      // Standby or nothing loaded yet (NFR-8): no action, no scheduler alarm (AC-41, AC-43).
      lastLag = 0;
      lagging = false;
      return;
    }
    let epoch: number;
    try {
      epoch = d.runEpochOf(season);
    } catch (err) {
      if (!epochError) d.log.warn({ msg: 'scheduler-run-epoch-unknown', code: errorCode(err) });
      epochError = true;
      return;
    }
    if (epoch !== runEpoch || !ledgerFresh) {
      const ledger = await d.runs.ledger(epoch);
      settled = new Set(ledger.settled);
      started = new Map(ledger.started);
      if (epoch !== runEpoch) {
        failures.clear();
        lagging = false;
      }
      runEpoch = epoch;
      ledgerFresh = true;
    }
    lastLag = 0;
    let deferred = false;
    // Drain: groups that come due while a look runs (at x600 a 50 ms look is 30 s of server time)
    // are taken by the next look at once, never after a sleep. Each group is looked at once per pass.
    const seen = new Set<string>();
    for (;;) {
      const v = d.view();
      if (v.frozen || !(v.speed > 0)) {
        // AC-38: frozen runs nothing and is never late.
        lastLag = 0;
        lagging = false;
        return;
      }
      if (state !== 'running' || !acting()) break;
      const due = dueGroups(p, v.now, settled).filter((g) => !seen.has(groupId(g)));
      if (due.length === 0) break;
      for (const g of due) seen.add(groupId(g));
      const outcome = await runDue(due, epoch);
      if (outcome.deferred) deferred = true;
      if (outcome.stale) break;
    }
    if (!deferred && lastLag <= LAG_ALARM_MS) lagging = false;
  }

  function nextDelay(): number {
    const p = plan;
    if (!p || !acting() || passFailed) return tickMs;
    const v = d.view();
    if (v.frozen || !(v.speed > 0)) return tickMs;
    // A group that came due after the last look of the pass, with a pair not waiting for a retry: now.
    const dueNow = dueGroups(p, v.now, settled).some((g) => g.moments.some((m) => !failures.has(pairKey(g.action, m.key))));
    if (dueNow) return 0;
    return Math.max(MIN_DELAY_MS, wakeDelayMs(nextDueAt(p, v.now, settled), v.now, v.speed, tickMs));
  }

  function runPass(): Promise<void> {
    passing ??= pass()
      .then(() => {
        passFailed = false;
      })
      .catch((err: unknown) => {
        passFailed = true;
        // Store down mid-pass: the ledger may have moved; the lease loop raises the page alarm.
        ledgerFresh = false;
        d.log.warn({ msg: 'scheduler-pass-failed', code: errorCode(err) });
      })
      .finally(() => {
        passing = null;
      });
    return passing;
  }

  function scheduleTick(ms: number): void {
    if (state !== 'running') return;
    if (tickTimer !== undefined) timers.clearTimeout(tickTimer);
    tickTimer = timers.setTimeout(() => {
      tickTimer = undefined;
      if (state !== 'running') return;
      // Joins a pass already running (`tick()`), then schedules the next look.
      void runPass().then(() => scheduleTick(nextDelay()));
    }, ms);
  }

  function kick(): void {
    if (state === 'running' && !passing) scheduleTick(0);
  }

  function nextGroup(): SchedulerMomentRef | null {
    const p = plan;
    if (!p) return null;
    const now = d.view().now;
    for (const g of p.groups) {
      if (g.at <= now) continue;
      const keys = g.moments.filter((m) => !settled.has(pairKey(g.action, m.key))).map((m) => m.key);
      if (keys.length > 0) return { action: g.action, at: g.at, keys };
    }
    return null;
  }

  function startLoops(): void {
    scheduleRenew(0);
    scheduleTick(0);
  }

  function clearLoops(): void {
    if (renewTimer !== undefined) timers.clearTimeout(renewTimer);
    if (tickTimer !== undefined) timers.clearTimeout(tickTimer);
    renewTimer = undefined;
    tickTimer = undefined;
  }

  return {
    start() {
      if (state !== 'stopped') return;
      state = 'running';
      startLoops();
    },
    async stop() {
      state = 'stopped';
      clearLoops();
      await Promise.allSettled([passing, renewing]);
      const held = lease;
      lease = NO_LEASE;
      if (held.held && held.epoch !== null) await d.lease.release?.(d.holderId, held.epoch).catch(() => {});
    },
    pause() {
      if (state !== 'running') return;
      state = 'paused';
      clearLoops();
      d.log.info({ msg: 'scheduler-paused', holder: d.holderId });
    },
    resume() {
      if (state !== 'paused') return;
      state = 'running';
      d.log.info({ msg: 'scheduler-resumed', holder: d.holderId });
      startLoops();
    },
    recompute() {
      dirty += 1;
      loadRetryAt = -Infinity;
      kick();
    },
    async tick() {
      if (passing) await passing;
      await runPass();
    },
    status(): SchedulerStatus {
      const nowMono = d.mono();
      return {
        holderId: d.holderId,
        state,
        lease: {
          held: lease.held,
          acting: holds(lease, nowMono),
          epoch: lease.epoch,
          termLeftMs: lease.held ? Math.max(0, Math.round(lease.grantedAtMono + lease.termMs - nowMono)) : 0,
          unreachable,
        },
        loaded: plan !== null,
        moments: momentCount,
        seasonId: input?.seasonId ?? null,
        runEpoch,
        next: nextGroup(),
        last,
        lagMs: acting() ? Math.round(lastLag) : 0,
        counters: { ...counters },
      };
    },
  };
}
