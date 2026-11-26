/**
 * The Postgres pool Better Auth runs on, plus the small query/transaction port the rights code uses
 * (SPEC-11 [П-2]). Adapter ring: the only place the rights stores meet `pg`.
 */
import pg from 'pg';
import type { RightsDb, RightsQuery } from '../rights/ports';
import type { AuthWiring } from './instance';

/**
 * What the pool getters read: the auth wiring only (A2: no `Deps`, no import of `endpoints/deps`, so the
 * `endpoints/deps` <-> `auth/pool` cycle is gone). Any `Deps` fits.
 */
export interface AuthPoolSource {
  auth?: AuthWiring;
}

function wiringOf(src: AuthPoolSource): AuthWiring {
  if (src.auth === undefined) throw new Error('deps.auth is not built (createDeps builds it)');
  return src.auth;
}

/** The pool `auth/instance.ts` passes to Better Auth as `database`. */
export async function authPool(src: AuthPoolSource): Promise<pg.Pool> {
  const ctx = await wiringOf(src).instance().$context;
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

export async function rightsDbOf(src: AuthPoolSource): Promise<RightsDb> {
  return rightsDbOfPool(await authPool(src));
}
