/**
 * Creation time of a subject (`users.created_at`) for the established-subject rule of `beat-rate-drop` (SPEC-14
 * AC-17, S14-01), application ring. The value never changes, so it is cached per process (bounded; the cache is
 * dropped whole when full). An unknown subject or a failed read → `null` (not established) and nothing is cached.
 * The subject id only reaches the query parameter — never a log (NFR-5).
 */
import type { RightsDb } from './ports';

/** Entries kept before the cache is dropped and refilled. */
export const SUBJECT_AGE_CACHE_MAX = 200_000;

export interface SubjectAges {
  createdAt(subjectId: string): Promise<number | null>;
}

export function createSubjectAges(deps: { db(): Promise<RightsDb>; max?: number }): SubjectAges {
  const max = deps.max ?? SUBJECT_AGE_CACHE_MAX;
  const cache = new Map<string, number>();
  return {
    async createdAt(subjectId) {
      const hit = cache.get(subjectId);
      if (hit !== undefined) return hit;
      const db = await deps.db();
      const res = await db.query<{ ms: number | string | null } & Record<string, unknown>>(
        'SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS ms FROM users WHERE id::text = $1',
        [subjectId],
      );
      const raw = res.rows[0]?.ms;
      const ms = raw === null || raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(ms)) return null;
      if (cache.size >= max) cache.clear();
      cache.set(subjectId, ms);
      return ms;
    },
  };
}
