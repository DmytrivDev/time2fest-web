/**
 * The intake sampler of the health log (SPEC-14 [А4], [П-5]; AC-14, AC-22), application ring. Every 5 s of server
 * time (started with the background jobs; in `test` the `presence-tick` door drives it) a node writes one row to
 * `presence_samples`: its id, whether the fast store answered, the fast store's run id and uptime (`FastStore.info`),
 * and the beats it accepted and failed since its previous sample — no subject data (NFR-5). A failed write raises
 * `presence/finalise-failed` (`log`, AC-22) and puts the counts back, so the next sample carries them.
 * Time comes from the caller (the server clock, NFR-8).
 */
import type { Alarm, FastStore } from '../ports';
import { assertDbWritable, presenceFaults, type PresenceFaultSwitch } from './faults';
import type { NodeIntake } from './intake';
import type { RightsDb, SampleRow, SampleStore } from './ports';

/** The key the reachability probe reads when the store has no `info()` (never written). */
const PROBE_KEY = 'pr:probe';

export const FINALISE_FAILED = 'presence/finalise-failed';

export interface SampleOutcome {
  ok: boolean;
  at: number;
  fastReachable: boolean;
}

export interface Sampler {
  sampleOnce(now: number): Promise<SampleOutcome>;
}

export interface SamplerDeps {
  db(): Promise<RightsDb>;
  fast(): FastStore;
  store: SampleStore;
  intake: NodeIntake;
  nodeId: string;
  alarm: Alarm;
  faults?: PresenceFaultSwitch;
}

export function createSampler(deps: SamplerDeps): Sampler {
  const faults = deps.faults ?? presenceFaults;
  return {
    async sampleOnce(now) {
      let fastReachable = true;
      let runId: string | null = null;
      let uptimeS: number | null = null;
      try {
        const store = deps.fast();
        if (store.info) {
          const info = await store.info();
          runId = info.runId || null;
          uptimeS = Number.isFinite(info.uptimeS) ? Math.max(0, Math.floor(info.uptimeS)) : null;
        } else {
          await store.get(PROBE_KEY);
        }
      } catch {
        fastReachable = false;
      }
      const counts = deps.intake.take();
      try {
        assertDbWritable(faults);
        await deps.store.add(await deps.db(), {
          node_id: deps.nodeId,
          at: now,
          fast_reachable: fastReachable,
          fast_run_id: runId,
          fast_uptime_s: uptimeS,
          accepted: counts.accepted,
          failed: counts.failed,
        });
        return { ok: true, at: now, fastReachable };
      } catch {
        deps.intake.accepted(counts.accepted);
        deps.intake.failed(counts.failed);
        deps.alarm.raise({ level: 'log', source: 'presence', code: 'presence/finalise-failed', details: { stage: 'sample', node: deps.nodeId } });
        return { ok: false, at: now, fastReachable };
      }
    },
  };
}

/** `presence_samples` over `RightsDb` (raw SQL, [П-1]). Two samples of one node at one instant (a frozen test clock) add up. */
export function createSqlSampleStore(): SampleStore {
  return {
    async add(db, row) {
      await db.query(
        `INSERT INTO presence_samples (node_id, at, fast_reachable, fast_run_id, fast_uptime_s, accepted, failed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (node_id, at) DO UPDATE SET
           fast_reachable = presence_samples.fast_reachable AND EXCLUDED.fast_reachable,
           fast_run_id = COALESCE(EXCLUDED.fast_run_id, presence_samples.fast_run_id),
           fast_uptime_s = COALESCE(EXCLUDED.fast_uptime_s, presence_samples.fast_uptime_s),
           accepted = presence_samples.accepted + EXCLUDED.accepted,
           failed = presence_samples.failed + EXCLUDED.failed`,
        [row.node_id, String(row.at), row.fast_reachable, row.fast_run_id, row.fast_uptime_s === null ? null : String(row.fast_uptime_s), row.accepted, row.failed],
      );
    },
    async between(db, fromMs, toMs) {
      const res = await db.query<SampleRow & Record<string, unknown>>(
        `SELECT node_id, at, fast_reachable, fast_run_id, fast_uptime_s, accepted, failed FROM presence_samples
         WHERE at >= $1 AND at <= $2 ORDER BY at, node_id`,
        [String(fromMs), String(toMs)],
      );
      return res.rows;
    },
    async pruneBefore(db, atMs) {
      const res = await db.query('DELETE FROM presence_samples WHERE at < $1', [String(atMs)]);
      return res.rowCount;
    },
  };
}
