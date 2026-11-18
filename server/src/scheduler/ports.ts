/**
 * Ports of the moment scheduler (SPEC-07 AC-24 … AC-48, C5, C6), ring 2: technology-neutral.
 * The Postgres adapter implements the lease and run stores, the catalog adapter the moment source;
 * the scheduler loop (ring 3) depends only on these.
 */
import type { SeasonInput, SeasonMoment } from '@time2fest/rules/time';
import type { ActionRule, LateRule } from '../domain/scheduler/plan';
import type { EnvClass } from '../platform/env';
import type { Logger } from '../ports';

export type { LateRule, SeasonInput, SeasonMoment };

/** Answer of one acquire/renew (C6); the store measures time by the database's `now()`. */
export interface LeaseGrant {
  held: boolean;
  /** Fencing epoch of the lease row (grows on every takeover). */
  epoch: number;
  /** Remaining term by the database clock; 0 when not held. */
  expiresInMs: number;
  /** On a takeover: the holder that let the lease expire (AC-48). */
  previousHolder?: string;
}

/** The single scheduler lease (AC-42). Throws `DependencyUnavailable` when the store is down. */
export interface LeaseStore {
  /** Takes a free or expired lease, or renews the one `holderId` holds. */
  acquireOrRenew(holderId: string): Promise<LeaseGrant>;
  /** Lets the lease go at once (graceful stop); only when `holderId` still holds `epoch`. */
  release?(holderId: string, epoch: number): Promise<void>;
}

/** Settled statuses never run again in the same run epoch. */
export type RunFinalStatus = 'done' | 'skipped' | 'failed';

export interface ClaimInput {
  leaseEpoch: number;
  holder: string;
  runEpoch: number;
  action: string;
  /** The group's not-yet-settled moment keys being run. */
  keys: readonly string[];
  consequenceId: string;
  /** Server instant of the group. */
  plannedAt: number;
  /** Server instant the run starts. */
  startedAt: number;
}

/**
 * - `claimed` — the `started` rows are written under a valid lease epoch: run the action;
 * - `stale`   — the lease epoch is no longer current: do not run (AC-45);
 * - `done`    — every pair is already settled: nothing to do.
 */
export type ClaimResult = 'claimed' | 'stale' | 'done';

export interface FinishInput {
  leaseEpoch: number;
  holder: string;
  runEpoch: number;
  action: string;
  keys: readonly string[];
  status: RunFinalStatus;
  /** `skipped`/`failed`: the late reason (`LateSkipReason`) or the error code. */
  reason?: string;
  consequenceId?: string;
  plannedAt: number;
  finishedAt: number;
}

/** What the run store knows about one run epoch. Pair keys are `pairKey(action, momentKey)`. */
export interface RunLedger {
  /** Pairs with a settled status (done, skipped, failed). */
  settled: ReadonlySet<string>;
  /** Pairs left `started` (a crash between publishing and `done`) → their consequence id (AC-29). */
  started: ReadonlyMap<string, string>;
}

/** Exactly-once bookkeeping per (runEpoch, action, momentKey) (AC-27, AC-45). */
export interface RunStore {
  /** One transaction: checks `holder` + `leaseEpoch` against the live lease, then marks the pairs `started` (never over a settled pair). */
  claim(input: ClaimInput): Promise<ClaimResult>;
  /**
   * Same lease check, then sets the final status; creates rows that were never claimed (a skip).
   * A settled pair is never overwritten. `stale` when the lease epoch is no longer current.
   */
  finish(input: FinishInput): Promise<'finished' | 'stale'>;
  ledger(runEpoch: number): Promise<RunLedger>;
  /** Pairs skipped or failed with `finishedAt` in the 24 h before `serverNow` (festival slice). */
  missed24h(serverNow: number): Promise<{ skipped: number; failed: number }>;
}

/** The catalog input of `seasonMoments` (events with their patched moments, zones by tzdb). */
export interface MomentSource {
  load(): Promise<SeasonInput>;
}

/** C5 `group`: one call of an action for every moment of the group (AC-30). */
export interface MomentActionGroup {
  action: string;
  /** Server instant of the group. */
  at: number;
  /** Moments to act on, C1 order (late-skipped ones removed). */
  moments: readonly SeasonMoment[];
  /** C4; the action must be idempotent by it (AC-29). */
  consequenceId: string;
  /** Server time at the start of the run: the action never reads a clock itself. */
  now: number;
  /** Lateness of the group in server time. */
  lateMs: number;
  runEpoch: number;
}

/** What the scheduler hands an action besides its group. */
export interface ActionContext {
  cls: EnvClass;
  log: Logger;
}

/**
 * C5 — one row of the moment-action registry (`registries/moments.ts`). A feature adds exactly one
 * such row. `run` throws (or rejects) on failure; the scheduler retries ≥1 s apart while the late
 * rule allows (AC-40).
 */
export interface MomentActionRow extends ActionRule {
  /** Owning capability (wave), for the journal and review. */
  capability: string;
  classes?: readonly EnvClass[];
  run(group: MomentActionGroup, ctx: ActionContext): Promise<void>;
}
