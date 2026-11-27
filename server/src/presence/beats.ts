/**
 * The presence beat (SPEC-14 [А1]–[А3], [А15], [П-3], [П-4]; AC-1 … AC-9, AC-11), application ring. Per beat:
 * - only the beat's VALID events count (catalog of the current season, midnight slot, not hidden — AC-8); the rest
 *   are skipped silently and never reach `nextBeatMs`;
 * - each valid event's current moment is recorded in the moment book ([П-4]); the beat counts toward every accepted
 *   moment of the event whose window contains the SERVER receipt time (the client's `openedAt` never enters, AC-11);
 * - the intake counters of the health log are fed for every accepted moment (pre-window and in-window, AC-4, AC-17);
 *   a counter failure never fails the beat;
 * - the proofs are written through the proof writer, which counts the beat once (accepted / failed) and answers
 *   `unavailable` + 5 000 ms only when a proof could be written neither via the fast store nor Postgres (AC-3, AC-6,
 *   AC-7, AC-9);
 * - `nextBeatMs` follows [А2] over the current moments of the valid events (AC-2).
 * An injected beat error ([П-10], `beatErrorRate`) is answered like an unwritable proof and counted as failed.
 * Nothing here logs: subject ids stay in the proof rows and the fast-store keys (NFR-5).
 */
import type { PresenceSource } from '@time2fest/rules/time';
import { nextBeatMs } from '../domain/presence/beatSchedule';
import { validEvent, type PresenceCatalog, type PresenceEvent } from '../domain/presence/eventValidity';
import { phaseOf, windowsContaining, type SeasonZones } from '../domain/presence/window';
import { beatFails, presenceFaults, type PresenceFaultSwitch } from './faults';
import type { NodeIntake, WindowIntake } from './intake';
import type { MomentBook } from './moments';
import { PROOF_RETRY_AFTER_MS, type ProofInput, type ProofWriter } from './proofs';

/** The presence view of the catalog a beat is judged against. */
export interface PresenceCatalogView {
  catalog: PresenceCatalog;
  /** Zone midnights of the season (when old moments stop being accepted). */
  zones: SeasonZones;
}

export interface BeatInput {
  /** The session's subject (never from the body). */
  subjectId: string;
  eventIds: readonly string[];
  source: PresenceSource;
  /** Server-clock receipt time. */
  receivedAt: number;
}

export type BeatOutcome = { ok: true; nextBeatMs: number | null } | { ok: false; retryAfterMs: number };

export interface BeatService {
  beat(input: BeatInput): Promise<BeatOutcome>;
}

export interface BeatServiceDeps {
  catalog(now: number): Promise<PresenceCatalogView>;
  moments: MomentBook;
  proofs: ProofWriter;
  windows: WindowIntake;
  intake: NodeIntake;
  faults?: PresenceFaultSwitch;
  /**
   * The subject's creation time (ms) for the established-subject rule of `beat-rate-drop` (S14-01); read only when the
   * beat falls in some window's pre span. Absent or failing → `null` (not established, not counted).
   */
  subjectCreatedAt?(subjectId: string): Promise<number | null>;
  /** Uniform in [0, 1); only the injected beat error reads it. Absent → the switch's exact spread (`nextBeatFails`). */
  random?: () => number;
}

export function createBeatService(deps: BeatServiceDeps): BeatService {
  const faults = deps.faults ?? presenceFaults;
  const random = deps.random;

  return {
    async beat({ subjectId, eventIds, source, receivedAt }) {
      if (random ? beatFails(faults, random()) : faults.nextBeatFails()) {
        deps.intake.failed();
        return { ok: false, retryAfterMs: PROOF_RETRY_AFTER_MS };
      }
      try {
        const { catalog, zones } = await deps.catalog(receivedAt);
        const season = catalog.season;
        const valid: PresenceEvent[] = [];
        for (const id of new Set(eventIds)) {
          const e = validEvent(catalog, id);
          if (e) valid.push(e);
        }

        if (valid.length > 0) {
          await deps.moments.observe(season, valid.map((e) => ({ eventId: e.eventId, momentMs: e.momentMs })), receivedAt);
        }

        // Read once per beat, and only when some accepted moment is in its pre span (S14-01).
        let createdAt: Promise<number | null> | undefined;
        const createdAtOf = (): Promise<number | null> =>
          (createdAt ??= deps.subjectCreatedAt ? deps.subjectCreatedAt(subjectId).catch(() => null) : Promise.resolve(null));

        const proofs: ProofInput[] = [];
        // The intake counters never fail the beat and do not depend on the proofs: they run alongside the proof writes.
        const counting: Promise<boolean>[] = [];
        for (const e of valid) {
          const accepted = await deps.moments.accepted(season, e.eventId, e.momentMs, receivedAt, zones);
          for (const momentMs of accepted) {
            const w = { season, eventId: e.eventId, momentMs };
            counting.push(
              phaseOf(receivedAt, momentMs) === 'pre'
                ? createdAtOf().then((at) => deps.windows.count(w, subjectId, receivedAt, at))
                : deps.windows.count(w, subjectId, receivedAt, null),
            );
          }
          for (const momentMs of windowsContaining(receivedAt, accepted)) {
            proofs.push({ subjectId, season, eventId: e.eventId, momentMs, receivedAt, source });
          }
        }

        const [written] = await Promise.all([deps.proofs.recordBeat(proofs), Promise.all(counting)]);
        if (!written.ok) return { ok: false, retryAfterMs: written.retryAfterMs };
        return { ok: true, nextBeatMs: nextBeatMs(receivedAt, valid.map((e) => e.momentMs)) };
      } catch {
        // A catalog / moment-book read that failed (presence pool timeout, database down, S14-03): `unavailable`,
        // counted as failed — never a silent `ok`.
        deps.intake.failed();
        return { ok: false, retryAfterMs: PROOF_RETRY_AFTER_MS };
      }
    },
  };
}
