/**
 * The admin records: the owner and the agents (AC-12 … AC-17).
 * - Session 24 h (owner decision Q1): `tokenExpiration`, which the cookie lifetime follows.
 * - Three roles; one owner. The first owner comes only from `owner:create` (a server-side call);
 *   through the admin or `/cms-api` no record may become a second owner (AC-13, AC-14).
 * - Agents never sign in by password (AC-17); they use an API key the owner issues once (AC-15).
 *   The key fields are never readable or writable through the API: only the key endpoints set them.
 * Access to the records is the `keys` group of the role policy (owner only).
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, Forbidden, initTransaction, killTransaction } from 'payload';
import type { CollectionConfig, Endpoint, PayloadRequest } from 'payload';
import { createKeyService, type AgentKeyStore } from '../access/keys';
import { ACTION_CONTEXT_KEY } from '../audit/journal';
import { isServerCall } from '../access/payloadGuard';
import { accessFor, ownerOnly, roleOf } from '../access/policies';
import { sessionCookieSecure } from '../domain/access/config';
import { ownerChangeRefused, ROLES } from '../domain/access/roles';
import { envClass } from '../platform/env';

/** Owner decision Q1: a Payload session lasts 24 h. */
export const SESSION_SECONDS = 86_400;

const never = () => false;

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

function keyStore(req: PayloadRequest): AgentKeyStore {
  const idOf = (id: string): number | null => (/^\d{1,15}$/.test(id) ? Number(id) : null);
  return {
    async roleOf(id) {
      const n = idOf(id);
      if (n === null) return null;
      const doc = await req.payload.findByID({ collection: 'admins', id: n, req, overrideAccess: true, disableErrors: true, depth: 0 });
      return doc ? String(doc.role) : null;
    },
    async setKey(id, key) {
      const n = idOf(id);
      if (n === null) return;
      // One transaction: Payload writes the key (its hooks compute the HMAC index), then the reversibly
      // encrypted copy is cleared, so only the one-way index stays in the row (NFR-3, finding S4-05).
      // Payload's API-key strategy finds the record by `apiKeyIndex` alone; an update that does not carry
      // `apiKey` leaves the index as it is (`setAPIKeyIndex` drops it from the write).
      const started = await initTransaction(req);
      try {
        await req.payload.update({
          collection: 'admins',
          id: n,
          data: key === null ? { enableAPIKey: false, apiKey: null } : { enableAPIKey: true, apiKey: key },
          req,
          context: { [ACTION_CONTEXT_KEY]: key === null ? 'key.revoke' : 'key.issue' },
          overrideAccess: true,
          depth: 0,
        });
        if (key !== null) await (await sessionOf(req)).execute(sql`UPDATE "admins" SET "api_key" = NULL WHERE "id" = ${n}`);
        if (started) await commitTransaction(req);
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
  };
}

const STATUS = { forbidden: 403, 'not-found': 404, 'not-agent': 400 } as const;
const NO_STORE = { 'cache-control': 'no-store' };

function keyEndpoint(action: 'issue' | 'revoke'): Endpoint {
  return {
    path: `/:id/${action}-key`,
    method: 'post',
    handler: async (req) => {
      const service = createKeyService(keyStore(req));
      const id = String(req.routeParams?.id ?? '');
      const actor = roleOf(req.user);
      const result = action === 'issue' ? await service.issue(actor, id) : await service.revoke(actor, id);
      if (!result.ok) return Response.json({ errors: [{ message: result.reason }] }, { status: STATUS[result.reason], headers: NO_STORE });
      return Response.json('key' in result ? { key: result.key } : { revoked: true }, { headers: NO_STORE });
    },
  };
}

export const admins: CollectionConfig = {
  slug: 'admins',
  labels: { singular: 'Адміністратор', plural: 'Адміністратори' },
  auth: {
    tokenExpiration: SESSION_SECONDS,
    useAPIKey: true,
    cookies: { sameSite: 'Lax', secure: sessionCookieSecure(envClass(process.env)) },
  },
  // Payload's default `unlock` is "any signed-in record"; it runs no `beforeOperation` (S4-02).
  access: { ...accessFor('keys'), unlock: ownerOnly },
  endpoints: [keyEndpoint('issue'), keyEndpoint('revoke')],
  hooks: {
    beforeChange: [
      ({ data, operation, originalDoc, req }) => {
        if ((operation !== 'create' && operation !== 'update') || isServerCall(req)) return data;
        if (operation === 'create' && roleOf(req.user) !== 'owner') throw new Forbidden(req.t);
        const previousRole = (originalDoc as { role?: unknown } | undefined)?.role;
        const nextRole = (data as { role?: unknown }).role ?? (operation === 'create' ? 'owner' : previousRole);
        if (ownerChangeRefused({ operation, nextRole, previousRole })) throw new Forbidden(req.t);
        return data;
      },
    ],
    beforeLogin: [
      ({ req, user }) => {
        if (roleOf(user) !== 'owner') throw new Forbidden(req.t);
        return user;
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: [...ROLES],
      required: true,
      defaultValue: 'owner',
      saveToJWT: true,
    },
    { name: 'enableAPIKey', type: 'checkbox', access: { read: never, create: never, update: never } },
    { name: 'apiKey', type: 'text', access: { read: never, create: never, update: never } },
  ],
};
