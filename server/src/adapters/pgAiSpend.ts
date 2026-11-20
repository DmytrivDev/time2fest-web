/**
 * Postgres store of the AI spend sums (SPEC-09 AC-28 … AC-31), ring 4. Raw SQL over Payload's pool
 * on the collection `ai-spend` (table `ai_spend`, one row per bucket, unique `period`).
 *
 * - `add` is one atomic upsert that returns the new total: concurrent adds from several processes
 *   serialise on the row and never lose a sum.
 * - `claimAlarm` is a conditional update (`alarmNN_at IS NULL`): exactly one caller per bucket and
 *   level wins, cluster-wide.
 * - `amount_micros` is `numeric`; `pg` returns it as a string — converted here. Rows never leave.
 * Connection failures surface as `DependencyUnavailable('postgres')`.
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload } from 'payload';
import type { SpendLevel } from '../domain/moderation/spend';
import { isDependencyFailure } from '../endpoints/pipeline';
import type { SpendStore } from '../moderation/spend';
import { DependencyUnavailable } from '../ports';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

const ALARM_COLUMN: Record<SpendLevel, ReturnType<typeof sql.raw>> = {
  50: sql.raw('"alarm50_at"'),
  80: sql.raw('"alarm80_at"'),
  100: sql.raw('"alarm100_at"'),
};

export function createPgAiSpend(payload: () => Promise<Payload>): SpendStore {
  const db = async (): Promise<Exec> => ((await payload()).db as unknown as { drizzle: Exec }).drizzle;
  const micros = (n: number) => Math.max(0, Math.round(n));

  return {
    add: (period, amount) =>
      guard(async () => {
        const { rows } = await (await db()).execute(sql`
          INSERT INTO "ai_spend" ("period", "amount_micros", "updated_at", "created_at")
          VALUES (${period}, ${micros(amount)}, now(), now())
          ON CONFLICT ("period") DO UPDATE
            SET "amount_micros" = "ai_spend"."amount_micros" + EXCLUDED."amount_micros", "updated_at" = now()
          RETURNING "amount_micros"::text AS "amount"`);
        return num(rows[0]?.amount);
      }),
    read: (periods) =>
      guard(async () => {
        const out = new Map<string, number>();
        if (periods.length === 0) return out;
        const list = sql.join(
          periods.map((p) => sql`${p}`),
          sql`, `,
        );
        const { rows } = await (await db()).execute(sql`
          SELECT "period", "amount_micros"::text AS "amount" FROM "ai_spend" WHERE "period" IN (${list})`);
        for (const row of rows) out.set(String(row.period), num(row.amount));
        return out;
      }),
    claimAlarm: (period, level) =>
      guard(async () => {
        const col = ALARM_COLUMN[level];
        const { rows } = await (await db()).execute(sql`
          UPDATE "ai_spend" SET ${col} = now(), "updated_at" = now()
          WHERE "period" = ${period} AND ${col} IS NULL
          RETURNING "id"`);
        return rows.length === 1;
      }),
    set: (period, amount) =>
      guard(async () => {
        await (await db()).execute(sql`
          INSERT INTO "ai_spend" ("period", "amount_micros", "updated_at", "created_at")
          VALUES (${period}, ${micros(amount)}, now(), now())
          ON CONFLICT ("period") DO UPDATE SET "amount_micros" = EXCLUDED."amount_micros", "updated_at" = now()`);
      }),
  };
}
