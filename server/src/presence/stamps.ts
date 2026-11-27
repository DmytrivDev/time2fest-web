/**
 * Stamp claims and the passport list (SPEC-14 [А7], [А9], [А10], [П-6]; AC-12, AC-18, AC-23 … AC-34, AC-36, AC-37,
 * NFR-5, NFR-8), application ring. A claim reads the subject's stamp, the valid event, the proofs of every accepted
 * window, their health records and the downtime records, asks the pure `claimDecision`, and on a grant inserts the
 * stamp `ON CONFLICT DO NOTHING RETURNING` in one transaction with the `old-moment` journal row. Zero rows (a parallel
 * claim won) → the stored stamp is re-read and returned, so every caller gets the same stamp (AC-30). Consequences
 * (achievements, events — P9) run only when THIS call inserted the row. Proofs survive a fast-store flush because
 * they are read from Postgres only (AC-12). Any database failure (or the `dbWrite` fault) → `unavailable` 5 000
 * (AC-26). Time is the server clock passed in (NFR-8); nothing here logs, so no subject id reaches a log (NFR-5).
 */
import type { PassportStamp } from '@time2fest/contracts';
import { ratingCloseAt, type PresenceSource } from '@time2fest/rules/time';
import { stampViewOf, type StampCatalog } from '../domain/passport/stampView';
import { CLAIM_DB_RETRY_MS, claimDecision, claimPrecheck, type ClaimGrant, type ClaimRefusal, type ClaimWindow } from '../domain/presence/claimDecision';
import { validEvent } from '../domain/presence/eventValidity';
import { downtimeApplies } from '../domain/presence/healthSigns';
import { isPresenceSource, sourceRank } from '../domain/presence/source';
import { acceptedMomentsOf } from '../domain/presence/window';
import type { RightsQuery } from '../rights/ports';
import type { PresenceCatalogView } from './beats';
import { healthDowntimeOf } from './downtime';
import { assertDbWritable, presenceFaults, type PresenceFaultSwitch } from './faults';
import type { MomentBook } from './moments';
import type { DowntimeStore, HealthStore, OldMomentLogRow, ProofStore, RightsDb, StampRow } from './ports';

export interface ClaimInput {
  /** The session's subject (never from the body). */
  subjectId: string;
  eventId: string;
  /** The body's source (a downtime grant carries it, AC-29). The body's `at` is not passed (AC-11). */
  source: PresenceSource;
  /** Server clock. */
  now: number;
}

export type ClaimOutcome = { ok: true; stamp: PassportStamp; inserted: boolean } | { ok: false; error: ClaimRefusal };

/** What a fresh grant hands to the consequences (P9): achievements, the `stamp` envelope, the internal event. */
export interface GrantedStamp {
  subjectId: string;
  season: string;
  stamp: PassportStamp;
  grant: ClaimGrant;
  issuedAt: number;
}

export interface StampService {
  claim(input: ClaimInput): Promise<ClaimOutcome>;
  /** The subject's stamps of the current season, ordered by `grantedAt` (events gone from the catalog are left out). */
  list(subjectId: string, now: number): Promise<PassportStamp[]>;
}

/** `stamps` and `stamp_old_moment_log` over a query handle (inside the claim transaction). */
export interface StampSqlStore {
  /** `true` when this call inserted the stamp. */
  insert(db: RightsQuery, row: StampRow): Promise<boolean>;
  get(db: RightsQuery, subjectId: string, season: string, eventId: string): Promise<StampRow | null>;
  listForSubject(db: RightsQuery, subjectId: string, season: string): Promise<StampRow[]>;
  logOldMoment(db: RightsQuery, row: Omit<OldMomentLogRow, 'id'>): Promise<void>;
}

export interface StampServiceDeps {
  db(): Promise<RightsDb>;
  catalog(now: number): Promise<PresenceCatalogView>;
  /** The catalog rows the stamp view is composed from. */
  stampCatalog(now: number): Promise<StampCatalog>;
  moments: MomentBook;
  proofs: Pick<ProofStore, 'listForSubject'>;
  health: Pick<HealthStore, 'get'>;
  downtimes: Pick<DowntimeStore, 'list'>;
  store: StampSqlStore;
  faults?: PresenceFaultSwitch;
  /** Consequences of a fresh grant (P9); a failure never undoes the grant. */
  onGranted?(granted: GrantedStamp): Promise<void>;
}

const sourceOf = (s: string, fallback: PresenceSource): PresenceSource => (isPresenceSource(s) ? s : fallback);

export function createStampService(deps: StampServiceDeps): StampService {
  const faults = deps.faults ?? presenceFaults;

  /** The best proof source per moment of the subject for the event. */
  async function proofSources(db: RightsDb, subjectId: string, season: string, eventId: string): Promise<Map<number, PresenceSource>> {
    const out = new Map<number, PresenceSource>();
    for (const p of await deps.proofs.listForSubject(db, subjectId, season)) {
      if (p.event_id !== eventId || !isPresenceSource(p.source)) continue;
      const m = Number(p.moment_ms);
      const had = out.get(m);
      if (had === undefined || sourceRank(p.source) > sourceRank(had)) out.set(m, p.source);
    }
    return out;
  }

  async function decide(db: RightsDb, input: ClaimInput) {
    const { subjectId, eventId, now } = input;
    const view = await deps.catalog(now);
    const season = view.catalog.season;
    const existing = season ? await deps.store.get(db, subjectId, season, eventId) : null;
    const event = validEvent(view.catalog, eventId);
    const zones = view.zones.zones;
    const closeAt = zones.length > 0 ? ratingCloseAt({ zones: [...zones] }) : Infinity;

    const windows: ClaimWindow[] = [];
    // S14-08: the time-only refusals need no proof / downtime / health reads (the stamp read above still wins).
    const early = existing === null ? claimPrecheck({ now, closeAt, currentMoment: event?.momentMs ?? null }) : null;
    if (existing === null && event !== null && early === null) {
      await deps.moments.observe(season, [{ eventId, momentMs: event.momentMs }], now);
      const [seen, proofs, downtimeRows] = await Promise.all([
        deps.moments.seen(season, eventId, now),
        proofSources(db, subjectId, season, eventId),
        deps.downtimes.list(db, season),
      ]);
      // W2: the subject's own stored proof moments count too (until the celebration end), so a moment this node has
      // not cached yet (a correction seen elsewhere, the 30 s moment cache) can never lead to `no-presence`.
      const accepted = acceptedMomentsOf(event.momentMs, [...seen, ...proofs.keys()], now, view.zones);
      const downtimes = downtimeRows.map(healthDowntimeOf);
      const records = await Promise.all(accepted.map((moment) => deps.health.get(db, season, eventId, moment)));
      accepted.forEach((moment, i) => {
        windows.push({
          moment,
          proofSource: proofs.get(moment) ?? null,
          record: records[i]?.state ?? null,
          downtime: downtimes.some((d) => downtimeApplies(d, eventId, moment)),
        });
      });
    }
    const decision = claimDecision({
      now,
      hasStamp: existing !== null,
      closeAt,
      currentMoment: event?.momentMs ?? null,
      windows,
      source: input.source,
    });
    return { decision, season, existing };
  }

  async function claim(input: ClaimInput): Promise<ClaimOutcome> {
    const unavailable: ClaimOutcome = { ok: false, error: { code: 'unavailable', retryAfterMs: CLAIM_DB_RETRY_MS } };
    let granted: GrantedStamp | undefined;
    let outcome: ClaimOutcome;
    try {
      assertDbWritable(faults);
      const db = await deps.db();
      const { decision, season, existing } = await decide(db, input);
      if (decision.kind === 'refuse') return { ok: false, error: decision.error };
      const catalog = await deps.stampCatalog(input.now);
      const view = (row: StampRow): PassportStamp | null =>
        stampViewOf({ eventId: row.event_id, grantedAt: Number(row.granted_at), presenceSource: sourceOf(row.presence_source, input.source) }, catalog);

      let row: StampRow;
      let inserted = false;
      if (decision.kind === 'existing' && existing !== null) {
        row = existing;
      } else if (decision.kind === 'grant') {
        const g = decision.grant;
        const fresh: StampRow = {
          subject_id: input.subjectId,
          season,
          event_id: input.eventId,
          granted_at: String(g.grantedAt),
          presence_source: g.presenceSource,
          grant_kind: g.kind,
          issued_at: String(input.now),
        };
        const stored = await db.tx(async (q) => {
          if (await deps.store.insert(q, fresh)) {
            if (g.oldMoment) {
              await deps.store.logOldMoment(q, {
                subject_id: input.subjectId,
                season,
                event_id: input.eventId,
                old_moment_ms: String(g.oldMoment.old),
                new_moment_ms: String(g.oldMoment.current),
                at: String(input.now),
              });
            }
            return { row: fresh, inserted: true };
          }
          // A parallel claim won: return its stamp unchanged (AC-23, AC-30).
          return { row: await deps.store.get(q, input.subjectId, season, input.eventId), inserted: false };
        });
        if (stored.row === null) return unavailable;
        row = stored.row;
        inserted = stored.inserted;
      } else {
        return unavailable;
      }
      const stamp = view(row);
      // The event left the catalog after the grant: nothing to compose the stamp from.
      if (stamp === null) return { ok: false, error: { code: 'not_found', reason: 'unknown-event' } };
      if (inserted && decision.kind === 'grant') granted = { subjectId: input.subjectId, season, stamp, grant: decision.grant, issuedAt: input.now };
      outcome = { ok: true, stamp, inserted };
    } catch {
      return unavailable;
    }
    if (granted && deps.onGranted) await deps.onGranted(granted).catch(() => undefined);
    return outcome;
  }

  return {
    claim,
    async list(subjectId, now) {
      const view = await deps.catalog(now);
      const season = view.catalog.season;
      if (!season) return [];
      const db = await deps.db();
      const [rows, catalog] = await Promise.all([deps.store.listForSubject(db, subjectId, season), deps.stampCatalog(now)]);
      const out: PassportStamp[] = [];
      for (const r of rows) {
        const s = stampViewOf({ eventId: r.event_id, grantedAt: Number(r.granted_at), presenceSource: sourceOf(r.presence_source, 'country') }, catalog);
        if (s) out.push(s);
      }
      return out.sort((a, b) => a.grantedAt - b.grantedAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
    },
  };
}

const STAMP_COLUMNS = 'subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at';

/** The only writer of `stamps` besides the guest merge (AC-34). */
export function createSqlStampStore(): StampSqlStore {
  return {
    async insert(db, row) {
      const res = await db.query(
        `INSERT INTO stamps (${STAMP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING event_id`,
        [row.subject_id, row.season, row.event_id, row.granted_at, row.presence_source, row.grant_kind, row.issued_at],
      );
      return res.rowCount > 0;
    },
    async get(db, subjectId, season, eventId) {
      const res = await db.query<StampRow & Record<string, unknown>>(
        `SELECT ${STAMP_COLUMNS} FROM stamps WHERE subject_id = $1 AND season = $2 AND event_id = $3`,
        [subjectId, season, eventId],
      );
      return res.rows[0] ?? null;
    },
    async listForSubject(db, subjectId, season) {
      const res = await db.query<StampRow & Record<string, unknown>>(
        `SELECT ${STAMP_COLUMNS} FROM stamps WHERE subject_id = $1 AND season = $2 ORDER BY granted_at, event_id`,
        [subjectId, season],
      );
      return res.rows;
    },
    async logOldMoment(db, row) {
      await db.query(
        `INSERT INTO stamp_old_moment_log (subject_id, season, event_id, old_moment_ms, new_moment_ms, at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.subject_id, row.season, row.event_id, row.old_moment_ms, row.new_moment_ms, row.at],
      );
    },
  };
}
