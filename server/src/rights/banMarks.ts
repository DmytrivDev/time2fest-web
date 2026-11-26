/**
 * Daily-fingerprint marks of bans (SPEC-11 W17; FR-ID-17; AC-23 … AC-26, NFR-5, EC-10, EC-11). Redis only (the
 * `FastStore` port), every key with a TTL to the next 00:00 UTC of the fingerprint clock (the same `deps.clock` the
 * day salts use), so a key never outlives the fingerprint it holds. Keys hold the `fp:<hmac>` fingerprint and
 * subject ids only — never an address; nothing here reaches the database.
 * - `ban:sfp:<subject>:<fp>` — "this subject was seen on this fingerprint today" (`setIfAbsent`: one round trip per
 *   request; the first sighting also writes `ban:fp:<subject>` and lets the caller check the ban once).
 * - `ban:fp:<subject>` — the subject's latest fingerprint of the day (marked at once by `ban()`).
 * - `ban:ipday:<fp>` — the instant the fingerprint was first marked by a ban (the earliest stays).
 * - `ban:guestfp:<guestId>` — `{fp, at}` of the guest's creation.
 * Values carry their instant; a value of another UTC day is ignored (the test clock moves without Redis expiring).
 * Errors of the store propagate; callers decide (isBlocked → DB only; the middleware → swallow).
 */
import { nextUtcMidnight } from '../domain/rights/blocked';
import { utcDay } from '../platform/fingerprint';
import type { FastStore } from '../ports';

/** Only a real address fingerprint is marked; the no-address bucket is shared by everyone without an address. */
export const isFingerprint = (fp: string): boolean => fp.startsWith('fp:');

const ttlOf = (now: number): number => Math.max(1, nextUtcMidnight(now) - now);

export interface BanMarks {
  /** Remembers the subject's fingerprint of the day; true on the first sighting of this pair today. */
  rememberSubjectFp(subject: string, fp: string, now: number): Promise<boolean>;
  /** The subject's latest fingerprint of today, or `null`. */
  subjectFp(subject: string, now: number): Promise<string | null>;
  /** Marks the fingerprint as banned from `bannedAt` until the next 00:00 UTC (the earliest mark stays). */
  markFp(fp: string, bannedAt: number, now: number): Promise<void>;
  /** The ban instant on the fingerprint today, or `null`. */
  ipDayMark(fp: string, now: number): Promise<number | null>;
  /** Removes the fingerprint's mark (unban). */
  clearFp(fp: string): Promise<void>;
  rememberGuestFp(guestId: string, fp: string, now: number): Promise<void>;
  /** The guest's creation fingerprint and instant of today, or `null`. */
  guestFp(guestId: string, now: number): Promise<{ fp: string; at: number } | null>;
}

const sameDay = (a: number, b: number): boolean => utcDay(a) === utcDay(b);

/** `<ms>|<fp>` → parts (fingerprints never contain `|`). */
function split(value: string | null): { at: number; rest: string } | null {
  if (value === null) return null;
  const i = value.indexOf('|');
  const at = Number(i < 0 ? value : value.slice(0, i));
  if (!Number.isFinite(at)) return null;
  return { at, rest: i < 0 ? '' : value.slice(i + 1) };
}

export function createBanMarks(fast: () => FastStore): BanMarks {
  return {
    async rememberSubjectFp(subject, fp, now) {
      if (!isFingerprint(fp)) return false;
      const ttl = ttlOf(now);
      const first = await fast().setIfAbsent(`ban:sfp:${subject}:${fp}`, String(now), ttl);
      if (first) await fast().set(`ban:fp:${subject}`, `${now}|${fp}`, ttl);
      return first;
    },
    async subjectFp(subject, now) {
      const v = split(await fast().get(`ban:fp:${subject}`));
      return v !== null && sameDay(v.at, now) && isFingerprint(v.rest) ? v.rest : null;
    },
    async markFp(fp, bannedAt, now) {
      if (!isFingerprint(fp)) return;
      const key = `ban:ipday:${fp}`;
      const old = split(await fast().get(key));
      // A mark of another day is stale (its fingerprint is gone): replace it.
      if (old !== null && sameDay(old.at, now) && old.at <= bannedAt) return;
      await fast().set(key, String(bannedAt), ttlOf(now));
    },
    async ipDayMark(fp, now) {
      if (!isFingerprint(fp)) return null;
      const v = split(await fast().get(`ban:ipday:${fp}`));
      return v !== null && sameDay(v.at, now) ? v.at : null;
    },
    async clearFp(fp) {
      await fast().del(`ban:ipday:${fp}`);
    },
    async rememberGuestFp(guestId, fp, now) {
      if (!isFingerprint(fp)) return;
      await fast().set(`ban:guestfp:${guestId}`, `${now}|${fp}`, ttlOf(now));
    },
    async guestFp(guestId, now) {
      const v = split(await fast().get(`ban:guestfp:${guestId}`));
      return v !== null && sameDay(v.at, now) && isFingerprint(v.rest) ? { fp: v.rest, at: v.at } : null;
    },
  };
}
