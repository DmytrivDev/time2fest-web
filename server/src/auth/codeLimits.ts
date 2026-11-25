/**
 * Limits of the sign-in code request (SPEC-10 W23, [П-8], [А4], AC-8 … AC-10, AC-40, NFR-4, NFR-7, EC-1, EC-7).
 * - `admitCode` READS the 5-per-10-min windows (email hash, `ipDay`, IPv6 /48) and the 10-per-UTC-day email counter,
 *   then CLAIMS the 30 s gap atomically (`setIfAbsent`, EC-1: of two parallel requests one gets `wait`).
 * - `commitCode` counts the code only after the mail outcome; `releaseCode` frees the gap when both providers failed,
 *   so the retry is neither `wait` nor counted (AC-40, [А8]).
 * - Redis unreachable → `unavailable` (NFR-4): the code request never runs without limits.
 * - The no-address bucket (`noaddr:<day>`, EC-7) is shared by every client without an edge address, so the address
 *   windows are skipped for it; the email limits still apply (Better Auth's own limiter stays a safety net).
 * Keys hold the email's sha256 only, never the address; nothing here logs.
 */
import type { ApiError } from '@time2fest/contracts';
import { msToUtcMidnight, utcDayKey } from '../domain/mail/day';
import { checkKeyedLimit, peekKeyedLimit, type LimitStores, type RateLimitRow } from '../platform/rateLimit';
import { DependencyUnavailable } from '../ports';
import { rateLimitRegistry } from '../registries/rateLimits';

/** Minimum gap between two codes for one email (AC-8). */
export const CODE_GAP_MS = 30_000;
/** Codes per email per UTC day (AC-10, NFR-7). */
export const CODE_DAY_LIMIT = 10;

export interface CodeLimitKeys {
  /** `emailKey` (sha256 hex) of the normalized address. */
  email: string;
  ipDay: string;
  ip48Day: string;
}

export type CodeLimitResult = { ok: true } | { ok: false; error: ApiError };

const gapKey = (email: string) => `auth:gap:${email}`;
const dayKey = (email: string, nowMs: number) => `auth:day:${email}:${utcDayKey(new Date(nowMs))}`;

function row(key: string): RateLimitRow {
  const found = rateLimitRegistry.find((r) => r.key === key);
  if (!found) throw new Error(`rate-limits: missing row ${key}`);
  return found;
}

/** The keyed windows of one request, in check order (the address windows only for a real address). */
function windows(keys: CodeLimitKeys): [RateLimitRow, string][] {
  const out: [RateLimitRow, string][] = [[row('auth-code-email'), keys.email]];
  if (!keys.ipDay.startsWith('noaddr:')) out.push([row('auth-code-ip'), keys.ipDay]);
  if (!keys.ip48Day.startsWith('noaddr:')) out.push([row('auth-code-ip48'), keys.ip48Day]);
  return out;
}

const tooMany = (retryAfterMs: number): CodeLimitResult => ({
  ok: false,
  error: { code: 'rate_limited', reason: 'too-many', retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)) },
});
const unavailable: CodeLimitResult = { ok: false, error: { code: 'unavailable' } };

async function storeCall<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (err instanceof DependencyUnavailable) return { ok: false };
    throw err;
  }
}

/** Peeks every limit, then claims the 30 s gap. `ok` means the code may be issued and sent. */
export async function admitCode(stores: LimitStores, keys: CodeLimitKeys, nowMs: number): Promise<CodeLimitResult> {
  for (const [r, key] of windows(keys)) {
    const verdict = await peekKeyedLimit(r, key, stores, nowMs);
    if (!verdict.ok) return verdict.error.code === 'rate_limited' ? tooMany(verdict.error.retryAfterMs ?? r.windowMs) : unavailable;
  }
  const day = await storeCall(() => stores.fast.get(dayKey(keys.email, nowMs)));
  if (!day.ok) return unavailable;
  if (Number(day.value ?? '0') >= CODE_DAY_LIMIT) return tooMany(msToUtcMidnight(new Date(nowMs)));

  const until = String(nowMs + CODE_GAP_MS);
  const claimed = await storeCall(() => stores.fast.setIfAbsent(gapKey(keys.email), until, CODE_GAP_MS));
  if (!claimed.ok) return unavailable;
  if (claimed.value) return { ok: true };
  const held = await storeCall(() => stores.fast.get(gapKey(keys.email)));
  if (!held.ok) return unavailable;
  const retryAfterMs = held.value === null ? 1 : Math.max(1, Math.min(CODE_GAP_MS, Number(held.value) - nowMs));
  return { ok: false, error: { code: 'rate_limited', reason: 'wait', retryAfterMs } };
}

/**
 * Counts an issued code in every window and the day counter. Throws `DependencyUnavailable` when Redis fails after
 * the mail went out (the caller logs it and still answers; the gap key already holds the 30 s).
 */
export async function commitCode(stores: LimitStores, keys: CodeLimitKeys, nowMs: number): Promise<void> {
  for (const [r, key] of windows(keys)) {
    const verdict = await checkKeyedLimit(r, key, stores, nowMs);
    if (!verdict.ok && verdict.error.code === 'unavailable') throw new DependencyUnavailable('redis');
  }
  await stores.fast.incrWindow(dayKey(keys.email, nowMs), msToUtcMidnight(new Date(nowMs)));
}

/** Frees the 30 s gap of a code that was not delivered (AC-40); a store failure is swallowed (the gap expires). */
export async function releaseCode(stores: LimitStores, keys: CodeLimitKeys): Promise<void> {
  await storeCall(() => stores.fast.del(gapKey(keys.email)));
}
