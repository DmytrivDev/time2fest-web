/**
 * The ops runner of one process (SPEC-13b [П-5]), ring 3: one ticker every 5 s; each job runs under its own
 * lease, on the wall clock (never the SPEC-07 server clock, AC-22). Jobs of a tick, in order: the heartbeat and
 * the digest planners (`ops-heartbeat`, W17), the hourly `log-alarms` prune (AC-12), then the Telegram sender
 * (`ops-telegram`) so a row planned in this tick goes out in it. Backups and spend join later (S8, S9).
 * Started only by `startProcessBackground`; the `ops-tick` test door runs `tick` with a substitute `now`.
 */
import { createSender, type Sender, type SenderTickResult } from '../alarms/sender';
import type { AlarmSink, LogAlarmStore } from '../alarms/ports';
import type { DeliveryState } from '../domain/ops/alarmText';
import { logPruneBefore } from '../domain/ops/schedule';
import type { EnvClass } from '../platform/env';
import type { Alarm, Logger } from '../ports';
import { startTicker, type Ticker } from '../unattended/ticker';
import { createDigestJob, type SpendOver50 } from './digest';
import { createHeartbeatJob, type OpsReads, type PlanJob, type PlanOutcome } from './heartbeat';
import type { OpsJournal, OpsLease, Outbox, WallClock } from './ports';

export const OPS_TICK_MS = 5_000;
const PRUNE_EVERY_MS = 3_600_000;
const RETRYING_FOR_MS = 600_000;
const FAILED_RECENTLY_MS = 86_400_000;

/** State of the Telegram sink for the monitoring screen (AC-14). */
export type TelegramStatus = 'configured' | 'not-configured';

/** What `createDeps` builds for operations; the runner and the overview read it. */
export interface OpsWiring {
  telegram: { status: TelegramStatus; sink: AlarmSink | null; chatId: string | null; missing?: readonly string[] };
  outbox: Outbox;
  logAlarms: LogAlarmStore;
  lease: OpsLease;
  /** The wall clock of ops schedules (AC-22). */
  clock: WallClock;
  cls: EnvClass;
}

/** Jobs of one tick, in run order. */
export const OPS_JOBS = ['heartbeat', 'digest', 'log-prune', 'sender'] as const;
export type OpsJobName = (typeof OPS_JOBS)[number];

export type OpsJobOutcome =
  | PlanOutcome
  | (SenderTickResult & { result: 'ran' })
  | { result: 'pruned'; removed: number }
  | { result: 'off' | 'idle' }
  | { result: 'failed'; code: string };

export interface OpsRunner {
  /** One pass of `jobs` (all when absent) at `now` (the ticker passes the wall clock; the `ops-tick` door a substitute). */
  tick(now: number, jobs?: readonly OpsJobName[]): Promise<Partial<Record<OpsJobName, OpsJobOutcome>>>;
  stop(): Promise<void>;
}

/** Reads of the planners that live outside the ops stores (container: catalog, alarms, backups later). */
export interface OpsSources {
  zones: OpsReads['zones'];
  openPageCount: OpsReads['openPageCount'];
  lastBackupAt: OpsReads['lastBackupAt'];
  /** Spend rows over 50 % for the digest; `[]` until W29. */
  spendOver50(now: number): Promise<readonly SpendOver50[]>;
  journal: OpsJournal;
}

export interface OpsRunnerDeps {
  ops: OpsWiring;
  alarm: Alarm;
  log: Logger;
  sources: OpsSources;
}

function codeOf(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** The jobs of one process; no timer (the ticker, the door or a test drives `tick`). */
export function createOpsRunner({ ops, alarm, log, sources }: OpsRunnerDeps): OpsRunner {
  const sink = ops.telegram.sink;
  const chatId = ops.telegram.chatId ?? '';
  const sender: Sender | null = sink ? createSender({ lease: ops.lease, outbox: ops.outbox, sink, chatId, cls: ops.cls, alarm }) : null;
  // Delivery as this process's sender saw it (the heartbeat line «Доставка»).
  let lastRetryAt: number | undefined;
  let lastFailedAt: number | undefined;
  const deliveryState = (now: number): DeliveryState => {
    if (lastFailedAt !== undefined && now - lastFailedAt < FAILED_RECENTLY_MS) return 'failed-recently';
    if (lastRetryAt !== undefined && now - lastRetryAt < RETRYING_FOR_MS) return 'retrying';
    return 'ok';
  };
  const reads: OpsReads = { zones: sources.zones, openPageCount: sources.openPageCount, lastBackupAt: sources.lastBackupAt, deliveryState };
  // Heartbeat and digest exist only with a Telegram sink: nothing would send their rows otherwise.
  const planDeps = { lease: ops.lease, outbox: ops.outbox, journal: sources.journal, reads, alarm, chatId, cls: ops.cls };
  const heartbeat: PlanJob | null = sink ? createHeartbeatJob(planDeps) : null;
  const digest: PlanJob | null = sink ? createDigestJob({ ...planDeps, logAlarms: ops.logAlarms, spendOver50: sources.spendOver50 }) : null;
  let lastPruneAt: number | undefined;

  const jobs: Record<OpsJobName, (now: number) => Promise<OpsJobOutcome>> = {
    heartbeat: async (now) => (heartbeat ? heartbeat.run(now) : { result: 'off' }),
    digest: async (now) => (digest ? digest.run(now) : { result: 'off' }),
    'log-prune': async (now) => {
      if (lastPruneAt !== undefined && Math.abs(now - lastPruneAt) < PRUNE_EVERY_MS) return { result: 'idle' };
      lastPruneAt = now;
      return { result: 'pruned', removed: await ops.logAlarms.pruneLog(logPruneBefore(now)) };
    },
    sender: async (now) => {
      if (!sender) return { result: 'off' };
      const r = await sender.tick(now);
      if (r.retried > 0) lastRetryAt = now;
      if (r.failed > 0) lastFailedAt = now;
      return { ...r, result: 'ran' };
    },
  };

  return {
    async tick(now, only) {
      const out: Partial<Record<OpsJobName, OpsJobOutcome>> = {};
      for (const name of OPS_JOBS) {
        if (only && !only.includes(name)) continue;
        // A failing job (database down) is a stdout line only: an alarm about the alarm path would loop.
        out[name] = await jobs[name](now).catch((err: unknown) => {
          const code = codeOf(err);
          log.warn({ event: `ops/${name}-tick-failed`, pgCode: code });
          return { result: 'failed', code } as const;
        });
      }
      return out;
    },
    async stop() {
      await sender?.release().catch(() => {});
      await ops.lease.release('ops-heartbeat').catch(() => {});
    },
  };
}

/**
 * Starts `runner` on a 5 s ticker. With no Telegram sink, one `log` alarm `ops/telegram-not-configured` at
 * start (AC-14); the sender, heartbeat and digest jobs then do not run.
 */
export function startOpsTicker(runner: OpsRunner, deps: Pick<OpsRunnerDeps, 'alarm' | 'log' | 'ops'>, intervalMs: number = OPS_TICK_MS): OpsRunner {
  if (deps.ops.telegram.status === 'not-configured') {
    deps.alarm.raise({ level: 'log', source: 'ops', code: 'telegram-not-configured' });
  }
  const ticker: Ticker = startTicker({
    tick: () => runner.tick(deps.ops.clock.now()).then(() => {}),
    onError: (err) => deps.log.warn({ event: 'ops/tick-failed', pgCode: codeOf(err) }),
    intervalMs,
  });
  return {
    tick: (now, only) => runner.tick(now, only),
    async stop() {
      await ticker.stop();
      await runner.stop();
    },
  };
}
