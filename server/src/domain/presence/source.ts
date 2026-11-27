/**
 * Priority of presence sources (SPEC-14 AC-9), ring 1, pure. The order is the rules' own tie-break of
 * `presentEvents` (`@time2fest/rules/time`, `presence.ts:51`: country > room > air > tv); the rules module does not
 * export its table, so the order is read off `presentEvents` once instead of being copied here.
 */
import { PRESENCE_SOURCES } from '@time2fest/contracts';
import { presentEvents, type PresenceSource } from '@time2fest/rules/time';

const PROBE = 'probe';

/** The source the rules keep when `a` and `b` show the same event at its midnight. */
function winnerOf(a: PresenceSource, b: PresenceSource): PresenceSource {
  const surface = (source: PresenceSource) => ({ source, eventIds: [PROBE], openedAt: 0 });
  const out = presentEvents([surface(a), surface(b)], [{ id: PROBE, midnightUtc: '', midnightMs: 0 }], 0);
  return out[PROBE] ?? a;
}

/** Every known source, highest priority first. */
export const SOURCES_BY_PRIORITY: readonly PresenceSource[] = Object.freeze(
  [...PRESENCE_SOURCES].sort((a, b) => (a === b ? 0 : winnerOf(a, b) === a ? -1 : 1)),
);

export function isPresenceSource(s: string): s is PresenceSource {
  return (SOURCES_BY_PRIORITY as readonly string[]).includes(s);
}

/** Rank of a source: higher wins; an unknown source ranks below every known one. */
export function sourceRank(s: string): number {
  const i = (SOURCES_BY_PRIORITY as readonly string[]).indexOf(s);
  return i < 0 ? 0 : SOURCES_BY_PRIORITY.length - i;
}

/** The higher-priority of two sources (the first on a tie). */
export function higherSource<S extends string>(a: S, b: S): S {
  return sourceRank(b) > sourceRank(a) ? b : a;
}

/** Sources strictly below `s` (unknown names are not listed). */
export function sourcesBelow(s: string): PresenceSource[] {
  return SOURCES_BY_PRIORITY.filter((x) => sourceRank(x) < sourceRank(s));
}
