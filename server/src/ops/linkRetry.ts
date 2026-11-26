/**
 * The guest-merge retry job `auth-link-retry` (SPEC-11 W29b, conductor decision 2; AC-49, AC-50), ring 3 — ports
 * only, wall clock. Hourly under the lease `ops-auth-link`: at most 100 due rows of `auth_link_retries`
 * (`next_at ≤ now`, attempts < 24) are taken (`FOR UPDATE SKIP LOCKED`, hidden for 10 min from other runs) and re-run:
 * success → the row is deleted (closed) and `afterClosed` re-checks the guest's removal; failure → attempts + 1,
 * `next_at` = now + 1 h, the error code; the 24th failure → one `log` alarm `auth/link-retry {handler, gaveUp:true}`
 * and the row stays as dead (still keeps its guest).
 */
import { gaveUp, LINK_RETRY_BATCH, LINK_RETRY_CLAIM_MS, LINK_RETRY_EVERY_MS, nextRetryAt, type LinkRetryRow } from '../domain/auth/linkRetry';
import type { Alarm, Logger } from '../ports';
import type { OpsLease } from './ports';

/** Longer than the run period: the holder renews it every hour. */
const LEASE_TTL_MS = 90 * 60_000;

export type LinkRetryOutcome = { result: 'idle' | 'not-held' } | { result: 'retried'; closed: number; failed: number; gaveUp: number };

export interface LinkRetryJob {
  run(now: number): Promise<LinkRetryOutcome>;
  release(): Promise<void>;
}

export interface LinkRetryStore {
  /** Takes due rows (`next_at ≤ nowMs`, attempts below the limit), hiding them until `hideUntilMs`. */
  takeDue(nowMs: number, hideUntilMs: number, limit: number): Promise<LinkRetryRow[]>;
  close(id: number): Promise<void>;
  reschedule(id: number, attempts: number, nextAtMs: number, errorCode: string): Promise<void>;
}

export interface LinkRetryJobDeps {
  lease: OpsLease;
  store: LinkRetryStore;
  /** Re-runs the row's work; throws on failure. */
  retry(row: LinkRetryRow): Promise<void>;
  /** After a closed row: the guest-removal re-check. Never fails the run. */
  afterClosed(row: LinkRetryRow): Promise<void>;
  errorCode(err: unknown): string;
  alarm: Alarm;
  log: Logger;
}

export function createLinkRetryJob(deps: LinkRetryJobDeps): LinkRetryJob {
  let lastRunAt: number | undefined;
  return {
    async run(now) {
      if (lastRunAt !== undefined && Math.abs(now - lastRunAt) < LINK_RETRY_EVERY_MS) return { result: 'idle' };
      if (!(await deps.lease.acquire('ops-auth-link', LEASE_TTL_MS))) return { result: 'not-held' };
      lastRunAt = now;
      let closed = 0;
      let failed = 0;
      let given = 0;
      for (const row of await deps.store.takeDue(now, now + LINK_RETRY_CLAIM_MS, LINK_RETRY_BATCH)) {
        try {
          await deps.retry(row);
        } catch (err) {
          const attempts = row.attempts + 1;
          failed += 1;
          await deps.store.reschedule(row.id, attempts, nextRetryAt(attempts, now), deps.errorCode(err));
          if (gaveUp(attempts)) {
            given += 1;
            deps.alarm.raise({ level: 'log', source: 'auth', code: 'auth/link-retry', details: { handler: row.handler, gaveUp: true } });
          }
          continue;
        }
        await deps.store.close(row.id);
        closed += 1;
        await deps.afterClosed(row).catch(() => deps.log.warn({ event: 'auth-link-retry', outcome: 'after-close-failed', handler: row.handler }));
      }
      return { result: 'retried', closed, failed, gaveUp: given };
    },
    async release() {
      await deps.lease.release('ops-auth-link').catch(() => {});
    },
  };
}
