/**
 * The agent key write over Payload (AC-15, NFR-3, finding S4-05), ring 4 — the `admins` collection's key endpoints
 * call this one function (A21-01: the collection stays thin, the SQL lives here).
 *
 * One transaction: Payload writes the key (its hooks compute the HMAC index), then the reversibly encrypted copy is
 * cleared, so only the one-way index stays in the row. Payload's API-key strategy finds the record by `apiKeyIndex`
 * alone; an update that does not carry `apiKey` leaves the index as it is (`setAPIKeyIndex` drops it from the write).
 * When the caller already holds a transaction on `req`, the write joins it and neither commits nor kills it: a
 * failure is rethrown for the caller to roll back (S21-06).
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload';
import { ACTION_CONTEXT_KEY } from '../audit/journal';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/** The open transaction's connection of `req`. */
async function sessionOf(req: PayloadRequest): Promise<Exec> {
  const db = req.payload.db as unknown as { sessions: Record<string, { db: Exec } | undefined> };
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('admins: the key write needs an open transaction');
  return session;
}

/** Issues (`key`) or revokes (`null`) the API key of admins record `id`, keeping only the HMAC index. */
export async function writeAdminKey(req: PayloadRequest, id: number, key: string | null): Promise<void> {
  const started = await initTransaction(req);
  try {
    await req.payload.update({
      collection: 'admins',
      id,
      data: key === null ? { enableAPIKey: false, apiKey: null } : { enableAPIKey: true, apiKey: key },
      req,
      context: { [ACTION_CONTEXT_KEY]: key === null ? 'key.revoke' : 'key.issue' },
      overrideAccess: true,
      depth: 0,
    });
    if (key !== null) await (await sessionOf(req)).execute(sql`UPDATE "admins" SET "api_key" = NULL WHERE "id" = ${id}`);
    if (started) await commitTransaction(req);
  } catch (err) {
    if (started) await killTransaction(req);
    throw err;
  }
}
