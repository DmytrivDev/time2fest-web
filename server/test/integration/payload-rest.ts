/**
 * Calls Payload's REST handlers directly, bypassing the proxy (AC-5 tests), with an optional
 * identity marker signed by this process — what the proxy adds after a pass. Admin records are
 * made through the Local API (a server-side call).
 */
import config from '@payload-config';
import { REST_DELETE, REST_GET, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes';
import type { Payload } from 'payload';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { getIdentityMarker } from '../../src/container';
import type { Role } from '../../src/domain/access/roles';

export const ADMIN_HOST = String(process.env.T2F_ADMIN_HOST);

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const HANDLERS = { GET: REST_GET, POST: REST_POST, PATCH: REST_PATCH, PUT: REST_PUT, DELETE: REST_DELETE } as const;

const exp = () => Math.floor(Date.now() / 1000) + 600;

/** The marker header of a person (owner) or a service token that passed the gate. */
export const personMark = (subject = 'gate-owner@example.com') => ({
  [IDENTITY_HEADER]: getIdentityMarker().sign({ kind: 'person', subject, exp: exp() }),
});
export const serviceMark = (subject = 'agent.access') => ({
  [IDENTITY_HEADER]: getIdentityMarker().sign({ kind: 'service', subject, exp: exp() }),
});

export const apiKeyHeader = (key: string) => ({ authorization: `admins API-Key ${key}` });

/** The origin a browser on the admin page sends (test class: plain http). */
export const ADMIN_ORIGIN = `http://${ADMIN_HOST.toLowerCase()}`;

/**
 * What a browser adds to a same-origin call from the admin page: `Sec-Fetch-Site`, and `Origin` on a
 * write. Payload's `csrf` setting reads them before it accepts the session cookie (S4-01).
 */
const browserHeaders = (method: Method, headers: Record<string, string> | undefined): Record<string, string> =>
  headers?.cookie === undefined ? {} : { 'sec-fetch-site': 'same-origin', ...(method === 'GET' ? {} : { origin: ADMIN_ORIGIN }) };

/** One REST call of `/cms-api<path>` straight into Payload's route handler. */
export async function rest(method: Method, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  const slug = (path.split('?')[0] ?? '').split('/').filter(Boolean);
  const headers: Record<string, string> = {
    host: ADMIN_HOST,
    ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...browserHeaders(method, opts.headers),
    ...opts.headers,
  };
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
