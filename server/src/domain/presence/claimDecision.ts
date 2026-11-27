/**
 * The stamp claim decision (SPEC-14 [А7], [А9], [П-6]; AC-11, AC-18, AC-24 … AC-29, AC-32 … AC-34, NFR-8), ring 1,
 * pure. Implements the spec's flowchart (`Module interactions`) in its order:
 *   stamp exists → ok (same stamp); after rating close + Δ → `conflict/claim-closed`; event not valid →
 *   `not_found/unknown-event`; server time before m + 15 s → `unavailable` until then; a proof in the current or an
 *   accepted old window → ok (`presence` / `old-moment`); a downtime over a window, or a window without a record past
 *   its deadline → ok (`downtime` / `old-moment`); a `healthy` record for every window → `forbidden/no-presence`;
 *   otherwise `unavailable` until the expected finalisation (1 000 … 30 000 ms).
 * S14-01: a `downtime` record whose ONLY sign is `beat-rate-drop` (and no downtime row over the window) grants only a
 * subject with pre-window evidence for the event; evidence known absent counts like a `healthy` record
 * (`no-presence`), evidence unknown (the store lost or cannot read it) → `unavailable` 5 000 ms — never `no-presence`
 * on uncertainty.
 * Inputs are server facts only: the client's `at` / `openedAt` and the pass are NOT part of the input type, so they
 * cannot change the outcome (AC-11, AC-34). `now` is passed in; nothing here reads a clock.
 */
import { stampGrantedAt, type PresenceSource } from '@time2fest/rules/time';
import { finaliseDueAt, missingRecordAt } from './healthSigns';
import { PRESENCE_DELTA_MS } from './window';

/** `retryAfterMs` when the database cannot be read or written (AC-26). */
export const CLAIM_DB_RETRY_MS = 5_000;
/** Bounds of `retryAfterMs` while a window's record is still expected (AC-26). */
export const CLAIM_RETRY_MIN_MS = 1_000;
export const CLAIM_RETRY_MAX_MS = 30_000;

export type ClaimGrantKind = 'presence' | 'downtime' | 'old-moment';

/** What the server knows about one accepted window of the event. */
export interface ClaimWindow {
  readonly moment: number;
  /** The best proof source of the subject in this window, `null` without a proof. */
  readonly proofSource: PresenceSource | null;
  /** The system health record of the window, `null` while none is written. */
  readonly record: 'healthy' | 'downtime' | null;
  /** A manual or edge-region downtime record applies to this window. */
  readonly downtime: boolean;
  /** The record's only sign is `beat-rate-drop` (S14-01). Absent → `false`. */
  readonly rateDropOnly?: boolean;
  /**
   * The subject beat this event in the window's pre span: `true` / `false` (the evidence is complete), `null` unknown.
   * Read only for a rate-drop-only window; absent → unknown.
   */
  readonly preEvidence?: boolean | null;
}

export interface ClaimInput {
  /** Server clock. */
  readonly now: number;
  /** The subject already holds a stamp for this event in the season. */
  readonly hasStamp: boolean;
  /** `ratingCloseAt` of the season (`Infinity` when the season has no zones). */
  readonly closeAt: number;
  /** The event's current (effective) moment when the event is valid ([А8]), else `null`. */
  readonly currentMoment: number | null;
  /** Every accepted window of the event (the current one included; older ones only until the celebration end). */
  readonly windows: readonly ClaimWindow[];
  /** The source of the claim body (used for a downtime grant, AC-29). */
  readonly source: PresenceSource;
}

export interface ClaimGrant {
  readonly kind: ClaimGrantKind;
  /** The moment of the window the grant is for. */
  readonly moment: number;
  /** `stampGrantedAt(moment)`. */
  readonly grantedAt: number;
  readonly presenceSource: PresenceSource;
  /** For `old-moment`: the journal pair (granted window's moment, current moment). */
  readonly oldMoment?: { readonly old: number; readonly current: number };
}

export type ClaimRefusal =
  | { readonly code: 'conflict'; readonly reason: 'claim-closed' }
  | { readonly code: 'not_found'; readonly reason: 'unknown-event' }
  | { readonly code: 'forbidden'; readonly reason: 'no-presence' }
  | { readonly code: 'unavailable'; readonly retryAfterMs: number };

export type ClaimDecision =
  | { readonly kind: 'existing' }
  | { readonly kind: 'grant'; readonly grant: ClaimGrant }
  | { readonly kind: 'refuse'; readonly error: ClaimRefusal };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A window counts as downtime: a `downtime` record, an applying downtime row, or no record past its deadline (AC-18). */
export function windowIsDowntime(w: ClaimWindow, now: number): boolean {
  return w.record === 'downtime' || w.downtime || (w.record === null && now >= missingRecordAt(w.moment));
}

/** A rate-drop-only downtime record with no downtime row over the window: it grants only with evidence (S14-01). */
export const needsEvidence = (w: ClaimWindow): boolean => w.record === 'downtime' && w.rateDropOnly === true && !w.downtime;

/** The window grants a downtime stamp to this subject. */
export function windowGrantsDowntime(w: ClaimWindow, now: number): boolean {
  if (!windowIsDowntime(w, now)) return false;
  return !needsEvidence(w) || w.preEvidence === true;
}

/** The window refuses this subject for good: `healthy`, or rate-drop-only with evidence known absent. */
const windowRefuses = (w: ClaimWindow): boolean =>
  !w.downtime && (w.record === 'healthy' || (needsEvidence(w) && w.preEvidence === false));

function grantFor(w: ClaimWindow, current: number, presenceSource: PresenceSource, kindAtCurrent: ClaimGrantKind): ClaimGrant {
  const atCurrent = w.moment === current;
  return {
    kind: atCurrent ? kindAtCurrent : 'old-moment',
    moment: w.moment,
    grantedAt: stampGrantedAt(w.moment),
    presenceSource,
    ...(atCurrent ? {} : { oldMoment: { old: w.moment, current } }),
  };
}

/** The current window first, then the old ones from the latest moment back. */
function byPreference(windows: readonly ClaimWindow[], current: number): ClaimWindow[] {
  return [...windows].sort((a, b) => (a.moment === current ? -1 : b.moment === current ? 1 : b.moment - a.moment));
}

/**
 * The cheap time-only steps of the decision for a subject WITHOUT a stamp (claim-closed, unknown-event, before
 * m + 15 s), in the flowchart's order. `null` → the windows are needed. The stamp check must run before this (S14-08:
 * callers skip the proof, downtime and health reads when this refuses).
 */
export function claimPrecheck(input: Pick<ClaimInput, 'now' | 'closeAt' | 'currentMoment'>): ClaimRefusal | null {
  const { now } = input;
  if (now > input.closeAt + PRESENCE_DELTA_MS) return { code: 'conflict', reason: 'claim-closed' };
  const current = input.currentMoment;
  if (current === null || !Number.isFinite(current)) return { code: 'not_found', reason: 'unknown-event' };
  const opensAt = stampGrantedAt(current);
  if (now < opensAt) return { code: 'unavailable', retryAfterMs: Math.max(1, opensAt - now) };
  return null;
}

export function claimDecision(input: ClaimInput): ClaimDecision {
  const { now } = input;
  if (input.hasStamp) return { kind: 'existing' };
  const early = claimPrecheck(input);
  if (early) return { kind: 'refuse', error: early };
  const current = input.currentMoment as number;

  const windows = byPreference(
    input.windows.some((w) => w.moment === current) ? input.windows : [...input.windows, { moment: current, proofSource: null, record: null, downtime: false }],
    current,
  );

  const proven = windows.find((w) => w.proofSource !== null);
  if (proven) return { kind: 'grant', grant: grantFor(proven, current, proven.proofSource as PresenceSource, 'presence') };

  const down = windows.find((w) => windowGrantsDowntime(w, now));
  if (down) return { kind: 'grant', grant: grantFor(down, current, input.source, 'downtime') };

  if (windows.every(windowRefuses)) return { kind: 'refuse', error: { code: 'forbidden', reason: 'no-presence' } };

  // Unknown evidence of a rate-drop-only window: the store answer is retried like a database read (AC-26).
  if (windows.some((w) => needsEvidence(w) && w.preEvidence !== true && w.preEvidence !== false)) {
    return { kind: 'refuse', error: { code: 'unavailable', retryAfterMs: CLAIM_DB_RETRY_MS } };
  }
  const due = Math.max(...windows.filter((w) => w.record === null).map((w) => finaliseDueAt(w.moment)));
  return { kind: 'refuse', error: { code: 'unavailable', retryAfterMs: clamp(due - now, CLAIM_RETRY_MIN_MS, CLAIM_RETRY_MAX_MS) } };
}
