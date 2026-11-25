/**
 * Limits of the sign-in code request (SPEC-10 W23, [П-8], [А4], AC-8 … AC-10, AC-40, NFR-4, NFR-7, EC-1, EC-7).
 * - `admitCode` RESERVES one hit in every 5-per-10-min window (email key, device, `ipDay`, IPv6 /48) atomically
 *   (Redis INCR) before the send, so parallel requests from one client for different addresses cannot pass together
 *   (S10-01); a refused request gives its hits back. Then it reads the 10-per-UTC-day email counter and CLAIMS the
 *   30 s gap atomically (`setIfAbsent`, EC-1: of two parallel requests one gets `wait`).
 * - `commitCode` counts the day counter after the mail outcome; `releaseCode` frees the gap AND gives the reserved
 *   hits back when nothing was sent (both providers failed, AC-40, [А8]), so the retry is neither `wait` nor counted.
 * - Redis unreachable → `unavailable` (NFR-4): the code request never runs without limits.
 * - The no-address bucket (`noaddr:<day>`, EC-7) is shared by every client without an edge address, so the address
 *   windows are skipped for it; the email and device windows still apply (Better Auth's own limiter stays a safety net).
 * Keys hold the email's HMAC only (`AuthWiring.emailKey`), never the address; nothing here logs.
 */
import type { ApiError } from '@time2fest/contracts';
import { msToUtcMidnight, utcDayKey } from '../domain/mail/day';
import { checkKeyedLimit, releaseKeyedLimit, type LimitStores, type RateLimitRow } from '../platform/rateLimit';
import { DependencyUnavailable } from '../ports';
import { rateLimitRegistry } from '../registries/rateLimits';

/** Minimum gap between two codes for one email (AC-8). */
export const CODE_GAP_MS = 30_000;
/** Codes per email per UTC day (AC-10, NFR-7). */
export const CODE_DAY_LIMIT = 10;

export interface CodeLimitKeys {
  /** `AuthWiring.emailKey` (HMAC hex) of the normalized address. */
  email: string;
  /** The request's device id (`ctx.device`, EC-7). */
  device: string;
  ipDay: string;
  ip48Day: string;
}

export type CodeLimitResult = { ok: true } | { ok: false; error: ApiError };

/** Redis key of the 30 s gap of an email key (also the `auth-free-gap` test door). */
export const codeGapKey = (email: string) => `auth:gap:${email}`;
const dayKey = (email: string, nowMs: number) => `auth:day:${email}:${utcDayKey(new Date(nowMs))}`;

function row(key: string): RateLimitRow {
  const found = rateLimitRegistry.find((r) => r.key === key);
  if (!found) throw new Error(`rate-limits: missing row ${key}`);
  return found;
}

/** The keyed windows of one request, in check order (the address windows only for a real address). */
function windows(keys: CodeLimitKeys): [RateLimitRow, string][] {
  const out: [RateLimitRow, string][] = [[row('auth-code-email'), keys.email], [row('auth-code-device'), keys.device]];
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

/** Gives back the hits reserved in `taken` (best effort; a store failure leaves them to expire). */
async function giveBack(stores: LimitStores, taken: readonly [RateLimitRow, string][], nowMs: number): Promise<void> {
  for (const [r, key] of taken) await releaseKeyedLimit(r, key, stores, nowMs);
}

/** Reserves one hit in every window, reads the day counter, then claims the 30 s gap. `ok` = issue and send. */
export async function admitCode(stores: LimitStores, keys: CodeLimitKeys, nowMs: number): Promise<CodeLimitResult> {
  const taken: [RateLimitRow, string][] = [];
  const refuse = async (result: CodeLimitResult): Promise<CodeLimitResult> => {
    await giveBack(stores, taken, nowMs);
    return result;
  };
  for (const [r, key] of windows(keys)) {
    const verdict = await checkKeyedLimit(r, key, stores, nowMs);
    if (!verdict.ok) {
      if (verdict.error.code !== 'rate_limited') return refuse(unavailable);
      taken.push([r, key]); // the refused hit was counted too: give it back with the others
      return refuse(tooMany(verdict.error.retryAfterMs ?? r.windowMs));
    }
    taken.push([r, key]);
  }
  const day = await storeCall(() => stores.fast.get(dayKey(keys.email, nowMs)));
  if (!day.ok) return refuse(unavailable);
  if (Number(day.value ?? '0') >= CODE_DAY_LIMIT) return refuse(tooMany(msToUtcMidnight(new Date(nowMs))));

  const until = String(nowMs + CODE_GAP_MS);
  const claimed = await storeCall(() => stores.fast.setIfAbsent(codeGapKey(keys.email), until, CODE_GAP_MS));
  if (!claimed.ok) return refuse(unavailable);
  if (claimed.value) return { ok: true };
  const held = await storeCall(() => stores.fast.get(codeGapKey(keys.email)));
  if (!held.ok) return refuse(unavailable);
  const retryAfterMs = held.value === null ? 1 : Math.max(1, Math.min(CODE_GAP_MS, Number(held.value) - nowMs));
  return refuse({ ok: false, error: { code: 'rate_limited', reason: 'wait', retryAfterMs } });
}

/**
 * Counts an issued code in the day counter (the windows were reserved by `admitCode`). Throws
 * `DependencyUnavailable` when Redis fails after the mail went out (the caller logs it and still answers).
 */
export async function commitCode(stores: LimitStores, keys: CodeLimitKeys, nowMs: number): Promise<void> {
  await stores.fast.incrWindow(dayKey(keys.email, nowMs), msToUtcMidnight(new Date(nowMs)));
}

/** Frees only the 30 s gap (the outcome of the send is unknown); a store failure is swallowed. */
export async function releaseGap(stores: LimitStores, keys: CodeLimitKeys): Promise<void> {
  await storeCall(() => stores.fast.del(codeGapKey(keys.email)));
}

/**
 * A code that was not sent (both providers failed, AC-40, or Better Auth refused before the send): frees the 30 s
 * gap and gives back the window hits `admitCode` reserved with the same `nowMs`. Store failures are swallowed.
 */
export async function releaseCode(stores: LimitStores, keys: CodeLimitKeys, nowMs: number): Promise<void> {
  await storeCall(() => stores.fast.del(codeGapKey(keys.email)));
  await storeCall(() => giveBack(stores, windows(keys), nowMs));
}
