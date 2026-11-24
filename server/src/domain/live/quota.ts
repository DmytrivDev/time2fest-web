/**
 * YouTube Data API quota rules (SPEC-12 AC-31 … AC-34, AC-36, AC-37, AC-40, AC-44, NFR-1), ring 1 — pure, time and
 * configuration are parameters.
 *
 * - The quota day is the calendar date in `dayTimeZone` (America/Los_Angeles: 01.01 starts at 08:00 UTC).
 * - Counters per day: `queries` (units), `search` (calls), `batchGetStats` (units) and `ad-hoc`, `candidates`,
 *   `playlists` (units, also charged to `queries`; each refused above its own daily ceiling, SPEC-21a [П-3]). A call is charged at least 1, failed or not (AC-31).
 * - Request classes, in queue order: open-window `statuses` → `ad-hoc` → `candidates` → `playlists` → `search`
 *   (→ `off-window`).
 *   While the `queries` remainder is below the reserve only `statuses` run (AC-32).
 * - A search over its daily ceiling is refused `quota-exhausted` before any request (AC-33).
 * - The first crossing of `alarmRatio` of a bucket in a day raises one `live/quota-80` `page` (AC-34).
 * - After `quotaExceeded` a bucket is stopped until the next day boundary.
 * - `rehearsal` with the real adapter: `rehearsalDailyUnits` per day and no call on the blackout days (AC-40).
 * - Stale statuses: `page` in an open window, `log` outside, after `staleMs` without a fresh check (AC-36).
 */
import type { LiveConfig, QuotaBucket } from './config';

/**
 * Queue order. The first five are FR-LIVE-12; `off-window` (the 6 h checks of AC-26 and the retention refresh) is not
 * named there and goes last: it is not an open-window status, so it also waits below the reserve.
 */
export const QUOTA_CLASSES = ['statuses', 'ad-hoc', 'candidates', 'playlists', 'search', 'off-window'] as const;
export type QuotaClass = (typeof QUOTA_CLASSES)[number];
/** Classes with their own daily ceiling counter, also charged to `queries` (SPEC-21a [П-3]). */
export const CEILED_CLASSES = ['candidates', 'playlists'] as const;
export type CeiledClass = (typeof CEILED_CLASSES)[number];
/** Counter keys: the three buckets plus the ad-hoc ceiling and the SPEC-21a class ceilings. */
export type QuotaCounterKey = QuotaBucket | 'ad-hoc' | CeiledClass;
export const QUOTA_COUNTER_KEYS: readonly QuotaCounterKey[] = ['queries', 'search', 'batchGetStats', 'ad-hoc', 'candidates', 'playlists'];

export interface QuotaCounter {
  /** Quota day `YYYY-MM-DD` the counter belongs to. */
  day: string;
  used: number;
  /** Epoch ms of this day's `live/quota-80`; `null` = not raised yet. */
  alarm80At: number | null;
  /** Epoch ms until which the bucket is stopped after `quotaExceeded`. */
  exceededUntil: number | null;
  /** Epoch minute of `minuteUsed`. */
  minute: number;
  minuteUsed: number;
}

export type QuotaState = Readonly<Partial<Record<QuotaCounterKey, QuotaCounter>>>;

export type QuotaRefusal =
  | 'quota-exceeded'
  | 'quota-exhausted'
  | 'reserve'
  | 'ad-hoc-ceiling'
  | 'class-ceiling'
  | 'rate-limited'
  | 'rehearsal-budget'
  | 'blackout';

export type QuotaDecision = { ok: true; bucket: QuotaBucket; units: number } | { ok: false; reason: QuotaRefusal };

export interface QuotaAlarm {
  code: 'live/quota-80';
  level: 'page';
  bucket: QuotaBucket;
  day: string;
}

/** Who runs the call: the environment class and the adapter (real only matters in `rehearsal`, AC-40). */
export interface CallerContext {
  envClass: 'test' | 'rehearsal' | 'production';
  adapter: 'fake' | 'real';
}

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const n = (k: string): number => p[k] ?? 0;
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), mi: n('minute'), s: n('second') };
}

/** Offset of `tz` from UTC at `ms`, in ms (local − UTC). */
function offsetAt(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  const local = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  const whole = new Date(ms);
  whole.setUTCMilliseconds(0);
  return local - whole.getTime();
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The quota day of an instant: its calendar date in `tz`. */
export function quotaDay(now: number, tz: string): string {
  const p = partsIn(now, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** The first instant of the quota day after the one of `now` (local midnight in `tz`, DST-safe). */
export function nextDayBoundary(now: number, tz: string): number {
  const p = partsIn(now, tz);
  const localMidnight = Date.UTC(p.y, p.mo - 1, p.d + 1);
  let guess = localMidnight - offsetAt(localMidnight, tz);
  guess = localMidnight - offsetAt(guess, tz);
  return guess;
}

/** The counter of `key` for the quota day of `now` (a counter of another day reads as fresh). */
export function counterOf(state: QuotaState, key: QuotaCounterKey, now: number, cfg: LiveConfig): QuotaCounter {
  const day = quotaDay(now, cfg.dayTimeZone);
  const minute = Math.floor(now / MINUTE_MS);
  const c = state[key];
  if (!c || c.day !== day) return { day, used: 0, alarm80At: null, exceededUntil: c?.exceededUntil ?? null, minute, minuteUsed: 0 };
  return c.minute === minute ? c : { ...c, minute, minuteUsed: 0 };
}

const bucketOf = (cls: QuotaClass): QuotaBucket => (cls === 'search' ? 'search' : 'queries');
const BUCKET_KEYS: Readonly<Record<QuotaBucket, true>> = { queries: true, search: true, batchGetStats: true };
const isBucket = (key: QuotaCounterKey): key is QuotaBucket => key in BUCKET_KEYS;
export const isCeiledClass = (cls: QuotaClass): cls is CeiledClass => (CEILED_CLASSES as readonly string[]).includes(cls);

function minuteLimit(bucket: QuotaBucket, cfg: LiveConfig): number {
  const b = cfg.buckets[bucket];
  return bucket === 'queries' ? Math.min(b.perMinute, cfg.buckets.queries.perUserPerMinute) : b.perMinute;
}

/** Units one call of a class costs in its bucket (`search` counts calls). */
export function unitsPerCall(cls: QuotaClass, cfg: LiveConfig): number {
  return cls === 'search' ? 1 : cfg.unitsPerListCall;
}

function inBlackout(now: number, cfg: LiveConfig): boolean {
  const d = new Date(now);
  const md = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const { from, to } = cfg.blackout;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** May `calls` calls of `cls` run now? Decided before any request (AC-32, AC-33, AC-40, AC-44). */
export function allow(state: QuotaState, cls: QuotaClass, now: number, cfg: LiveConfig, caller: CallerContext, calls = 1): QuotaDecision {
  const bucket = bucketOf(cls);
  const units = Math.max(1, calls) * unitsPerCall(cls, cfg);
  const counter = counterOf(state, bucket, now, cfg);
  if (counter.exceededUntil != null && now < counter.exceededUntil) return { ok: false, reason: 'quota-exceeded' };
  const queries = counterOf(state, 'queries', now, cfg);
  if (caller.envClass === 'rehearsal' && caller.adapter === 'real') {
    if (inBlackout(now, cfg)) return { ok: false, reason: 'blackout' };
    if (bucket === 'queries' && queries.used + units > cfg.rehearsalDailyUnits) return { ok: false, reason: 'rehearsal-budget' };
  }
  if (counter.used + units > cfg.buckets[bucket].perDay) return { ok: false, reason: 'quota-exhausted' };
  if (cls !== 'statuses' && cfg.buckets.queries.perDay - queries.used < cfg.reserve) return { ok: false, reason: 'reserve' };
  if (cls === 'ad-hoc' && counterOf(state, 'ad-hoc', now, cfg).used + units > cfg.adHocCeiling) {
    return { ok: false, reason: 'ad-hoc-ceiling' };
  }
  if (isCeiledClass(cls) && counterOf(state, cls, now, cfg).used + units > cfg.classCeilings[cls]) return { ok: false, reason: 'class-ceiling' };
  if (counter.minuteUsed + units > minuteLimit(bucket, cfg)) return { ok: false, reason: 'rate-limited' };
  return { ok: true, bucket, units };
}

/** The classes allowed now, in queue order (AC-32). */
export function allowedClasses(state: QuotaState, now: number, cfg: LiveConfig, caller: CallerContext): QuotaClass[] {
  return QUOTA_CLASSES.filter((cls) => allow(state, cls, now, cfg, caller).ok);
}

/** Pending requests in queue order (stable inside a class). */
export function inQueueOrder<R extends { cls: QuotaClass }>(requests: readonly R[]): R[] {
  const rank = (cls: QuotaClass) => QUOTA_CLASSES.indexOf(cls);
  return requests
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.cls) - rank(b.r.cls) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Charges `units` (at least 1, whether the call succeeded or not — AC-31) to `key` and returns the new state and,
 * on the first crossing of the alarm ratio in the day, one `live/quota-80` (AC-34).
 */
export function charge(
  state: QuotaState,
  key: QuotaCounterKey,
  units: number,
  now: number,
  cfg: LiveConfig,
): { state: QuotaState; alarm: QuotaAlarm | null } {
  const c = counterOf(state, key, now, cfg);
  const n = Math.max(1, Math.ceil(units));
  const next: QuotaCounter = { ...c, used: c.used + n, minuteUsed: c.minuteUsed + n };
  let alarm: QuotaAlarm | null = null;
  if (isBucket(key) && next.alarm80At == null && next.used >= cfg.alarmRatio * cfg.buckets[key].perDay) {
    next.alarm80At = now;
    alarm = { code: 'live/quota-80', level: 'page', bucket: key, day: c.day };
  }
  return { state: { ...state, [key]: next }, alarm };
}

/** Charges one class's calls: its bucket, plus its own counter for `ad-hoc`, `candidates` and `playlists`. */
export function chargeCalls(
  state: QuotaState,
  cls: QuotaClass,
  calls: number,
  now: number,
  cfg: LiveConfig,
): { state: QuotaState; alarm: QuotaAlarm | null } {
  const units = Math.max(1, calls) * unitsPerCall(cls, cfg);
  const charged = charge(state, bucketOf(cls), units, now, cfg);
  const own: QuotaCounterKey | null = cls === 'ad-hoc' || isCeiledClass(cls) ? cls : null;
  return own ? { state: charge(charged.state, own, units, now, cfg).state, alarm: charged.alarm } : charged;
}

/** After `quotaExceeded`: the bucket stops until the next quota day boundary (AC-35). */
export function markExceeded(state: QuotaState, bucket: QuotaBucket, now: number, cfg: LiveConfig): QuotaState {
  const c = counterOf(state, bucket, now, cfg);
  return { ...state, [bucket]: { ...c, exceededUntil: nextDayBoundary(now, cfg.dayTimeZone) } };
}

export type StaleLevel = 'page' | 'log';

/**
 * The stale-status rule (AC-36): no fresh check for longer than `staleMs` since `since` (the last fresh check, or
 * the moment the window opened) → `page` for an event in an open window, `log` outside; `null` while fresh.
 */
export function staleLevel(input: { inOpenWindow: boolean; since: number }, now: number, cfg: LiveConfig): StaleLevel | null {
  if (now - input.since <= cfg.staleMs) return null;
  return input.inOpenWindow ? 'page' : 'log';
}
