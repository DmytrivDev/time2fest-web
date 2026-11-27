/**
 * Presence test doors (SPEC-14 W21, AC-63, [А17], [П-10]). Part of the doors module: loaded only through the dynamic
 * doors `import()`, so they exist only in the `test` class with `T2F_TEST_DOORS=1`. Every door works on the presence
 * services of the process (`presenceOf`: one node intake, one sampler), never on a second copy.
 *
 * - `POST /api/_test/presence/fault {fastStore?, dbWrite?, beatErrorRate?}` — the process's fault switch; absent fields
 *   keep their value. `fastStore: 'restart'` (beyond the contract's `'down' | 'up'`) simulates a Redis restart: the
 *   samples report a new run id from then on (the real stop/start is the exclusive test's job). Answers the switch.
 * - `POST /api/_test/presence/downtime` — a manual record (`{kind:'manual', eventId, reason}` = that event's window,
 *   or `{kind:'manual', from, to, reason}`) or an edge-region report `{kind:'edge-region', region, from, to}` through
 *   the downtime service (manual = `recordedBy: owner`, edge = `system`). No season / unknown event → `not_found`,
 *   a bad range → `validation`.
 * - `POST /api/_test/presence/tick {}` — one intake sample at the server clock's `now`, then the finalisation of every
 *   due window (what the 5 s ticker does; a window already recorded by the ticker stays as it is).
 * - `POST /api/_test/presence/health {eventId}` — the event's window records, the samples around its windows and the
 *   downtime records that apply to it, for the current season.
 *
 * `reset` empties the nine presence tables (`clearPresenceTables`) and the fault switch; the `pr:*` keys go with the
 * prefix wipe.
 */
import { presenceDowntimeDoor, presenceFaultDoor, presenceHealthDoor, presenceTickDoor } from '@time2fest/contracts/schemas';
import { z } from 'zod';
import { rightsDbOf } from '../auth/pool';
import { downtimeApplies, samplesSpanOf } from '../domain/presence/healthSigns';
import { presenceOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Deps, Outcome } from '../endpoints/types';
import { healthDowntimeOf, type DowntimeAddResult } from '../presence/downtime';
import { presenceFaults } from '../presence/faults';
import type { DowntimeRow } from '../presence/ports';
import type { DoorRow } from './registry';

/** Every table of the SPEC-14 migration (`20261126_205719_spec14_presence`). */
export const PRESENCE_TABLES = [
  'presence_proofs',
  'presence_event_moments',
  'presence_samples',
  'presence_window_health',
  'presence_downtimes',
  'stamps',
  'passport_achievements',
  'stamp_old_moment_log',
  'author_ids',
] as const;

/** Empties the presence tables, drops the fault switch and the process's presence caches (reset door). */
export async function clearPresenceTables(deps: Deps): Promise<void> {
  presenceFaults.reset();
  if (!deps.auth) return;
  const db = await rightsDbOf(deps);
  await db.query(PRESENCE_TABLES.map((t) => `DELETE FROM ${t};`).join(' '));
  const p = presenceOf(deps);
  p.clear();
  p.intake.take();
}

/** The contract's fault body plus the simulated restart. */
export const PresenceFaultDoorBody = presenceFaultDoor.extend({ fastStore: z.enum(['down', 'up', 'restart']).optional() });

const view = (row: DowntimeRow) => ({
  id: String(row.id),
  kind: row.kind,
  eventId: row.event_id,
  from: Number(row.from_ms),
  to: Number(row.to_ms),
  region: row.region,
  reason: row.reason,
  recordedBy: row.recorded_by,
  alarmedAt: row.alarmed_at === null ? null : Number(row.alarmed_at),
});

function added(result: DowntimeAddResult): Outcome {
  if (result.ok) return { ok: true, value: { downtime: view(result.row) } };
  return result.reason === 'invalid-range' ? failure('validation', { reason: 'invalid-range' }) : failure('not_found', { reason: result.reason });
}

export const presenceFaultDoorRow: DoorRow = {
  key: 'presence-fault',
  method: 'POST',
  path: '/api/_test/presence/fault',
  body: PresenceFaultDoorBody,
  async handler(ctx) {
    const { fastStore, ...rest } = ctx.body as z.infer<typeof PresenceFaultDoorBody>;
    if (fastStore === 'restart') presenceFaults.restartFastStore();
    const state = presenceFaults.apply(fastStore === 'restart' ? rest : { ...rest, ...(fastStore ? { fastStore } : {}) });
    return { ok: true, value: { ...state } };
  },
};

export const presenceDowntimeDoorRow: DoorRow = {
  key: 'presence-downtime',
  method: 'POST',
  path: '/api/_test/presence/downtime',
  body: presenceDowntimeDoor,
  async handler(ctx) {
    const body = ctx.body as z.infer<typeof presenceDowntimeDoor>;
    const { downtimes } = presenceOf(ctx.deps);
    const now = ctx.deps.clock.now();
    if (body.kind === 'edge-region') return added(await downtimes.reportEdgeFailure({ region: body.region, from: body.from, to: body.to }, now));
    if ('eventId' in body) return added(await downtimes.addManual({ eventId: body.eventId, reason: body.reason }, now));
    return added(await downtimes.addManual({ from: body.from, to: body.to, reason: body.reason }, now));
  },
};

export const presenceTickDoorRow: DoorRow = {
  key: 'presence-tick',
  method: 'POST',
  path: '/api/_test/presence/tick',
  body: presenceTickDoor,
  async handler(ctx) {
    const p = presenceOf(ctx.deps);
    const now = ctx.deps.clock.now();
    const sample = await p.sampler.sampleOnce(now);
    const finalised = await p.finaliser.finaliseDue(now);
    return { ok: true, value: { now, sample, finalised } };
  },
};

interface HealthDbRow extends Record<string, unknown> {
  moment_ms: string;
  state: string;
  signs: string[];
  recorded_by: string;
  recorded_at: string;
  alarmed_at: string | null;
}
interface SampleDbRow extends Record<string, unknown> {
  node_id: string;
  at: string;
  fast_reachable: boolean;
  fast_run_id: string | null;
  fast_uptime_s: string | null;
  accepted: number;
  failed: number;
}

export const presenceHealthDoorRow: DoorRow = {
  key: 'presence-health',
  method: 'POST',
  path: '/api/_test/presence/health',
  body: presenceHealthDoor,
  async handler(ctx) {
    const { eventId } = ctx.body as z.infer<typeof presenceHealthDoor>;
    const p = presenceOf(ctx.deps);
    const { catalog } = await p.catalog(ctx.deps.clock.now());
    const season = catalog.season;
    if (!season) return failure('not_found', { reason: 'no-season' });
    const db = await rightsDbOf(ctx.deps);
    const records = (
      await db.query<HealthDbRow>(
        `SELECT moment_ms, state, signs, recorded_by, recorded_at, alarmed_at FROM presence_window_health
         WHERE season = $1 AND event_id = $2 ORDER BY moment_ms`,
        [season, eventId],
      )
    ).rows;
    const seen = (await db.query<{ moment_ms: string }>('SELECT moment_ms FROM presence_event_moments WHERE season = $1 AND event_id = $2', [season, eventId])).rows;
    const moments = new Set<number>([...records.map((r) => Number(r.moment_ms)), ...seen.map((r) => Number(r.moment_ms))]);
    const current = catalog.events.get(eventId);
    if (current) moments.add(current.momentMs);
    const sorted = [...moments].sort((a, b) => a - b);
    let samples: SampleDbRow[] = [];
    if (sorted.length > 0) {
      const from = samplesSpanOf(sorted[0]!).from;
      const to = samplesSpanOf(sorted[sorted.length - 1]!).to;
      samples = (
        await db.query<SampleDbRow>(
          `SELECT node_id, at, fast_reachable, fast_run_id, fast_uptime_s, accepted, failed FROM presence_samples
           WHERE at >= $1 AND at <= $2 ORDER BY at, node_id`,
          [String(from), String(to)],
        )
      ).rows.filter((s) => sorted.some((m) => {
        const span = samplesSpanOf(m);
        return Number(s.at) >= span.from && Number(s.at) <= span.to;
      }));
    }
    const downtimes = (await p.downtimes.list(season)).filter((r) => sorted.some((m) => downtimeApplies(healthDowntimeOf(r), eventId, m)));
    return {
      ok: true,
      value: {
        season,
        eventId,
        moments: sorted,
        records: records.map((r) => ({
          momentMs: Number(r.moment_ms),
          state: r.state,
          signs: r.signs,
          recordedBy: r.recorded_by,
          recordedAt: Number(r.recorded_at),
          alarmedAt: r.alarmed_at === null ? null : Number(r.alarmed_at),
        })),
        samples: samples.map((s) => ({
          nodeId: s.node_id,
          at: Number(s.at),
          fastReachable: s.fast_reachable,
          fastRunId: s.fast_run_id,
          fastUptimeS: s.fast_uptime_s === null ? null : Number(s.fast_uptime_s),
          accepted: Number(s.accepted),
          failed: Number(s.failed),
        })),
        downtimes: downtimes.map(view),
      },
    };
  },
};

export const presenceDoors: readonly DoorRow[] = [presenceDowntimeDoorRow, presenceFaultDoorRow, presenceHealthDoorRow, presenceTickDoorRow];
