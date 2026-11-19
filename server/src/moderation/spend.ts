/**
 * Spend counter (SPEC-09 AC-26 … AC-34, AC-42, NFR-4), ring 3. Ports arrive as parameters; time only
 * through the injected clock (wall time of the clock port: it picks the night and month buckets).
 *
 * - `record` adds the cost of an answered call to an in-memory pending sum of the current buckets and
 *   re-judges the ceiling at once (known total + pending), so a process stops before its next call.
 * - Pending is written to Postgres (`add`, an atomic upsert) every `flushMs` (5 s) by the timer, and
 *   earlier when it reaches `flushAtMicros` ($0.10): two instances overspend at most about their two
 *   unflushed sums plus the calls in flight (NFR-4).
 * - Every tick re-reads the settings and the bucket totals, so another process's spend and a raised
 *   or lowered ceiling take effect in ≤ one tick (AC-32, AC-42).
 * - Threshold alarms (50 % `log`, 80 % and 100 % `page`) are claimed in the database with a
 *   conditional update: exactly one process wins per bucket and level for the whole cluster
 *   (AC-29 … AC-31). A level already claimed is never raised again in that bucket (a lowered ceiling
 *   does not re-raise it).
 * - Store failures keep the pending sum; after more than 60 s of continuous failure the ceiling counts
 *   as reached and one `page` is raised until the first success (AC-34).
 */
import {
  costMicros,
  levelsAt,
  nightKeyNear,
  periodsAt,
  usdToMicros,
  microsToUsd,
  type AiPrices,
  type SpendLevel,
  type SpendRequest,
} from '../domain/moderation/spend';
import { DEFAULT_SETTINGS, type ModerationSettings } from '../domain/moderation/settings';
import type { Alarm, Clock, Logger } from '../ports';
import type { ProviderAnswer, TokenUsage } from './ports';
import type { ProviderId } from './providers';

/** Postgres sums per bucket (`night:YYYY`, `month:YYYY-MM`), micro-dollars. */
export interface SpendStore {
  /** Adds `micros` to the bucket (creating it) and returns its new total. */
  add(period: string, micros: number): Promise<number>;
  /** Totals of the buckets; an absent bucket is 0. */
  read(periods: readonly string[]): Promise<Map<string, number>>;
  /** True for exactly one caller per bucket and level, cluster-wide. */
  claimAlarm(period: string, level: SpendLevel): Promise<boolean>;
  /** Sets the bucket's total (test door `setSpend`). */
  set(period: string, micros: number): Promise<void>;
}

export interface SettingsSource {
  read(): Promise<ModerationSettings>;
}

/** The provider layer's ceiling switch (AC-32). */
export interface CeilingSwitch {
  setCeiling(reached: boolean): void;
}

export interface SpendCounterDeps {
  store: SpendStore;
  settings: SettingsSource;
  layer: CeilingSwitch;
  prices: AiPrices;
  /** Wall clock of the clock port, epoch ms. */
  clock: Clock;
  alarm: Alarm;
  log: Logger;
  flushMs?: number;
  flushAtMicros?: number;
  storeDownMs?: number;
  /** Upper estimate of a probe without `usage`: fixed service text and the moderation `max_tokens`. */
  probeRequest?: SpendRequest;
}

export interface SpendTotals {
  night: { period: string; usd: number; ceilingUsd: number } | null;
  month: { period: string; usd: number; ceilingUsd: number };
}

export interface SpendCounter {
  /** Adds the cost of one answered call (AC-26, AC-27). */
  record(provider: ProviderId, usage: TokenUsage | undefined, request: SpendRequest): void;
  /** Adds the cost of a probe that the provider answered (probes cost money too). */
  recordProbe(provider: ProviderId, answer: ProviderAnswer<unknown>): void;
  /** Whether the ceiling counts as reached now (a bucket at its ceiling, or the store down > 60 s). */
  reached(): boolean;
  /** Last read settings (thresholds for verdicts come from here too). */
  settings(): ModerationSettings;
  /** Known totals including the pending sums, for the door's status and the admin slice. */
  totals(): SpendTotals;
  /** Writes the pending sums now. */
  flush(): Promise<void>;
  /** One cycle: flush, re-read settings and totals, claim alarms, re-judge the ceiling. */
  tick(): Promise<void>;
  /** Starts the `unref` timer (first tick at once). */
  start(): { stop(): Promise<void> };
  /** Test door `setSpend`: the bucket of `period` near now gets exactly `usd`. */
  setSpendForDoor(period: 'night' | 'month', usd: number): Promise<void>;
  /** Test door `reset`: forgets every in-memory sum, claim and failure; ceiling lifted. */
  reset(): void;
}

const LEVEL_ALARM: Record<SpendLevel, 'log' | 'page'> = { 50: 'log', 80: 'page', 100: 'page' };
export const STORE_DOWN_MS = 60_000;
export const FLUSH_MS = 5_000;
export const FLUSH_AT_MICROS = 100_000;
/** `ping` (4 characters) with the moderation `max_tokens` of both adapters (32). */
const PROBE_REQUEST: SpendRequest = { chars: 4, maxTokens: 32 };

const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

export function createSpendCounter({
  store,
  settings: source,
  layer,
  prices,
  clock,
  alarm,
  log,
  flushMs = FLUSH_MS,
  flushAtMicros = FLUSH_AT_MICROS,
  storeDownMs = STORE_DOWN_MS,
  probeRequest = PROBE_REQUEST,
}: SpendCounterDeps): SpendCounter {
  let current: ModerationSettings = DEFAULT_SETTINGS;
  /** Totals last seen in Postgres, per bucket. */
  const known = new Map<string, number>();
  /** Not yet written, per bucket. */
  const pending = new Map<string, number>();
  /** `period:level` already claimed (by anyone): never asked again. */
  const claimed = new Set<string>();
  let failingSince: number | null = null;
  let downRaised = false;
  let flushing: Promise<void> | null = null;
  let ticking: Promise<void> | null = null;
  let generation = 0;

  const ceilingOf = (period: string) => usdToMicros(period.startsWith('night:') ? current.nightCeilingUsd : current.monthCeilingUsd);
  const sumOf = (period: string) => (known.get(period) ?? 0) + (pending.get(period) ?? 0);
  const activePeriods = (): string[] => {
    const p = periodsAt(clock.now());
    return p.night ? [p.night, p.month] : [p.month];
  };
  const pendingTotal = () => Math.max(0, ...pending.values());

  function atCeiling(): boolean {
    return activePeriods().some((p) => sumOf(p) >= ceilingOf(p));
  }

  function storeDown(): boolean {
    return failingSince !== null && clock.now() - failingSince > storeDownMs;
  }

  function judge() {
    const down = storeDown();
    if (down && !downRaised) {
      downRaised = true;
      alarm.raise({ level: 'page', source: 'mod', code: 'spend_store_down', details: { seconds: Math.round(storeDownMs / 1000) } });
    }
    layer.setCeiling(down || atCeiling());
  }

  function failed(err: unknown) {
    if (failingSince === null) failingSince = clock.now();
    log.warn({ event: 'ai-spend-store-failed', err: errName(err) });
  }

  function succeeded() {
    failingSince = null;
    if (downRaised) {
      downRaised = false;
      alarm.raise({ level: 'log', source: 'mod', code: 'spend_store_recovered' });
    }
  }

  async function flushOnce() {
    if (pending.size === 0) return;
    const gen = generation;
    const batch = [...pending.entries()];
    pending.clear();
    for (let i = 0; i < batch.length; i++) {
      const [period, micros] = batch[i] as [string, number];
      try {
        const total = await store.add(period, micros);
        if (gen !== generation) return;
        known.set(period, total);
        succeeded();
      } catch (err) {
        if (gen !== generation) return;
        // Keep what was not written; it goes out with the next flush.
        for (const [p, m] of batch.slice(i)) pending.set(p, (pending.get(p) ?? 0) + m);
        failed(err);
        return;
      }
    }
  }

  /** Writes everything pending at the time of the call (waits for a flush already running first). */
  async function flush(): Promise<void> {
    while (flushing) await flushing;
    if (pending.size === 0) return;
    flushing = flushOnce().finally(() => {
      flushing = null;
    });
    await flushing;
  }

  async function refresh() {
    const gen = generation;
    const periods = activePeriods();
    try {
      const [next, totals] = await Promise.all([source.read(), store.read(periods)]);
      if (gen !== generation) return;
      current = next;
      for (const p of periods) known.set(p, totals.get(p) ?? 0);
      succeeded();
    } catch (err) {
      if (gen !== generation) return;
      failed(err);
      return;
    }
    for (const p of periods) {
      for (const level of levelsAt(known.get(p) ?? 0, ceilingOf(p))) {
        const key = `${p}:${level}`;
        if (claimed.has(key)) continue;
        try {
          const won = await store.claimAlarm(p, level);
          if (gen !== generation) return;
          claimed.add(key);
          if (won) {
            alarm.raise({
              level: LEVEL_ALARM[level],
              source: 'mod',
              code: `spend_${level}`,
              details: { period: p, ceilingUsd: microsToUsd(ceilingOf(p)), spentUsd: microsToUsd(known.get(p) ?? 0) },
            });
          }
        } catch (err) {
          failed(err);
          return;
        }
      }
    }
  }

  function tick(): Promise<void> {
    if (ticking) return ticking;
    ticking = (async () => {
      try {
        await flush();
        await refresh();
      } finally {
        judge();
        ticking = null;
      }
    })();
    return ticking;
  }

  function add(provider: ProviderId, usage: TokenUsage | undefined, request: SpendRequest) {
    const micros = costMicros(provider, usage, request, prices);
    if (micros <= 0) return;
    for (const p of activePeriods()) pending.set(p, (pending.get(p) ?? 0) + micros);
    judge();
    if (!flushing && pendingTotal() >= flushAtMicros && failingSince === null) {
      void flush()
        .then(() => judge())
        .catch((err: unknown) => log.warn({ event: 'ai-spend-flush-failed', err: errName(err) }));
    }
  }

  return {
    record: add,
    recordProbe(provider, answer) {
      if (answer.ok) add(provider, answer.usage, probeRequest);
    },
    reached: () => storeDown() || atCeiling(),
    settings: () => current,
    totals() {
      const p = periodsAt(clock.now());
      const view = (period: string) => ({ period, usd: microsToUsd(sumOf(period)), ceilingUsd: microsToUsd(ceilingOf(period)) });
      return { night: p.night ? view(p.night) : null, month: view(p.month) };
    },
    flush,
    tick,
    start() {
      void tick().catch(() => {});
      const timer = setInterval(() => {
        void tick().catch((err: unknown) => log.warn({ event: 'ai-spend-tick-failed', err: errName(err) }));
      }, flushMs);
      timer.unref?.();
      return {
        stop: async () => {
          clearInterval(timer);
          await ticking;
          await flush();
        },
      };
    },
    async setSpendForDoor(period, usd) {
      const now = clock.now();
      const key = period === 'night' ? nightKeyNear(now) : periodsAt(now).month;
      const micros = usdToMicros(usd);
      await store.set(key, micros);
      pending.delete(key);
      known.set(key, micros);
      judge();
    },
    reset() {
      generation++;
      known.clear();
      pending.clear();
      claimed.clear();
      failingSince = null;
      downRaised = false;
      current = DEFAULT_SETTINGS;
      layer.setCeiling(false);
    },
  };
}
