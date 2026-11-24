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
import { chainFull } from '../../src/domain/live/candidates';
import { playlistDue, refreshDue, searchDue, type WatchChannel } from '../../src/domain/live/channels';
import { allow, chargeCalls, counterOf, nextDayBoundary, quotaDay, type CallerContext, type QuotaClass, type QuotaState } from '../../src/domain/live/quota';
import { nextOffWindowCheckAt, planTick, type ScheduledSource } from '../../src/domain/live/schedule';

const cfg = LIVE_DEFAULTS;
const caller: CallerContext = { envClass: 'production', adapter: 'fake' };
const IDS_PER_EVENT = 10;
const HOUR = 60 * 60_000;
/** Whole-night simulations take seconds; the default 5 s is too tight on a loaded machine. */
const SIM_TIMEOUT_MS = 60_000;

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
  }, SIM_TIMEOUT_MS);
});

/**
 * SPEC-21a NFR-1: the busiest night with the stream sources wave on top — every schedule event with a chain cut to
 * `maxSourcesPerEvent` by `chainFull`, `maxWatchedChannels` channels spread over the event zones (uploads refresh,
 * playlist reads by `playlistDue`, one lawful search each by `searchDue`), the `candidates` class asked every tick up
 * to its ceiling, ad-hoc to its ceiling. Every call passes `allow` first. Budget [А2]: day 1 ≤ 7 422, day 2 ≤ 2 472.
 */
describe('NFR-1 of SPEC-21a — sources wave within the [А2] budget', () => {
  const BUDGET: Record<string, number> = { '2026-12-31': 7_422, '2027-01-01': 2_472 };

  interface WaveDay extends DayResult {
    statuses: number;
    playlists: number;
    candidates: number;
    searches: number;
  }

  function simulateWave(): { days: WaveDay[]; perEvent: number[]; searches: number; refused: number } {
    // Chains: ten would-be sources per event, admitted only while the ceiling allows.
    const chains = new Map<string, { videoId: string }[]>();
    for (const e of events) {
      const chain: { videoId: string }[] = [];
      for (let i = 0; i < IDS_PER_EVENT; i++) if (!chainFull(chain, cfg)) chain.push({ videoId: `${e.eventId}~${i}` });
      chains.set(e.eventId, chain);
    }
    const polled: ScheduledSource[] = [...chains].flatMap(([eventId, c]) => c.map((s) => ({ eventId, videoId: s.videoId, nextOffWindowCheckAt: null })));
    const n = new Set(polled.map((s) => s.videoId)).size;

    const zoneIds = [...new Set(events.map((e) => e.zoneId))];
    const channels = Array.from({ length: cfg.maxWatchedChannels }, (_, i) => {
      const zone = zoneIds[i % zoneIds.length]!;
      const zm = events.filter((e) => e.zoneId === zone).map((e) => ({ eventId: e.eventId, moment: e.moment }));
      const c: WatchChannel & { lastSearchAt: number | null } = { state: 'watched', uploadsPlaylistId: null, uploadsFetchedAt: null, lastPlaylistAt: null, lastSearchAt: null };
      return { c, zm, moments: [...new Set(zm.map((z) => z.moment))] };
    });

    const firstOpen = Math.min(...events.map((e) => e.moment)) - cfg.windowBeforeMs;
    const lastClose = Math.max(...events.map((e) => e.moment)) + cfg.windowAfterMs;
    let start = firstOpen;
    while (quotaDay(start - cfg.tickMs, cfg.dayTimeZone) === quotaDay(firstOpen, cfg.dayTimeZone)) start -= cfg.tickMs;
    const end = nextDayBoundary(lastClose, cfg.dayTimeZone);

    let state: QuotaState = {};
    const days = new Map<string, WaveDay>();
    let searches = 0;
    let refused = 0;
    const call = (cls: QuotaClass, now: number, calls = 1): boolean => {
      if (!allow(state, cls, now, cfg, caller, calls).ok) return false;
      state = chargeCalls(state, cls, calls, now, cfg).state;
      return true;
    };
    for (let now = start; now < end; now += cfg.tickMs) {
      const day = quotaDay(now, cfg.dayTimeZone);
      const d = days.get(day) ?? { day, used: 0, formula: 0, statuses: 0, playlists: 0, candidates: 0, searches: 0 };
      days.set(day, d);
      const plan = planTick(events, polled, now, cfg);
      const open = new Set(events.filter((e) => now >= e.moment - cfg.windowBeforeMs && now < e.moment + cfg.windowAfterMs).map((e) => e.eventId));
      d.formula += Math.ceil(new Set(polled.filter((s) => open.has(s.eventId)).map((s) => s.videoId)).size / cfg.batchSize);

      const windowCalls = Math.ceil(plan.windowIds.length / cfg.batchSize);
      const offCalls = plan.batches.length - windowCalls;
      if (windowCalls && !call('statuses', now, windowCalls)) refused += 1;
      if (offCalls && !call('off-window', now, offCalls)) refused += 1;
      d.statuses += windowCalls;
      const checked = new Set([...plan.windowIds, ...plan.offWindowIds]);
      for (const s of polled) if (checked.has(s.videoId)) s.nextOffWindowCheckAt = nextOffWindowCheckAt(now, cfg);
      call('ad-hoc', now);
      if (call('candidates', now)) d.candidates += 1;

      if ((now - start) % cfg.watchPassMs === 0) {
        for (const ch of channels) {
          if (refreshDue(ch.c, now, cfg) && call('playlists', now)) {
            ch.c.uploadsPlaylistId = 'UU';
            ch.c.uploadsFetchedAt = now;
            d.playlists += 1;
          }
          if (playlistDue(ch.c, ch.moments, now, cfg) && call('playlists', now)) {
            ch.c.lastPlaylistAt = now;
            d.playlists += 1;
          }
          if (searchDue(ch.c, ch.zm, () => false, now, cfg) && call('search', now)) {
            ch.c.lastSearchAt = now;
            d.searches += 1;
            searches += 1;
          }
        }
      }
      d.used = counterOf(state, 'queries', now, cfg).used;
    }
    const r = Math.ceil(n / cfg.batchSize) * (24 * HOUR / cfg.offWindowMinMs);
    for (const d of days.values()) d.formula += r + cfg.adHocCeiling + Math.min(cfg.classCeilings.playlists, d.playlists) + cfg.classCeilings.candidates;
    return { days: [...days.values()], perEvent: [...chains.values()].map((c) => c.length), searches, refused };
  }

  it('297 events × 3 ids, 100 channels, candidates and ad-hoc to their ceilings, 100 searches: each day ≤ 8 000 and within [А2]', () => {
    expect(events).toHaveLength(297);
    const { days, perEvent, searches, refused } = simulateWave();
    // Open-window and off-window statuses are never refused.
    expect(refused).toBe(0);
    if (process.env.T2F_NFR1_REPORT) console.info('NFR-1 SPEC-21a', JSON.stringify(days));
    // The ten-ids case is cut to the ceiling by chainFull.
    expect(new Set(perEvent)).toEqual(new Set([cfg.maxSourcesPerEvent]));
    expect(days.map((d) => d.day)).toEqual(['2026-12-31', '2027-01-01']);
    expect(searches).toBe(cfg.maxWatchedChannels);
    for (const d of days) {
      expect(d.used, d.day).toBeLessThanOrEqual(cfg.alarmRatio * cfg.buckets.queries.perDay);
      expect(d.used, d.day).toBeLessThanOrEqual(BUDGET[d.day]!);
      expect(Math.abs(d.used - d.formula), d.day).toBeLessThanOrEqual(d.formula / 100);
      expect(d.searches, d.day).toBeLessThanOrEqual(cfg.buckets.search.perDay);
      expect(d.candidates, d.day).toBe(cfg.classCeilings.candidates);
      expect(d.playlists, d.day).toBeLessThanOrEqual(cfg.classCeilings.playlists);
    }
  }, SIM_TIMEOUT_MS);
});
