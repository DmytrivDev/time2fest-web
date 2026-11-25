/**
 * Ports of the rights domain (SPEC-11). The store interfaces are filled in by later phases
 * (passes P5, bans P8, profiles P9); only the database port is final here.
 */

export interface DbResult<R> {
  rows: R[];
  rowCount: number;
}

/** A query handle: the pool, or the one client inside a transaction. */
export interface RightsQuery {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DbResult<R>>;
}

export interface RightsDb extends RightsQuery {
  /** Runs `fn` on one client between BEGIN and COMMIT; any throw rolls back; the client is always released. */
  tx<T>(fn: (db: RightsQuery) => Promise<T>): Promise<T>;
}

/** Pass storage: the service of `rights/passes.ts` (P5). */
export type { PassService as PassStore } from './passes';

/** Ban storage (filled in by P8). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BanStore {}

/** Profile storage (filled in by P9). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProfileStore {}
