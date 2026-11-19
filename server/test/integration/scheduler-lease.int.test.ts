/**
 * SPEC-07 W25 against the real Postgres: the scheduler lease (AC-42, AC-44, AC-48) and the fenced
 * run store (AC-27, AC-45, NFR-7). A lease row of its own name and a run epoch of its own, so a
 * running scheduler (dev server) is never met. Measures the takeover time after the holder stops
 * renewing (term 6 s by the database clock; the other instance polls every 200 ms here).
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPgScheduler, SKIP_ACTION, TAKEOVER_ACTION, type PgScheduler } from '../../src/adapters/pgScheduler';
import { payloadOf } from '../../src/container';
import { pairKey } from '../../src/domain/scheduler/consequence';
import type { Deps } from '../../src/endpoints/types';
import { isRevertible } from '../../src/registries/revertHandlers';
import { testDeps } from './helpers';

const run = randomBytes(4).toString('hex');
const NAME = `scheduler-test-${run}`;
const RUN_EPOCH = 900_000_000 + Number.parseInt(run.slice(0, 6), 16);
const A = `host-a:1:${run}`;
const B = `host-b:2:${run}`;
const AT = Date.parse('2026-12-31T23:00:00Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('scheduler lease and run store on Postgres', { timeout: 60_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let store: PgScheduler;

  const claim = (holder: string, leaseEpoch: number, keys: string[]) =>
    store.runs.claim({ leaseEpoch, holder, runEpoch: RUN_EPOCH, action: 'rec', keys, consequenceId: `rec:${RUN_EPOCH}:x`, plannedAt: AT, startedAt: AT + 10 });
  const finish = (holder: string, leaseEpoch: number, keys: string[], status: 'done' | 'skipped' | 'failed', reason?: string) =>
    store.runs.finish({ leaseEpoch, holder, runEpoch: RUN_EPOCH, action: 'rec', keys, status, plannedAt: AT, finishedAt: AT + 20, ...(reason ? { reason } : {}) });
  const journal = async (action: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: action } }, { 'target.ref': { in: [NAME, `${RUN_EPOCH}:rec`] } }] },
        overrideAccess: true,
        depth: 0,
        sort: 'id',
      })
    ).docs as unknown as { before: Record<string, unknown> | null; after: Record<string, unknown> }[];
  const statusOf = async (key: string) => {
    const db = payload.db as unknown as { pool: { query(q: string, v: unknown[]): Promise<{ rows: { status: string }[] }> } };
    const { rows } = await db.pool.query('SELECT "status" FROM "scheduler_runs" WHERE "run_epoch" = $1 AND "action" = $2 AND "moment_key" = $3', [RUN_EPOCH, 'rec', key]);
    return rows[0]?.status;
  };

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    store = createPgScheduler({ payload: payloadOf(deps), journal: createPayloadJournal(isRevertible), name: NAME });
  });

  afterAll(async () => {
    const db = payload.db as unknown as { pool: { query(q: string, v: unknown[]): Promise<unknown> } };
    await db.pool.query('DELETE FROM "scheduler_runs" WHERE "run_epoch" = $1', [RUN_EPOCH]);
    await db.pool.query('DELETE FROM "scheduler_leases" WHERE "name" = $1', [NAME]);
  });

  let epoch1 = 0;

  it('AC-42: the first holder gets the lease for ~6 s by the database clock; the second does not', async () => {
    const a = await store.lease.acquireOrRenew(A);
    expect(a.held).toBe(true);
    expect(a.previousHolder).toBeUndefined();
    expect(a.expiresInMs).toBeGreaterThan(5_000);
    expect(a.expiresInMs).toBeLessThanOrEqual(6_000);
    epoch1 = a.epoch;
    expect(await store.lease.acquireOrRenew(B)).toMatchObject({ held: false, epoch: epoch1, expiresInMs: 0 });
    const renewed = await store.lease.acquireOrRenew(A);
    expect(renewed).toMatchObject({ held: true, epoch: epoch1 });
  });

  it('AC-27, AC-45: claim/finish are fenced by holder + epoch; a settled pair is never overwritten', async () => {
    expect(await claim(B, epoch1, ['zone-midnight:Z1'])).toBe('stale');
    expect(await claim(A, epoch1 + 1, ['zone-midnight:Z1'])).toBe('stale');
    expect(await statusOf('zone-midnight:Z1')).toBeUndefined();

    expect(await claim(A, epoch1, ['zone-midnight:Z1', 'zone-midnight:Z2'])).toBe('claimed');
    expect(await statusOf('zone-midnight:Z1')).toBe('started');
    expect(await finish(A, epoch1, ['zone-midnight:Z1', 'zone-midnight:Z2'], 'done')).toBe('finished');
    expect(await claim(A, epoch1, ['zone-midnight:Z1', 'zone-midnight:Z2'])).toBe('done');
    expect(await finish(A, epoch1, ['zone-midnight:Z1'], 'skipped', 'within-exceeded')).toBe('finished');
    expect(await statusOf('zone-midnight:Z1')).toBe('done');
    expect(await journal(SKIP_ACTION)).toHaveLength(0);

    // A skip creates its row and one journal row (NFR-7).
    expect(await finish(A, epoch1, ['zone-midnight:Z3'], 'skipped', 'within-exceeded')).toBe('finished');
    expect(await statusOf('zone-midnight:Z3')).toBe('skipped');
    const skips = await journal(SKIP_ACTION);
    expect(skips).toHaveLength(1);
    expect(skips[0]?.after).toMatchObject({ keys: ['zone-midnight:Z3'], reason: 'within-exceeded', lateMs: 20 });

    // A crash between claim and done leaves `started` with its consequence id (AC-29).
    expect(await claim(A, epoch1, ['zone-midnight:Z4'])).toBe('claimed');
    const ledger = await store.runs.ledger(RUN_EPOCH);
    expect([...ledger.settled].sort()).toEqual([pairKey('rec', 'zone-midnight:Z1'), pairKey('rec', 'zone-midnight:Z2'), pairKey('rec', 'zone-midnight:Z3')]);
    expect(ledger.started.get(pairKey('rec', 'zone-midnight:Z4'))).toBe(`rec:${RUN_EPOCH}:x`);
    expect(await store.runs.missed24h(AT + 1_000)).toMatchObject({ skipped: 1, failed: 0 });
  });

  it('AC-44, AC-48: after the holder stops renewing, another takes over with epoch + 1, journaled; the old one is fenced', async () => {
    const last = await store.lease.acquireOrRenew(A);
    const lastRenew = performance.now();
    expect(last.held).toBe(true);
    let takeover = await store.lease.acquireOrRenew(B);
    while (!takeover.held) {
      await sleep(200);
      takeover = await store.lease.acquireOrRenew(B);
    }
    const takeoverMs = performance.now() - lastRenew;
    console.info(`[scheduler-lease] takeover ${Math.round(takeoverMs)} ms after the holder's last renew`);
    expect(takeoverMs).toBeGreaterThan(5_500);
    expect(takeoverMs).toBeLessThan(10_000);
    expect(takeover).toMatchObject({ held: true, epoch: epoch1 + 1, previousHolder: A });

    const rows = await journal(TAKEOVER_ACTION);
    expect(rows.at(-1)).toMatchObject({ before: { holder: A, epoch: epoch1 }, after: { holder: B, epoch: epoch1 + 1 } });

    expect(await claim(A, epoch1, ['zone-midnight:Z5'])).toBe('stale');
    expect(await finish(A, epoch1, ['zone-midnight:Z4'], 'done')).toBe('stale');
    expect(await statusOf('zone-midnight:Z5')).toBeUndefined();
    expect((await store.lease.acquireOrRenew(A)).held).toBe(false);
    expect(await finish(B, epoch1 + 1, ['zone-midnight:Z4'], 'done')).toBe('finished');
  });

  it('release lets the next holder in at once', async () => {
    await store.lease.release?.(B, epoch1 + 1);
    expect(await store.lease.acquireOrRenew(A)).toMatchObject({ held: true, epoch: epoch1 + 2, previousHolder: B });
  });
});
