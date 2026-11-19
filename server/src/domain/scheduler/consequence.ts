/**
 * Consequence ids of moment actions (SPEC-07 C4, AC-28, AC-29), ring 1: pure, no clock.
 *
 * `<actionKey>:<runEpoch>:<digest>` where `digest` is the first 16 hex characters of
 * sha256 over the group's moment keys, deduplicated and sorted by code unit, joined by `\n`.
 * Moment keys carry no time (C1), so neither a patch that moves a moment nor the instant the
 * action runs at changes the id; only the action, the run epoch and the set of keys do.
 */
import { createHash } from 'node:crypto';

/** Hex characters of the digest kept in the id. */
export const CONSEQUENCE_DIGEST_HEX = 16;

/** The (action, moment) pair as one string: the unit of exactly-once bookkeeping. */
export function pairKey(action: string, momentKey: string): string {
  return `${action}|${momentKey}`;
}

/** Keys deduplicated and sorted by code unit (locale-independent). */
export function sortedKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** C4: deterministic id of the consequence of `action` for the group `keys` in `runEpoch`. */
export function consequenceId(action: string, runEpoch: number, keys: readonly string[]): string {
  if (keys.length === 0) throw new Error('scheduler: a consequence needs at least one moment key');
  const digest = createHash('sha256').update(sortedKeys(keys).join('\n')).digest('hex').slice(0, CONSEQUENCE_DIGEST_HEX);
  return `${action}:${runEpoch}:${digest}`;
}

/**
 * The id to use for a (re)run of `action` over the not-yet-settled `keys` (AC-29). When every key
 * already has a `started` row with one and the same consequence id (a crash after publishing),
 * that id is reused, even if the group shrank since (a key skipped by its late rule, a patch that
 * moved one moment away); otherwise the id is computed from the keys.
 */
export function consequenceFor(
  action: string,
  runEpoch: number,
  keys: readonly string[],
  started: ReadonlyMap<string, string> = new Map(),
): string {
  let reused: string | undefined;
  for (const key of keys) {
    const id = started.get(pairKey(action, key));
    if (id === undefined || (reused !== undefined && id !== reused)) {
      reused = undefined;
      break;
    }
    reused = id;
  }
  return reused ?? consequenceId(action, runEpoch, keys);
}

/**
 * Run epoch of the production class (plan Assumptions, C4: one epoch per season): the starting
 * year of the season key `YYYY-YY` (`2026-27` → 2026). Test and rehearsal take the clock-state
 * `runEpoch` instead.
 */
export function seasonRunEpoch(seasonKey: string): number {
  const match = /^(\d{4})-\d{2}$/.exec(seasonKey);
  if (!match?.[1]) throw new Error(`scheduler: season key ${JSON.stringify(seasonKey)} is not YYYY-YY`);
  return Number(match[1]);
}
