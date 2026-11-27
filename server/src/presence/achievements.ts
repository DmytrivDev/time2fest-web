/**
 * Passport achievements (SPEC-14 [A11], AC-38, AC-41, AC-43), application ring. After a fresh stamp the season's stamps
 * go through the rules' `achievementsOf`; every key not yet held is stored once with the time it was reached. Keys carry
 * the season (`goal:<season>:countries:3`), so a new season starts empty and an old season's rows stay. Nothing here
 * deletes an achievement (AC-43): a repeated run only adds what is missing, so a grant that failed after the stamp was
 * committed is caught up by the next one. Time is the server clock passed in (NFR-8).
 */
import { achievementsOf } from '@time2fest/rules/passport';
import type { AchievementRow, AchievementStore, RightsDb, StampRow } from './ports';

/** The catalog facts achievements need: the zone and country of an event and the order of a zone (`NaN` = unknown). */
export interface AchievementLookups {
  zoneOf(eventId: string): string;
  countryOf(eventId: string): string;
  orderOf(zoneId: string): number;
}

export interface AchievementServiceDeps {
  store: AchievementStore;
  /** The season's stamps of the subject. */
  stamps(db: RightsDb, subjectId: string, season: string): Promise<StampRow[]>;
}

export interface AchievementService {
  /** Stores the keys now reached and not yet held; returns the new ones (sorted). */
  grant(db: RightsDb, input: { subjectId: string; season: string; now: number; lookups: AchievementLookups }): Promise<string[]>;
}

export function createAchievementService(deps: AchievementServiceDeps): AchievementService {
  return {
    async grant(db, { subjectId, season, now, lookups }) {
      const rows = await deps.stamps(db, subjectId, season);
      const stamps = rows.map((r) => ({ eventId: r.event_id, countryIso: lookups.countryOf(r.event_id), zoneId: lookups.zoneOf(r.event_id) }));
      const keys = achievementsOf(stamps, lookups.orderOf, season);
      if (keys.length === 0) return [];
      return (await deps.store.grant(db, subjectId, season, keys, now)).sort();
    },
  };
}

/** `passport_achievements`; a key is held once per subject (primary key `subject_id, key`). */
export function createSqlAchievementStore(): AchievementStore {
  return {
    async grant(db, subjectId, season, keys, at) {
      if (keys.length === 0) return [];
      const res = await db.query<{ key: string }>(
        `INSERT INTO passport_achievements (subject_id, season, key, achieved_at)
         SELECT $1, $2, k, $4 FROM unnest($3::text[]) AS k
         ON CONFLICT DO NOTHING RETURNING key`,
        [subjectId, season, [...keys], String(at)],
      );
      return res.rows.map((r) => r.key);
    },
    async listForSubject(db, subjectId) {
      const res = await db.query<AchievementRow & Record<string, unknown>>(
        'SELECT subject_id, season, key, achieved_at FROM passport_achievements WHERE subject_id = $1 ORDER BY achieved_at, key',
        [subjectId],
      );
      return res.rows.map((r) => ({ subject_id: r.subject_id, season: r.season, key: r.key, achieved_at: String(r.achieved_at) }));
    },
  };
}
