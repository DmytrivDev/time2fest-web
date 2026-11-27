/**
 * Creation time of a subject (`users.created_at`) for the established-subject rule of `beat-rate-drop` (SPEC-14
 * AC-17, S14-01), application ring. The value never changes, so it is cached per process (bounded; the cache is
 * dropped whole when full). The session fast path primes the cache from its `users` join (`prime`), so a beat
 * usually makes no query (S14-10). A miss reads `users` by its primary key (`id = $1::uuid`, the PK index); an id
 * that is not a uuid is never queried. An unknown subject or a failed read → `null` (not established), remembered
 * for `SUBJECT_AGE_NEGATIVE_MS` so a flood of first beats cannot repeat the read. The subject id only reaches the
 * query parameter — never a log (NFR-5).
 */
import { realClock } from '../clock';
import type { RightsDb } from './ports';

/** Entries kept before the cache is dropped and refilled. */
export const SUBJECT_AGE_CACHE_MAX = 200_000;
/** How long an unknown subject or a failed read is remembered as `null`. */
export const SUBJECT_AGE_NEGATIVE_MS = 30_000;
/** `users.id` is a uuid. */
export const USER_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SubjectAges {
  createdAt(subjectId: string): Promise<number | null>;
  /** A creation time already read elsewhere (the session fast path). */
  prime(subjectId: string, createdAtMs: number): void;
}

export function createSubjectAges(deps: { db(): Promise<RightsDb>; max?: number; now?: () => number }): SubjectAges {
  const max = deps.max ?? SUBJECT_AGE_CACHE_MAX;
  // A cache lifetime, not a presence decision: real time (the virtual test clock must not keep a miss forever).
  const now = deps.now ?? (() => realClock.now());
  const cache = new Map<string, number>();
  /** subject → until when `null` is answered without a read. */
  const negative = new Map<string, number>();

  const remember = (subjectId: string, ms: number): void => {
    if (cache.size >= max) cache.clear();
    cache.set(subjectId, ms);
    negative.delete(subjectId);
  };
  const forget = (subjectId: string): null => {
    if (negative.size >= max) negative.clear();
    negative.set(subjectId, now() + SUBJECT_AGE_NEGATIVE_MS);
    return null;
  };

  return {
    prime(subjectId, createdAtMs) {
      if (Number.isFinite(createdAtMs) && !cache.has(subjectId)) remember(subjectId, createdAtMs);
    },
    async createdAt(subjectId) {
      const hit = cache.get(subjectId);
      if (hit !== undefined) return hit;
      const until = negative.get(subjectId);
      if (until !== undefined) {
        if (until > now()) return null;
        negative.delete(subjectId);
      }
      if (!USER_ID_UUID.test(subjectId)) return forget(subjectId);
      let raw: unknown;
      try {
        const db = await deps.db();
        const res = await db.query<{ ms: number | string | null } & Record<string, unknown>>(
          'SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS ms FROM users WHERE id = $1::uuid',
          [subjectId],
        );
        raw = res.rows[0]?.ms;
      } catch {
        return forget(subjectId);
      }
      const ms = raw === null || raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(ms)) return forget(subjectId);
      remember(subjectId, ms);
      return ms;
    },
  };
}
