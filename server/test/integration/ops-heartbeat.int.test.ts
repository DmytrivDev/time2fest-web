/**
 * SPEC-13b W19: the heartbeat and the morning digest over the real Postgres outbox and the Telegram fake, driven
 * by the `ops-tick` door's substitute wall-clock `now` (AC-22: the SPEC-07 test clock is not how ops time moves).
 * AC-20 — 7 `log` alarms of three domains, a tick at 09:00 Kyiv → one digest with exact numbers;
 * AC-18/AC-21 — one heartbeat per slot; a restart 5 min into a slot catches it up, 15 min in → skipped with a
 * journal line `ops.heartbeat-skipped` and no message.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarmStoreOf, buildDispatcher, payloadOf } from '../../src/container';
import { digestSlotAt } from '../../src/domain/ops/schedule';
import type { Deps } from '../../src/endpoints/types';
import { startTelegramFake, type FakeTelegramHandle } from '../support/fakeTelegram';
import { post, testDeps } from './helpers';

const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('heartbeat and digest through the ops-tick door (W19)', () => {
  let fake: FakeTelegramHandle;
  let payload: Payload;
  const started = new Date().toISOString();
  const live: Deps[] = [];

  /** A fresh process: its own deps, runner and lease holder (the previous one released its leases). */
  async function processStart(): Promise<Deps> {
    for (const d of live.splice(0)) await d.opsRunner?.stop();
    const deps = testDeps({}, fake.env);
    live.push(deps);
    return deps;
  }

  async function tick(deps: Deps, now: number, jobs: string[]): Promise<Record<string, { result: string; slotKey?: string }>> {
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/ops-tick', { now: new Date(now).toISOString(), jobs }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { value: { jobs: Record<string, { result: string; slotKey?: string }> } }).value.jobs;
  }

  const dropSlots = (keys: string[]) =>
    payload.delete({ collection: 'alarm-deliveries', where: { slotKey: { in: keys } }, overrideAccess: true });

  const journal = async (action: string, key: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: action } }, { 'target.ref': { equals: key } }, { createdAt: { greater_than_equal: started } }] },
        overrideAccess: true,
        depth: 0,
      })
    ).docs;

  beforeAll(async () => {
    fake = await startTelegramFake();
    payload = await payloadOf(await processStart())();
  });

  afterAll(async () => {
    for (const d of live.splice(0)) await d.opsRunner?.stop();
    await fake?.close();
  });

  it('AC-20: 7 log alarms of three domains + a tick at 09:00 Kyiv → one digest with exact numbers, once', async () => {
    const deps = await processStart();
    let slot = digestSlotAt(Date.now());
    if (slot.due <= Date.now()) slot = digestSlotAt(slot.due + DAY);
    const date = slot.key.slice('digest:'.length);
    await dropSlots([slot.key]);
    await payload.delete({ collection: 'log-alarms', where: { id: { exists: true } }, overrideAccess: true });
    const logs = deps.ops!.logAlarms;
    for (let i = 0; i < 3; i += 1) await logs.insert({ source: 'clock', code: 'refresh_failed' });
    for (let i = 0; i < 2; i += 1) await logs.insert({ source: 'live', code: 'poller_tick_failed' });
    for (let i = 0; i < 2; i += 1) await logs.insert({ source: 'mod', code: 'moderation_degraded' });
    const openPage = (await alarmStoreOf(deps).listOpenPage()).length;

    const out = await tick(deps, slot.due, ['digest', 'sender']);
    expect(out.digest).toEqual({ result: 'queued', slotKey: slot.key });
    const calls = await fake.callsWith(`Ранковий підсумок ${date}`);
    expect(calls).toHaveLength(1);
    const text = String(calls[0]!.text);
    expect(text).toContain(`Відкритих тривог: ${openPage}`);
    expect(text).toContain('Остання копія бази: копій ще немає');
    expect(text).toContain('Витрати понад 50 %: немає');
    expect(text).toContain('Тривог рівня log за 24 год: 7\nЧас: 3\nЕфір: 2\nМодерація й AI: 2\nНайчастіші види:');
    expect(text).toContain('clock/refresh_failed: 3\nlive/poller_tick_failed: 2\nmod/moderation_degraded: 2');

    // Same process again, then another process: the slot is taken → no second digest.
    expect((await tick(deps, slot.due + 60_000, ['digest', 'sender'])).digest).toEqual({ result: 'idle' });
    const other = await processStart();
    expect((await tick(other, slot.due + 120_000, ['digest', 'sender'])).digest).toEqual({ result: 'duplicate', slotKey: slot.key });
    await sleep(500);
    expect(await fake.callsWith(`Ранковий підсумок ${date}`)).toHaveLength(1);
  }, 60_000);

  it('AC-18, AC-21: one heartbeat per slot; restart at :05 → caught up; restart at :15 → skipped + journal line', async () => {
    const keys = ['hb:2026-12-31T22', 'hb:2026-12-31T23', 'hb:2027-01-01T00'];
    await dropSlots(keys);
    const at = (s: string) => Date.parse(s);

    const a = await processStart();
    expect((await tick(a, at('2026-12-31T22:00:02Z'), ['heartbeat', 'sender'])).heartbeat).toEqual({ result: 'queued', slotKey: keys[0] });
    expect((await tick(a, at('2026-12-31T22:00:07Z'), ['heartbeat', 'sender'])).heartbeat).toEqual({ result: 'idle' });
    const first = await fake.callsWith('31.12.2026 22:00:00 UTC');
    expect(first).toHaveLength(1);
    expect(String(first[0]!.text)).toMatch(/^(Усе гаразд|Зв'язок працює; відкритих тривог: \d+) · середовище: тест \(test\)/);

    const b = await processStart();
    expect((await tick(b, at('2026-12-31T23:05:00Z'), ['heartbeat', 'sender'])).heartbeat).toEqual({ result: 'queued', slotKey: keys[1] });
    expect(await fake.callsWith('31.12.2026 23:00:00 UTC')).toHaveLength(1);

    const c = await processStart();
    expect((await tick(c, at('2027-01-01T00:15:00Z'), ['heartbeat', 'sender'])).heartbeat).toEqual({ result: 'skipped', slotKey: keys[2] });
    expect(await fake.callsWith('01.01.2027 00:00:00 UTC')).toHaveLength(0);
    const lines = await journal('ops.heartbeat-skipped', keys[2]!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actor: { kind: 'system', ref: 'ops' }, after: { slotKey: keys[2], lateMs: 15 * 60_000 } });
    const rows = await payload.find({ collection: 'alarm-deliveries', where: { slotKey: { in: keys } }, overrideAccess: true, depth: 0 });
    expect(rows.docs.map((d) => (d as unknown as { slotKey: string }).slotKey).sort()).toEqual(keys.slice(0, 2));

    // The restarted process at :15 of a slot that WAS sent writes no skip line.
    const d = await processStart();
    expect((await tick(d, at('2026-12-31T23:15:00Z'), ['heartbeat'])).heartbeat).toEqual({ result: 'duplicate', slotKey: keys[1] });
    expect(await journal('ops.heartbeat-skipped', keys[1]!)).toHaveLength(0);
  }, 60_000);
});
