/**
 * SPEC-09 security S4: the toast check's sub-budget (20 % of each ceiling) is summed under
 * `<bucket>:toasts`; 50 % `log` and 80 % `page` alarm once per bucket cluster-wide; once spent only the
 * toast check is cut off, the shared ceiling stays open.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/domain/moderation/settings';
import { aiPricesFrom, type SpendLevel } from '../../src/domain/moderation/spend';
import { createSpendCounter, type SpendStore } from '../../src/moderation/spend';
import type { AlarmInput } from '../../src/ports';

const PRICES = aiPricesFrom({
  anthropic: { input: '0.10', output: '0.50', cacheRead: '0.01', cacheWrite: '0.125' },
  deepseek: { cacheMiss: '0.30', cacheHit: '0.006', output: '1.20' },
});
/** Outside the night: only the month bucket (`month:2027-03`, ceiling $100, toasts $20). */
const T0 = Date.UTC(2027, 2, 10, 12);
const REQ = { chars: 10, maxTokens: 32 };
/** `usd` of Anthropic input tokens ($0.10 per million). */
const usd = (n: number) => ({ input: n * 10_000_000, output: 0, cacheRead: 0, cacheWrite: 0 });

function memoryStore(): SpendStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  const claims = new Set<string>();
  return {
    rows,
    add: async (p, m) => {
      rows.set(p, (rows.get(p) ?? 0) + m);
      return rows.get(p) as number;
    },
    read: async (ps) => new Map(ps.map((p) => [p, rows.get(p) ?? 0])),
    claimAlarm: async (p: string, l: SpendLevel) => {
      const key = `${p}:${l}`;
      if (!rows.has(p) || claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    set: async (p, m) => {
      rows.set(p, m);
    },
  };
}

function counterOn(store: SpendStore) {
  const alarms: AlarmInput[] = [];
  const counter = createSpendCounter({
    store,
    settings: { read: async () => DEFAULT_SETTINGS },
    layer: { setCeiling: () => {} },
    prices: PRICES,
    clock: { now: () => T0 },
    alarm: { raise: (a) => void alarms.push(a) },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return { counter, alarms };
}

describe('S4: toasts.check sub-budget', () => {
  it('sums toasts under month:<m>:toasts, alarms 50 % log and 80 % page once, cuts off only the toast check at 100 %', async () => {
    const store = memoryStore();
    const { counter, alarms } = counterOn(store);
    const other = counterOn(store);
    const codes = (a: AlarmInput[]) => a.map((x) => `${x.level}:${x.code}`);

    counter.record('anthropic', usd(10.5), REQ, 'toasts');
    await counter.tick();
    expect(store.rows.get('month:2027-03:toasts')).toBe(10_500_000);
    expect(store.rows.get('month:2027-03')).toBe(10_500_000);
    expect(codes(alarms)).toEqual(['log:toasts_spend_50']);

    counter.record('anthropic', usd(6), REQ, 'toasts');
    await counter.tick();
    expect(codes(alarms)).toEqual(['log:toasts_spend_50', 'page:toasts_spend_80']);
    expect(counter.toastsReached()).toBe(false);

    // Chat spend counts against the shared ceiling only.
    counter.record('anthropic', usd(30), REQ);
    await counter.tick();
    expect(store.rows.get('month:2027-03:toasts')).toBe(16_500_000);
    expect(counter.toastsReached()).toBe(false);

    counter.record('anthropic', usd(4), REQ, 'toasts');
    expect(counter.toastsReached()).toBe(true);
    expect(counter.reached()).toBe(false);
    await counter.tick();
    // 100 % of the sub-budget is the switch to the filter, not an alarm; the shared 50 % is its own.
    expect(codes(alarms)).toEqual(['log:toasts_spend_50', 'page:toasts_spend_80', 'log:spend_50']);

    // Another process reads the same buckets: same switch, no second alarm.
    await other.counter.tick();
    expect(other.counter.toastsReached()).toBe(true);
    expect(other.alarms).toEqual([]);
  });

  it('the share comes from the configuration', async () => {
    const store = memoryStore();
    const alarms: AlarmInput[] = [];
    const counter = createSpendCounter({
      store,
      settings: { read: async () => DEFAULT_SETTINGS },
      layer: { setCeiling: () => {} },
      prices: PRICES,
      clock: { now: () => T0 },
      alarm: { raise: (a) => void alarms.push(a) },
      log: { info: () => {}, warn: () => {}, error: () => {} },
      toastsShare: 0.05,
    });
    counter.record('anthropic', usd(5), REQ, 'toasts');
    expect(counter.toastsReached()).toBe(true);
  });
});
