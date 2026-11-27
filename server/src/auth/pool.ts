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

/**
 * Connections of the presence pool (S14-03): beats (the via-DB path included), proofs, claims and the health log run
 * on their own small pool, so a Redis-down midnight that sends every beat to Postgres cannot starve sign-in and
 * `getSession` on the auth pool. A request that cannot get a connection within `PRESENCE_CONNECT_TIMEOUT_MS`, or a
 * statement over `PRESENCE_STATEMENT_TIMEOUT_MS`, throws; the presence services answer that `unavailable` with
 * `retryAfterMs` (never `no-presence`).
 */
export const PRESENCE_POOL_MAX = 8;
export const PRESENCE_CONNECT_TIMEOUT_MS = 2_000;
export const PRESENCE_STATEMENT_TIMEOUT_MS = 5_000;

const presencePools = new WeakMap<pg.Pool, pg.Pool>();

/** The presence pool beside the auth pool of `src` (same database, built once per auth pool). */
export async function presencePool(src: AuthPoolSource): Promise<pg.Pool> {
  const auth = await authPool(src);
  let pool = presencePools.get(auth);
  if (pool === undefined) {
    const base = auth.options as pg.PoolConfig;
    pool = new pg.Pool({
      ...(base.connectionString !== undefined ? { connectionString: base.connectionString } : {}),
      max: PRESENCE_POOL_MAX,
      connectionTimeoutMillis: PRESENCE_CONNECT_TIMEOUT_MS,
      statement_timeout: PRESENCE_STATEMENT_TIMEOUT_MS,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    // An idle client's error (database restart) must not crash the process; the next query reconnects.
    pool.on('error', () => undefined);
    presencePools.set(auth, pool);
  }
  return pool;
}

/** Presence database port over the presence pool (S14-03). */
export async function presenceDbOf(src: AuthPoolSource): Promise<RightsDb> {
  return rightsDbOfPool(await presencePool(src));
}
