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
  // ---- Stream sources (SPEC-21a) ----
  /** Chain ceiling: active sources (videoId, not dead, not hidden) per event ([А1], AC-23). */
  maxSourcesPerEvent: number;
  /** Channels in the `watched` state at most (AC-6). */
  maxWatchedChannels: number;
  /** Daily ceilings of the SPEC-21a request classes, in units, also charged to `queries` ([П-3], AC-24, AC-25). */
  classCeilings: { candidates: number; playlists: number };
  /** Uploads playlist read of a watched channel: every `playlistEveryMs` ([А4]) … */
  playlistEveryMs: number;
  /** … and every `playlistNearEveryMs` in `[moment − playlistNearBeforeMs; moment + playlistNearAfterMs)` of its zones. */
  playlistNearEveryMs: number;
  playlistNearBeforeMs: number;
  playlistNearAfterMs: number;
  /** Entries of the uploads playlist's first page read per call. */
  playlistPageSize: number;
  /** The uploads playlist id is refreshed through `channels.list` after this (AC-27). */
  channelRefreshMs: number;
  /** One lawful search per channel and zone moment in `[moment − searchFromMs; moment − searchToMs]` ([А5]). */
  searchFromMs: number;
  searchToMs: number;
  /** Approve writes the candidate's YouTube fields when its check is not older than this ([А9]). */
  candidateFreshMs: number;
  /** Default event of an approval: the channel zone's moment nearest to `scheduledStartTime` within ± this ([А8]). */
  defaultEventToleranceMs: number;
  /** Candidate YouTube fields older than this are refreshed (AC-46; never above `MAX_RETENTION_MS`). */
  candidateRefreshMs: number;
  /** Decided candidates unchanged this long go to `archive` (AC-46). */
  candidateArchiveMs: number;
  /** Stream-search agent limits per key and quota day ([А13]; per-minute limits live in `registries/rateLimits.ts`). */
  agent: { proposalsPerDay: number };
  /** Period of the sources watch pass ([П-4]). */
  watchPassMs: number;
}

/** The longest the YouTube fields may be kept (YouTube API Services policy, AC-73). */
export const MAX_RETENTION_MS = 30 * DAY;

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
  retentionMs: MAX_RETENTION_MS,
  rehearsalDailyUnits: 1_000,
  blackout: Object.freeze({ from: '12-29', to: '01-01' }),
  viewersMinPerCountry: 3,
  maxSourcesPerEvent: 3,
  maxWatchedChannels: 100,
  classCeilings: Object.freeze({ candidates: 300, playlists: 1_000 }),
  playlistEveryMs: 6 * HOUR,
  playlistNearEveryMs: 60 * MIN,
  playlistNearBeforeMs: 6 * HOUR,
  playlistNearAfterMs: 1 * HOUR,
  playlistPageSize: 50,
  channelRefreshMs: 30 * DAY,
  searchFromMs: 12 * HOUR,
  searchToMs: 2 * HOUR,
  candidateFreshMs: 5 * MIN,
  defaultEventToleranceMs: 3 * HOUR,
  candidateRefreshMs: MAX_RETENTION_MS,
  candidateArchiveMs: 30 * DAY,
  agent: Object.freeze({ proposalsPerDay: 300 }),
  watchPassMs: 60 * SEC,
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
    /** YouTube API Services policy: never above 30 days (security S12-03). */
    retentionMs: posInt.max(MAX_RETENTION_MS),
    rehearsalDailyUnits: nonNegInt,
    blackout: z.object({ from: monthDay, to: monthDay }).strict(),
    viewersMinPerCountry: posInt,
    maxSourcesPerEvent: posInt,
    maxWatchedChannels: nonNegInt,
    classCeilings: z.object({ candidates: nonNegInt, playlists: nonNegInt }).partial().strict(),
    playlistEveryMs: posInt,
    playlistNearEveryMs: posInt,
    playlistNearBeforeMs: nonNegInt,
    playlistNearAfterMs: nonNegInt,
    /** YouTube `playlistItems.list` maxResults is at most 50. */
    playlistPageSize: posInt.max(50),
    channelRefreshMs: posInt,
    searchFromMs: posInt,
    searchToMs: nonNegInt,
    candidateFreshMs: nonNegInt,
    defaultEventToleranceMs: nonNegInt,
    /** YouTube API Services policy: never above 30 days. */
    candidateRefreshMs: posInt.max(MAX_RETENTION_MS),
    candidateArchiveMs: posInt,
    agent: z.object({ proposalsPerDay: nonNegInt }).partial().strict(),
    watchPassMs: posInt,
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
    classCeilings: { ...d.classCeilings, ...o.classCeilings },
    agent: { ...d.agent, ...o.agent },
  };
  if (config.offWindowMinMs > config.offWindowMaxMs) return { ok: false, failing: ['T2F_LIVE_CONFIG.offWindowMinMs'] };
  if (config.searchToMs >= config.searchFromMs) return { ok: false, failing: ['T2F_LIVE_CONFIG.searchToMs'] };
  return { ok: true, config };
}
