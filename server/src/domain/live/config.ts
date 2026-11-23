/**
 * Live configuration (SPEC-12 [А8], AC-37), ring 1 — pure. Every quota number of the wave lives here and only here
 * (`LIVE_DEFAULTS`, the owner's Google console figures of 21.11); the other live modules read them from a
 * `LiveConfig` parameter. `T2F_LIVE_CONFIG` (JSON, partial, deep) overrides any key through `parseLiveConfig`.
 * Messages name keys only, never values.
 */
import { POLL_WINDOW_AFTER, POLL_WINDOW_BEFORE } from '@time2fest/rules/time';
import { z } from 'zod';

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Quota buckets of the Google console (AC-31): `queries` counts units, `search` counts calls. */
export const QUOTA_BUCKETS = ['queries', 'search', 'batchGetStats'] as const;
export type QuotaBucket = (typeof QUOTA_BUCKETS)[number];

export interface BucketLimits {
  perDay: number;
  perMinute: number;
}

export interface LiveConfig {
  buckets: {
    /** General bucket: `videos.list` and other `list` calls. */
    queries: BucketLimits & { perUserPerMinute: number };
    /** `search.list` calls (SPEC-21a); never spent in this wave. */
    search: BucketLimits;
    /** `videos.batchGetStats`: shown in the admin slice only, never called. */
    batchGetStats: BucketLimits;
  };
  /** Units charged per `list` call. */
  unitsPerListCall: number;
  /** B: ids per `videos.list` call. */
  batchSize: number;
  /** T: poller tick. */
  tickMs: number;
  /** Poll window around the event moment: `[moment − before; moment + after)`. */
  windowBeforeMs: number;
  windowAfterMs: number;
  /** Daily ceiling of ad-hoc checks (player reports, replace), in units. */
  adHocCeiling: number;
  /** Below this remainder of `queries` only open-window statuses run. */
  reserve: number;
  /** Share of a bucket's day that raises `live/quota-80` once. */
  alarmRatio: number;
  /** Quota day time zone (resets at its midnight). */
  dayTimeZone: string;
  /** Long news window around the event moment: `[moment − before; moment + after)` (В3). */
  longNewsBeforeMs: number;
  longNewsAfterMs: number;
  /** Off-window checks: not more often than `min`, not less often than `max` (AC-26). */
  offWindowMinMs: number;
  offWindowMaxMs: number;
  /** `expected` without `startsAt` is published as `possible` this close to the moment (AC-28). */
  possibleBeforeMs: number;
  /** No fresh check for longer than this → `live/statuses-stale` (AC-36). */
  staleMs: number;
  /** A YouTube fetch older than this is not served (AC-74). */
  retentionMs: number;
  /** Daily units of the real adapter in `rehearsal` (AC-40). */
  rehearsalDailyUnits: number;
  /** UTC days (`MM-DD`, inclusive, may wrap the year) when the real adapter refuses every call in `rehearsal` (AC-40). */
  blackout: { from: string; to: string };
  /** Countries are listed from this many people (В2). */
  viewersMinPerCountry: number;
}

export const LIVE_DEFAULTS: LiveConfig = Object.freeze({
  buckets: Object.freeze({
    queries: Object.freeze({ perDay: 10_000, perMinute: 1_800_000, perUserPerMinute: 180_000 }),
    search: Object.freeze({ perDay: 100, perMinute: 100 }),
    batchGetStats: Object.freeze({ perDay: 10_000, perMinute: 600 }),
  }),
  unitsPerListCall: 1,
  batchSize: 50,
  tickMs: 30 * SEC,
  windowBeforeMs: POLL_WINDOW_BEFORE,
  windowAfterMs: POLL_WINDOW_AFTER,
  adHocCeiling: 500,
  reserve: 1_000,
  alarmRatio: 0.8,
  dayTimeZone: 'America/Los_Angeles',
  longNewsBeforeMs: 20 * MIN,
  longNewsAfterMs: 15 * MIN,
  offWindowMinMs: 6 * HOUR,
  offWindowMaxMs: 7 * DAY,
  possibleBeforeMs: 5 * MIN,
  staleMs: 2 * MIN,
  retentionMs: 30 * DAY,
  rehearsalDailyUnits: 1_000,
  blackout: Object.freeze({ from: '12-29', to: '01-01' }),
  viewersMinPerCountry: 3,
}) as LiveConfig;

const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();
const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const limits = { perDay: posInt, perMinute: posInt };

const OverrideSchema = z
  .object({
    buckets: z
      .object({
        queries: z.object({ ...limits, perUserPerMinute: posInt }).partial().strict(),
        search: z.object(limits).partial().strict(),
        batchGetStats: z.object(limits).partial().strict(),
      })
      .partial()
      .strict(),
    unitsPerListCall: posInt,
    batchSize: posInt,
    tickMs: posInt,
    windowBeforeMs: nonNegInt,
    windowAfterMs: posInt,
    adHocCeiling: nonNegInt,
    reserve: nonNegInt,
    alarmRatio: z.number().gt(0).lte(1),
    dayTimeZone: z.string().refine(isTimeZone),
    longNewsBeforeMs: nonNegInt,
    longNewsAfterMs: posInt,
    offWindowMinMs: posInt,
    offWindowMaxMs: posInt,
    possibleBeforeMs: nonNegInt,
    staleMs: posInt,
    retentionMs: posInt,
    rehearsalDailyUnits: nonNegInt,
    blackout: z.object({ from: monthDay, to: monthDay }).strict(),
    viewersMinPerCountry: posInt,
  })
  .partial()
  .strict();

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type LiveConfigResult = { ok: true; config: LiveConfig } | { ok: false; failing: string[] };

/** `LIVE_DEFAULTS` with the JSON override of `T2F_LIVE_CONFIG` merged in; empty or absent → the defaults. */
export function parseLiveConfig(json: string | undefined): LiveConfigResult {
  if (json === undefined || json.trim() === '') return { ok: true, config: LIVE_DEFAULTS };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, failing: ['T2F_LIVE_CONFIG'] };
  }
  const parsed = OverrideSchema.safeParse(raw);
  if (!parsed.success) {
    const keys = new Set(parsed.error.issues.map((i) => ['T2F_LIVE_CONFIG', ...i.path.map(String)].join('.')));
    return { ok: false, failing: [...keys].sort() };
  }
  const o = parsed.data;
  const d = LIVE_DEFAULTS;
  const config: LiveConfig = {
    ...d,
    ...o,
    buckets: {
      queries: { ...d.buckets.queries, ...o.buckets?.queries },
      search: { ...d.buckets.search, ...o.buckets?.search },
      batchGetStats: { ...d.buckets.batchGetStats, ...o.buckets?.batchGetStats },
    },
    blackout: { ...d.blackout, ...o.blackout },
  };
  if (config.offWindowMinMs > config.offWindowMaxMs) return { ok: false, failing: ['T2F_LIVE_CONFIG.offWindowMinMs'] };
  return { ok: true, config };
}
