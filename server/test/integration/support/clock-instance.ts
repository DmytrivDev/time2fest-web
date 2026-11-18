/**
 * A second server process for `clock-shared.int.test.ts` (SPEC-07 AC-49, AC-50): its own container,
 * Postgres pool, clock cache and event bus, against the same database as the test process. Run
 * with `tsx`. On boot it loads the stored clock like `startProcessBackground` (the 5 s fallback is
 * stretched to 10 min, so a change can reach it only through `clock.changed`), then prints `READY`.
 * Each stdin line `GET` → one line `CLOCK <json>`: the value of `GET /api/_test/clock` of its own
 * dispatcher, its cached state and the real instants just before and after the dispatch. It stops
 * when stdin closes.
 */
import { createInterface } from 'node:readline';
import { buildDispatcher, createDeps, getDeps, startBackground, startClockRefresher } from '../../../src/container';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

async function main(): Promise<void> {
  // The `clock-refresh` subscriber reaches the process deps (`getDeps`): the same class, no edge gate.
  process.env.T2F_ENV = 'test';
  process.env.T2F_TEST_DOORS = '1';
  delete process.env.T2F_EDGE_SECRET;
  const deps = createDeps({ ...process.env }, { log: silent });
  getDeps();
  const refresher = await startClockRefresher(deps, 600_000);
  const bus = await startBackground(deps);
  const dispatch = await buildDispatcher(deps);
  process.stdout.write('READY\n');
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (line.trim() !== 'GET') return;
    void (async () => {
      const before = Date.now();
      const res = await dispatch(new Request('http://127.0.0.1:3000/api/_test/clock'));
      const after = Date.now();
      const body = (await res.json()) as { value?: unknown };
      process.stdout.write(`CLOCK ${JSON.stringify({ status: res.status, value: body.value, state: deps.sharedClock?.state(), before, after })}\n`);
    })();
  });
  lines.on('close', () => {
    refresher?.stop();
    void bus.stop().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`clock instance failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
