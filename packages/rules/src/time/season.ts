/**
 * Season moments (SPEC-07 AC-19…AC-22): every instant the clock server must fire, in a fixed order. Pure: no clock is
 * read, times come from the catalog input and the existing rule constants.
 */
import { CELEBRATION_LEAD, CELEBRATION_TAIL, HOWTO_BEFORE, POLL_WINDOW_AFTER, POLL_WINDOW_BEFORE, STAMP_DELAY } from './constants';
import { handoverMoment } from './event';
import { ratingCloseAt } from './bounds';
import type { Ms } from './types';

export type SeasonMomentKind =
  | 'celebration-start'
  | 'poll-start'
  | 'poll-end'
  | 'event-reminder'
  | 'pin-end'
  | 'zone-midnight'
  | 'event-moment'
  | 'event-stamp'
  | 'event-handover'
  | 'celebration-end'
  | 'rating-close';

export interface SeasonZoneInput {
  readonly zoneId: string;
  readonly midnightMs: Ms;
}

export interface SeasonEventInput {
  readonly eventId: string;
  readonly zoneId: string;
  readonly countryIso: string;
  /** Effective moment of the event (with the correction applied). */
  readonly momentMs: Ms;
  readonly sortIndex: number;
  readonly hidden?: boolean;
}

export interface SeasonInput {
  readonly seasonId: string;
  readonly zones: readonly SeasonZoneInput[];
  readonly events: readonly SeasonEventInput[];
}

export interface SeasonMoment {
  /** `<kind>:<zoneId|eventId|seasonId>`: no time in it, so a moment correction never changes it. */
  readonly key: string;
  readonly kind: SeasonMomentKind;
  readonly at: Ms;
  /** Tie rank at equal `at`: 1 handover and pin-end, 2 zone-midnight, 3 event-stamp, 4 the rest. */
  readonly rank: 1 | 2 | 3 | 4;
  /** Catalog order (`sortIndex`) for `event-stamp` (the only kind ordered by it), 0 otherwise. */
  readonly order: number;
  readonly zoneId?: string;
  readonly eventId?: string;
  readonly countryIso?: string;
  readonly hidden?: boolean;
}

/** Poll window of a zone: `[midnight − POLL_WINDOW_BEFORE; midnight + POLL_WINDOW_AFTER]`. */
export function pollWindow(midnightMs: Ms): { from: Ms; to: Ms } {
  return { from: midnightMs - POLL_WINDOW_BEFORE, to: midnightMs + POLL_WINDOW_AFTER };
}

/** All season moments sorted by `at`, then rank, then `order`, then key. No zones: nothing to enumerate. */
export function seasonMoments(input: SeasonInput): SeasonMoment[] {
  const { seasonId, zones, events } = input;
  if (zones.length === 0) return [];
  const out: SeasonMoment[] = [];
  let first = Infinity;
  let last = -Infinity;
  for (const z of zones) {
    if (z.midnightMs < first) first = z.midnightMs;
    if (z.midnightMs > last) last = z.midnightMs;
    const w = pollWindow(z.midnightMs);
    const base = { zoneId: z.zoneId, order: 0 } as const;
    out.push({ ...base, key: `poll-start:${z.zoneId}`, kind: 'poll-start', at: w.from, rank: 4 });
    out.push({ ...base, key: `poll-end:${z.zoneId}`, kind: 'poll-end', at: w.to, rank: 4 });
    out.push({ ...base, key: `zone-midnight:${z.zoneId}`, kind: 'zone-midnight', at: z.midnightMs, rank: 2 });
    out.push({ ...base, key: `pin-end:${z.zoneId}`, kind: 'pin-end', at: z.midnightMs, rank: 1 });
  }
  for (const e of events) {
    const base = {
      eventId: e.eventId,
      zoneId: e.zoneId,
      countryIso: e.countryIso,
      order: 0,
      ...(e.hidden === undefined ? {} : { hidden: e.hidden }),
    };
    out.push({ ...base, key: `event-reminder:${e.eventId}`, kind: 'event-reminder', at: e.momentMs - HOWTO_BEFORE, rank: 4 });
    out.push({ ...base, key: `event-moment:${e.eventId}`, kind: 'event-moment', at: e.momentMs, rank: 4 });
    out.push({ ...base, key: `event-stamp:${e.eventId}`, kind: 'event-stamp', at: e.momentMs + STAMP_DELAY, rank: 3, order: e.sortIndex });
    out.push({ ...base, key: `event-handover:${e.eventId}`, kind: 'event-handover', at: handoverMoment(e.momentMs), rank: 1 });
  }
  out.push({ key: `celebration-start:${seasonId}`, kind: 'celebration-start', at: first - CELEBRATION_LEAD, rank: 4, order: 0 });
  out.push({ key: `celebration-end:${seasonId}`, kind: 'celebration-end', at: last + CELEBRATION_TAIL, rank: 4, order: 0 });
  out.push({ key: `rating-close:${seasonId}`, kind: 'rating-close', at: ratingCloseAt({ zones }), rank: 4, order: 0 });
  return out.sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
