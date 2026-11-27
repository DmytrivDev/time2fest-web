/**
 * Downtime records and the downtime alarm (SPEC-14 [А5], [А6], [П-5]; AC-19 (service), AC-20, AC-21), application ring.
 * - `addManual` appends an owner's record: one event (its window, or the given range) or a time range, reason ≤ 200;
 *   with `within`, the caller runs the insert inside its own transaction (the owner endpoint: record and journal row
 *   commit together, S14-05), and the alarm runs only after that commit;
 * - `reportEdgeFailure({region, from, to})` (internal; in this wave only the door calls it) appends an `edge-region`
 *   record by `system` — every window it overlaps gets the `edge-region` sign at finalisation;
 * - records are append-only: nothing here updates or deletes one (only `alarmed_at` is claimed);
 * - a record overlapping `[m − 10 min; m + 10 min]` of any event, and every `downtime` window record, raises
 *   `presence/downtime` (`page`) and publishes the internal event `presence.downtime-recorded` EXACTLY once: the
 *   claim is `UPDATE … SET alarmed_at = $now WHERE alarmed_at IS NULL RETURNING`; a failed publish releases the claim,
 *   and the finaliser's sweep tries again on its next tick.
 * No subject data anywhere here (NFR-5). Time comes from the caller (NFR-8).
 */
import type { Alarm } from '../ports';
import { DOWNTIME_ALARM_SPAN_MS, overlaps, type HealthDowntime } from '../domain/presence/healthSigns';
import { validEvent } from '../domain/presence/eventValidity';
import { windowOf } from '../domain/presence/window';
import type { PresenceCatalogView } from './beats';
import type { RightsQuery } from '../rights/ports';
import type { DowntimeRow, DowntimeStore, RightsDb } from './ports';

export const PRESENCE_DOWNTIME = 'presence/downtime';
/** Internal event "presence downtime recorded" (AC-20). */
export const PRESENCE_DOWNTIME_TOPIC = 'presence.downtime-recorded';

/** Payload of `presence.downtime-recorded`: which events, which span, which signs. */
export interface DowntimeRecordedPayload {
  /** `window` = a window record of the health log; otherwise the kind of the downtime record. */
  kind: 'window' | 'manual' | 'edge-region';
  season: string;
  eventIds: string[];
  from: number;
  to: number;
  signs: string[];
}

/** A claim of the one-time alarm of a record. */
export interface AlarmClaim {
  /** `true` when this call set `alarmed_at` (the record was not alarmed yet). */
  claim(): Promise<boolean>;
  /** Clears `alarmed_at` again (the publish failed). */
  release(): Promise<void>;
}

/** Raises the downtime alarm and publishes the internal event once per record. */
export interface DowntimeNotifier {
  /** `true` when the alarm went out on this call. Never throws. */
  notify(claim: AlarmClaim, payload: DowntimeRecordedPayload): Promise<boolean>;
}

export function createDowntimeNotifier(deps: { alarm: Alarm; publish(payload: DowntimeRecordedPayload): Promise<void> }): DowntimeNotifier {
  return {
    async notify(claim, payload) {
      try {
        if (!(await claim.claim())) return false;
      } catch {
        return false;
      }
      try {
        await deps.publish(payload);
      } catch {
        await claim.release().catch(() => undefined);
        return false;
      }
      deps.alarm.raise({
        level: 'page',
        source: 'presence',
        code: 'presence/downtime',
        details: { kind: payload.kind, event: payload.eventIds[0] ?? '', events: payload.eventIds.length, signs: payload.signs.join('+') },
      });
      return true;
    },
  };
}

/** The downtime store with the one-time alarm claim. */
export interface DowntimeSqlStore extends DowntimeStore {
  /** Takes any query handle, so a caller's transaction client can carry the insert (`ManualTx`). */
  add(db: RightsQuery, row: Omit<DowntimeRow, 'id' | 'alarmed_at'>): Promise<DowntimeRow>;
  claimAlarm(db: RightsDb, id: string, at: number): Promise<boolean>;
  releaseAlarm(db: RightsDb, id: string): Promise<void>;
  listUnalarmed(db: RightsDb, season: string): Promise<DowntimeRow[]>;
}

/** A stored record as `healthOf` reads it. */
export function healthDowntimeOf(r: DowntimeRow): HealthDowntime {
  return { kind: r.kind, eventId: r.event_id, from: Number(r.from_ms), to: Number(r.to_ms) };
}

/** The events whose `[m − 10 min; m + 10 min]` the record overlaps (current moments of the catalog). */
export function eventsHitBy(r: HealthDowntime, view: PresenceCatalogView): string[] {
  const out: string[] = [];
  for (const e of view.catalog.events.values()) {
    if (r.kind === 'manual' && r.eventId !== null) {
      if (r.eventId === e.eventId) out.push(e.eventId);
      continue;
    }
    if (overlaps(r.from, r.to, e.momentMs - DOWNTIME_ALARM_SPAN_MS, e.momentMs + DOWNTIME_ALARM_SPAN_MS)) out.push(e.eventId);
  }
  return out.sort();
}

export type ManualInput = { eventId: string; from?: number; to?: number; reason: string } | { eventId?: undefined; from: number; to: number; reason: string };
/**
 * The caller's transaction for a manual record: gets the insert, runs it on its transaction's connection with whatever
 * else must commit with it (the journal row), commits, and returns the stored row; a throw means nothing was kept.
 */
export type ManualTx = (insert: (db: RightsQuery) => Promise<DowntimeRow>) => Promise<DowntimeRow>;
export type DowntimeAddResult = { ok: true; row: DowntimeRow } | { ok: false; reason: 'no-season' | 'unknown-event' | 'invalid-range' };

export interface DowntimeService {
  addManual(input: ManualInput, now: number, within?: ManualTx): Promise<DowntimeAddResult>;
  reportEdgeFailure(input: { region: string; from: number; to: number }, now: number): Promise<DowntimeAddResult>;
  list(season: string): Promise<DowntimeRow[]>;
  /** Alarms every record of the season not alarmed yet that overlaps an event's span (the sweep). */
  alarmPending(view: PresenceCatalogView, now: number): Promise<number>;
}

export interface DowntimeDeps {
  db(): Promise<RightsDb>;
  store: DowntimeSqlStore;
  catalog(now: number): Promise<PresenceCatalogView>;
  notifier: DowntimeNotifier;
}

export function createDowntimeService(deps: DowntimeDeps): DowntimeService {
  async function alarmRow(row: DowntimeRow, view: PresenceCatalogView, now: number): Promise<boolean> {
    const events = eventsHitBy(healthDowntimeOf(row), view);
    if (events.length === 0) return false;
    const db = await deps.db();
    return deps.notifier.notify(
      { claim: () => deps.store.claimAlarm(db, row.id, now), release: () => deps.store.releaseAlarm(db, row.id) },
      { kind: row.kind, season: row.season, eventIds: events, from: Number(row.from_ms), to: Number(row.to_ms), signs: [row.kind] },
    );
  }

  async function append(row: Omit<DowntimeRow, 'id' | 'alarmed_at'>, view: PresenceCatalogView, now: number, within?: ManualTx): Promise<DowntimeAddResult> {
    const stored = within ? await within((db) => deps.store.add(db, row)) : await deps.store.add(await deps.db(), row);
    await alarmRow(stored, view, now);
    return { ok: true, row: stored };
  }

  return {
    async addManual(input, now, within) {
      const view = await deps.catalog(now);
      const season = view.catalog.season;
      if (!season) return { ok: false, reason: 'no-season' };
      let from = input.from;
      let to = input.to;
      if (input.eventId !== undefined) {
        const e = validEvent(view.catalog, input.eventId);
        if (!e) return { ok: false, reason: 'unknown-event' };
        if (from === undefined || to === undefined) {
          const w = windowOf(e.momentMs);
          from = w.from;
          to = w.until;
        }
      }
      if (from === undefined || to === undefined || !Number.isFinite(from) || !Number.isFinite(to) || to < from) return { ok: false, reason: 'invalid-range' };
      return append(
        { season, kind: 'manual', event_id: input.eventId ?? null, from_ms: String(from), to_ms: String(to), region: null, reason: input.reason, recorded_by: 'owner', created_at: String(now) },
        view,
        now,
        within,
      );
    },
    async reportEdgeFailure(input, now) {
      const view = await deps.catalog(now);
      const season = view.catalog.season;
      if (!season) return { ok: false, reason: 'no-season' };
      if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.to < input.from) return { ok: false, reason: 'invalid-range' };
      return append(
        { season, kind: 'edge-region', event_id: null, from_ms: String(input.from), to_ms: String(input.to), region: input.region, reason: null, recorded_by: 'system', created_at: String(now) },
        view,
        now,
      );
    },
    async list(season) {
      return deps.store.list(await deps.db(), season);
    },
    async alarmPending(view, now) {
      if (!view.catalog.season) return 0;
      const rows = await deps.store.listUnalarmed(await deps.db(), view.catalog.season);
      let n = 0;
      for (const r of rows) if (await alarmRow(r, view, now)) n += 1;
      return n;
    },
  };
}

const COLUMNS = 'id, season, kind, event_id, from_ms, to_ms, region, reason, recorded_by, created_at, alarmed_at';

/** `presence_downtimes` over `RightsDb` (raw SQL, [П-1]); append-only. */
export function createSqlDowntimeStore(): DowntimeSqlStore {
  return {
    async add(db, row) {
      const res = await db.query<DowntimeRow & Record<string, unknown>>(
        `INSERT INTO presence_downtimes (season, kind, event_id, from_ms, to_ms, region, reason, recorded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
        [row.season, row.kind, row.event_id, row.from_ms, row.to_ms, row.region, row.reason, row.recorded_by, row.created_at],
      );
      const out = res.rows[0];
      if (!out) throw new Error('presence downtime: insert returned no row');
      return { ...out, id: String(out.id) };
    },
    async list(db, season) {
      const res = await db.query<DowntimeRow & Record<string, unknown>>(`SELECT ${COLUMNS} FROM presence_downtimes WHERE season = $1 ORDER BY id`, [season]);
      return res.rows.map((r) => ({ ...r, id: String(r.id) }));
    },
    async listUnalarmed(db, season) {
      const res = await db.query<DowntimeRow & Record<string, unknown>>(
        `SELECT ${COLUMNS} FROM presence_downtimes WHERE season = $1 AND alarmed_at IS NULL ORDER BY id`,
        [season],
      );
      return res.rows.map((r) => ({ ...r, id: String(r.id) }));
    },
    async markAlarmed(db, id, at) {
      await db.query('UPDATE presence_downtimes SET alarmed_at = $2 WHERE id = $1 AND alarmed_at IS NULL', [id, String(at)]);
    },
    async claimAlarm(db, id, at) {
      const res = await db.query('UPDATE presence_downtimes SET alarmed_at = $2 WHERE id = $1 AND alarmed_at IS NULL RETURNING id', [id, String(at)]);
      return res.rowCount > 0;
    },
    async releaseAlarm(db, id) {
      await db.query('UPDATE presence_downtimes SET alarmed_at = NULL WHERE id = $1', [id]);
    },
  };
}
