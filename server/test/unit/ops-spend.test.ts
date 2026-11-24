/**
 * SPEC-13b S9 (W30): витрати платних служб — реєстр, математика, задача (AC-60, AC-62 … AC-65, NFR-6).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPS_SPEND_SETTINGS } from '../../src/adapters/payloadOps';
import {
  backupStorageEstimate,
  bytesToGb,
  cloudflareCost,
  levelsCrossed,
  levelsReached,
  mailRow,
  monthPeriod,
  percent,
  serverCost,
  type CloudflarePrices,
} from '../../src/domain/ops/spend';
import { createR2Meter } from '../../src/ops/meter';
import type { OpsLease, SpendCounter, SpendCounterDelta, SpendCounterStore } from '../../src/ops/ports';
import { createSpendJob } from '../../src/ops/spend';
import type { Alarm } from '../../src/ports';
import { assertSpendRegistry, spendRegistry } from '../../src/registries/spend';

const PRICES: CloudflarePrices = {
  classAPerMillionUsd: 4.5,
  classBPerMillionUsd: 0.36,
  storagePerGbUsd: 0.015,
  freeClassA: 1_000_000,
  freeClassB: 10_000_000,
  freeStorageGb: 10,
};

describe('spend registry (AC-60)', () => {
  it('passes the static check and has the five rows', () => {
    expect(() => assertSpendRegistry(spendRegistry)).not.toThrow();
    expect(spendRegistry.map((r) => r.key)).toEqual(['ai', 'cloudflare', 'mail', 'server', 'youtube']);
  });
});

describe('server cost (AC-63)', () => {
  const MONTH = '2026-12';
  it('24 h x $0.0833 plus the base pro-rata is exact', () => {
    const end = Date.UTC(2027, 0, 1);
    // The month is over: the whole base is due.
    expect(serverCost(MONTH, end, 12, [{ hours: 24, usdPerHour: 0.0833 }])).toBeCloseTo(12 + 24 * 0.0833, 10);
    // Half way (15.5 of 31 days).
    const mid = Date.UTC(2026, 11, 1) + 15.5 * 86_400_000;
    expect(serverCost(MONTH, mid, 12, [])).toBeCloseTo(6, 10);
    expect(serverCost(MONTH, mid, 12, [{ hours: 24, usdPerHour: 0.0833 }])).toBeCloseTo(6 + 1.9992, 10);
  });
  it('clamps before the month starts and after it ends', () => {
    expect(serverCost(MONTH, Date.UTC(2026, 10, 1), 12, [])).toBe(0);
    expect(serverCost(MONTH, Date.UTC(2027, 5, 1), 12, [])).toBe(12);
  });
  it('period key is the UTC month', () => {
    expect(monthPeriod(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12');
    expect(monthPeriod(Date.UTC(2027, 0, 1))).toBe('2027-01');
  });
});

describe('cloudflare cost (AC-64)', () => {
  it('is exact above the free tiers', () => {
    const usd = cloudflareCost({ classA: 3_000_000, classB: 30_000_000, storageGb: 30 }, PRICES);
    expect(usd).toBeCloseTo(2 * 4.5 + 20 * 0.36 + 20 * 0.015, 10);
  });
  it('is $0 within the free tiers', () => {
    expect(cloudflareCost({ classA: 1_000_000, classB: 10_000_000, storageGb: 10 }, PRICES)).toBe(0);
    expect(cloudflareCost({ classA: 5, classB: 5, storageGb: 0.2 }, PRICES)).toBe(0);
  });
  it('the row carries the lower-bound note', () => {
    expect(spendRegistry.find((r) => r.key === 'cloudflare')?.note).toBe('нижня межа: без читань краю');
  });
});

describe('levels and the mail row (AC-62, AC-65)', () => {
  it('percent and levels', () => {
    expect(percent(6, 12)).toBe(50);
    expect(percent(1, 0)).toBe(0);
    expect(levelsReached(49.9)).toEqual([]);
    expect(levelsReached(50)).toEqual([50]);
    expect(levelsReached(81)).toEqual([50, 80]);
    expect(levelsCrossed(40, 85)).toEqual([50, 80]);
    expect(levelsCrossed(55, 85)).toEqual([80]);
    expect(levelsCrossed(85, 90)).toEqual([]);
  });
  it('mail has no provider', () => {
    expect(mailRow()).toEqual({ state: 'no-provider' });
  });
});

describe('backup storage estimate (NFR-6)', () => {
  it('102 backups stay under 10 GB for a database of ~50 MB', () => {
    const manifests = Array.from({ length: 102 }, () => ({ size: 50_000_000 }));
    expect(backupStorageEstimate(manifests)).toBe(5_100_000_000);
    expect(bytesToGb(backupStorageEstimate(manifests))).toBeLessThan(10);
    expect(bytesToGb(backupStorageEstimate(Array.from({ length: 102 }, () => ({ size: 100_000_000 }))))).toBeGreaterThan(10);
  });
});

/** In-memory store with the same claim semantics as the adapter. */
function memoryStore(): SpendCounterStore & { rows: Map<string, SpendCounter>; failUpsert: boolean } {
  const rows = new Map<string, SpendCounter>();
  const key = (r: string, p: string) => `${r}|${p}`;
  const blank = (row: string, period: string): SpendCounter => ({
    row,
    period,
    amountUsd: 0,
    classA: 0,
    classB: 0,
    storageBytes: 0,
    hours: 0,
    alarm50At: null,
    alarm80At: null,
    updatedAt: 0,
  });
  const store = {
    rows,
    failUpsert: false,
    async get(row: string, period: string) {
      return rows.get(key(row, period)) ?? null;
    },
    async upsert(row: string, period: string, d: SpendCounterDelta, at: number, storageBytes?: number) {
      if (store.failUpsert) throw new Error('down');
      const c = rows.get(key(row, period)) ?? blank(row, period);
      rows.set(key(row, period), {
        ...c,
        amountUsd: c.amountUsd + (d.amountUsd ?? 0),
        classA: c.classA + (d.classA ?? 0),
        classB: c.classB + (d.classB ?? 0),
        hours: c.hours + (d.hours ?? 0),
        storageBytes: storageBytes ?? c.storageBytes,
        updatedAt: at,
      });
    },
    async addServerHours(period: string, hours: number, usd: number, at: number) {
      await store.upsert('server', period, { hours, amountUsd: usd }, at);
    },
    async claimLevel(row: string, period: string, level: 50 | 80, at: number) {
      const c = rows.get(key(row, period)) ?? blank(row, period);
      const f = level === 50 ? 'alarm50At' : 'alarm80At';
      if (c[f] !== null) return false;
      rows.set(key(row, period), { ...c, [f]: at });
      return true;
    },
  };
  return store;
}

const lease = (held = true): OpsLease => ({ acquire: async () => held, release: async () => {} });

function job(over: { store?: ReturnType<typeof memoryStore>; settings?: Partial<typeof DEFAULT_OPS_SPEND_SETTINGS>; held?: boolean } = {}) {
  const raised: { level: string; source: string; code: string }[] = [];
  const alarm = { raise: (a: { level: string; source: string; code: string }) => void raised.push(a) } as unknown as Alarm;
  const store = over.store ?? memoryStore();
  const meter = createR2Meter();
  const j = createSpendJob({
    counters: store,
    settings: { read: async () => ({ ...DEFAULT_OPS_SPEND_SETTINGS, serverCeilingUsd: 12, ...over.settings }) },
    lease: lease(over.held ?? true),
    alarm,
    meter,
    ai: async () => ({ usd: 8.5, ceilingUsd: 10 }),
    youtube: async () => ({ used: 5000, limit: 10_000 }),
    backupStorageBytes: async () => 0,
  });
  return { j, store, raised, meter };
}

const MID_DEC = Date.UTC(2026, 11, 16, 12); // ~50.5 % of the month

describe('spend job (AC-60, AC-62, AC-65)', () => {
  it('rows follow the registry; ai and youtube read their sources; mail has no provider', async () => {
    const { j } = job();
    const rows = await j.rows(MID_DEC);
    expect(rows.map((r) => r.key)).toEqual(['ai', 'cloudflare', 'mail', 'server', 'youtube']);
    expect(rows.find((r) => r.key === 'ai')?.percent).toBeCloseTo(85, 5);
    expect(rows.find((r) => r.key === 'youtube')?.percent).toBe(50);
    expect(rows.find((r) => r.key === 'mail')).toMatchObject({ state: 'no-provider', percent: null });
    expect(rows.find((r) => r.key === 'cloudflare')?.note).toBe('нижня межа: без читань краю');
  });

  it('raises server-50 once in a period; 80 % pages once; a new month is possible again', async () => {
    const { j, raised } = job();
    await j.run(MID_DEC);
    await j.run(MID_DEC + 60_000);
    expect(raised.map((a) => `${a.level} ${a.source}/${a.code}`)).toEqual(['log spend/server-50']);
    await j.recordServerHours(40, 0.0833, MID_DEC); // 6.06 + 3.33 = 9.4 -> 78 %: still only 50
    await j.recordServerHours(10, 0.0833, MID_DEC); // 10.2 -> 85 %
    await j.run(MID_DEC + 120_000);
    await j.run(MID_DEC + 180_000);
    expect(raised.map((a) => `${a.level} ${a.source}/${a.code}`)).toEqual(['log spend/server-50', 'page spend/server-80']);
    // A month later the base alone is back at ~60 %: the 50 % level is claimable again.
    await j.run(Date.UTC(2027, 0, 20));
    expect(raised.at(-1)?.code).toBe('server-50');
  });

  it('a process without the lease raises nothing, but still flushes its meter', async () => {
    const { j, raised, store, meter } = job({ held: false });
    meter.record({ prefix: 'site', ok: true, classA: 7, classB: 3, at: MID_DEC });
    expect(await j.run(MID_DEC)).toEqual({ result: 'idle' });
    expect(raised).toEqual([]);
    expect(store.rows.get(`cloudflare|${monthPeriod(MID_DEC)}`)).toMatchObject({ classA: 7, classB: 3 });
  });

  it('a failed flush gives the delta back to the meter', async () => {
    const { j, store, meter } = job();
    meter.record({ prefix: 'site', ok: true, classA: 4, classB: 2, at: MID_DEC });
    store.failUpsert = true;
    expect(await j.run(MID_DEC)).toEqual({ result: 'flush-failed' });
    expect(meter.drain()).toEqual({ classA: 4, classB: 2 });
  });

  it('cloudflare over its ceiling pages; mail never alarms', async () => {
    const { j, raised, store } = job({ settings: { cloudflareCeilingUsd: 1 } });
    await store.upsert('cloudflare', monthPeriod(MID_DEC), { classA: 2_000_000 }, MID_DEC); // $4.50 over the free tier
    await j.run(MID_DEC);
    expect(raised.filter((a) => a.code.startsWith('cloudflare')).map((a) => a.code)).toEqual(['cloudflare-50', 'cloudflare-80']);
    expect(raised.some((a) => a.code.startsWith('mail'))).toBe(false);
  });

  it('server row with defaults (base 12, ceiling 40) and no extra hours stays below 50 % on day 28', async () => {
    expect(DEFAULT_OPS_SPEND_SETTINGS).toMatchObject({ serverBaseUsd: 12, serverCeilingUsd: 40 });
    const { j } = job({ settings: { serverCeilingUsd: DEFAULT_OPS_SPEND_SETTINGS.serverCeilingUsd } });
    const day28 = Date.UTC(2026, 10, 28, 12);
    const server = (await j.rows(day28)).find((r) => r.key === 'server');
    expect(server?.percent).toBeLessThanOrEqual(30);
    expect(server?.percent).toBeLessThan(50);
  });

  it('over50 lists the rows past half, for the digest', async () => {
    const { j } = job();
    const titles = (await j.over50(MID_DEC)).map((r) => r.title);
    expect(titles).toContain('AI (модерація й переклад)');
    expect(titles).not.toContain('Листи');
  });
});
