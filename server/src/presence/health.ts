/**
 * Finalisation of the presence windows (SPEC-14 [А4], [П-5]; AC-15, AC-16, AC-20, AC-22), application ring.
 * A window (one event × one seen moment) is due at its end + 10 s; then exactly ONE record is written:
 * `healthOf` over the samples of every node, the window's distinct-subject counters and the downtime records.
 * It runs (a) on every sampler tick for every due window of the season without a record (the primary finaliser,
 * boot-after-downtime included, AC-15, EC-4), and (b) from the moments registry row `presence-finalise`
 * (`event-stamp`, `late: 'always'`) for windows already due at that group (a late group); an on-time group returns
 * before any read, and a window not due yet is left to (a). The unique key of `presence_window_health` makes a second run a no-op.
 * A failed read or write raises `presence/finalise-failed` (`log`) and writes nothing — never `healthy` on
 * incomplete data (AC-22); the window then has no record and counts as downtime for claims after end + 2 min (AC-18).
 * Every `downtime` record alarms once (`DowntimeNotifier`); the tick also sweeps records whose alarm did not go out.
 * Time comes only from the caller (`now`, `group.now`).
 */
import { finaliseDueAt, healthOf, isRateDropOnly, samplesSpanOf, type HealthSample } from '../domain/presence/healthSigns';
import { windowOf } from '../domain/presence/window';
import { STAMP_DELAY } from '@time2fest/rules/time';
import type { Alarm } from '../ports';
import type { MomentActionRow } from '../scheduler/ports';
import type { PresenceCatalogView } from './beats';
import { healthDowntimeOf, type DowntimeNotifier, type DowntimeService, type DowntimeSqlStore } from './downtime';
import { assertDbWritable, presenceFaults, type PresenceFaultSwitch } from './faults';
import type { WindowIntake } from './intake';
import type { HealthStore, RightsDb, SampleRow, SampleStore, WindowHealthRow } from './ports';

export const PRESENCE_FINALISE = 'presence-finalise';

export type FinaliseResult = 'written' | 'exists' | 'not-due' | 'failed';

export interface FinaliseReport {
  written: number;
  failed: number;
  notDue: number;
}

export interface Finaliser {
  /** Every due window of the season without a record, then the alarm sweep. */
  finaliseDue(now: number): Promise<FinaliseReport>;
  /** The windows of these events (current and seen moments); `notDue` counts windows still open. */
  finaliseEvents(eventIds: readonly string[], now: number): Promise<FinaliseReport>;
  /** The record of one window, or `null`. */
  record(season: string, eventId: string, momentMs: number): Promise<WindowHealthRow | null>;
}

/** The health store with the alarm claim and the season reads of the finaliser. */
export interface HealthSqlStore extends HealthStore {
  claimAlarm(db: RightsDb, season: string, eventId: string, momentMs: number, at: number): Promise<boolean>;
  releaseAlarm(db: RightsDb, season: string, eventId: string, momentMs: number): Promise<void>;
  /** `<event>\n<moment>` of every record of the season. */
  recordedKeys(db: RightsDb, season: string): Promise<Set<string>>;
  /** Downtime records of the season whose alarm has not gone out. */
  listUnalarmed(db: RightsDb, season: string): Promise<WindowHealthRow[]>;
  /** Every moment seen for the events of the season (`presence_event_moments`). */
  seasonMoments(db: RightsDb, season: string): Promise<{ eventId: string; momentMs: number }[]>;
}

export interface FinaliserDeps {
  db(): Promise<RightsDb>;
  store: HealthSqlStore;
  samples: SampleStore;
  downtimeStore: DowntimeSqlStore;
  downtimes: DowntimeService;
  windows: WindowIntake;
  catalog(now: number): Promise<PresenceCatalogView>;
  notifier: DowntimeNotifier;
  alarm: Alarm;
  nodeId: string;
  faults?: PresenceFaultSwitch;
}

const keyOf = (eventId: string, momentMs: number): string => `${eventId}\n${momentMs}`;

const sampleOf = (r: SampleRow): HealthSample => ({
  nodeId: r.node_id,
  at: Number(r.at),
  fastReachable: r.fast_reachable,
  fastRunId: r.fast_run_id,
  fastUptimeS: r.fast_uptime_s === null ? null : Number(r.fast_uptime_s),
  accepted: Number(r.accepted),
  failed: Number(r.failed),
});

export function createFinaliser(deps: FinaliserDeps): Finaliser {
  const faults = deps.faults ?? presenceFaults;

  function failed(): FinaliseResult {
    deps.alarm.raise({ level: 'log', source: 'presence', code: 'presence/finalise-failed', details: { stage: 'finalise', node: deps.nodeId } });
    return 'failed';
  }

  async function notifyWindow(db: RightsDb, row: { season: string; event_id: string; moment_ms: string; signs: readonly string[] }, now: number): Promise<void> {
    const m = Number(row.moment_ms);
    const w = windowOf(m);
    await deps.notifier.notify(
      {
        claim: () => deps.store.claimAlarm(db, row.season, row.event_id, m, now),
        release: () => deps.store.releaseAlarm(db, row.season, row.event_id, m),
      },
      { kind: 'window', season: row.season, eventIds: [row.event_id], from: w.from, to: w.until, signs: [...row.signs] },
    );
  }

  async function finaliseWindow(season: string, eventId: string, momentMs: number, now: number): Promise<FinaliseResult> {
    if (now < finaliseDueAt(momentMs)) return 'not-due';
    let db: RightsDb;
    let verdict: ReturnType<typeof healthOf>;
    try {
      db = await deps.db();
      if ((await deps.store.get(db, season, eventId, momentMs)) !== null) return 'exists';
      const span = samplesSpanOf(momentMs);
      const [rows, downtimeRows, counters] = await Promise.all([
        deps.samples.between(db, span.from, span.to),
        deps.downtimeStore.list(db, season),
        deps.windows.counts({ season, eventId, momentMs }),
      ]);
      verdict = healthOf({ eventId, moment: momentMs, samples: rows.map(sampleOf), counters, downtimes: downtimeRows.map(healthDowntimeOf) });
      // S14-01: a `beat-rate-drop`-only record grants a downtime stamp only to subjects with pre-window evidence, so
      // the evidence must be complete and anchored first. Counters that could not be read (the fast store looked
      // healthy otherwise) are a failed read: retried on the next tick, never recorded as rate-drop-only (AC-22).
      if (isRateDropOnly(verdict.signs)) {
        if (counters === null) return failed();
        await deps.windows.anchorEvidence({ season, eventId, momentMs }, now);
      }
    } catch {
      return failed();
    }
    let written: boolean;
    try {
      assertDbWritable(faults);
      written = await deps.store.record(db, { season, event_id: eventId, moment_ms: String(momentMs), state: verdict.state, signs: [...verdict.signs], recorded_at: String(now) });
    } catch {
      return failed();
    }
    if (!written) return 'exists';
    if (verdict.state === 'downtime') await notifyWindow(db, { season, event_id: eventId, moment_ms: String(momentMs), signs: verdict.signs }, now);
    return 'written';
  }

  const tally = (results: readonly FinaliseResult[]): FinaliseReport => ({
    written: results.filter((r) => r === 'written').length,
    failed: results.filter((r) => r === 'failed').length,
    notDue: results.filter((r) => r === 'not-due').length,
  });

  /** Current moments of the catalog ∪ seen moments, for the given events (all when `only` is undefined). */
  async function windowsOf(view: PresenceCatalogView, db: RightsDb, only?: ReadonlySet<string>): Promise<{ eventId: string; momentMs: number }[]> {
    const season = view.catalog.season;
    const out = new Map<string, { eventId: string; momentMs: number }>();
    for (const e of view.catalog.events.values()) {
      if (only && !only.has(e.eventId)) continue;
      out.set(keyOf(e.eventId, e.momentMs), { eventId: e.eventId, momentMs: e.momentMs });
    }
    for (const s of await deps.store.seasonMoments(db, season)) {
      if (!view.catalog.events.has(s.eventId) || (only && !only.has(s.eventId))) continue;
      out.set(keyOf(s.eventId, s.momentMs), s);
    }
    return [...out.values()];
  }

  async function sweep(view: PresenceCatalogView, db: RightsDb, now: number): Promise<void> {
    for (const r of await deps.store.listUnalarmed(db, view.catalog.season)) await notifyWindow(db, r, now);
    await deps.downtimes.alarmPending(view, now);
  }

  return {
    async finaliseDue(now) {
      let view: PresenceCatalogView;
      let db: RightsDb;
      let due: { eventId: string; momentMs: number }[];
      try {
        view = await deps.catalog(now);
        if (!view.catalog.season) return { written: 0, failed: 0, notDue: 0 };
        db = await deps.db();
        const recorded = await deps.store.recordedKeys(db, view.catalog.season);
        due = (await windowsOf(view, db)).filter((w) => !recorded.has(keyOf(w.eventId, w.momentMs)) && now >= finaliseDueAt(w.momentMs));
      } catch {
        failed();
        return { written: 0, failed: 1, notDue: 0 };
      }
      const results: FinaliseResult[] = [];
      for (const w of due) results.push(await finaliseWindow(view.catalog.season, w.eventId, w.momentMs, now));
      await sweep(view, db, now).catch(() => undefined);
      return tally(results);
    },
    async finaliseEvents(eventIds, now) {
      let view: PresenceCatalogView;
      let windows: { eventId: string; momentMs: number }[];
      try {
        view = await deps.catalog(now);
        if (!view.catalog.season) return { written: 0, failed: 0, notDue: 0 };
        windows = await windowsOf(view, await deps.db(), new Set(eventIds));
      } catch {
        failed();
        return { written: 0, failed: 1, notDue: 0 };
      }
      const results: FinaliseResult[] = [];
      for (const w of windows) results.push(await finaliseWindow(view.catalog.season, w.eventId, w.momentMs, now));
      return tally(results);
    },
    async record(season, eventId, momentMs) {
      return deps.store.get(await deps.db(), season, eventId, momentMs);
    },
  };
}

/** Thrown by the moments row when a record could not be written (the scheduler retries; `late: 'always'`). */
export class FinaliseFailed extends Error {
  readonly code = 'presence-finalise-failed';
  constructor() {
    super('presence window not finalised');
  }
}

/**
 * The moments-registry row `presence-finalise` ([П-5]): at each `event-stamp` group the windows of its events are
 * finalised at `group.now`. A window not due yet (the stamp moment comes before the window end + 10 s) returns
 * quietly — the 5 s sampler tick (`finaliseDue`) is the primary finaliser and writes it once due (W4: no retry storm,
 * no warn lines). Only a failed read or write throws, so the scheduler retries. Idempotent by the window's unique
 * record, so by `consequenceId` too.
 */
export function createPresenceFinaliseRow(finaliser: () => Promise<Finaliser>): MomentActionRow {
  return {
    key: PRESENCE_FINALISE,
    capability: 'SPEC-14',
    kinds: ['event-stamp'],
    late: 'always',
    async run(group) {
      // Cheap when nothing is due: an on-time `event-stamp` group (m + 15 s) never has its window due (the window ends
      // at the claim close, after m + 15 s), so it touches neither the finaliser nor the database — the scheduler's
      // per-instant work stays flat (scheduler-a p99). Only a late group (backlog, boot after downtime) finalises here;
      // an old moment's window is left to the 5 s ticker.
      const due = group.moments.filter((m) => group.now >= finaliseDueAt(m.at - STAMP_DELAY));
      const eventIds = [...new Set(due.map((m) => m.eventId).filter((e): e is string => typeof e === 'string' && e !== ''))];
      if (eventIds.length === 0) return;
      const report = await (await finaliser()).finaliseEvents(eventIds, group.now);
      if (report.failed > 0) throw new FinaliseFailed();
    },
  };
}

const HEALTH_COLUMNS = 'season, event_id, moment_ms, state, signs, recorded_by, recorded_at, alarmed_at';

/** `presence_window_health` over `RightsDb` (raw SQL, [П-1]); one record per window. */
export function createSqlHealthStore(): HealthSqlStore {
  return {
    async record(db, row) {
      const res = await db.query(
        `INSERT INTO presence_window_health (season, event_id, moment_ms, state, signs, recorded_at)
         VALUES ($1, $2, $3, $4, $5::text[], $6) ON CONFLICT ON CONSTRAINT presence_window_health_uq DO NOTHING`,
        [row.season, row.event_id, row.moment_ms, row.state, row.signs, row.recorded_at],
      );
      return res.rowCount > 0;
    },
    async get(db, season, eventId, momentMs) {
      const res = await db.query<WindowHealthRow & Record<string, unknown>>(
        `SELECT ${HEALTH_COLUMNS} FROM presence_window_health WHERE season = $1 AND event_id = $2 AND moment_ms = $3`,
        [season, eventId, String(momentMs)],
      );
      return res.rows[0] ?? null;
    },
    async markAlarmed(db, season, eventId, momentMs, at) {
      await db.query(
        'UPDATE presence_window_health SET alarmed_at = $4 WHERE season = $1 AND event_id = $2 AND moment_ms = $3 AND alarmed_at IS NULL',
        [season, eventId, String(momentMs), String(at)],
      );
    },
    async claimAlarm(db, season, eventId, momentMs, at) {
      const res = await db.query(
        `UPDATE presence_window_health SET alarmed_at = $4
         WHERE season = $1 AND event_id = $2 AND moment_ms = $3 AND state = 'downtime' AND alarmed_at IS NULL RETURNING event_id`,
        [season, eventId, String(momentMs), String(at)],
      );
      return res.rowCount > 0;
    },
    async releaseAlarm(db, season, eventId, momentMs) {
      await db.query('UPDATE presence_window_health SET alarmed_at = NULL WHERE season = $1 AND event_id = $2 AND moment_ms = $3', [season, eventId, String(momentMs)]);
    },
    async recordedKeys(db, season) {
      const res = await db.query<{ event_id: string; moment_ms: string }>('SELECT event_id, moment_ms FROM presence_window_health WHERE season = $1', [season]);
      return new Set(res.rows.map((r) => keyOf(r.event_id, Number(r.moment_ms))));
    },
    async listUnalarmed(db, season) {
      const res = await db.query<WindowHealthRow & Record<string, unknown>>(
        `SELECT ${HEALTH_COLUMNS} FROM presence_window_health WHERE season = $1 AND state = 'downtime' AND alarmed_at IS NULL ORDER BY moment_ms, event_id`,
        [season],
      );
      return res.rows;
    },
    async seasonMoments(db, season) {
      const res = await db.query<{ event_id: string; moment_ms: string }>('SELECT event_id, moment_ms FROM presence_event_moments WHERE season = $1', [season]);
      return res.rows.map((r) => ({ eventId: r.event_id, momentMs: Number(r.moment_ms) })).filter((r) => Number.isFinite(r.momentMs));
    },
  };
}
