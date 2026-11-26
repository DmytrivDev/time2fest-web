/**
 * Subject data of the passport (SPEC-14 W32, FR-PLAT-13; AC-55, AC-56): the row `stamps` of `registries/subjectData.ts`.
 * Like the rights rows, the handler holds no deps: `createPresenceSubjectData(db)` takes the database getter and
 * `registries/subjectData.ts` wires it to the auth scope (`requireSubjectDataDeps`), so callers run the registry through
 * `runSubjectDataInScope`.
 * - export: stamps of every season, achievements, proofs of presence and the old-moment journal of the subject, each a
 *   list (all empty → nothing held, the guest cleanup's emptiness rule);
 * - erase: deletes all four; anonymise = erase (a stamp without its subject means nothing).
 * The beat keys in Redis are the declarative row `presence-beats` (TTL ≤ 48 h), not this handler.
 */
import type { SubjectDataHandler } from '../platform/subjectData';
import type { RightsDb, RightsQuery } from '../rights/ports';

export const STAMPS_CAPABILITY = 'stamps';

export interface StampsSubjectExport {
  stamps: { season: string; eventId: string; grantedAt: number; presenceSource: string; grantKind: string; issuedAt: number }[];
  achievements: { season: string; key: string; achievedAt: number }[];
  proofs: { season: string; eventId: string; momentMs: number; firstReceivedAt: number; lastReceivedAt: number | null; source: string }[];
  oldMoments: { season: string; eventId: string; oldMomentMs: number; newMomentMs: number; at: number }[];
}

const num = (v: unknown): number => Number(v);

async function exportOf(db: RightsQuery, subjectId: string): Promise<StampsSubjectExport> {
  const [stamps, achievements, proofs, oldMoments] = await Promise.all([
    db.query<{ season: string; event_id: string; granted_at: string; presence_source: string; grant_kind: string; issued_at: string }>(
      'SELECT season, event_id, granted_at, presence_source, grant_kind, issued_at FROM stamps WHERE subject_id = $1 ORDER BY season, granted_at, event_id',
      [subjectId],
    ),
    db.query<{ season: string; key: string; achieved_at: string }>('SELECT season, key, achieved_at FROM passport_achievements WHERE subject_id = $1 ORDER BY season, achieved_at, key', [subjectId]),
    db.query<{ season: string; event_id: string; moment_ms: string; first_received_at: string; last_received_at: string | null; source: string }>(
      'SELECT season, event_id, moment_ms, first_received_at, last_received_at, source FROM presence_proofs WHERE subject_id = $1 ORDER BY season, event_id, moment_ms',
      [subjectId],
    ),
    db.query<{ season: string; event_id: string; old_moment_ms: string; new_moment_ms: string; at: string }>(
      'SELECT season, event_id, old_moment_ms, new_moment_ms, at FROM stamp_old_moment_log WHERE subject_id = $1 ORDER BY at, id',
      [subjectId],
    ),
  ]);
  return {
    stamps: stamps.rows.map((r) => ({
      season: r.season,
      eventId: r.event_id,
      grantedAt: num(r.granted_at),
      presenceSource: r.presence_source,
      grantKind: r.grant_kind,
      issuedAt: num(r.issued_at),
    })),
    achievements: achievements.rows.map((r) => ({ season: r.season, key: r.key, achievedAt: num(r.achieved_at) })),
    proofs: proofs.rows.map((r) => ({
      season: r.season,
      eventId: r.event_id,
      momentMs: num(r.moment_ms),
      firstReceivedAt: num(r.first_received_at),
      lastReceivedAt: r.last_received_at === null ? null : num(r.last_received_at),
      source: r.source,
    })),
    oldMoments: oldMoments.rows.map((r) => ({ season: r.season, eventId: r.event_id, oldMomentMs: num(r.old_moment_ms), newMomentMs: num(r.new_moment_ms), at: num(r.at) })),
  };
}

async function eraseOf(db: RightsDb, subjectId: string): Promise<{ removed: number }> {
  return db.tx(async (q) => {
    let removed = 0;
    for (const table of ['stamps', 'passport_achievements', 'presence_proofs', 'stamp_old_moment_log']) {
      removed += (await q.query(`DELETE FROM ${table} WHERE subject_id = $1`, [subjectId])).rowCount ?? 0;
    }
    return { removed };
  });
}

/** The registry row `stamps` over `db` (read per call: the caller resolves it from its scope). */
export function createPresenceSubjectData(db: () => Promise<RightsDb>): SubjectDataHandler {
  return {
    capability: STAMPS_CAPABILITY,
    export: async (id) => exportOf(await db(), id),
    erase: async (id) => eraseOf(await db(), id),
    anonymise: async (id) => eraseOf(await db(), id),
  };
}
