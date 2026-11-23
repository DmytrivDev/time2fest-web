/**
 * NFR-1: the poller's day budget on the busiest night. Simulates the poller with a test clock over `data/schedule.json`
 * and the seed chains of `data/streams.json`, each multiplied to 10 ids per event, through the real `schedule.ts`
 * and `quota.ts` (no copy of the planner). Each quota day must stay ≤80 % of the general bucket and within ±1 % of
 * `U = Σ ⌈A(t)/B⌉ + C_adhoc + ⌈N/B⌉·24/6`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS } from '../../src/domain/live/config';
import type { LiveEvent } from '../../src/domain/live/moment';
import { allow, chargeCalls, counterOf, nextDayBoundary, quotaDay, type CallerContext, type QuotaState } from '../../src/domain/live/quota';
import { nextOffWindowCheckAt, planTick, type ScheduledSource } from '../../src/domain/live/schedule';

const cfg = LIVE_DEFAULTS;
const caller: CallerContext = { envClass: 'production', adapter: 'fake' };
const IDS_PER_EVENT = 10;
const HOUR = 60 * 60_000;

interface ScheduleJson {
  zones: { id: string; countries: { cities: { events: { id: string; midnightUtc: string }[] }[] }[] }[];
}
interface StreamsJson {
  chains: { eventId: string; sources: { videoId?: string }[] }[];
}
const read = <T>(rel: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T;
const schedule = read<ScheduleJson>('../../../data/schedule.json');
const streams = read<StreamsJson>('../../../data/streams.json');

const events: LiveEvent[] = schedule.zones.flatMap((z) =>
  z.countries.flatMap((c) =>
    c.cities.flatMap((city) => city.events.map((e) => ({ eventId: e.id, zoneId: z.id, moment: Date.parse(e.midnightUtc), nonMidnight: false, hidden: false }))),
  ),
);

/** Ten distinct ids per event: the event's seed videoIds, then synthetic ones. */
function tenIds(eventId: string, seed: readonly string[]): ScheduledSource[] {
  const ids = [...new Set(seed)].slice(0, IDS_PER_EVENT);
  for (let i = 0; ids.length < IDS_PER_EVENT; i++) ids.push(`${eventId}~${i}`);
  return ids.map((videoId) => ({ eventId, videoId, nextOffWindowCheckAt: null }));
}

interface DayResult {
  day: string;
  used: number;
  formula: number;
}

/** `gate`: every call must pass `allow` (the budget case); off → the demand is measured as is. */
function simulate(sources: ScheduledSource[], gate = true): DayResult[] {
  const known = new Set(events.map((e) => e.eventId));
  const polled = sources.filter((s) => known.has(s.eventId));
  const n = new Set(polled.map((s) => s.videoId)).size;
  const firstOpen = Math.min(...events.map((e) => e.moment)) - cfg.windowBeforeMs;
  const lastClose = Math.max(...events.map((e) => e.moment)) + cfg.windowAfterMs;
  // From the start of the quota day of the first window to the end of the quota day of the last one.
  let start = firstOpen;
  while (quotaDay(start - cfg.tickMs, cfg.dayTimeZone) === quotaDay(firstOpen, cfg.dayTimeZone)) start -= cfg.tickMs;
  const end = nextDayBoundary(lastClose, cfg.dayTimeZone);

  let state: QuotaState = {};
  const windowFormula = new Map<string, number>();
  const used = new Map<string, number>();
  for (let now = start; now < end; now += cfg.tickMs) {
    const day = quotaDay(now, cfg.dayTimeZone);
    const plan = planTick(events, polled, now, cfg);
    // Formula term ⌈A(t)/B⌉, with A(t) counted here from the windows, independently of the planner's batches.
    const open = new Set(events.filter((e) => now >= e.moment - cfg.windowBeforeMs && now < e.moment + cfg.windowAfterMs).map((e) => e.eventId));
    const a = new Set(polled.filter((s) => open.has(s.eventId)).map((s) => s.videoId)).size;
    windowFormula.set(day, (windowFormula.get(day) ?? 0) + Math.ceil(a / cfg.batchSize));

    const windowCalls = Math.ceil(plan.windowIds.length / cfg.batchSize);
    const offCalls = plan.batches.length - windowCalls;
    for (const [cls, calls] of [['statuses', windowCalls], ['off-window', offCalls]] as const) {
      if (calls === 0) continue;
      if (gate) expect(allow(state, cls, now, cfg, caller, calls).ok).toBe(true);
      state = chargeCalls(state, cls, calls, now, cfg).state;
    }
    const checked = new Set([...plan.windowIds, ...plan.offWindowIds]);
    for (const s of polled) if (checked.has(s.videoId)) s.nextOffWindowCheckAt = nextOffWindowCheckAt(now, cfg);
    // Ad-hoc checks (player reports) asked every tick: the ceiling caps them (C_adhoc).
    if (allow(state, 'ad-hoc', now, cfg, caller).ok) state = chargeCalls(state, 'ad-hoc', 1, now, cfg).state;
    used.set(day, counterOf(state, 'queries', now, cfg).used);
  }
  const r = Math.ceil(n / cfg.batchSize) * (24 * HOUR / cfg.offWindowMinMs);
  return [...used].map(([day, u]) => ({ day, used: u, formula: (windowFormula.get(day) ?? 0) + cfg.adHocCeiling + r }));
}

describe('NFR-1 — busiest night within 80 % of the general bucket', () => {
  it('seed chains ×10 ids per event: every quota day ≤ 8 000 and within ±1 % of the formula', () => {
    const seed = streams.chains.flatMap((c) => tenIds(c.eventId, c.sources.flatMap((s) => (s.videoId ? [s.videoId] : []))));
    const days = simulate(seed);
    if (process.env.T2F_NFR1_REPORT) console.info('NFR-1 seed', JSON.stringify(days));
    expect(days.map((d) => d.day)).toEqual(['2026-12-31', '2027-01-01']);
    for (const d of days) {
      expect(d.used, d.day).toBeLessThanOrEqual(cfg.alarmRatio * cfg.buckets.queries.perDay);
      expect(Math.abs(d.used - d.formula), d.day).toBeLessThanOrEqual(d.formula / 100);
    }
  });

  it('every schedule event ×10 ids (demand, not gated): the planner still matches the formula ±1 %', () => {
    const all = events.flatMap((e) => tenIds(e.eventId, []));
    const days = simulate(all, false);
    if (process.env.T2F_NFR1_REPORT) console.info('NFR-1 all events', JSON.stringify(days));
    for (const d of days) expect(Math.abs(d.used - d.formula), d.day).toBeLessThanOrEqual(d.formula / 100);
  });
});
