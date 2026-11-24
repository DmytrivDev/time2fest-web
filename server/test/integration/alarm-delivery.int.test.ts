/**
 * SPEC-13b W15: alarm delivery to the Telegram fake over the real Postgres outbox.
 * AC-2 (page → one message ≤60 s, row `deliveredAt`), AC-3 (a row left by a crashed process is delivered once by
 * the next one), AC-12 (`log` → `log-alarms`, no message), AC-27 (unregistered kind → marker in class `test`).
 * AC-5 (W19): the final failure after 11 min of substitute time, through the `ops-tick` door (W18).
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf, startOpsTickerOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import type { OpsRunner } from '../../src/ops/runner';
import { spawnAlarmInstance, startTelegramFake, type AlarmInstance, type FakeTelegramHandle } from '../support/fakeTelegram';
import { post, testDeps } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms: number, step = 250): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await sleep(step);
    v = await fn();
  }
  return v;
}

describe('alarm delivery to Telegram (W15)', () => {
  const run = Date.now().toString(36);
  let fake: FakeTelegramHandle;
  let deps: Deps;
  let payload: Payload;

  const deliveries = async (code: string) =>
    (await payload.find({ collection: 'alarm-deliveries', where: { code: { equals: code } }, overrideAccess: true, depth: 0 })).docs as unknown as Record<string, unknown>[];
  const logAlarms = async (code: string) =>
    (await payload.find({ collection: 'log-alarms', where: { code: { equals: code } }, overrideAccess: true, depth: 0, limit: 200 })).docs as unknown as Record<string, unknown>[];

  beforeAll(async () => {
    fake = await startTelegramFake();
    deps = testDeps({}, fake.env);
    payload = await payloadOf(deps)();
  });

  afterAll(async () => {
    await fake?.close();
  });

  describe('one process', () => {
    let runner: OpsRunner | undefined;
    beforeAll(() => {
      runner = startOpsTickerOf(deps, 500);
    });
    afterAll(async () => {
      await runner?.stop();
    });

    it('AC-2, AC-27: page through the door → one sendMessage ≤60 s, the row delivered; unregistered → marker', async () => {
      const code = `deliver-${run}`;
      const dispatch = await buildDispatcher(deps);
      const started = Date.now();
      const res = await dispatch(post('/api/_test/alarm', { level: 'page', source: 'test', code, details: { email: 'x@y.z' } }));
      expect(res.status).toBe(200);
      const calls = await until(() => fake.callsWith(code), (c) => c.length >= 1, 60_000);
      expect(calls).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(calls[0]).toMatchObject({ tokenMatches: true, disable_web_page_preview: true });
      expect(calls[0]!.parse_mode).toBeUndefined();
      expect(String(calls[0]!.text)).toContain('Домен: невідомо');
      expect(String(calls[0]!.text)).not.toContain('x@y.z');
      const rows = await until(() => deliveries(code), (r) => r[0]?.status === 'delivered', 5_000);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'alarm', status: 'delivered', source: 'test' });
      expect(rows[0]!.deliveredAt).toBeTruthy();
      const markers = (await logAlarms('unregistered-alarm')).filter((m) => (m.details as { code?: string } | null)?.code === code);
      expect(markers).toHaveLength(1);
      await sleep(1_500);
      expect(await fake.callsWith(code)).toHaveLength(1);
    }, 90_000);

    it('AC-12: log → one log-alarms row, zero messages', async () => {
      const code = `log-${run}`;
      const dispatch = await buildDispatcher(deps);
      const res = await dispatch(post('/api/_test/alarm', { level: 'log', source: 'test', code }));
      expect(res.status).toBe(200);
      const rows = await until(() => logAlarms(code), (r) => r.length >= 1, 5_000);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'test', code });
      await sleep(2_000);
      expect(await fake.callsWith(code)).toHaveLength(0);
      expect(await deliveries(code)).toHaveLength(0);
    }, 30_000);

    it('AC-5: fake down 11 min of substitute time (ops-tick door) → failed row, one log alarm, one journal row, no outbox row from it', async () => {
      const code = `down-${run}`;
      const since = new Date().toISOString();
      const dispatch = await buildDispatcher(deps);
      await fake.down(true);
      try {
        expect((await dispatch(post('/api/_test/alarm', { level: 'page', source: 'test', code }))).status).toBe(200);
        // Tried at least once on the wall clock while Telegram is down.
        const pending = await until(() => deliveries(code), (r) => Number(r[0]?.attempts ?? 0) >= 1, 30_000);
        expect(pending[0]).toMatchObject({ status: 'pending' });
        const raisedAt = Date.parse(String(pending[0]!.raisedAt));
        const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(raisedAt + 11 * 60_000).toISOString(), jobs: ['sender'] }));
        expect(res.status).toBe(200);
        const rows = await until(() => deliveries(code), (r) => r[0]?.status === 'failed', 5_000);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'failed' });
        expect(rows[0]!.failedAt).toBeTruthy();
        const failedAlarms = async () =>
          (await logAlarms('telegram-delivery-failed')).filter((r) => r.source === 'ops' && String(r.createdAt) >= since);
        expect(await until(failedAlarms, (r) => r.length >= 1, 5_000)).toHaveLength(1);
        const journal = (
          await payload.find({
            collection: 'audit-log',
            where: { and: [{ action: { equals: 'ops.telegram-delivery-failed' } }, { 'target.ref': { equals: String(rows[0]!.id) } }] },
            overrideAccess: true,
            depth: 0,
          })
        ).docs;
        expect(journal).toHaveLength(1);
        await sleep(1_500);
        // The alarm about the failure never reaches the outbox (no recursion).
        expect(await deliveries('telegram-delivery-failed')).toHaveLength(0);
        // A failed row is never retried: Telegram back up → no further attempt of it.
        const attempts = (await fake.callsWith(code)).length;
        await fake.down(false);
        await sleep(2_000);
        expect(await fake.callsWith(code)).toHaveLength(attempts);
      } finally {
        await fake.down(false);
      }
    }, 90_000);
  });

  it('AC-3: a row left by a crashed process is delivered exactly once by the next process ≤60 s after its start', async () => {
    const code = `restart-${run}`;
    await fake.down(true);
    let a: AlarmInstance | undefined;
    let b: AlarmInstance | undefined;
    try {
      a = await spawnAlarmInstance('restart-a', fake.env);
      a.raise('page', 'test', code);
      // Queued and tried at least once while Telegram is down.
      const pending = await until(() => deliveries(code), (r) => Number(r[0]?.attempts ?? 0) >= 1, 60_000);
      expect(pending[0]).toMatchObject({ status: 'pending' });
      await a.kill();
      await fake.reset();
      b = await spawnAlarmInstance('restart-b', fake.env);
      const started = Date.now();
      const calls = await until(() => fake.callsWith(code), (c) => c.length >= 1, 60_000);
      expect(calls).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(60_000);
      await sleep(3_000);
      expect(await fake.callsWith(code)).toHaveLength(1);
      expect((await deliveries(code))[0]).toMatchObject({ status: 'delivered' });
    } finally {
      await a?.kill();
      await b?.stop();
      await fake.reset();
    }
  }, 300_000);
});
