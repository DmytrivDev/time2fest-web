/**
 * SPEC-13b AC-21 (W19): two server processes (own containers, pools and lease holders) both run the heartbeat
 * planner and the sender every 250 ms on a substitute wall clock moved into the celebration window (01.01 01:00,
 * 02:00, 03:00 UTC — inside the catalog window and the fallback one) → exactly one heartbeat message per slot,
 * thanks to the `ops-heartbeat` lease and the unique slot key. HEAVY: run under the exclusive lock.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { spawnAlarmInstance, startTelegramFake, type AlarmInstance, type FakeTelegramHandle } from '../support/fakeTelegram';
import { testDeps } from '../integration/helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLOTS = ['2027-01-01T01', '2027-01-01T02', '2027-01-01T03'];
const utcLine = (slot: string) => `01.01.2027 ${slot.slice(11)}:00:00 UTC`;

describe('two instances, one heartbeat per slot (AC-21, exclusive)', () => {
  let fake: FakeTelegramHandle;
  let payload: Payload;
  let a: AlarmInstance | undefined;
  let b: AlarmInstance | undefined;

  beforeAll(async () => {
    fake = await startTelegramFake();
    payload = await payloadOf(testDeps({}, fake.env))();
    await payload.delete({ collection: 'alarm-deliveries', where: { slotKey: { in: SLOTS.map((s) => `hb:${s}`) } }, overrideAccess: true });
    [a, b] = await Promise.all([spawnAlarmInstance('hb-a', fake.env), spawnAlarmInstance('hb-b', fake.env)]);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([a?.stop(), b?.stop()]);
    await fake?.close();
  });

  it('both planners tick through three slots → 3 messages, one per slot', async () => {
    for (const slot of SLOTS) {
      const offset = Date.parse(`${slot}:00:01Z`) - Date.now();
      a!.offset(offset);
      b!.offset(offset);
      const end = Date.now() + 30_000;
      while ((await fake.callsWith(utcLine(slot))).length < 1 && Date.now() < end) await sleep(250);
      // Both planners keep ticking inside the slot: still one message.
      await sleep(3_000);
      expect(await fake.callsWith(utcLine(slot)), slot).toHaveLength(1);
    }
    const rows = await payload.find({
      collection: 'alarm-deliveries',
      where: { slotKey: { in: SLOTS.map((s) => `hb:${s}`) } },
      overrideAccess: true,
      depth: 0,
    });
    expect(rows.docs.map((d) => (d as unknown as { status: string }).status)).toEqual(['delivered', 'delivered', 'delivered']);
  }, 300_000);
});
