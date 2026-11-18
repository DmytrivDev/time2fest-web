/**
 * The scheduler lease as seen by one process (SPEC-07 AC-42, AC-43, AC-46 … AC-48, C6), ring 1:
 * pure, every instant is a parameter.
 *
 * The term is real time only: the database grants it by its own `now()` (~6 s, renewed every ~2 s),
 * and the process trusts it only until `grantedAtMono + termMs − LEASE_SAFETY_MS` on its own
 * monotonic clock, counted from the moment the renew request was SENT (so network and database
 * delay only shorten the local term). Server (virtual) time never enters: speed and jumps of the
 * virtual clock cannot extend or shorten the lease.
 */

/** Lease term granted by the database. */
export const LEASE_TERM_MS = 6_000;
/** Renew period. */
export const LEASE_RENEW_MS = 2_000;
/** The process stops acting this long before the local term ends. */
export const LEASE_SAFETY_MS = 500;

export interface LeaseTerm {
  /** Monotonic instant the successful acquire/renew request was sent. */
  readonly grantedAtMono: number;
  /** Granted term in ms (≤ LEASE_TERM_MS). */
  readonly termMs: number;
}

/** AC-46, AC-47: true while the local term (minus the safety margin) has not run out. */
export function mayAct({ grantedAtMono, termMs, nowMono }: LeaseTerm & { readonly nowMono: number }): boolean {
  return nowMono >= grantedAtMono && nowMono < grantedAtMono + termMs - LEASE_SAFETY_MS;
}

export interface LeaseView extends LeaseTerm {
  /** The last answer of the store said this process holds the lease. */
  readonly held: boolean;
  /** Fencing epoch of the held lease; null before the first grant. */
  readonly epoch: number | null;
}

export const NO_LEASE: LeaseView = { held: false, epoch: null, grantedAtMono: 0, termMs: 0 };

/** What the lease store answered (`LeaseStore.acquireOrRenew`), or that it could not be reached. */
export type RenewOutcome =
  | { readonly ok: true; readonly held: boolean; readonly epoch: number; readonly expiresInMs: number; readonly previousHolder?: string }
  | { readonly ok: false };

export type LeaseChange =
  /** Became the holder (first grant or takeover): journal it (AC-48). */
  | 'acquired'
  /** Still the holder, same epoch. */
  | 'renewed'
  /** Was the holder, the store says someone else is now. */
  | 'lost'
  /** Not the holder before nor now. */
  | 'standby'
  /** The store could not be reached: the view is kept and its term runs out by itself (AC-46). */
  | 'unreachable';

export interface LeaseStep {
  readonly view: LeaseView;
  readonly change: LeaseChange;
  /** On `acquired`: who held it before (from the store) and the new epoch (AC-48). */
  readonly takeover?: { readonly previousHolder?: string; readonly epoch: number };
}

/** True while `view` is held and its local term allows acting at `nowMono`. */
export function holds(view: LeaseView, nowMono: number): boolean {
  return view.held && mayAct({ grantedAtMono: view.grantedAtMono, termMs: view.termMs, nowMono });
}

/** Next lease view after one acquire/renew attempt sent at `sentAtMono`. */
export function applyRenew(view: LeaseView, outcome: RenewOutcome, sentAtMono: number): LeaseStep {
  if (!outcome.ok) return { view, change: 'unreachable' };
  if (!outcome.held) {
    return { view: { ...NO_LEASE, epoch: view.epoch }, change: view.held ? 'lost' : 'standby' };
  }
  const next: LeaseView = {
    held: true,
    epoch: outcome.epoch,
    grantedAtMono: sentAtMono,
    termMs: Math.max(0, Math.min(LEASE_TERM_MS, outcome.expiresInMs)),
  };
  if (view.held && view.epoch === outcome.epoch) return { view: next, change: 'renewed' };
  const takeover = outcome.previousHolder === undefined ? { epoch: outcome.epoch } : { previousHolder: outcome.previousHolder, epoch: outcome.epoch };
  return { view: next, change: 'acquired', takeover };
}
