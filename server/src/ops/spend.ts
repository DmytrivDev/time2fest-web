/**
 * Лічильники витрат платних служб (SPEC-13b AC-60 … AC-65, W29), ring 3 — лише порти, годинник стінний.
 *
 * Рядки реєстру `registries/spend.ts`: `ai` читає наявний `ai_spend` SPEC-09 (його тривоги — його), `youtube` —
 * квоту SPEC-12, `server` і `cloudflare` рахуються з лічильників і `ops-settings`, `mail` — «немає провайдера».
 * Раз на хвилину кожен процес скидає свою дельту лічильника R2 у `cloudflare:<yyyy-mm>`; оцінку й пороги
 * 50 % (`log`) / 80 % (`page`) рахує той, хто взяв оренду `ops-spend`, і лише той, хто виграв `claimLevel`,
 * піднімає тривогу `spend/<рядок>-50|80` — раз на період на весь кластер (AC-62).
 */
import { bytesToGb, cloudflareCost, levelsReached, mailRow, monthPeriod, percent, serverCost, type SpendLevel } from '../domain/ops/spend';
import type { Alarm } from '../ports';
import { spendRegistry } from '../registries/spend';
import type { SpendOver50 } from './digest';
import type { R2Meter } from './meter';
import type { OpsLease, OpsSpendSettings, SpendCounterStore } from './ports';

export const SPEND_EVERY_MS = 60_000;
const LEASE_TTL_MS = 90_000;
/** The backup size estimate is re-read this rarely (a query over `backup-runs`). */
const STORAGE_EVERY_MS = 600_000;
const LEVEL_ALARM: Record<SpendLevel, 'log' | 'page'> = { 50: 'log', 80: 'page' };

/** What one spend row shows (the monitoring block `spend`, AC-60). */
export interface SpendRowState {
  key: string;
  title: string;
  unit: 'units' | 'usd';
  /** `null` — no number (`mail` without a provider, a source that cannot be read). */
  amount: number | null;
  ceiling: number | null;
  percent: number | null;
  state: 'ok' | 'no-provider' | 'unknown';
  note?: string;
}

export interface SpendJobDeps {
  counters: SpendCounterStore;
  settings: { read(): Promise<OpsSpendSettings> };
  lease: OpsLease;
  alarm: Alarm;
  /** The R2 meter of this process; absent — nothing to flush. */
  meter?: R2Meter;
  /** The larger of the AI night / month buckets of SPEC-09 by percent, `null` while unreadable. */
  ai(now: number): Promise<{ usd: number; ceilingUsd: number } | null>;
  /** Used and limit of the YouTube `queries` bucket of the quota day, `null` while unreadable. */
  youtube(now: number): Promise<{ used: number; limit: number } | null>;
  /** Bytes of the backups on R2 (estimate). */
  backupStorageBytes(): Promise<number>;
}

export type SpendJobOutcome = { result: 'ran'; raised: string[] } | { result: 'idle' } | { result: 'flush-failed' };

export interface SpendJob {
  /** One pass at `now` (the runner gates it to once a minute). */
  run(now: number): Promise<SpendJobOutcome>;
  /** The rows for the overview, registry order. */
  rows(now: number): Promise<SpendRowState[]>;
  /** Rows over 50 % for the digest (AC-20). */
  over50(now: number): Promise<SpendOver50[]>;
  /** Records night-size hours into the `server` counter of the month of `now` (AC-63). */
  recordServerHours(hours: number, usdPerHour: number, now: number): Promise<void>;
  release(): Promise<void>;
}

/** Records night-size hours (AC-63): the function the `ops spend-record` and `capacity` commands call. */
export async function recordServerHours(counters: SpendCounterStore, hours: number, usdPerHour: number, now: number): Promise<void> {
  if (!(hours > 0) || !(usdPerHour >= 0)) throw new Error('spend: hours must be > 0 and the rate >= 0');
  await counters.addServerHours(monthPeriod(now), hours, hours * usdPerHour, now);
}

export function createSpendJob(deps: SpendJobDeps): SpendJob {
  let lastStorageAt: number | undefined;

  /** The fresh estimate, or `undefined` while the last one is still recent. */
  const storageBytes = async (now: number): Promise<number | undefined> => {
    if (lastStorageAt !== undefined && Math.abs(now - lastStorageAt) < STORAGE_EVERY_MS) return undefined;
    const bytes = await deps.backupStorageBytes();
    lastStorageAt = now;
    return bytes;
  };

  async function flushMeter(now: number): Promise<boolean> {
    if (!deps.meter) return true;
    const delta = deps.meter.drain();
    if (delta.classA === 0 && delta.classB === 0) return true;
    try {
      await deps.counters.upsert('cloudflare', monthPeriod(now), delta, now);
      return true;
    } catch {
      deps.meter.restore(delta);
      return false;
    }
  }

  async function money(now: number, st: OpsSpendSettings) {
    const period = monthPeriod(now);
    const [server, cf] = await Promise.all([deps.counters.get('server', period), deps.counters.get('cloudflare', period)]);
    const serverUsd = serverCost(period, now, st.serverBaseUsd, server ? [{ hours: 1, usdPerHour: server.amountUsd }] : []);
    const cloudflareUsd = cloudflareCost(
      { classA: cf?.classA ?? 0, classB: cf?.classB ?? 0, storageGb: bytesToGb(cf?.storageBytes ?? 0) },
      {
        classAPerMillionUsd: st.priceClassAPerMillionUsd,
        classBPerMillionUsd: st.priceClassBPerMillionUsd,
        storagePerGbUsd: st.priceStoragePerGbUsd,
        freeClassA: st.freeClassA,
        freeClassB: st.freeClassB,
        freeStorageGb: st.freeStorageGb,
      },
    );
    return { period, serverUsd, cloudflareUsd };
  }

  const known = (amount: number, ceiling: number): Pick<SpendRowState, 'amount' | 'ceiling' | 'percent' | 'state'> => ({
    amount,
    ceiling,
    percent: percent(amount, ceiling),
    state: 'ok',
  });
  const unknown = { amount: null, ceiling: null, percent: null, state: 'unknown' } as const;

  async function rows(now: number): Promise<SpendRowState[]> {
    const st = await deps.settings.read();
    const m = await money(now, st);
    const out: SpendRowState[] = [];
    for (const r of spendRegistry) {
      const base = { key: r.key, title: r.title, unit: r.unit, ...(r.note ? { note: r.note } : {}) };
      if (r.key === 'ai') {
        const ai = await deps.ai(now).catch(() => null);
        out.push({ ...base, ...(ai ? known(ai.usd, ai.ceilingUsd) : unknown) });
      } else if (r.key === 'youtube') {
        const y = await deps.youtube(now).catch(() => null);
        out.push({ ...base, ...(y ? known(y.used, y.limit) : unknown) });
      } else if (r.key === 'mail') {
        out.push({ ...base, amount: null, ceiling: st.mailCeilingUsd, percent: null, state: mailRow().state });
      } else if (r.key === 'server') {
        out.push({ ...base, ...known(m.serverUsd, st.serverCeilingUsd) });
      } else {
        out.push({ ...base, ...known(m.cloudflareUsd, st.cloudflareCeilingUsd) });
      }
    }
    return out;
  }

  return {
    rows,
    async over50(now) {
      return (await rows(now))
        .filter((r) => r.percent !== null && r.percent >= 50)
        .map((r) => ({ title: r.title, percent: Math.floor(r.percent ?? 0) }));
    },
    recordServerHours: (hours, usdPerHour, now) => recordServerHours(deps.counters, hours, usdPerHour, now),
    async run(now) {
      const flushed = await flushMeter(now);
      // The counters store is down: nothing to evaluate (the runner logs a thrown error; this is the quiet case).
      if (!flushed) return { result: 'flush-failed' };
      if (!(await deps.lease.acquire('ops-spend', LEASE_TTL_MS))) return { result: 'idle' };
      const period = monthPeriod(now);
      const bytes = await storageBytes(now);
      if (bytes !== undefined) await deps.counters.upsert('cloudflare', period, {}, now, bytes);
      const st = await deps.settings.read();
      const m = await money(now, st);
      // `ai` and `youtube` raise nothing here (SPEC-09 / SPEC-12 own their alarms); `mail` has no counter (AC-65).
      const checks = [
        { key: 'server', usd: m.serverUsd, ceiling: st.serverCeilingUsd },
        { key: 'cloudflare', usd: m.cloudflareUsd, ceiling: st.cloudflareCeilingUsd },
      ];
      const raised: string[] = [];
      for (const c of checks) {
        const p = percent(c.usd, c.ceiling);
        for (const level of levelsReached(p)) {
          if (!(await deps.counters.claimLevel(c.key, period, level, now))) continue;
          const code = `${c.key}-${level}`;
          deps.alarm.raise({ level: LEVEL_ALARM[level], source: 'spend', code, details: { percent: Math.floor(p), period } });
          raised.push(`spend/${code}`);
        }
      }
      return { result: 'ran', raised };
    },
    async release() {
      await deps.lease.release('ops-spend').catch(() => {});
    },
  };
}
