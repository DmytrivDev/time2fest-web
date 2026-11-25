/**
 * The Postgres pool Better Auth runs on, plus the small query/transaction port the rights code uses
 * (SPEC-11 [П-2]). Adapter ring: the only place the rights stores meet `pg`.
 */
import pg from 'pg';
import { authOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import type { RightsDb, RightsQuery } from '../rights/ports';

/** The pool `auth/instance.ts` passes to Better Auth as `database`. */
export async function authPool(deps: Deps): Promise<pg.Pool> {
  const ctx = await authOf(deps).instance().$context;
  const db = (ctx.options as { database?: unknown }).database;
  if (!(db instanceof pg.Pool))
    throw new Error('test doors: Better Auth database is not a pg pool');
  return db;
}

function portOf(q: Pick<pg.Pool | pg.PoolClient, 'query'>): RightsQuery {
  return {
    query: async <R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) => {
      const res = await q.query(text, values as unknown[] | undefined);
      return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
    },
  };
}

/** Rights database port over a pool: `tx` holds one client for `BEGIN`…`COMMIT`/`ROLLBACK` and always releases it. */
export function rightsDbOfPool(pool: pg.Pool): RightsDb {
  return {
    ...portOf(pool),
    async tx<T>(fn: (db: RightsQuery) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(portOf(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the original error wins */
        }
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export async function rightsDbOf(deps: Deps): Promise<RightsDb> {
  return rightsDbOfPool(await authPool(deps));
}
