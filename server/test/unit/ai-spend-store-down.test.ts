/** SPEC-09 AC-34 (security S2): a hung spend store counts as down — bounded calls, ceiling and one page after 60 s. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/domain/moderation/settings';
import { aiPricesFrom } from '../../src/domain/moderation/spend';
import { createSpendCounter, type SpendStore } from '../../src/moderation/spend';
import type { AlarmInput } from '../../src/ports';

const PRICES = aiPricesFrom({
  anthropic: { input: '0.10', output: '0.50', cacheRead: '0.01', cacheWrite: '0.125' },
  deepseek: { cacheMiss: '0.30', cacheHit: '0.006', output: '1.20' },
});
const T0 = Date.UTC(2027, 2, 10, 12);
const never = <T>() => new Promise<T>(() => {});

function setup(store: SpendStore) {
  let now = T0;
  const alarms: AlarmInput[] = [];
  const ceiling: boolean[] = [];
  const counter = createSpendCounter({
    store,
    settings: { read: async () => DEFAULT_SETTINGS },
    layer: { setCeiling: (r) => void ceiling.push(r) },
    prices: PRICES,
    clock: { now: () => now },
    alarm: { raise: (a) => void alarms.push(a) },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    storeTimeoutMs: 20,
  });
  return {
    counter,
    alarms,
    ceiling,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 };

describe('spend store hang (AC-34, S2)', () => {
  it('a never-resolving store releases the tick, then after 60 s the ceiling is reached with one spend_store_down page', async () => {
    const hung: SpendStore = { add: never, read: never, claimAlarm: never, set: never };
    const { counter, alarms, ceiling, advance } = setup(hung);

    await counter.tick(); // resolves: the hung read times out and counts as a failure
    expect(counter.reached()).toBe(false);
    const second = counter.tick();
    await second; // not stuck behind the first one
    advance(59_000);
    counter.record('anthropic', usage, { chars: 4, maxTokens: 32 });
    expect(counter.reached()).toBe(false);
    expect(alarms.filter((a) => a.code === 'spend_store_down')).toHaveLength(0);

    advance(2_000);
    counter.record('anthropic', usage, { chars: 4, maxTokens: 32 });
    expect(counter.reached()).toBe(true);
    expect(ceiling.at(-1)).toBe(true);
    await counter.tick();
    expect(alarms.filter((a) => a.code === 'spend_store_down')).toEqual([
      { level: 'page', source: 'mod', code: 'spend_store_down', details: { seconds: 60 } },
    ]);
  });

  it('an idle counter with a healthy store is never judged down by elapsed time alone', async () => {
    const ok: SpendStore = { add: async (_p, m) => m, read: async () => new Map(), claimAlarm: async () => false, set: async () => {} };
    const { counter, advance } = setup(ok);
    await counter.tick();
    advance(10 * 60_000);
    expect(counter.reached()).toBe(false);
  });
});
