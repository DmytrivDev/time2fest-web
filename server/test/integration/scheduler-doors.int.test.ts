/**
 * SPEC-07 W30 end to end against the real Postgres (AC-29, AC-45, AC-67, AC-73): the three scheduler
 * doors on the dispatcher of THE process deps (the run recorder resolves its store through them),
 * with this process's scheduler started on the real lease row.
 * - night-run → a new run epoch; the recorder writes `celebration-start` once, read back by `GET`;
 * - fault → the next run throws after publishing and before `done`; the retry reuses the consequence
 *   id: one record row, the run settled `done` with that id;
 * - lease pause → another holder takes the lease over once the term ran out; after resume the old
 *   process acts no more (fenced) — no record for a fresh night.
 * Needs the lease free: a dev server of this worktree holding it makes the first test time out.
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seasonMoments } from '@time2fest/rules/time';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadMomentSource } from '../../src/adapters/payloadMoments';
import { createPgScheduler } from '../../src/adapters/pgScheduler';
import { buildDispatcher, getDeps, payloadOf } from '../../src/container';
import { catalogStoreOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { isRevertible } from '../../src/registries/revertHandlers';
import { RUN_RECORDER, runFaultArmed } from '../../src/scheduler/recorder';
import type { SchedulerHandle } from '../../src/scheduler/service';

const BASE = 'http://127.0.0.1:3000';
const JSON_TYPE = { 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Journal {
  epoch: number;
  records: { keys: string[]; action: string; plannedAt: number; startedAt: number; consequenceId: string }[];
}

describe('scheduler doors end to end', { timeout: 90_000 }, () => {
  let deps: Deps;
  let scheduler: SchedulerHandle;
  let payload: Payload;
  let dispatch: ((r: Request) => Promise<Response>) | undefined;
  let start = 0;
  let seasonKey = '';

  const call = (r: Request) => {
    if (!dispatch) throw new Error('dispatcher not built');
    return dispatch(r);
  };
  const post = async (path: string, body: unknown) => {
    const res = await call(new Request(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
    return { status: res.status, body: (await res.json()) as { ok: boolean; value?: Record<string, unknown> } };
  };
  const journal = async (): Promise<Journal> => {
    const res = await call(new Request(`${BASE}/api/_test/scheduler/night-run`));
    expect(res.status).toBe(200);
    return ((await res.json()) as { value: Journal }).value;
  };
  const until = async <T>(fn: () => Promise<T | undefined>, ms: number, label: string): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out: ${label}`);
      await sleep(200);
    }
  };
  const celebrationRecords = (j: Journal) => j.records.filter((r) => r.keys.includes(seasonKey));
  const runRow = async (runEpoch: number) => {
    const db = payload.db as unknown as { pool: { query(q: string, v: unknown[]): Promise<{ rows: { status: string; consequence_id: string }[] }> } };
    const { rows } = await db.pool.query(
      'SELECT "status", "consequence_id" FROM "scheduler_runs" WHERE "run_epoch" = $1 AND "action" = $2 AND "moment_key" = $3',
      [runEpoch, RUN_RECORDER, seasonKey],
    );
    return rows[0];
  };

  beforeAll(async () => {
    // THE process deps: the recorder row reaches its store through them (`processDeps`).
    process.env.T2F_ENV = 'test';
    process.env.T2F_TEST_DOORS = '1';
    delete process.env.T2F_EDGE_SECRET;
    deps = getDeps();
    if (!deps.scheduler) throw new Error('no scheduler in deps');
    scheduler = deps.scheduler;
    payload = await payloadOf(deps)();
    dispatch = await buildDispatcher(deps);
    expect((await post('/api/_test/reset', {})).status).toBe(200);
    const input = await createPayloadMomentSource({ payload: payloadOf(deps), catalog: catalogStoreOf(deps) }).load();
    const moment = seasonMoments(input).find((m) => m.kind === 'celebration-start');
    if (!moment) throw new Error('seeded catalog has no season');
    start = moment.at;
    seasonKey = moment.key;
    scheduler.start();
    await until(async () => (scheduler.status().lease.acting ? true : undefined), 15_000, 'lease acquired');
  });

  afterAll(async () => {
    await scheduler?.stop();
    if (dispatch) await post('/api/_test/reset', {});
  });

  it('night-run: new epoch from celebration-start − 60 s at ×60; the recorder writes celebration-start once', async () => {
    const before = deps.sharedClock!.state().runEpoch;
    const res = await post('/api/_test/scheduler/night-run', { speed: 60 });
    expect(res.status).toBe(200);
    const epoch = res.body.value?.epoch as number;
    expect(epoch).toBe(before + 1);
    const view = deps.sharedClock!.view();
    expect(view.speed).toBe(60);
    expect(view.now).toBeLessThan(start);
    expect(view.now).toBeGreaterThanOrEqual(start - 60_000);
    const j = await until(async () => {
      const got = await journal();
      return celebrationRecords(got).length > 0 ? got : undefined;
    }, 10_000, 'celebration-start recorded');
    expect(j.epoch).toBe(epoch);
    // Nothing of the night precedes celebration-start.
    expect(j.records[0]?.keys).toEqual([seasonKey]);
    const [rec] = celebrationRecords(j);
    expect(rec).toMatchObject({ action: RUN_RECORDER, plannedAt: start });
    expect(rec?.consequenceId.startsWith(`${RUN_RECORDER}:${epoch}:`)).toBe(true);
    await until(async () => ((await runRow(epoch))?.status === 'done' ? true : undefined), 5_000, 'settled done');
  });

  it('AC-29: fault → the run throws after publishing; the retry reuses the id; one record row, settled done', async () => {
    const retriesBefore = scheduler.status().counters.retries;
    expect((await post('/api/_test/scheduler/fault', { after: 'publish', action: RUN_RECORDER })).status).toBe(200);
    expect(runFaultArmed()).toBe(true);
    const res = await post('/api/_test/scheduler/night-run', { speed: 60, from: start - 2_000 });
    expect(res.status).toBe(200);
    const epoch = res.body.value?.epoch as number;
    const row = await until(async () => {
      const r = await runRow(epoch);
      return r?.status === 'done' ? r : undefined;
    }, 15_000, 'faulted run settled done');
    expect(runFaultArmed()).toBe(false);
    expect(scheduler.status().counters.retries).toBeGreaterThan(retriesBefore);
    const recs = celebrationRecords(await journal());
    expect(recs).toHaveLength(1);
    expect(recs[0]?.consequenceId).toBe(row.consequence_id);
  });

  it('AC-45: lease pause → another holder takes over; after resume the old process runs nothing', async () => {
    const paused = await post('/api/_test/scheduler/lease', { action: 'pause' });
    expect(paused.status).toBe(200);
    expect(paused.body.value).toMatchObject({ holder: true });
    const oldEpoch = paused.body.value?.epoch as number;
    expect(scheduler.status().state).toBe('paused');

    const other = createPgScheduler({ payload: payloadOf(deps), journal: createPayloadJournal(isRevertible) });
    const holder = `scheduler-doors-int:${randomBytes(4).toString('hex')}`;
    const grant = await until(async () => {
      const g = await other.lease.acquireOrRenew(holder);
      return g.held ? g : undefined;
    }, 15_000, 'takeover by the other holder');
    expect(grant.epoch).toBe(oldEpoch + 1);

    try {
      const resumed = await post('/api/_test/scheduler/lease', { action: 'resume' });
      expect(resumed.status).toBe(200);
      const res = await post('/api/_test/scheduler/night-run', { speed: 60, from: start - 1_000 });
      const epoch = res.body.value?.epoch as number;
      // The other holder keeps the lease (renewed every 2 s); the old process must not act.
      for (let i = 0; i < 3; i += 1) {
        await sleep(1_000);
        expect((await other.lease.acquireOrRenew(holder)).held).toBe(true);
      }
      expect((await journal()).records).toEqual([]);
      expect(await runRow(epoch)).toBeUndefined();
      expect(scheduler.status().lease.acting).toBe(false);
    } finally {
      await other.lease.release?.(holder, grant.epoch);
    }
  });
});
