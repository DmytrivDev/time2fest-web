/**
 * The `run-records` table of the run recorder (SPEC-07 W29, AC-27, AC-29, AC-73), ring 4. Raw SQL
 * over Payload's pool, like `pgScheduler.ts`: the unique `consequence_id` makes the write idempotent
 * (`ON CONFLICT DO NOTHING`), so a retried consequence never makes a second row. Connection
 * failures surface as `DependencyUnavailable('postgres')`. Payload rows never leave.
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload } from 'payload';
import { isDependencyFailure } from '../endpoints/pipeline';
import { DependencyUnavailable } from '../ports';
import type { RunRecord, RunRecordStore } from '../scheduler/recorder';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

function keysOf(v: unknown): string[] {
  const parsed: unknown = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

export function createPayloadRunRecordStore(payload: () => Promise<Payload>): RunRecordStore {
  const db = async (): Promise<Exec> => ((await payload()).db as unknown as { drizzle: Exec }).drizzle;
  return {
    record(row: RunRecord) {
      return guard(async () => {
        const { rows } = await (await db()).execute(sql`
          INSERT INTO "run_records" ("consequence_id", "keys", "action", "run_epoch", "planned_at", "started_at", "at")
          VALUES (${row.consequenceId}, ${JSON.stringify(row.keys)}::jsonb, ${row.action}, ${row.runEpoch}::numeric,
            ${row.plannedAt}::numeric, ${row.startedAt}::numeric, ${row.at}::numeric)
          ON CONFLICT ("consequence_id") DO NOTHING
          RETURNING "id"`);
        return rows.length > 0;
      });
    },
    list(runEpoch: number) {
      return guard(async () => {
        const { rows } = await (await db()).execute(sql`
          SELECT "consequence_id", "keys", "action", "run_epoch"::text AS "run_epoch", "planned_at"::text AS "planned_at",
            "started_at"::text AS "started_at", "at"::text AS "at"
          FROM "run_records" WHERE "run_epoch" = ${runEpoch}::numeric
          ORDER BY "started_at", "id"`);
        return rows.map(
          (r): RunRecord => ({
            consequenceId: String(r.consequence_id),
            keys: keysOf(r.keys),
            action: String(r.action),
            runEpoch: num(r.run_epoch),
            plannedAt: num(r.planned_at),
            startedAt: num(r.started_at),
            at: num(r.at),
          }),
        );
      });
    },
  };
}
