/** Spend arithmetic, buckets, settings validation and the store-down rule (SPEC-09 AC-26, AC-27, AC-33, AC-34, AC-42; W19, W21, W22). */
import { describe, expect, it } from 'vitest';
import { validateSettings } from '../../src/domain/moderation/settings';
import { aiPricesFrom, costMicros, crossed, levelsAt, parseUsdPerMTok, periodsAt } from '../../src/domain/moderation/spend';
import { createSpendCounter, type SpendStore } from '../../src/moderation/spend';
import { DEFAULT_SETTINGS } from '../../src/domain/moderation/settings';
import type { AlarmInput } from '../../src/ports';

/** The configuration's defaults (`server/src/registries/env.ts`). */
const PRICES = aiPricesFrom({
  anthropic: { input: '0.10', output: '0.50', cacheRead: '0.01', cacheWrite: '0.125' },
  deepseek: { cacheMiss: '0.30', cacheHit: '0.006', output: '1.20' },
});
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('AC-33 spend buckets', () => {
  const at = (iso: string) => periodsAt(Date.parse(iso));
  it('31.12 07:59 → month only', () => expect(at('2026-12-31T07:59:00Z')).toEqual({ month: 'month:2026-12', night: null }));
  it('31.12 08:00 → night starts', () => expect(at('2026-12-31T08:00:00Z')).toEqual({ month: 'month:2026-12', night: 'night:2026' }));
  it('31.12 23:59 → night + December', () => expect(at('2026-12-31T23:59:00Z')).toEqual({ month: 'month:2026-12', night: 'night:2026' }));
  it('01.01 00:01 → same night + January (month edge keeps the night)', () =>
    expect(at('2027-01-01T00:01:00Z')).toEqual({ month: 'month:2027-01', night: 'night:2026' }));
  it('01.01 13:59 → still the night', () => expect(at('2027-01-01T13:59:59Z').night).toBe('night:2026'));
  it('01.01 14:00 → January only', () => expect(at('2027-01-01T14:00:00Z')).toEqual({ month: 'month:2027-01', night: null }));
  it('mid-year → month only', () => expect(at('2027-06-15T12:00:00Z')).toEqual({ month: 'month:2027-06', night: null }));
});

describe('AC-26, AC-27 cost', () => {
  it('prices parse to integer micro-dollars per million tokens', () => {
    expect(parseUsdPerMTok('0.10')).toBe(100_000);
    expect(parseUsdPerMTok('0.125')).toBe(125_000);
    expect(parseUsdPerMTok('0.006')).toBe(6_000);
    expect(parseUsdPerMTok('3')).toBe(3_000_000);
    expect(parseUsdPerMTok('0.0000001')).toBe(1);
    expect(() => parseUsdPerMTok('1e3')).toThrow();
  });

  it('Anthropic 1 000 000 in + 100 000 out at defaults → $0.15', () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
    expect(costMicros('anthropic', usage, { chars: 10, maxTokens: 32 }, PRICES)).toBe(150_000);
  });

  it('Anthropic cache fields are priced apart', () => {
    const usage = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
    expect(costMicros('anthropic', usage, { chars: 0, maxTokens: 0 }, PRICES)).toBe(10_000 + 125_000);
  });

  it('DeepSeek miss/hit/completion at peak prices', () => {
    const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 };
    expect(costMicros('deepseek', usage, { chars: 0, maxTokens: 0 }, PRICES)).toBe(300_000 + 1_200_000 + 6_000);
  });

  it('no usage → upper estimate: chars as input, max_tokens as output (AC-27)', () => {
    // 2 000 000 chars × 0.10 + 400 000 × 0.50 → 200 000 + 200 000 micros
    expect(costMicros('anthropic', undefined, { chars: 2_000_000, maxTokens: 400_000 }, PRICES)).toBe(400_000);
    // 4 × 0.10 + 32 × 0.50 = 16.4 micros, rounded up.
    expect(costMicros('anthropic', undefined, { chars: 4, maxTokens: 32 }, PRICES)).toBe(17);
  });

  it('levels and crossings', () => {
    expect(levelsAt(49, 100)).toEqual([]);
    expect(levelsAt(50, 100)).toEqual([50]);
    expect(levelsAt(100, 100)).toEqual([50, 80, 100]);
    expect(crossed(40, 85, 100)).toEqual([50, 80]);
    expect(crossed(85, 90, 100)).toEqual([]);
  });
});

describe('AC-42 settings validation', () => {
  const ok = { review: 0.5, block: 0.8, nightCeilingUsd: 50, monthCeilingUsd: 100 };
  it.each([
    [ok, []],
    [{ ...ok, review: 0.9, block: 0.8 }, ['review']],
    [{ ...ok, review: 0.8, block: 0.8 }, ['review']],
    [{ ...ok, review: 0 }, ['review']],
    [{ ...ok, block: 1 }, []],
    [{ ...ok, block: 1.01 }, ['block']],
    [{ ...ok, nightCeilingUsd: 0 }, ['nightCeilingUsd']],
    [{ ...ok, monthCeilingUsd: -1 }, ['monthCeilingUsd']],
    [{ ...ok, monthCeilingUsd: Number.POSITIVE_INFINITY }, ['monthCeilingUsd']],
    [{ ...ok, review: Number.NaN }, ['review']],
  ])('%j → %j', (input, fields) => {
    const r = validateSettings(input);
    expect(r.ok ? [] : r.fields).toEqual(fields);
  });
});

describe('AC-34 store down > 60 s → ceiling and page', () => {
  it('61 s of failures → ceiling + one page; first success → lifted', async () => {
    let t = Date.parse('2027-03-10T10:00:00Z');
    let failing = true;
    const totals = new Map<string, number>();
    const fail = () => Promise.reject(Object.assign(new Error('down'), { name: 'DependencyUnavailable' }));
    const store: SpendStore = {
      add: (p, m) => {
        if (failing) return fail();
        totals.set(p, (totals.get(p) ?? 0) + m);
        return Promise.resolve(totals.get(p) as number);
      },
      read: (ps) => (failing ? fail() : Promise.resolve(new Map(ps.map((p) => [p, totals.get(p) ?? 0])))),
      claimAlarm: () => Promise.resolve(false),
      set: () => Promise.resolve(),
    };
    const alarms: AlarmInput[] = [];
    const ceiling: boolean[] = [];
    const counter = createSpendCounter({
      store,
      settings: { read: () => (failing ? fail() : Promise.resolve(DEFAULT_SETTINGS)) },
      layer: { setCeiling: (r) => ceiling.push(r) },
      prices: PRICES,
      clock: { now: () => t },
      alarm: { raise: (a) => alarms.push(a) },
      log: silent,
    });

    counter.record('anthropic', { input: 1000, output: 10, cacheRead: 0, cacheWrite: 0 }, { chars: 1, maxTokens: 1 });
    await counter.tick();
    expect(counter.reached()).toBe(false);
    t += 60_000;
    await counter.tick();
    expect(counter.reached()).toBe(false);
    t += 1_000;
    await counter.tick();
    expect(counter.reached()).toBe(true);
    expect(ceiling.at(-1)).toBe(true);
    await counter.tick();
    expect(alarms.filter((a) => a.code === 'spend_store_down')).toEqual([expect.objectContaining({ level: 'page', source: 'mod' })]);

    failing = false;
    await counter.tick();
    expect(counter.reached()).toBe(false);
    expect(ceiling.at(-1)).toBe(false);
    // The pending sum kept during the failure reached the store.
    expect(totals.get('month:2027-03')).toBe(counter.totals().month.usd * 1_000_000);
    expect(totals.get('month:2027-03')).toBeGreaterThan(0);
  });
});
