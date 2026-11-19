/**
 * SPEC-07 W41: the moment scheduler across two server instances (AC-41, AC-43, AC-44, AC-48, NFR-5).
 * Two child processes (`support/scheduler-instance.ts`), each with its own container, pool, clock
 * cache and scheduler on the REAL lease row; this process only drives the night through the doors
 * and reads the database (its own scheduler is never started).
 * - AC-41 (first: the delay fires once per process, and the alarm throttle is 60 s): the recorder
 *   delayed 3 s at Kiribati's midnight in both instances, the night started 2 s before it (no backlog
 *   to page about) → exactly one `page` scheduler/lag row, raised by the holder.
 * - AC-43: ×60 over the first midnights → every run of the epoch is under the holder's lease epoch;
 *   the standby acted on nothing.
 * - AC-44, AC-48: the holder SIGKILLed 1 s before India's midnight at ×1 → the other holds the lease
 *   within 10 s (`T2F_MEASURE lease-takeover-ms`, from the kill), India's midnight is recorded once
 *   under the new lease epoch, the takeover is journaled and logged with both holders. The new holder
 *   pages `scheduler/lag` for the moments the dead holder left behind (AC-39).
 * Runs only under the exclusive lock (T2F_EXCLUSIVE=1); it needs the real lease free.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeasonMoment } from '@time2fest/rules/time';
import { SCHEDULER_LEASE, TAKEOVER_ACTION } from '../../src/adapters/pgScheduler';
import { RUN_RECORDER } from '../../src/scheduler/recorder';
import { printMeasure } from '../integration/measure';
import { bootHarness, MIN, SEC, sleep, until, type Harness } from '../integration/scheduler-support';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIRIBATI = 'utc+1400';
const INDIA = 'utc+0530';

interface Instance {
  tag: string;
  proc: ChildProcessWithoutNullStreams;
  holderId: string;
  acting: boolean;
  /** Real ms (`Date.now`) of every `HOLDER true`. */
  heldAt: number[];
  logs: Record<string, unknown>[];
  alarms: { code: string; t: number }[];
  status(): Promise<{ counters: Record<string, number>; lease: { epoch: number | null; acting: boolean } }>;
  stop(): Promise<void>;
  kill(): Promise<number>;
}

function spawnInstance(tag: string, delayAt: number): Promise<Instance> {
  const proc = spawn(process.execPath, [path.join(serverDir, 'node_modules/tsx/dist/cli.mjs'), 'test/exclusive/support/scheduler-instance.ts', tag, String(delayAt)], {
    cwd: serverDir,
    env: process.env,
    stdio: 'pipe',
  });
  const statusWaiters: ((s: unknown) => void)[] = [];
  let buffer = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const inst: Instance = {
      tag,
      proc,
      holderId: '',
      acting: false,
      heldAt: [],
      logs: [],
      alarms: [],
      status() {
        return new Promise((r) => {
          statusWaiters.push(r as (s: unknown) => void);
          proc.stdin.write('STATUS\n');
        });
      },
      stop() {
        return new Promise((r) => {
          if (proc.exitCode !== null || proc.signalCode !== null) return r();
          proc.once('exit', () => r());
          proc.stdin.end();
          setTimeout(() => {
            proc.kill('SIGKILL');
            r();
          }, 15_000);
        });
      },
      kill() {
        return new Promise((r) => {
          const t = Date.now();
          proc.once('exit', () => r(t));
          proc.kill('SIGKILL');
        });
      },
    };
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.stdout.on('data', (c: Buffer) => {
      buffer += c.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const [head, ...rest] = line.trim().split(' ');
        const tail = rest.join(' ');
        if (head === 'READY') {
          inst.holderId = tail;
          resolve(inst);
        } else if (head === 'HOLDER') {
          inst.acting = rest[0] === 'true';
          if (inst.acting) inst.heldAt.push(Date.now());
        } else if (head === 'LOG') inst.logs.push(JSON.parse(tail) as Record<string, unknown>);
        else if (head === 'ALARM') inst.alarms.push(JSON.parse(tail) as { code: string; t: number });
        else if (head === 'STATUS') statusWaiters.shift()?.(JSON.parse(tail));
      }
    });
    proc.on('exit', (code) => reject(new Error(`instance ${tag} exited (${code}) before READY: ${stderr.slice(-500)}`)));
  });
}

describe('scheduler across two instances (AC-41, AC-43, AC-44)', { timeout: 180_000 }, () => {
  let h: Harness;
  let moments: SeasonMoment[] = [];
  let a: Instance;
  let b: Instance;
  const at = (key: string) => {
    const m = moments.find((x) => x.key === key);
    if (!m) throw new Error(`no moment ${key}`);
    return m.at;
  };
  const holder = () => [a, b].find((i) => i.acting);
  const standby = () => [a, b].find((i) => !i.acting);
  const leaseEpochs = async (epoch: number) =>
    (await h.pool.query<{ lease_epoch: string }>('SELECT DISTINCT "lease_epoch"::text AS "lease_epoch" FROM "scheduler_runs" WHERE "run_epoch" = $1 AND "action" = $2', [epoch, RUN_RECORDER])).rows.map((r) =>
      Number(r.lease_epoch),
    );

  beforeAll(async () => {
    h = await bootHarness();
    moments = await h.moments();
    const delayAt = at(`zone-midnight:${KIRIBATI}`);
    a = await spawnInstance('inst-a', delayAt);
    await until(() => a.acting, 20_000, 'instance A holds the lease (is a dev server of this worktree holding it?)');
    b = await spawnInstance('inst-b', delayAt);
    await sleep(3_000);
    expect(b.acting).toBe(false);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([a?.stop(), b?.stop()]);
    await h?.close();
  }, 120_000);

  it('AC-41: the recorder delayed 3 s in both instances → exactly one `page` scheduler/lag row, from the holder', async () => {
    const lead = holder();
    const idle = standby();
    if (!lead || !idle) throw new Error('expected one holder and one standby');
    const t0 = Date.now();
    const store = h.deps.alarmStore;
    if (!store) throw new Error('no alarm store in deps');
    // `raisedAt` is SERVER time (virtual here): new rows are told apart by id, not by time.
    const known = new Set((await store.listOpenPage()).map((x) => x.id));
    const m = at(`zone-midnight:${KIRIBATI}`);
    const epoch = await h.nightRun({ speed: 60, from: m - 2 * SEC });
    const stamps = moments.filter((x) => x.kind === 'event-stamp' && x.zoneId === KIRIBATI).map((x) => x.key);
    await until(
      async () => {
        const have = new Set((await h.records(epoch)).flatMap((r) => r.keys));
        return stamps.every((k) => have.has(k));
      },
      30_000,
      'Kiribati stamps recorded behind the 3 s call',
    );
    await sleep(2_000);
    await h.clock({ frozen: true });
    const rows = (await store.listOpenPage()).filter((x) => !known.has(x.id) && x.source === 'scheduler' && x.code === 'lag');
    expect(rows).toHaveLength(1);
    expect(lead.alarms.filter((x) => x.code === 'lag' && x.t >= t0)).toHaveLength(1);
    expect(idle.alarms).toEqual([]);
  });

  it('AC-43: two instances at ×60 → every run is under the holder’s lease epoch; the standby ran nothing', async () => {
    const lead = holder();
    const idle = standby();
    if (!lead || !idle) throw new Error('expected one holder and one standby');
    const before = (await idle.status()).counters;
    const leaseEpoch = (await lead.status()).lease.epoch;
    const epoch = await h.nightRun({ speed: 60, from: at(`zone-midnight:${KIRIBATI}`) - 16 * MIN });
    await until(() => h.now() >= at(`zone-midnight:${KIRIBATI}`) + 16 * MIN, 60_000, 'clock past Kiribati + 16 min');
    await until(
      async () => {
        const have = new Set((await h.records(epoch)).flatMap((r) => r.keys));
        return moments.filter((m) => m.at <= at(`zone-midnight:${KIRIBATI}`) + 16 * MIN).every((m) => have.has(m.key));
      },
      30_000,
      'records up to Kiribati + 16 min',
    );
    await h.clock({ frozen: true });
    expect(await leaseEpochs(epoch)).toEqual([leaseEpoch]);
    const after = (await idle.status()).counters;
    expect(after.done).toBe(before.done);
    expect(after.acquired).toBe(before.acquired);
    expect(idle.acting).toBe(false);
    const keys = (await h.records(epoch)).flatMap((r) => r.keys);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('AC-44, AC-48: the holder killed 1 s before India’s midnight → takeover ≤ 10 s, the midnight recorded once under the new epoch', async () => {
    const lead = holder();
    const idle = standby();
    if (!lead || !idle) throw new Error('expected one holder and one standby');
    const oldEpoch = (await lead.status()).lease.epoch ?? 0;
    const m = at(`zone-midnight:${INDIA}`);
    const epoch = await h.nightRun({ speed: 1, from: m - 15 * SEC });
    await until(() => h.now() >= m - SEC, 30_000, 'one second before midnight');
    const heldBefore = idle.heldAt.length;
    const killedAt = await lead.kill();
    await until(() => idle.heldAt.length > heldBefore, 15_000, 'takeover');
    const takeoverMs = (idle.heldAt.at(-1) ?? Infinity) - killedAt;
    printMeasure('lease-takeover-ms', [takeoverMs]);
    expect(takeoverMs).toBeLessThanOrEqual(10_000);

    const midnight = `zone-midnight:${INDIA}`;
    const records = await until(
      async () => {
        const got = await h.records(epoch);
        return got.some((r) => r.keys.includes(midnight)) ? got : undefined;
      },
      15_000,
      'India midnight recorded',
    );
    await h.clock({ frozen: true });
    expect(records.filter((r) => r.keys.includes(midnight))).toHaveLength(1);
    const { rows } = await h.pool.query<{ lease_epoch: string }>(
      'SELECT "lease_epoch"::text AS "lease_epoch" FROM "scheduler_runs" WHERE "run_epoch" = $1 AND "action" = $2 AND "moment_key" = $3',
      [epoch, RUN_RECORDER, midnight],
    );
    expect(rows.map((r) => Number(r.lease_epoch))).toEqual([oldEpoch + 1]);

    const logged = idle.logs.find((l) => l.msg === 'scheduler-takeover' && l.previousHolder === lead.holderId);
    expect(logged).toMatchObject({ holder: idle.holderId, previousHolder: lead.holderId, epoch: oldEpoch + 1 });
    const journal = (
      await h.payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: TAKEOVER_ACTION } }, { 'target.ref': { equals: SCHEDULER_LEASE } }] },
        overrideAccess: true,
        depth: 0,
        sort: '-id',
        limit: 1,
      })
    ).docs[0] as unknown as { before: Record<string, unknown>; after: Record<string, unknown> } | undefined;
    expect(journal).toMatchObject({ before: { holder: lead.holderId, epoch: oldEpoch }, after: { holder: idle.holderId, epoch: oldEpoch + 1 } });
    // AC-39: the midnight fell due while nobody held the lease — the new holder pages the lag.
    expect(idle.alarms.some((x) => x.code === 'lag' && x.t >= killedAt)).toBe(true);
  });
});
