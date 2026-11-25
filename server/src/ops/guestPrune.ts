/**
 * Guest cleanup (SPEC-10 W41, AC-5), ring 3 — ports only, wall clock. Hourly under the lease `ops-auth`: guests with
 * no session activity for 30 days (at most 500 per run) are exported through every subject-data handler; a guest is
 * deleted with its sessions only when no handler except `auth` returned anything for it. A failed export keeps the
 * guest (retried next hour); deletion goes through Better Auth's internal adapter (the store re-checks staleness).
 * The job walks the stale guests with a keyset cursor (oldest first) and starts over only after a short batch, so
 * guests kept for other data never starve the rest (S10-09).
 */
import { GUEST_PRUNE_BATCH, holdsOtherData, isStale, staleBefore } from '../domain/auth/guestPrune';
import type { SubjectDataResult } from '../platform/subjectData';
import type { Logger } from '../ports';
import type { OpsLease } from './ports';

export const GUEST_PRUNE_EVERY_MS = 3_600_000;
/** Longer than the run period: the holder renews it every hour. */
const LEASE_TTL_MS = 90 * 60_000;

export type GuestPruneOutcome = { result: 'idle' | 'not-held' } | { result: 'pruned'; removed: number; kept: number; failed: number };

export interface GuestPruneJob {
  run(now: number): Promise<GuestPruneOutcome>;
  release(): Promise<void>;
}

/** The sign-in side of the job (`auth/subjectData.ts` `createAuthGuestStore`). */
export interface GuestPruneStore {
  /** Stale guests ordered by (last activity, id), strictly after `after` (an earlier row's `cursor`) when given. */
  staleGuests(beforeMs: number, limit: number, after?: string): Promise<{ id: string; lastActiveAtMs: number; cursor?: string }[]>;
  deleteIfStale(id: string, beforeMs: number): Promise<boolean>;
}

export interface GuestPruneJobDeps {
  lease: OpsLease;
  guests: GuestPruneStore;
  /** `export` of one subject across the subject-data registry (inside the auth scope). */
  exportSubject(subjectId: string): Promise<SubjectDataResult>;
  /** The capability whose own data does not keep a guest. */
  ownCapability: string;
  log: Logger;
}

export function createGuestPruneJob(deps: GuestPruneJobDeps): GuestPruneJob {
  let lastRunAt: number | undefined;
  /** Where the next run continues; reset after a batch shorter than the limit (the walk wrapped). */
  let cursor: string | undefined;
  return {
    async run(now) {
      if (lastRunAt !== undefined && Math.abs(now - lastRunAt) < GUEST_PRUNE_EVERY_MS) return { result: 'idle' };
      if (!(await deps.lease.acquire('ops-auth', LEASE_TTL_MS))) return { result: 'not-held' };
      lastRunAt = now;
      const before = staleBefore(now);
      let removed = 0;
      let kept = 0;
      let failed = 0;
      const batch = await deps.guests.staleGuests(before, GUEST_PRUNE_BATCH, cursor);
      cursor = batch.length < GUEST_PRUNE_BATCH ? undefined : batch[batch.length - 1]?.cursor;
      for (const guest of batch) {
        if (!isStale(guest.lastActiveAtMs, now)) continue;
        const exported = await deps.exportSubject(guest.id).catch(() => null);
        if (exported === null || !exported.ok) {
          failed += 1;
          continue;
        }
        if (holdsOtherData(exported.results, deps.ownCapability)) {
          kept += 1;
          continue;
        }
        if (await deps.guests.deleteIfStale(guest.id, before)) removed += 1;
      }
      if (failed > 0) deps.log.warn({ event: 'auth-guest-prune', outcome: 'export-failed', failed });
      return { result: 'pruned', removed, kept, failed };
    },
    async release() {
      await deps.lease.release('ops-auth').catch(() => {});
    },
  };
}
