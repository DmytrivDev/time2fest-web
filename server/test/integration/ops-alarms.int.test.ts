/**
 * SPEC-13b W40: the alarm registry end to end over the Telegram fake.
 * AC-28: `expectAlarmInTestChannel` is green for one kind of each merged domain and the `ops` and `spend` kinds
 * (the trigger is the `POST /api/_test/alarm` door with that exact kind; each domain's real trigger is proven by
 * its own suite — plan assumption 3). AC-27: an unregistered kind through the door → domain «невідомо», marker row,
 * deleted again so the suite-end check stays at zero. AC-29: the `site` and `live` `publish-failed` rows are `log` kinds in the
 * registry. NFR-1: 50 raises of 10 kinds inside one minute → the first message of every kind arrives ≤60 s.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf, startOpsTickerOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import type { OpsRunner } from '../../src/ops/runner';
import { findKind, opsRegistry } from '../../src/registries/ops';
import { expectAlarmInTestChannel } from '../support/expectAlarmInTestChannel';
import { startTelegramFake, type FakeTelegramHandle } from '../support/fakeTelegram';
import { post, testDeps } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AC28_KINDS: readonly { source: string; code: string }[] = [
  { source: 'clock', code: 'edge-divergence' },
  { source: 'scheduler', code: 'lag' },
  { source: 'catalog', code: 'catalog-r2-copy-failed' },
  { source: 'site', code: 'site/rebuild-failed' },
  { source: 'live', code: 'live/quota-80' },
  { source: 'mod', code: 'spend_80' },
  { source: 'ops', code: 'backup-failed' },
  { source: 'ops', code: 'backup-stale' },
  { source: 'spend', code: 'cloudflare-80' },
];

describe('ops alarms over the Telegram fake (W40)', () => {
  let fake: FakeTelegramHandle;
  let deps: Deps;
  let payload: Payload;
  let runner: OpsRunner | undefined;
  let dispatch: Awaited<ReturnType<typeof buildDispatcher>>;

  const door = (source: string, code: string, level: 'page' | 'log' = 'page') => async () => {
    const res = await dispatch(post('/api/_test/alarm', { level, source, code }));
    expect(res.status).toBe(200);
  };

  // Repeats within 10 min of a delivered message of a kind are coalesced and one 10-min window holds at most 20
  // messages (AC-6, AC-8), both read from `alarm-deliveries`: start every group from an empty outbox of the test DB.
  const clearOutbox = async () => {
    await payload.delete({ collection: 'alarm-deliveries', where: { id: { exists: true } }, overrideAccess: true });
  };

  beforeAll(async () => {
    fake = await startTelegramFake();
    deps = testDeps({}, fake.env);
    payload = await payloadOf(deps)();
    dispatch = await buildDispatcher(deps);
    await clearOutbox();
    runner = startOpsTickerOf(deps, 500);
  });

  afterAll(async () => {
    await runner?.stop();
    await fake?.close();
  });

  it('AC-28: the helper is green for every listed kind', async () => {
    await clearOutbox();
    for (const k of AC28_KINDS) {
      expect(findKind(k.source, k.code), `${k.source}/${k.code} in the registry`).toBeDefined();
      const ms = await expectAlarmInTestChannel(k, door(k.source, k.code), fake);
      expect(ms).toBeLessThan(60_000);
    }
  }, 600_000);

  it('AC-28: the helper fails (and says so) for a kind that never reaches the channel', async () => {
    await expect(expectAlarmInTestChannel({ source: 'ops', code: 'backup-not-configured' }, async () => {}, fake, { timeoutMs: 1_000 })).rejects.toThrow(/no Telegram message/);
    await expect(expectAlarmInTestChannel({ source: 'nope', code: 'nope' }, async () => {}, fake)).rejects.toThrow(/not in the ops registry/);
  });

  it('AC-27: an unregistered kind → «невідомо» in the message and a marker row, which the test deletes', async () => {
    await clearOutbox();
    const code = `unreg-${Date.now().toString(36)}`;
    await fake.reset();
    await door('test', code)();
    const end = Date.now() + 30_000;
    let calls = await fake.callsWith(code);
    while (calls.length === 0 && Date.now() < end) {
      await sleep(250);
      calls = await fake.callsWith(code);
    }
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.text)).toContain('Домен: невідомо');
    const markers = async () =>
      (await payload.find({ collection: 'log-alarms', where: { code: { equals: 'unregistered-alarm' } }, overrideAccess: true, depth: 0, limit: 500 })).docs.filter(
        (m) => (m.details as { code?: string } | null)?.code === code,
      );
    const end2 = Date.now() + 5_000;
    let rows = await markers();
    while (rows.length === 0 && Date.now() < end2) {
      await sleep(250);
      rows = await markers();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'ops' });
    for (const r of rows) await payload.delete({ collection: 'log-alarms', id: r.id, overrideAccess: true });
    expect(await markers()).toHaveLength(0);
  }, 60_000);

  it('AC-29: publish-failed rows are `log` kinds; skipped/frozen/disabled/not-configured are info; edge/origin-down is reserved `page`', () => {
    expect(findKind('site', 'site/publish-failed')?.alarm.level).toBe('log');
    expect(findKind('live', 'live/publish-failed')?.alarm.level).toBe('log');
    const edge = findKind('edge', 'origin-down') ?? findKind('edge', 'edge/origin-down');
    expect(edge?.alarm.level).toBe('page');
    expect(edge?.domain.reserved).toBe(true);
    const infos = opsRegistry.flatMap((d) => d.alarms).filter((a) => /skipped|rebuild-frozen|rebuild-disabled|rebuild-not-configured/.test(a.code));
    expect(infos.length).toBeGreaterThan(0);
    for (const a of infos) expect(a.level, `${a.source}/${a.code}`).toBe('info');
  });

  it('NFR-1: 50 raises of 10 kinds in one minute → the first message of every kind within 60 s', async () => {
    const used = new Set(AC28_KINDS.map((k) => `${k.source}/${k.code}`));
    const kinds = opsRegistry
      .filter((d) => !d.reserved)
      .flatMap((d) => d.alarms)
      .filter((a) => a.level === 'page' && !used.has(`${a.source}/${a.code}`))
      .slice(0, 10);
    expect(kinds).toHaveLength(10);
    await clearOutbox();
    await fake.reset();
    const started = Date.now();
    for (let i = 0; i < 5; i++) for (const k of kinds) await door(k.source, k.code)();
    const first = new Map<string, number>();
    while (first.size < kinds.length && Date.now() - started < 60_000) {
      const calls = await fake.calls();
      for (const k of kinds) {
        const key = `${k.source}/${k.code}`;
        const row = findKind(k.source, k.code)!;
        if (!first.has(key) && calls.some((c) => typeof c.text === 'string' && c.text.includes(row.alarm.meaning))) first.set(key, Date.now() - started);
      }
      if (first.size < kinds.length) await sleep(250);
    }
    const max = Math.max(...first.values());
    console.log(`NFR-1: ${first.size}/10 kinds delivered, max first-of-kind latency ${max} ms`);
    expect(first.size).toBe(10);
    expect(max).toBeLessThan(60_000);
  }, 120_000);
});
