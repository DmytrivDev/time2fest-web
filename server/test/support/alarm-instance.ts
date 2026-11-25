/**
 * One server instance's alarm path for `alarm-delivery.int.test.ts` (AC-3) and `alarm-two-instances.exclusive.test.ts`
 * (AC-8), `ops-heartbeat-two.exclusive.test.ts` (AC-21): its own Node process, container and Postgres pool; the
 * delivering process alarm and the ops runner (sender under the REAL `ops-telegram` lease, heartbeat and digest under
 * `ops-heartbeat`) as `startProcessBackground` builds them, ticking every 250 ms. The parent passes the fake Telegram env. Run with `tsx`:
 *
 *   tsx test/support/alarm-instance.ts <tag>
 *
 * stdin, one command per line: `RAISE <level> <source> <code>`; `OFFSET <ms>` — later ticks run at wall clock +
 * offset (a substitute `now` for storm windows). stdout: `READY <tag>` once the runner ticks. Closing stdin stops
 * gracefully (the lease is released); SIGKILL is the crash.
 */
import { createInterface } from 'node:readline';
import { getDeps, payloadOf } from '../../src/container';

const tag = process.argv[2] ?? 'instance';
/**
 * Only the alarm-path jobs. The later jobs take their own long leases (`ops-auth` 90 min, `ops-mail`, `ops-backup`,
 * `ops-spend`); an instance SIGKILLed as the crash case would leave them held for the rest of the int run, and the
 * next file that ticks e.g. `auth-guest-prune` would get `not-held`.
 */
const ALARM_JOBS = ['heartbeat', 'digest', 'log-prune', 'sender'] as const;
const print = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  process.env.T2F_ENV = 'test';
  process.env.T2F_TEST_DOORS = '1';
  delete process.env.T2F_EDGE_SECRET;
  const deps = getDeps();
  await payloadOf(deps)();
  if (!deps.ops?.telegram.sink || !deps.opsRunner) throw new Error('telegram sink not configured');
  const runner = deps.opsRunner;
  let offset = 0;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runner.tick(Date.now() + offset, ALARM_JOBS).finally(() => {
      running = false;
    });
  }, 250);
  print(`READY ${tag}`);

  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (cmd === 'RAISE' && args.length === 3) {
      const [level, source, code] = args as [string, string, string];
      deps.alarm.raise({ level: level === 'log' ? 'log' : 'page', source, code });
    } else if (cmd === 'OFFSET' && args[0] !== undefined) {
      offset = Number(args[0]);
    }
  });
  lines.on('close', () => {
    clearInterval(timer);
    void runner.stop().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`alarm instance failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
