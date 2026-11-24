/**
 * The `streams.candidate` journal row (SPEC-21a NFR-6), ring 3: one builder for every writer — the sources services,
 * the sources watch and the status poller (AC-10). `revertOne` of the sources depends on exactly this shape.
 * Imports neither `sources.ts` nor `poller.ts` (sources imports the poller), so both can use it without a cycle.
 */
import type { Actor, Journal } from '../audit/ports';
import type { StoredCandidate, Tx } from './ports';

export const STREAMS_CANDIDATE_ACTION = 'streams.candidate';
export const CANDIDATES_COLLECTION = 'stream-candidates';

/** The journalled view of a candidate: the fields a revert restores. */
export const candidateView = (c: Pick<StoredCandidate, 'videoId' | 'state' | 'reason' | 'eventId' | 'foundBy'>) => ({
  videoId: c.videoId,
  state: c.state,
  reason: c.reason ?? null,
  eventId: c.eventId ?? null,
  foundBy: [...c.foundBy],
});

/** Appends one `streams.candidate` row in `tx`: `before` → `after` (plus `extra` in `after`, e.g. an agent note). */
export async function journalCandidate(
  journal: Journal,
  tx: Tx,
  row: { actor: Actor; at: number; before: StoredCandidate | null; after: StoredCandidate; revertOf: string | null; extra?: Record<string, unknown> },
): Promise<void> {
  await journal.append(tx, {
    actor: row.actor,
    action: STREAMS_CANDIDATE_ACTION,
    target: { collection: CANDIDATES_COLLECTION, id: row.after.videoId },
    at: row.at,
    before: row.before ? candidateView(row.before) : null,
    after: { ...candidateView(row.after), ...(row.extra ?? {}) },
    revertOf: row.revertOf,
  });
}
