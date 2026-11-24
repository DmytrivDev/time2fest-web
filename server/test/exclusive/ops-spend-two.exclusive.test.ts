/**
 * SPEC-13b AC-62 (W30): two server processes (own containers, pools and lease holders) both run the spend job on a
 * substitute wall clock moved into mid-March 2027, with the `server` counter seeded so the row crosses 50 % and 80 %
 * of its ceiling → exactly one `spend/server-50` (`log`) and one `spend/server-80` (`page`) in the cluster, thanks to
 * the conditional `claimLevel`. A move to April (a new period) makes 50 % claimable again. HEAVY: exclusive lock.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { spawnAlarmInstance, startTelegramFake, type AlarmInstance, type FakeTelegramHandle } from '../support/fakeTelegram';
import { testDeps } from '../integration/helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARCH = Date.parse('2027-03-16T12:00:00Z'); // base alone: 50.5 % of the month
const APRIL = Date.parse('2027-04-20T12:00:00Z'); // base alone: 63 % of the month
const PERIODS = ['2027-03', '2027-04'];

describe('two instances, one spend alarm per level and period (AC-62, exclusive)', () => {
  let fake: FakeTelegramHandle;
  let payload: Payload;
  let a: AlarmInstance | undefined;
  let b: AlarmInstance | undefined;

  const logRows = async (code: string) =>
    (await payload.find({ collection: 'log-alarms', where: { and: [{ source: { equals: 'spend' } }, { code: { equals: code } }] }, overrideAccess: true, depth: 0 })).docs;
  const pageRows = async (code: string) =>
    (await payload.find({ collection: 'alarm-deliveries', where: { and: [{ source: { equals: 'spend' } }, { code: { equals: code } }] }, overrideAccess: true, depth: 0 })).docs;

  const claimed = async (period = '2027-04') =>
    (await payload.find({ collection: 'spend-counters', where: { and: [{ row: { equals: 'server' } }, { period: { equals: period } }] }, overrideAccess: true, depth: 0 })).docs[0] as
      | { alarm50At?: string | null; alarm80At?: string | null }
      | undefined;

  const clean = async () => {
    await payload.delete({ collection: 'spend-counters', where: { period: { in: PERIODS } }, overrideAccess: true });
    await payload.delete({ collection: 'log-alarms', where: { source: { equals: 'spend' } }, overrideAccess: true });
    await payload.delete({ collection: 'alarm-deliveries', where: { source: { equals: 'spend' } }, overrideAccess: true });
  };

  beforeAll(async () => {
    fake = await startTelegramFake();
    payload = await payloadOf(testDeps({}, fake.env))();
    await clean();
    // 48 recorded night-size hours worth $4 on top of the base: 6.06 + 4 = 10.06 of $12 -> 84 % in March.
    await payload.create({ collection: 'spend-counters', data: { row: 'server', period: '2027-03', amountMicros: 4_000_000, meta: { hours: 48 } }, overrideAccess: true });
    [a, b] = await Promise.all([spawnAlarmInstance('sp-a', fake.env), spawnAlarmInstance('sp-b', fake.env)]);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([a?.stop(), b?.stop()]);
    await fake?.close();
    await clean().catch(() => undefined);
  });

  it('crossing 80 % in a period -> one 50 and one 80 across both instances; a new month claims again', async () => {
    const march = MARCH - Date.now();
    a!.offset(march);
    b!.offset(march);
    const end = Date.now() + 60_000;
    while ((await pageRows('server-80')).length < 1 && Date.now() < end) await sleep(250);
    // Both runners keep ticking inside the period: still one of each.
    await sleep(3_000);
    expect(await pageRows('server-80')).toHaveLength(1);
    const marchRow = await claimed('2027-03');
    expect(marchRow?.alarm50At).toBeTruthy();
    expect(marchRow?.alarm80At).toBeTruthy();
    // The hourly `log` prune of the shifted clock may already have dropped the row: never two, and the claim is on the counter.
    expect((await logRows('server-50')).length).toBeLessThanOrEqual(1);

    const april = APRIL - Date.now();
    a!.offset(april);
    b!.offset(april);
    // The hourly prune of the April clock drops the March `log` rows, so the new claim is read off the counter row.
    const end2 = Date.now() + 60_000;
    while (!(await claimed())?.alarm50At && Date.now() < end2) await sleep(250);
    expect((await claimed())?.alarm50At).toBeTruthy();
    expect((await claimed())?.alarm80At ?? null).toBeNull();
    expect(await pageRows('server-80')).toHaveLength(1);
  }, 240_000);
});
