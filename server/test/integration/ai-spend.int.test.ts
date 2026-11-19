/**
 * SPEC-09 W22 against the real Postgres: the spend counter's sums, cluster-wide alarms and ceiling
 * (AC-26, AC-28 … AC-32, AC-42 propagation, NFR-4). "Two processes" are two counter instances in
 * this process over the same database; each has its own in-memory state, so they only meet in
 * Postgres, like two server processes. Buckets of a far-future year of this run's own, so a running
 * server never meets them; removed afterwards.
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadModerationSettings, SETTINGS_ACTION } from '../../src/adapters/payloadModerationSettings';
import { createPgAiSpend } from '../../src/adapters/pgAiSpend';
import { payloadOf } from '../../src/container';
import { DEFAULT_SETTINGS, type ModerationSettings } from '../../src/domain/moderation/settings';
import { aiPricesFrom, type SpendRequest } from '../../src/domain/moderation/spend';
import type { Deps } from '../../src/endpoints/types';
import { createAlarm } from '../../src/platform/logger';
import type { AiProvider, TokenUsage } from '../../src/moderation/ports';
import { createProviderLayer, type ProviderLayer } from '../../src/moderation/providers';
import { createSpendCounter, type ModerationSettingsStore, type SettingsSource, type SpendCounter, type SpendStore } from '../../src/moderation/spend';
import type { Alarm, AlarmInput } from '../../src/ports';
import { isRevertible } from '../../src/registries/revertHandlers';
import { silent, testDeps } from './helpers';

const YEAR = 2200 + (Number.parseInt(randomBytes(2).toString('hex'), 16) % 7000);
const at = (month: number) => Date.UTC(YEAR, month - 1, 10, 12);
const key = (month: number) => `month:${YEAR}-${String(month).padStart(2, '0')}`;
const PRICES = aiPricesFrom({
  anthropic: { input: '0.10', output: '0.50', cacheRead: '0.01', cacheWrite: '0.125' },
  deepseek: { cacheMiss: '0.30', cacheHit: '0.006', output: '1.20' },
});
const REQ: SpendRequest = { chars: 10, maxTokens: 32 };
/** Anthropic usage costing exactly `micros` (input tokens × $0.10/M). */
const usageOf = (micros: number): TokenUsage => ({ input: micros * 10, output: 0, cacheRead: 0, cacheWrite: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spyAlarm(forward?: Alarm) {
  const raised: AlarmInput[] = [];
  return {
    raised,
    alarm: { raise: (a: AlarmInput) => (raised.push(a), forward?.raise(a)) } as Alarm,
  };
}

function stubProvider(id: AiProvider['id']) {
  const calls = { moderate: 0, probe: 0 };
  const provider: AiProvider = {
    id,
    configured: true,
    moderate: async () => (calls.moderate++, { ok: true, value: { raw: '{"score":0}' }, usage: usageOf(5_000), ms: 1 }),
    translate: async () => ({ ok: true, value: { text: 'x' }, usage: usageOf(5_000), ms: 1 }),
    probe: async () => (calls.probe++, { ok: true, value: { raw: '{"score":0}' }, ms: 1 }),
  };
  return { provider, calls };
}

describe('AI spend counter on Postgres', { timeout: 60_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let store: SpendStore;
  let settingsStore: ModerationSettingsStore;
  let original: ModerationSettings;

  const counter = (o: { month: number; settings: SettingsSource; alarm: Alarm; layer?: ProviderLayer; ceiling?: (r: boolean) => void }): SpendCounter =>
    createSpendCounter({
      store,
      settings: o.settings,
      layer: o.layer ?? { setCeiling: o.ceiling ?? (() => {}) },
      prices: PRICES,
      clock: { now: () => at(o.month) },
      alarm: o.alarm,
      log: silent,
    });
  const fixed = (s: Partial<ModerationSettings>): SettingsSource & { set(n: Partial<ModerationSettings>): void } => {
    let cur: ModerationSettings = { ...DEFAULT_SETTINGS, ...s };
    return {
      read: async () => cur,
      set: (n) => {
        cur = { ...cur, ...n };
      },
    };
  };
  const total = async (month: number) => (await store.read([key(month)])).get(key(month)) ?? 0;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    store = createPgAiSpend(payloadOf(deps));
    settingsStore = createPayloadModerationSettings({ payload: payloadOf(deps), journal: createPayloadJournal(isRevertible), clock: { now: () => Date.UTC(YEAR, 0, 1) } });
    original = await settingsStore.read();
  });

  afterAll(async () => {
    const db = payload.db as unknown as { pool: { query(q: string, v: unknown[]): Promise<unknown> } };
    await db.pool.query(`DELETE FROM "ai_spend" WHERE "period" LIKE $1 OR "period" = $2`, [`month:${YEAR}-%`, `night:${YEAR}`]);
    await settingsStore.write(null, { ...original }, { kind: 'system', id: 'test', label: 'test' });
  });

  it('AC-26 + AC-28: two instances × 100 calls → sum = 200 × cost; a new instance reads the same sum', async () => {
    const s = fixed({ monthCeilingUsd: 10_000 });
    const a = counter({ month: 2, settings: s, alarm: spyAlarm().alarm });
    const b = counter({ month: 2, settings: s, alarm: spyAlarm().alarm });
    // AC-26: 1 000 000 in + 100 000 out (Anthropic) at the defaults = $0.15 = 150 000 micros.
    a.record('anthropic', { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }, REQ);
    await a.tick();
    expect(await total(2)).toBe(150_000);
    for (let i = 0; i < 100; i++) {
      a.record('anthropic', usageOf(1_500), REQ);
      b.record('anthropic', usageOf(1_500), REQ);
    }
    await Promise.all([a.tick(), b.tick()]);
    expect(await total(2)).toBe(150_000 + 200 * 1_500);
    const restarted = counter({ month: 2, settings: s, alarm: spyAlarm().alarm });
    await restarted.tick();
    expect(restarted.totals().month.usd).toBeCloseTo(0.45, 9);
  });

  it('AC-27: an answer without usage counts the upper estimate', async () => {
    const a = counter({ month: 7, settings: fixed({}), alarm: spyAlarm().alarm });
    a.record('deepseek', undefined, { chars: 100, maxTokens: 400 });
    await a.tick();
    // 100 × $0.30/M + 400 × $1.20/M = 30 + 480 micros
    expect(await total(7)).toBe(510);
  });

  it('AC-29: two instances cross 50 % at the same time → exactly one log alarm', async () => {
    const s = fixed({ monthCeilingUsd: 1 });
    const spy = spyAlarm();
    const a = counter({ month: 3, settings: s, alarm: spy.alarm });
    const b = counter({ month: 3, settings: s, alarm: spy.alarm });
    a.record('anthropic', usageOf(300_000), REQ);
    b.record('anthropic', usageOf(300_000), REQ);
    await Promise.all([a.tick(), b.tick()]);
    await Promise.all([a.tick(), b.tick()]);
    expect(await total(3)).toBe(600_000);
    expect(spy.raised.filter((x) => x.code === 'spend_50')).toEqual([expect.objectContaining({ level: 'log', source: 'mod' })]);
    expect(spy.raised.filter((x) => x.code === 'spend_80')).toEqual([]);
  });

  it('AC-30: 80 % → one page row in the alarm store; lowering the ceiling in the period → no new row', async () => {
    const db = payload.db as unknown as { pool: { query(q: string, v: unknown[]): Promise<{ rows: { n: string }[] }> } };
    const pages = async () =>
      Number((await db.pool.query(`SELECT count(*)::text AS n FROM "alarms" WHERE "source" = 'mod' AND "code" = 'spend_80' AND "id" > $1`, [before])).rows[0]?.n);
    const before = Number((await db.pool.query(`SELECT coalesce(max("id"), 0)::text AS n FROM "alarms"`, [])).rows[0]?.n);
    const real = createAlarm(silent, deps.alarmStore, { throttleMs: 0 });
    const s = fixed({ monthCeilingUsd: 1 });
    const spy = spyAlarm(real);
    const a = counter({ month: 4, settings: s, alarm: spy.alarm });
    const b = counter({ month: 4, settings: s, alarm: spy.alarm });
    a.record('anthropic', usageOf(850_000), REQ);
    await Promise.all([a.tick(), b.tick()]);
    await vi.waitFor(async () => expect(await pages()).toBe(1), { timeout: 5_000 });
    s.set({ monthCeilingUsd: 0.9 });
    b.record('anthropic', usageOf(1_000), REQ);
    await Promise.all([a.tick(), b.tick()]);
    await sleep(300);
    expect(await pages()).toBe(1);
    expect(spy.raised.filter((x) => x.code === 'spend_80')).toHaveLength(1);
  });

  describe('AC-31, AC-32, AC-42: ceiling reached, then raised by the owner', () => {
    const anthropic = stubProvider('anthropic');
    const deepseek = stubProvider('deepseek');
    const spy = spyAlarm();
    let layer: ProviderLayer;
    let c: SpendCounter;

    beforeAll(async () => {
      layer = createProviderLayer({
        providers: { moderation: [anthropic.provider, deepseek.provider], translation: [deepseek.provider, anthropic.provider] },
        clock: { now: () => 0 },
        alarm: spyAlarm().alarm,
        log: silent,
      });
      await settingsStore.write(null, { ...DEFAULT_SETTINGS, monthCeilingUsd: 50 }, { kind: 'system', id: 'test', label: 'test' });
      c = counter({ month: 5, settings: settingsStore, alarm: spy.alarm, layer });
      await c.tick();
    });

    it('AC-31: $49.99 at a $50 ceiling, one call → page and both tasks fallback/ceiling', async () => {
      await c.setSpendForDoor('month', 49.99);
      expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
      c.record('anthropic', usageOf(10_000), REQ);
      expect(layer.state('moderation')).toEqual({ task: 'moderation', state: 'fallback', reason: 'ceiling' });
      expect(layer.state('translation')).toEqual({ task: 'translation', state: 'fallback', reason: 'ceiling' });
      await c.tick();
      expect(await total(5)).toBe(50_000_000);
      expect(spy.raised.filter((x) => x.code === 'spend_100')).toEqual([expect.objectContaining({ level: 'page', source: 'mod' })]);
    });

    it('AC-32: no provider request at the ceiling; raising it → available within 10 s, one journal row', async () => {
      const before = anthropic.calls.moderate + deepseek.calls.moderate;
      for (let i = 0; i < 20; i++) {
        for (const p of layer.usable('moderation')) await layer.call('moderation', p, () => p.moderate('hi', undefined, AbortSignal.timeout(1_000)));
      }
      expect(anthropic.calls.moderate + deepseek.calls.moderate).toBe(before);

      const timer = c.start();
      try {
        const t0 = performance.now();
        await settingsStore.write(null, { ...DEFAULT_SETTINGS, monthCeilingUsd: 200 }, { kind: 'owner', id: 'test-owner', label: 'owner@test' });
        await vi.waitFor(() => expect(layer.state('moderation').state).toBe('available'), { timeout: 10_000, interval: 100 });
        expect(performance.now() - t0).toBeLessThanOrEqual(10_000);
        expect(layer.state('translation').state).toBe('available');
      } finally {
        await timer.stop();
      }
      const rows = (
        await payload.find({
          collection: 'audit-log',
          where: { and: [{ action: { equals: SETTINGS_ACTION } }, { 'actor.ref': { equals: 'test-owner' } }] },
          overrideAccess: true,
          depth: 0,
          sort: '-id',
          limit: 1,
        })
      ).docs as unknown as { before: Record<string, unknown>; after: Record<string, unknown> }[];
      expect(rows[0]?.before).toMatchObject({ monthCeilingUsd: 50 });
      expect(rows[0]?.after).toMatchObject({ monthCeilingUsd: 200 });
    });
  });

  it('NFR-4: two instances at 3 000 calls/min, $1 ceiling → final sum ≤ $1.50', async () => {
    const s = fixed({ monthCeilingUsd: 1 });
    const make = () => {
      const p = stubProvider('anthropic');
      const q = stubProvider('deepseek');
      const layer = createProviderLayer({
        providers: { moderation: [p.provider, q.provider], translation: [q.provider, p.provider] },
        clock: { now: () => 0 },
        alarm: spyAlarm().alarm,
        log: silent,
      });
      const c = counter({ month: 6, settings: s, alarm: spyAlarm().alarm, layer });
      return { layer, c };
    };
    const instances = [make(), make()];
    const timers = instances.map((i) => i.c.start());
    // Each instance 1 500 calls/min = one call every 40 ms; $0.005 per call.
    const load = async ({ layer, c }: (typeof instances)[number]) => {
      for (let i = 0; i < 1_000; i++) {
        const [p] = layer.usable('moderation');
        if (!p) return i;
        void layer.call('moderation', p, () => p.moderate('hi', undefined, AbortSignal.timeout(1_000))).then((answer) => {
          if (answer.ok) c.record(p.id, answer.usage, REQ);
        });
        await sleep(40);
      }
      return 1_000;
    };
    const calls = await Promise.all(instances.map(load));
    await Promise.all(timers.map((t) => t.stop()));
    const sum = await total(6);
    expect(calls.every((n) => n < 1_000)).toBe(true);
    expect(sum).toBeGreaterThanOrEqual(1_000_000);
    expect(sum).toBeLessThanOrEqual(1_500_000);
  });
});
