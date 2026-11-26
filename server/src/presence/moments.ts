/**
 * Every moment the server has seen for an event (SPEC-14 [А9], [П-4]; AC-32), application ring. The corrections
 * module keeps only the current patch, so the presence module records each effective moment it reads
 * (`presence_event_moments`, `INSERT … ON CONFLICT DO NOTHING`); a beat counts toward every seen moment still accepted
 * at `now` (the current one always, older ones until the celebration is over — `acceptedMomentsOf`).
 * Reads are cached in process for 30 s per event; a moment observed by this process is visible at once.
 */
import { acceptedMomentsOf, type SeasonZones } from '../domain/presence/window';
import type { MomentRow, MomentStore, RightsDb } from './ports';

/** How long a read of an event's seen moments is reused. */
export const MOMENTS_CACHE_MS = 30_000;

export interface SeenMoment {
  eventId: string;
  momentMs: number;
}

export interface MomentBook {
  /** Records the effective moments of a catalog read; only moments new to this process reach the database. */
  observe(season: string, events: readonly SeenMoment[], seenAt: number): Promise<void>;
  /** Every moment seen for the event (database ∪ this process), sorted. */
  seen(season: string, eventId: string, now: number): Promise<number[]>;
  /** The moments of the event that still accept presence at `now` (the current one first in time order). */
  accepted(season: string, eventId: string, current: number, now: number, zones: SeasonZones): Promise<number[]>;
  /** Drops the process cache (tests, the worktree reset). */
  clear(): void;
}

export interface MomentBookDeps {
  db(): Promise<RightsDb>;
  store: MomentStore;
}

export function createMomentBook(deps: MomentBookDeps): MomentBook {
  /** `<season>\n<event>` → moments recorded or read by this process. */
  const known = new Map<string, Set<number>>();
  /** `<season>\n<event>` → when the database was last read for it. */
  const readAt = new Map<string, number>();
  const keyOf = (season: string, eventId: string): string => `${season}\n${eventId}`;
  const setOf = (k: string): Set<number> => {
    let s = known.get(k);
    if (!s) known.set(k, (s = new Set()));
    return s;
  };

  async function seen(season: string, eventId: string, now: number): Promise<number[]> {
    const k = keyOf(season, eventId);
    const last = readAt.get(k);
    if (last === undefined || now - last >= MOMENTS_CACHE_MS || now < last) {
      const rows = await deps.store.list(await deps.db(), season, eventId);
      const s = setOf(k);
      for (const r of rows) {
        const m = Number(r.moment_ms);
        if (Number.isFinite(m)) s.add(m);
      }
      readAt.set(k, now);
    }
    return [...setOf(k)].sort((a, b) => a - b);
  }

  return {
    async observe(season, events, seenAt) {
      if (!season) return;
      const fresh = events.filter((e) => Number.isFinite(e.momentMs) && !known.get(keyOf(season, e.eventId))?.has(e.momentMs));
      if (fresh.length === 0) return;
      const db = await deps.db();
      for (const e of fresh) {
        await deps.store.record(db, season, e.eventId, e.momentMs, seenAt);
        setOf(keyOf(season, e.eventId)).add(e.momentMs);
      }
    },
    seen,
    async accepted(season, eventId, current, now, zones) {
      return acceptedMomentsOf(current, await seen(season, eventId, now), now, zones);
    },
    clear() {
      known.clear();
      readAt.clear();
    },
  };
}

/** `presence_event_moments` over `RightsDb` (raw SQL, [П-1]). */
export function createSqlMomentStore(): MomentStore {
  return {
    async record(db, season, eventId, momentMs, seenAt) {
      await db.query(
        `INSERT INTO presence_event_moments (season, event_id, moment_ms, first_seen_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [season, eventId, String(momentMs), String(seenAt)],
      );
    },
    async list(db, season, eventId) {
      const res = await db.query<MomentRow & Record<string, unknown>>(
        `SELECT season, event_id, moment_ms, first_seen_at FROM presence_event_moments
         WHERE season = $1 AND event_id = $2 ORDER BY moment_ms`,
        [season, eventId],
      );
      return res.rows;
    },
  };
}
