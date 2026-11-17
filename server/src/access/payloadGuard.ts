/**
 * The second check inside Payload (AC-5; second half of AC-1). Payload glue (ring 4), thin.
 *
 * `harden` adds to a collection, `hardenGlobal` to a global:
 * - `beforeOperation`: refuses every operation (read, create, update, delete, login, refresh,
 *   forgot-password, …) unless the request carries the identity marker the proxy set for this
 *   request, or it is a server-side call;
 * - every custom endpoint is wrapped with the same check (endpoints run no operation hooks);
 * - on an auth collection: `afterMe` refuses `me`, `beforeLogin` requires a person identity, and
 *   `access.admin` (the admin UI) requires a person identity and the `owner` role.
 *
 * A server-side call is a Local API call that carries no inbound HTTP request (no `Host`): the
 * CLI, the seed, services, and Payload's own user lookup when the admin UI resolves its session.
 * A caller may also say so explicitly with `context: { t2fTrusted: true }`. REST requests
 * (`payloadAPI === 'REST'`) and admin-UI requests (Local API with the request's headers) are never
 * server-side calls, so without the marker they are refused (W10 spike: REST hooks see headers;
 * Local API calls carry none).
 */
import { Forbidden } from 'payload';
import type { CollectionConfig, CollectionSlug, Endpoint, GlobalConfig, PayloadRequest } from 'payload';
import { createIdentityMarker, IDENTITY_HEADER } from '../adapters/identityMarker';
import { auditAfterChange, auditAfterDelete } from '../collections/auditHooks';
import { realClock } from '../clock';
import type { AccessIdentity } from './ports';
import { roleOf } from './policies';

/** The request context key a server-side Local API caller may set. */
export const TRUSTED_CONTEXT_KEY = 't2fTrusted';

const marker = createIdentityMarker(realClock);

type GuardedRequest = Pick<PayloadRequest, 'context' | 'headers' | 'payloadAPI'>;

/** A Local API call made by server code, not on behalf of an inbound HTTP request. */
export function isServerCall(req: GuardedRequest): boolean {
  if (req.context?.[TRUSTED_CONTEXT_KEY] === true) return true;
  return req.payloadAPI === 'local' && !req.headers?.get('host');
}

/** Who passed the Access gate for this request, or `null`. */
export function gateIdentity(req: Pick<PayloadRequest, 'headers'>): AccessIdentity | null {
  return marker.verify(req.headers?.get(IDENTITY_HEADER));
}

/** The request passed the gate, or is a server-side call. */
export function passedGate(req: GuardedRequest): boolean {
  return isServerCall(req) || gateIdentity(req) !== null;
}

/**
 * The request declares a JSON body (`application/json`, any parameters). A custom endpoint that reads
 * a JSON body requires it (S4-01): a cross-site form or a `no-cors` fetch cannot send this type
 * without a CORS preflight.
 */
export function hasJsonContentType(req: Pick<PayloadRequest, 'headers'>): boolean {
  const type = req.headers?.get('content-type') ?? '';
  return type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function refuseUnlessPassed(req: PayloadRequest): void {
  if (!passedGate(req)) throw new Forbidden(req.t);
}

function guardEndpoints(endpoints: Endpoint[] | false | undefined): Endpoint[] | false | undefined {
  if (!Array.isArray(endpoints)) return endpoints;
  return endpoints.map((e) => ({
    ...e,
    handler: async (req: PayloadRequest) => (passedGate(req) ? e.handler(req) : Response.json({ errors: [] }, { status: 403 })),
  }));
}

type AdminAccess = NonNullable<NonNullable<CollectionConfig['access']>['admin']>;

/** Admin UI: a person who passed the gate, signed in as the owner. */
function adminAccess(existing: AdminAccess | undefined): AdminAccess {
  return async (args) => {
    const { req } = args;
    if (gateIdentity(req)?.kind !== 'person' || roleOf(req.user) !== 'owner') return false;
    return existing ? Boolean(await existing(args)) : true;
  };
}

/**
 * Adds the second check to a collection (see the module comment); with `audited`, also the journal
 * hooks (AC-20), after the collection's own `afterChange`/`afterDelete`.
 */
export function harden(collection: CollectionConfig, options: { audited?: boolean } = {}): CollectionConfig {
  const hooks = collection.hooks ?? {};
  const slug = collection.slug as CollectionSlug;
  const audit = options.audited
    ? {
        afterChange: [...(hooks.afterChange ?? []), auditAfterChange(slug)],
        afterDelete: [...(hooks.afterDelete ?? []), auditAfterDelete(slug)],
      }
    : {};
  const guarded: CollectionConfig = {
    ...collection,
    endpoints: guardEndpoints(collection.endpoints),
    hooks: {
      ...hooks,
      ...audit,
      beforeOperation: [({ req }) => refuseUnlessPassed(req), ...(hooks.beforeOperation ?? [])],
    },
  };
  if (!collection.auth) return guarded;
  return {
    ...guarded,
    access: { ...collection.access, admin: adminAccess(collection.access?.admin) },
    hooks: {
      ...guarded.hooks,
      afterMe: [
        ({ req, response }) => {
          refuseUnlessPassed(req);
          return response;
        },
        ...(hooks.afterMe ?? []),
      ],
      beforeLogin: [
        ({ req, user }) => {
          if (!isServerCall(req) && gateIdentity(req)?.kind !== 'person') throw new Forbidden(req.t);
          return user;
        },
        ...(hooks.beforeLogin ?? []),
      ],
    },
  };
}

/** Adds the second check to a global. */
export function hardenGlobal(global: GlobalConfig): GlobalConfig {
  const hooks = global.hooks ?? {};
  return {
    ...global,
    endpoints: guardEndpoints(global.endpoints),
    hooks: {
      ...hooks,
      beforeOperation: [
        ({ args, req }) => {
          refuseUnlessPassed(req);
          return args;
        },
        ...(hooks.beforeOperation ?? []),
      ],
    },
  };
}
