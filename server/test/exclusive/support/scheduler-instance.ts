/**
 * One server instance's moment scheduler for `scheduler-two-instances.exclusive.test.ts` (SPEC-07
 * AC-41, AC-43, AC-44): its own Node process, container, Postgres pool, clock cache (kept current by
 * the `clock.changed` subscriber of its event bus and a 1 s refresh) and a scheduler built like the
 * process one — the REAL lease row `scheduler`, the run stores, the catalog moment source, the moment
 * registry of the `test` class (the run recorder). Run with `tsx`:
 *
 *   tsx test/exclusive/support/scheduler-instance.ts <tag> [<delay-at ms>]
 *
 * With `<delay-at>`, the recorder's first run of the group planned at that server instant waits 3 s
 * first (AC-39/AC-41). stdout, one line each: `READY <holderId>`; `HOLDER <true|false> <lease epoch>`
 * on every change of "acting"; `LOG <json>` for every scheduler log line; `ALARM <json>` for every
 * scheduler alarm; `STATUS <json>` (the scheduler status) for every `STATUS` line on stdin. Closing
 * stdin stops the scheduler gracefully (the lease is released); SIGKILL is the crash.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { SCHEDULER_LEASE } from '../../../src/adapters/pgScheduler';
import { getDeps, payloadOf, startBackground, startClockRefresher } from '../../../src/container';
import { createAlarm } from '../../../src/platform/logger';
import type { Alarm, Logger } from '../../../src/ports';
import { momentActionsFor } from '../../../src/registries/moments';
import { RUN_RECORDER } from '../../../src/scheduler/recorder';
import type { MomentActionRow } from '../../../src/scheduler/ports';
import { testScheduler } from '../../integration/scheduler-support';

const tag = process.argv[2] ?? 'instance';
const delayAt = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const DELAY_MS = 3_000;
const print = (line: string) => process.stdout.write(`${line}\n`);
const silent = { info: () => {}, warn: () => {}, error: () => {} };

async function main(): Promise<void> {
  process.env.T2F_ENV = 'test';
  process.env.T2F_TEST_DOORS = '1';
  delete process.env.T2F_EDGE_SECRET;
  const deps = getDeps();
  await payloadOf(deps)();
  const refresher = await startClockRefresher(deps, 1_000);
  const bus = await startBackground(deps);

  const log: Logger = {
    info: (f) => print(`LOG ${JSON.stringify({ level: 'info', ...f })}`),
    warn: (f) => print(`LOG ${JSON.stringify({ level: 'warn', ...f })}`),
    error: (f) => print(`LOG ${JSON.stringify({ level: 'error', ...f })}`),
  };
  // Saved like the process alarm (page rows), printed for the test; the alarm's own log is silent.
  const saved = createAlarm(silent, deps.alarmStore);
  const alarm: Alarm = {
    raise(a) {
      if (a.source === 'scheduler') print(`ALARM ${JSON.stringify({ level: a.level, source: a.source, code: a.code, t: Date.now() })}`);
      saved.raise(a);
    },
  };

  let delayed = false;
  const rows: MomentActionRow[] = momentActionsFor('test').map((row) =>
    row.key !== RUN_RECORDER || delayAt === undefined
      ? row
      : {
          ...row,
          async run(group, ctx) {
            if (!delayed && group.at === delayAt) {
              delayed = true;
              await new Promise((r) => setTimeout(r, DELAY_MS));
            }
            await row.run(group, ctx);
          },
        },
  );
  const holderId = `${tag}:${process.pid}:${randomBytes(4).toString('hex')}`;
  const { handle } = testScheduler(deps, { rows, leaseName: SCHEDULER_LEASE, holderId, log, alarm });
  handle.start();
  print(`READY ${holderId}`);

  let acting: boolean | undefined;
  const watch = setInterval(() => {
    const s = handle.status();
    if (s.lease.acting !== acting) {
      acting = s.lease.acting;
      print(`HOLDER ${String(acting)} ${s.lease.epoch ?? 0}`);
    }
  }, 50);

  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (line.trim() === 'STATUS') print(`STATUS ${JSON.stringify(handle.status())}`);
  });
  lines.on('close', () => {
    clearInterval(watch);
    void handle
      .stop()
      .then(() => {
        refresher?.stop();
        return bus.stop();
      })
      .finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`scheduler instance failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
