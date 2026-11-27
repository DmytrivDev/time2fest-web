/**
 * The path of a chat author as the card shows it (SPEC-14 [А14]; AC-50, AC-51, AC-53), ring 1, pure.
 * Order of the rules: the viewer's own path always (`hidden: false`); a blocked author → hidden; no pass → nothing and not
 * hidden (the path is not shown at all, EC-15); a pass and `showPath` off → hidden; otherwise the points. Points are the
 * stamps of the current season (`planned: false`, in the order given) and the author's scheduled events whose midnight is
 * after `now` and that have no stamp (`planned: true`, by midnight then id) [Q1].
 */
import type { AuthorPathResponse } from '@time2fest/contracts';

export interface AuthorPathInput {
  /** The viewer is the author (same subject). */
  own: boolean;
  blocked: boolean;
  hasPass: boolean;
  showPath: boolean;
  /** Event ids of the author's stamps of the current season, in display order. */
  stampedEventIds: readonly string[];
  /** The author's schedule joined with the catalog: event id and effective midnight (ms). */
  scheduled: readonly { eventId: string; momentMs: number }[];
  now: number;
}

/** The most points a path carries (the wire schema's limit). */
export const AUTHOR_PATH_MAX_POINTS = 512;

export function pointsOf(stamped: readonly string[], scheduled: readonly { eventId: string; momentMs: number }[], now: number): AuthorPathResponse['points'] {
  const seen = new Set(stamped);
  const points: AuthorPathResponse['points'] = stamped.map((eventId) => ({ eventId, planned: false }));
  const future = scheduled
    .filter((e) => e.momentMs > now && !seen.has(e.eventId))
    .sort((a, b) => a.momentMs - b.momentMs || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  for (const e of future) {
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    points.push({ eventId: e.eventId, planned: true });
  }
  return points.slice(0, AUTHOR_PATH_MAX_POINTS);
}

export function authorPathOf(input: AuthorPathInput): AuthorPathResponse {
  if (input.own) return { points: pointsOf(input.stampedEventIds, input.scheduled, input.now), hidden: false };
  if (input.blocked) return { points: [], hidden: true };
  if (!input.hasPass) return { points: [], hidden: false };
  if (!input.showPath) return { points: [], hidden: true };
  return { points: pointsOf(input.stampedEventIds, input.scheduled, input.now), hidden: false };
}
