/**
 * The quota rule of one YouTube call (SPEC-12 AC-31, AC-34, AC-35; SPEC-21a AC-25), ring 3: charge the bucket (and
 * the class counter) before the request, so a failed call counts too; `live/quota-80` on the first crossing of the
 * alarm ratio; `quotaExceeded` stops the bucket until the quota day ends. Shared by the status poller (which keeps
 * its own batch bookkeeping on top), the sources services and the sources watch.
 */
import type { LiveConfig, QuotaBucket } from '../domain/live/config';
import { allow, nextDayBoundary, quotaDay, type CallerContext, type CeiledClass, type QuotaCounterKey, type QuotaRefusal } from '../domain/live/quota';
import type { Alarm, Clock } from '../ports';
import type { QuotaStore, VideoStatusError } from './ports';

const ALARM_SOURCE = 'live';

export interface QuotaCallDeps {
  quota: QuotaStore;
  alarm: Alarm;
  clock: Clock;
  cfg: LiveConfig;
  caller: CallerContext;
}

/** Charges one allowed call to `bucket` and, when given, to the class counter `cls`; raises the alarm-ratio page once. */
export async function chargeCall(
  deps: Pick<QuotaCallDeps, 'quota' | 'alarm' | 'cfg'>,
  day: string,
  bucket: QuotaBucket,
  cls: QuotaCounterKey | null,
  units: number,
  now: number,
): Promise<number> {
  const used = await deps.quota.charge(day, bucket, units);
  if (cls) await deps.quota.charge(day, cls, units);
  if (used >= deps.cfg.alarmRatio * deps.cfg.buckets[bucket].perDay && (await deps.quota.mark80(day, bucket, now))) {
    deps.alarm.raise({ level: 'page', source: ALARM_SOURCE, code: 'live/quota-80', details: { bucket } });
  }
  return used;
}

/** `quotaExceeded` from YouTube: the bucket stops until the quota day ends; one log line on the first mark. */
export async function stopBucket(deps: Pick<QuotaCallDeps, 'quota' | 'alarm' | 'cfg'>, day: string, bucket: QuotaBucket, now: number): Promise<void> {
  if (await deps.quota.markExceeded(day, bucket, nextDayBoundary(now, deps.cfg.dayTimeZone))) {
    deps.alarm.raise({ level: 'log', source: ALARM_SOURCE, code: 'live/quota-exceeded', details: { bucket } });
  }
}

export type CountedResult<T> = { ok: true; value: T } | { ok: false; refusal: QuotaRefusal | VideoStatusError | 'not-wired' };

/**
 * One YouTube call of a ceiled class or of `search`: allowed by the SPEC-12 rule, charged to its bucket (`queries`, or
 * `search` for a search) and to the class counter before the request (a failed call counts too), `live/quota-80` on
 * the first crossing, `quotaExceeded` stops that bucket until the quota day ends.
 */
export async function countedCall<T>(deps: QuotaCallDeps, cls: CeiledClass | 'search', call: () => Promise<T | { error: VideoStatusError }>): Promise<CountedResult<T>> {
  const { cfg } = deps;
  const now = deps.clock.now();
  const day = quotaDay(now, cfg.dayTimeZone);
  const decision = allow(await deps.quota.read(day), cls, now, cfg, deps.caller, 1);
  if (!decision.ok) return { ok: false, refusal: decision.reason };
  const bucket = decision.bucket;
  await chargeCall(deps, day, bucket, cls !== 'search' ? cls : null, decision.units, now);
  let result: T | { error: VideoStatusError };
  try {
    result = await call();
  } catch {
    return { ok: false, refusal: 'unavailable' };
  }
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error: VideoStatusError }).error;
    if (error === 'quota-exceeded') await stopBucket(deps, day, bucket, now);
    return { ok: false, refusal: error };
  }
  return { ok: true, value: result as T };
}
