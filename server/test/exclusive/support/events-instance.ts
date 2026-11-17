/**
 * One extra server instance for `events-two-instances.exclusive.test.ts` (AC-40): its own
 * container, Postgres pool and event bus (listener + poll) in a separate Node process, against
 * the same database as the test process. Run with `tsx`. It prints `READY` once the bus runs, then
 * one `EVENT <json>` line per delivered event whose topic starts with argv[2]; it stops when stdin closes.
 */
import { createDeps, startBackground } from '../../../src/container';
import { recordedEvents } from '../../../src/registries/subscribers';

const prefix = process.argv[2] ?? '';
const silent = { info: () => {}, warn: () => {}, error: () => {} };

async function main(): Promise<void> {
  const deps = createDeps({ ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: '1' }, { log: silent });
  const bus = await startBackground(deps);
  let printed = 0;
  const timer = setInterval(() => {
    const all = recordedEvents();
    for (; printed < all.length; printed += 1) {
      const e = all[printed];
      if (e && e.topic.startsWith(prefix)) process.stdout.write(`EVENT ${JSON.stringify({ ...e, receivedAt: Date.now() })}\n`);
    }
  }, 20);
  process.stdout.write('READY\n');
  process.stdin.resume();
  process.stdin.on('end', () => {
    clearInterval(timer);
    void bus.stop().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`instance failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
