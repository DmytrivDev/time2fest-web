/**
 * Proof of presence outside Redis (SPEC-14 [А1], [А3], [П-3]; AC-3, AC-6, AC-7, AC-9, AC-12, AC-56), application ring.
 * Per in-window beat and event × moment:
 * - the fast-store marker `pr:mk:<season>:<event>:<moment>:<subject>` holds the best source so far (TTL 48 h);
 * - marker set now (`setIfAbsent`) → `INSERT … ON CONFLICT DO NOTHING` into `presence_proofs` BEFORE the beat is
 *   answered `ok` (AC-3); a failed insert removes the marker again (so the next beat retries) and the beat is
 *   `unavailable` — the proof must be in the database before `ok`;
 * - marker present with a lower source → the database row is upgraded first (only where its stored source is lower,
 *   AC-9), then the marker; a failed upgrade leaves the proof as it was (still `ok`, the next beat retries);
 * - the fast store fails (any error; `DependencyUnavailable` in practice) → the same conditional insert and upgrade
 *   straight in Postgres, answer `ok`, alarm `presence/fast-store-down` at most once a minute per node (AC-6);
 * - Postgres fails too → `unavailable` with `retryAfterMs: 5000`, the beat counts as failed (AC-7).
 * The beat's own counters (accepted / failed per node) are taken once per beat by `recordBeat`. Subject ids are written
 * only to the proof row and the marker key — never to a log or an alarm (NFR-5). Time comes from the caller's server
 * clock (NFR-8).
 */
import type { Alarm, FastStore } from '../ports';
import { sourceRank, sourcesBelow } from '../domain/presence/source';
import { assertDbWritable, presenceFaults, type PresenceFaultSwitch } from './faults';
import { PRESENCE_KEY_TTL_MS, type NodeIntake } from './intake';
import type { PresenceSourceName, ProofKey, ProofRow, ProofStore, RightsDb } from './ports';

/** `retryAfterMs` of a beat whose proof could not be written anywhere (AC-7). */
export const PROOF_RETRY_AFTER_MS = 5_000;
/** At most one `presence/fast-store-down` alarm per node in this span (AC-6). */
export const FAST_DOWN_ALARM_EVERY_MS = 60_000;

export const proofMarkerKey = (season: string, eventId: string, momentMs: number, subject: string): string =>
  `pr:mk:${season}:${eventId}:${momentMs}:${subject}`;

/** One proof to write: a subject seen in the window of one event moment. */
export interface ProofInput {
  subjectId: string;
  season: string;
  eventId: string;
  momentMs: number;
  /** Server-clock receipt time of the beat. */
  receivedAt: number;
  source: PresenceSourceName;
}

export type ProofWrite = 'inserted' | 'exists' | 'upgraded';
export type ProofOutcome =
  | { ok: true; proof: ProofWrite; via: 'fast' | 'db' }
  | { ok: false; retryAfterMs: number };

export type BeatProofOutcome = { ok: true; written: ProofWrite[] } | { ok: false; retryAfterMs: number };

export interface ProofWriter {
  /** Writes one proof (see the module rules). */
  record(input: ProofInput): Promise<ProofOutcome>;
  /**
   * Writes every proof of ONE beat (zero proofs for an out-of-window beat, AC-4) and counts the beat once: `accepted`
   * when every proof is safe, `failed` when any could not be written (AC-7).
   */
  recordBeat(inputs: readonly ProofInput[]): Promise<BeatProofOutcome>;
}

export interface ProofWriterDeps {
  db(): Promise<RightsDb>;
  fast(): FastStore;
  store: ProofStore;
  alarm: Alarm;
  clock: { now(): number };
  intake: NodeIntake;
  /** Id of this node (alarm details only). */
  nodeId: string;
  faults?: PresenceFaultSwitch;
}

const keyOf = (i: ProofInput): ProofKey => ({
  subject_id: i.subjectId,
  season: i.season,
  event_id: i.eventId,
  moment_ms: String(i.momentMs),
});

export function createProofWriter(deps: ProofWriterDeps): ProofWriter {
  const faults = deps.faults ?? presenceFaults;
  let lastFastAlarm = -Infinity;

  const unavailable = (): ProofOutcome => ({ ok: false, retryAfterMs: PROOF_RETRY_AFTER_MS });

  async function dbInsert(i: ProofInput): Promise<boolean> {
    assertDbWritable(faults);
    const db = await deps.db();
    return deps.store.insert(db, { ...keyOf(i), first_received_at: String(i.receivedAt), source: i.source });
  }

  async function dbUpgrade(i: ProofInput): Promise<boolean> {
    const lower = sourcesBelow(i.source);
    if (lower.length === 0) return false;
    assertDbWritable(faults);
    const db = await deps.db();
    return (await deps.store.upgradeSource(db, keyOf(i), i.source, lower)) > 0;
  }

  function alarmFastDown(): void {
    const now = deps.clock.now();
    if (now - lastFastAlarm < FAST_DOWN_ALARM_EVERY_MS) return;
    lastFastAlarm = now;
    deps.alarm.raise({ level: 'log', source: 'presence', code: 'presence/fast-store-down', details: { node: deps.nodeId } });
  }

  /** Fast store unreachable: the proof goes straight to Postgres, without duplicates. */
  async function viaDb(i: ProofInput): Promise<ProofOutcome> {
    alarmFastDown();
    try {
      if (await dbInsert(i)) return { ok: true, proof: 'inserted', via: 'db' };
      return { ok: true, proof: (await dbUpgrade(i)) ? 'upgraded' : 'exists', via: 'db' };
    } catch {
      return unavailable();
    }
  }

  async function record(i: ProofInput): Promise<ProofOutcome> {
    const key = proofMarkerKey(i.season, i.eventId, i.momentMs, i.subjectId);
    let fresh: boolean;
    let stored: string | null = null;
    try {
      if (faults.get().fastStore === 'down') throw new Error('fast store down (fault)');
      fresh = await deps.fast().setIfAbsent(key, i.source, PRESENCE_KEY_TTL_MS);
      if (!fresh) stored = await deps.fast().get(key);
    } catch {
      return viaDb(i);
    }

    if (fresh) {
      try {
        if (await dbInsert(i)) return { ok: true, proof: 'inserted', via: 'fast' };
      } catch {
        await deps.fast().del(key).catch(() => undefined);
        return unavailable();
      }
      // The row predates the marker (the fast store was restarted or flushed, AC-12): it may hold a lower source.
      try {
        return { ok: true, proof: (await dbUpgrade(i)) ? 'upgraded' : 'exists', via: 'fast' };
      } catch {
        await deps.fast().del(key).catch(() => undefined);
        return { ok: true, proof: 'exists', via: 'fast' };
      }
    }

    // A marker expired between `setIfAbsent` and `get` (or was deleted): treat as unknown and write conditionally.
    if (stored === null) {
      try {
        if (await dbInsert(i)) {
          await deps.fast().set(key, i.source, PRESENCE_KEY_TTL_MS).catch(() => undefined);
          return { ok: true, proof: 'inserted', via: 'fast' };
        }
      } catch {
        return unavailable();
      }
    }

    if (stored !== null && sourceRank(i.source) <= sourceRank(stored)) return { ok: true, proof: 'exists', via: 'fast' };
    try {
      const upgraded = await dbUpgrade(i);
      await deps.fast().set(key, i.source, PRESENCE_KEY_TTL_MS).catch(() => undefined);
      return { ok: true, proof: upgraded ? 'upgraded' : 'exists', via: 'fast' };
    } catch {
      // The proof exists with the lower source; the marker keeps the lower one so the next beat retries.
      return { ok: true, proof: 'exists', via: 'fast' };
    }
  }

  return {
    record,
    async recordBeat(inputs) {
      const written: ProofWrite[] = [];
      for (const i of inputs) {
        const out = await record(i);
        if (!out.ok) {
          deps.intake.failed();
          return out;
        }
        written.push(out.proof);
      }
      deps.intake.accepted();
      return { ok: true, written };
    },
  };
}

/** `presence_proofs` over `RightsDb` (raw SQL, [П-1]). */
export function createSqlProofStore(): ProofStore {
  return {
    async insert(db, row) {
      const res = await db.query(
        `INSERT INTO presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, source)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [row.subject_id, row.season, row.event_id, row.moment_ms, row.first_received_at, row.source],
      );
      return res.rowCount > 0;
    },
    async upgradeSource(db, key, source, lowerSources) {
      if (lowerSources.length === 0) return 0;
      const res = await db.query(
        `UPDATE presence_proofs SET source = $5
         WHERE subject_id = $1 AND season = $2 AND event_id = $3 AND moment_ms = $4 AND source = ANY($6::text[])`,
        [key.subject_id, key.season, key.event_id, key.moment_ms, source, [...lowerSources]],
      );
      return res.rowCount;
    },
    async touch(db, key, at) {
      await db.query(
        `UPDATE presence_proofs SET last_received_at = GREATEST(COALESCE(last_received_at, 0), $5)
         WHERE subject_id = $1 AND season = $2 AND event_id = $3 AND moment_ms = $4`,
        [key.subject_id, key.season, key.event_id, key.moment_ms, String(at)],
      );
    },
    async listForSubject(db, subjectId, season) {
      const res = await db.query<ProofRow & Record<string, unknown>>(
        `SELECT subject_id, season, event_id, moment_ms, first_received_at, last_received_at, source
         FROM presence_proofs WHERE subject_id = $1 AND season = $2 ORDER BY event_id, moment_ms`,
        [subjectId, season],
      );
      return res.rows;
    },
  };
}
