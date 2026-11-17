/**
 * Calls Payload's REST handlers directly, bypassing the proxy (AC-5 tests), with an optional
 * identity marker signed by this process — what the proxy adds after a pass. Admin records are
 * made through the Local API (a server-side call).
 */
import config from '@payload-config';
import { REST_DELETE, REST_GET, REST_PATCH, REST_POST } from '@payloadcms/next/routes';
import type { Payload } from 'payload';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { getIdentityMarker } from '../../src/container';
import type { Role } from '../../src/domain/access/roles';

export const ADMIN_HOST = String(process.env.T2F_ADMIN_HOST);

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const HANDLERS = { GET: REST_GET, POST: REST_POST, PATCH: REST_PATCH, DELETE: REST_DELETE } as const;

const exp = () => Math.floor(Date.now() / 1000) + 600;

/** The marker header of a person (owner) or a service token that passed the gate. */
export const personMark = (subject = 'gate-owner@example.com') => ({
  [IDENTITY_HEADER]: getIdentityMarker().sign({ kind: 'person', subject, exp: exp() }),
});
export const serviceMark = (subject = 'agent.access') => ({
  [IDENTITY_HEADER]: getIdentityMarker().sign({ kind: 'service', subject, exp: exp() }),
});

export const apiKeyHeader = (key: string) => ({ authorization: `admins API-Key ${key}` });

/** One REST call of `/cms-api<path>` straight into Payload's route handler. */
export async function rest(method: Method, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  const slug = (path.split('?')[0] ?? '').split('/').filter(Boolean);
  const headers: Record<string, string> = { host: ADMIN_HOST, ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...opts.headers };
  const request = new Request(`http://${ADMIN_HOST}/cms-api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const handler = HANDLERS[method](config) as (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>;
  return handler(request, { params: Promise.resolve({ slug }) });
}

/** Creates an admin record through the Local API (server-side call) and returns its id. */
export async function makeAdmin(payload: Payload, email: string, password: string, role: Role): Promise<number> {
  await payload.delete({ collection: 'admins', where: { email: { equals: email } }, overrideAccess: true });
  const doc = await payload.create({ collection: 'admins', data: { email, password, role }, overrideAccess: true });
  return doc.id;
}

/** The session cookie of a record, from a Local API login (server-side call). */
export async function sessionCookie(payload: Payload, email: string, password: string): Promise<string> {
  const login = await payload.login({ collection: 'admins', data: { email, password } });
  return `payload-token=${login.token ?? ''}`;
}

export async function removeAdmins(payload: Payload, emails: readonly string[]): Promise<void> {
  await payload.delete({ collection: 'admins', where: { email: { in: [...emails] } }, overrideAccess: true });
}
