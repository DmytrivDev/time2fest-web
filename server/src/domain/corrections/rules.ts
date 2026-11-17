/**
 * Rules of an event correction (AC-59 … AC-62), ring 1 — pure.
 *
 * A correction is kept apart from the catalog's base values (AC-62): a stored patch holds only what the
 * owner changed, and the effective value of a field is the patch value, else the base value.
 *
 * - `restrained` needs the `uk` note (the only language of the note), 1 … 200 characters; the note is
 *   plain text, stored verbatim (no trimming, no markup handling): whoever renders it escapes it (AC-59);
 * - a save carries the event's correction version it was based on; an older one is `changed-since` (AC-61);
 * - there is NO time-window rule: the festival night accepts corrections like any other time (AC-60).
 */
import type { SiteEventPatch } from '@time2fest/contracts';

export const NOTE_MAX = 200;

/** Why a correction is refused. `unknown-event`: an event id the catalog does not have. */
export type CorrectionReason =
  | 'invalid-input'
  | 'unknown-event'
  | 'changed-since'
  | 'correction-out-of-range'
  | 'main-required'
  | 'warnings-not-confirmed';

/** What a correction may change on one event; an absent key leaves the field as it is. */
export interface PatchChange {
  /** Epoch ms; `null` drops the correction (back to the base moment). */
  moment?: number | null;
  /** `null` drops the correction (back to the base flag). */
  isMainCelebration?: boolean | null;
  /** On with its `uk` note, or `null` = off. */
  restrained?: { note?: unknown } | null;
  hidden?: boolean;
}

/** The stored correction of one event, without bookkeeping. */
export interface PatchState {
  moment: number | null;
  isMainCelebration: boolean | null;
  restrained: boolean;
  restrainedNote: string | null;
  hidden: boolean;
}

export const EMPTY_PATCH: PatchState = Object.freeze({
  moment: null,
  isMainCelebration: null,
  restrained: false,
  restrainedNote: null,
  hidden: false,
});

/** The catalog's own values of an event (never changed by a correction). */
export interface EventBase {
  eventId: string;
  countryIso: string;
  zoneId: string;
  /** `midnight`, `dawn`, …: only events of one slot share a main celebration. */
  slot: string;
  /** Epoch ms: the zone midnight for a `midnight` event, else its `startsAt`. */
  moment: number;
  isMainCelebration: boolean;
  /** The event zone's offset from UTC, for the local time of the preview; `null` when unknown. */
  offsetMinutes: number | null;
}

const CHANGE_KEYS: ReadonlySet<string> = new Set(['moment', 'isMainCelebration', 'restrained', 'hidden']);

/** The shape of one change: known keys only, each of its own type. */
export function isPatchChange(value: unknown): value is PatchChange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !CHANGE_KEYS.has(k))) return false;
  if ('moment' in v && v.moment !== null && !Number.isSafeInteger(v.moment)) return false;
  if ('isMainCelebration' in v && v.isMainCelebration !== null && typeof v.isMainCelebration !== 'boolean') return false;
  if ('hidden' in v && typeof v.hidden !== 'boolean') return false;
  if ('restrained' in v && v.restrained !== null) {
    const r = v.restrained;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return false;
    if (Object.keys(r).some((k) => k !== 'note')) return false;
  }
  return true;
}

/** AC-59: the restrained note is present, non-blank text of at most 200 characters. */
export function checkNote(change: PatchChange): 'ok' | 'invalid-input' {
  if (change.restrained === undefined || change.restrained === null) return 'ok';
  const note = change.restrained.note;
  if (typeof note !== 'string' || note.trim().length === 0 || note.length > NOTE_MAX) return 'invalid-input';
  return 'ok';
}

/**
 * One event's change against its stored correction: the shape, the note, and the version it was
 * based on (`expectedVersion`, the stored per-event version; 0 when the event has no correction yet).
 */
export function validatePatch(
  current: { version: number } | null,
  change: unknown,
  expectedVersion: unknown,
): 'ok' | 'invalid-input' | 'changed-since' {
  if (!isPatchChange(change) || checkNote(change) !== 'ok') return 'invalid-input';
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) return 'invalid-input';
  if ((expectedVersion as number) !== (current?.version ?? 0)) return 'changed-since';
  return 'ok';
}

/** The stored correction after `change`. */
export function applyChange(current: PatchState | null, change: PatchChange): PatchState {
  const next: PatchState = { ...(current ?? EMPTY_PATCH) };
  if (change.moment !== undefined) next.moment = change.moment;
  if (change.isMainCelebration !== undefined) next.isMainCelebration = change.isMainCelebration;
  if (change.restrained !== undefined) {
    next.restrained = change.restrained !== null;
    next.restrainedNote = change.restrained === null ? null : String(change.restrained.note);
  }
  if (change.hidden !== undefined) next.hidden = change.hidden;
  return next;
}

export function samePatch(a: PatchState | null, b: PatchState | null): boolean {
  const x = a ?? EMPTY_PATCH;
  const y = b ?? EMPTY_PATCH;
  return (
    x.moment === y.moment &&
    x.isMainCelebration === y.isMainCelebration &&
    x.restrained === y.restrained &&
    x.restrainedNote === y.restrainedNote &&
    x.hidden === y.hidden
  );
}

/** The wire form of a stored correction (`SiteEventPatch`, `packages/contracts/src/site.ts`); `null` when it changes nothing. */
export function toSitePatch(state: PatchState | null): SiteEventPatch | null {
  if (!state) return null;
  const out: { moment?: number; isMainCelebration?: boolean; restrained?: { note?: string }; hidden?: boolean } = {};
  if (state.moment !== null) out.moment = state.moment;
  if (state.isMainCelebration !== null) out.isMainCelebration = state.isMainCelebration;
  if (state.restrained) out.restrained = state.restrainedNote === null ? {} : { note: state.restrainedNote };
  if (state.hidden) out.hidden = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** The change that brings a correction back to `patch` (a revert restores a journalled `before`). */
export function changeRestoring(patch: SiteEventPatch | null): PatchChange {
  return {
    moment: patch?.moment ?? null,
    isMainCelebration: patch?.isMainCelebration ?? null,
    restrained: patch?.restrained ? { note: patch.restrained.note } : null,
    hidden: patch?.hidden ?? false,
  };
}

/** The values the event shows with a correction applied. */
export interface EffectiveEvent {
  moment: number;
  isMainCelebration: boolean;
  restrained: { note: string } | null;
  hidden: boolean;
}

export function effective(base: EventBase, state: PatchState | null): EffectiveEvent {
  const s = state ?? EMPTY_PATCH;
  return {
    moment: s.moment ?? base.moment,
    isMainCelebration: s.isMainCelebration ?? base.isMainCelebration,
    restrained: s.restrained ? { note: s.restrainedNote ?? '' } : null,
    hidden: s.hidden,
  };
}

/** `YYYY-MM-DD HH:mm` in the zone of the event (fixed offset of the season), or `null` without an offset. */
export function localTime(moment: number, offsetMinutes: number | null): string | null {
  if (offsetMinutes === null || !Number.isFinite(offsetMinutes)) return null;
  return new Date(moment + offsetMinutes * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}
