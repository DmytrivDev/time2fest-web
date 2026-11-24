/**
 * SPEC-13b S9 (W30), over the real Postgres: AC-61 — `ai_spend` seeded at 85 % → the `ai` row reads 85 % and a spend tick raises
 * no `spend/*` alarm for it; AC-63 — night-size hours land in the `server` counter; the R2 meter flushes into `cloudflare`.
 * The instants are in a far-future year of this run's own, so a running server never meets the rows; removed afterwards.
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgAiSpend } from '../../src/adapters/pgAiSpend';
import { alarmStoreOf, buildDispatcher, payloadOf, spendJobOf } from '../../src/container';
import { MICROS_PER_USD } from '../../src/domain/moderation/spend';
import type { Deps } from '../../src/endpoints/types';
import { post, testDeps } from './helpers';

const YEAR = 2200 + (Number.parseInt(randomBytes(2).toString('hex'), 16) % 7000);
const PERIOD = `${YEAR}-06`;
/** First second of the month: the server base pro-rata is ~0 %. */
const NOW = Date.UTC(YEAR, 5, 1, 0, 0, 1);

describe('spend rows over Postgres (AC-61, AC-63)', { timeout: 60_000 }, () => {
  let deps: Deps;
  let payload: Payload;

  const cleanup = async () => {
    await payload.delete({ collection: 'spend-counters', where: { period: { equals: PERIOD } }, overrideAccess: true });
    await payload.delete({ collection: 'ai-spend', where: { period: { equals: `month:${PERIOD}` } }, overrideAccess: true });
  };

  beforeAll(async () => {
    deps = testDeps({}, {});
    payload = await payloadOf(deps)();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await deps.opsRunner?.stop();
  });

  it('AC-61: ai_spend at 85 % -> the ai row reads 85 %, a spend tick raises no spend/* alarm', async () => {
    const settings = await deps.moderation!.settings.read();
    const ceilingUsd = settings.monthCeilingUsd;
    await createPgAiSpend(payloadOf(deps)).set(`month:${PERIOD}`, Math.round(ceilingUsd * 0.85 * MICROS_PER_USD));
    const job = spendJobOf(deps, deps.ops!, payloadOf(deps));
    const ai = (await job.rows(NOW)).find((r) => r.key === 'ai');
    expect(ai?.percent).toBeCloseTo(85, 1);
    expect(ai?.ceiling).toBe(ceilingUsd);

    // Other files leave open `spend` page alarms (ops-alarms raises `spend/cloudflare-80` through the door): start from none.
    await payload.delete({ collection: 'alarms', where: { source: { equals: 'spend' } }, overrideAccess: true });
    const before = await payload.count({ collection: 'log-alarms', where: { source: { equals: 'spend' } }, overrideAccess: true });
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(NOW).toISOString(), jobs: ['spend'] }));
    expect(res.status).toBe(200);
    const after = await payload.count({ collection: 'log-alarms', where: { source: { equals: 'spend' } }, overrideAccess: true });
    expect(after.totalDocs).toBe(before.totalDocs);
    expect((await alarmStoreOf(deps).listOpenPage()).filter((a) => a.source === 'spend')).toEqual([]);
  });

  it('AC-63: recorded night-size hours add up in the server counter; the row reads base + hours', async () => {
    const job = spendJobOf(deps, deps.ops!, payloadOf(deps));
    await job.recordServerHours(24, 0.0833, NOW);
    await job.recordServerHours(2, 0.0833, NOW);
    const row = (await job.rows(NOW)).find((r) => r.key === 'server');
    expect(row?.amount).toBeCloseTo(26 * 0.0833, 3);
    const doc = await payload.find({ collection: 'spend-counters', where: { and: [{ row: { equals: 'server' } }, { period: { equals: PERIOD } }] }, overrideAccess: true, depth: 0 });
    expect(doc.docs).toHaveLength(1);
    expect((doc.docs[0] as unknown as { meta: { hours: number } }).meta.hours).toBe(26);
  });

  it('the R2 meter delta is flushed into the cloudflare counter by a tick', async () => {
    deps.r2Meter!.record({ prefix: 'site', ok: true, classA: 11, classB: 5, at: NOW });
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(NOW + 120_000).toISOString(), jobs: ['spend'] }));
    expect(res.status).toBe(200);
    const doc = await payload.find({ collection: 'spend-counters', where: { and: [{ row: { equals: 'cloudflare' } }, { period: { equals: PERIOD } }] }, overrideAccess: true, depth: 0 });
    expect(doc.docs).toHaveLength(1);
    expect(doc.docs[0]).toMatchObject({ classA: 11, classB: 5 });
  });
});
