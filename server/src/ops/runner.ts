/**
 * The ops runner of one process (SPEC-13b [П-5]), ring 3: one ticker every 5 s; each job runs under its own
 * lease, on the wall clock (never the SPEC-07 server clock, AC-22). This phase has the Telegram sender only;
 * heartbeat, digest, backups and spend join it later (W18). Started only by `startProcessBackground`.
 */
import { createSender, type Sender } from '../alarms/sender';
import type { AlarmSink, LogAlarmStore } from '../alarms/ports';
import type { EnvClass } from '../platform/env';
import type { Alarm, Logger } from '../ports';
import { startTicker, type Ticker } from '../unattended/ticker';
import type { OpsLease, Outbox, WallClock } from './ports';

export const OPS_TICK_MS = 5_000;

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

export interface OpsRunner {
  /** One pass of every job at `now` (the ticker passes the wall clock; the `ops-tick` door a substitute). */
  tick(now: number): Promise<void>;
  stop(): Promise<void>;
}

export interface OpsRunnerDeps {
  ops: OpsWiring;
  alarm: Alarm;
  log: Logger;
}

function codeOf(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** The jobs of one process; no timer (the ticker or a test drives `tick`). */
export function createOpsRunner({ ops, alarm, log }: OpsRunnerDeps): OpsRunner {
  const sender: Sender | null = ops.telegram.sink
    ? createSender({ lease: ops.lease, outbox: ops.outbox, sink: ops.telegram.sink, chatId: ops.telegram.chatId ?? '', cls: ops.cls, alarm })
    : null;
  return {
    async tick(now) {
      if (sender) {
        // A failing pass (database down) is a stdout line only: an alarm about the alarm path would loop.
        await sender.tick(now).catch((err: unknown) => log.warn({ event: 'ops/sender-tick-failed', pgCode: codeOf(err) }));
      }
    },
    async stop() {
      await sender?.release().catch(() => {});
    },
  };
}

/**
 * Starts the runner on a 5 s ticker. With no Telegram sink, one `log` alarm `ops/telegram-not-configured` at
 * start (AC-14); the sender job then does not run.
 */
export function startOpsTicker(deps: OpsRunnerDeps, intervalMs: number = OPS_TICK_MS): OpsRunner {
  if (deps.ops.telegram.status === 'not-configured') {
    deps.alarm.raise({ level: 'log', source: 'ops', code: 'telegram-not-configured' });
  }
  const runner = createOpsRunner(deps);
  const ticker: Ticker = startTicker({
    tick: () => runner.tick(deps.ops.clock.now()),
    onError: (err) => deps.log.warn({ event: 'ops/tick-failed', pgCode: codeOf(err) }),
    intervalMs,
  });
  return {
    tick: (now) => runner.tick(now),
    async stop() {
      await ticker.stop();
      await runner.stop();
    },
  };
}
