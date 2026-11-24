/**
 * SPEC-13b AC-8: two server processes (own containers and pools) raise and send alarms through one outbox under
 * the `ops-telegram` lease — 30 alarms of 30 kinds → 30 messages in the fake, 0 duplicates. The 30 are raised in
 * three batches of 10, each in its own substitute 10-min window (ticks run at wall clock + 11/22/33 min), so the
 * storm ceiling (20 per 10 min, AC-7) is not what is tested here. HEAVY: run under the exclusive lock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnAlarmInstance, startTelegramFake, type AlarmInstance, type FakeTelegramHandle } from '../support/fakeTelegram';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN = 60_000;

describe('two instances, one outbox (AC-8, exclusive)', () => {
  const run = Date.now().toString(36);
  let fake: FakeTelegramHandle;
  let a: AlarmInstance | undefined;
  let b: AlarmInstance | undefined;

  beforeAll(async () => {
    fake = await startTelegramFake();
    [a, b] = await Promise.all([spawnAlarmInstance('two-a', fake.env), spawnAlarmInstance('two-b', fake.env)]);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([a?.stop(), b?.stop()]);
    await fake?.close();
  });

  it('30 alarms of 30 kinds from two processes → 30 messages, 0 duplicates', async () => {
    const prefix = `two-${run}-`;
    const ours = async () => (await fake.calls()).filter((c) => typeof c.text === 'string' && c.text.includes(prefix));
    for (let batch = 0; batch < 3; batch += 1) {
      a!.offset((batch + 1) * 11 * MIN);
      b!.offset((batch + 1) * 11 * MIN);
      for (let i = 0; i < 10; i += 1) (i % 2 === 0 ? a! : b!).raise('page', 'test', `${prefix}${batch * 10 + i}`);
      const want = (batch + 1) * 10;
      const end = Date.now() + 60_000;
      while ((await ours()).length < want && Date.now() < end) await sleep(250);
      expect((await ours()).length).toBe(want);
    }
    await sleep(5_000);
    const calls = await ours();
    const codes = calls.map((c) => /two-[a-z0-9]+-(\d+)/.exec(String(c.text))?.[1]);
    expect(calls).toHaveLength(30);
    expect(new Set(codes).size).toBe(30);
    expect(calls.every((c) => c.tokenMatches)).toBe(true);
    expect((await fake.calls()).filter((c) => String(c.text).includes('Забагато тривог'))).toHaveLength(0);
  }, 300_000);
});
