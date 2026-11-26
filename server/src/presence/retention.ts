/**
 * Proof retention (SPEC-14 W33, [П-11], [А16]; AC-57): the ops job `presence-retention` deletes the proofs of presence
 * of a season once `now > ratingCloseAt(season) + 24 h`. The season is the catalog's current one (its zones give the
 * close); the job runs hourly for the months between that point and the next season's catalog, so no older season is
 * guessed at (season keys of tests are not ordered like real ones). Stamps, achievements, samples and health records stay (the latter hold no subject data). Hourly; time
 * is the `now` passed in (the wiring passes the server clock, NFR-8).
 */
import { ratingCloseAt } from '@time2fest/rules/time';
import type { RightsDb } from '../rights/ports';

export const PROOF_RETENTION_AFTER_CLOSE_MS = 24 * 3_600_000;
export const PRESENCE_RETENTION_EVERY_MS = 3_600_000;

export interface RetentionSeason {
  key: string | null;
  zones: readonly { midnightMs: number }[];
}

/** The season whose proofs are due for deletion at `now`, or null. Pure. */
export function proofRetentionDue(season: RetentionSeason, now: number): string | null {
  if (season.key === null) return null;
  const zones = season.zones.filter((z) => Number.isFinite(z.midnightMs));
  if (zones.length === 0) return null;
  return now > ratingCloseAt({ zones: [...zones] }) + PROOF_RETENTION_AFTER_CLOSE_MS ? season.key : null;
}

export type PresenceRetentionOutcome = { result: 'idle' | 'not-due' } | { result: 'pruned'; removed: number };

export interface PresenceRetentionJob {
  run(now: number): Promise<PresenceRetentionOutcome>;
}

export interface PresenceRetentionDeps {
  db(): Promise<RightsDb>;
  season(now: number): Promise<RetentionSeason>;
}

/** `run` deletes due proofs at most hourly; `runNow` skips the hourly gate (tests). */
export function createPresenceRetention(deps: PresenceRetentionDeps): PresenceRetentionJob & { runNow(now: number): Promise<PresenceRetentionOutcome> } {
  let lastRunAt: number | undefined;
  const runNow = async (now: number): Promise<PresenceRetentionOutcome> => {
    const due = proofRetentionDue(await deps.season(now), now);
    if (due === null) return { result: 'not-due' };
    const res = await (await deps.db()).query('DELETE FROM presence_proofs WHERE season = $1', [due]);
    return { result: 'pruned', removed: res.rowCount ?? 0 };
  };
  return {
    runNow,
    async run(now) {
      if (lastRunAt !== undefined && Math.abs(now - lastRunAt) < PRESENCE_RETENTION_EVERY_MS) return { result: 'idle' };
      lastRunAt = now;
      return runNow(now);
    },
  };
}
