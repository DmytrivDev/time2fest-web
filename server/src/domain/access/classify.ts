/**
 * Access gate rules (AC-1, AC-3, AC-4, AC-6). Ring 1: pure functions, no I/O.
 *
 * - `/api` and `/api/*` are the public API: never gated.
 * - `/admin*` and `/cms-api*` on a host other than the admin host → 404, like an unknown path.
 * - Any other path needs a valid Access JWT: an owner person, or an allowed service token.
 * - A service token reaches only `/cms-api/*`.
 */
import type { AccessConfig } from './config';
import { isOwnerEmail } from './ownerEmails';

/** The claims of a verified Access JWT that the gate reads. */
export interface AccessClaims {
  sub: string;
  email?: string;
  common_name?: string;
  exp: number;
}

export type Classification = 'person-owner' | 'person-foreign' | 'service-allowed' | 'service-foreign';

/** Why the gate refused; logged as a code, never with the token or the email (NFR-8). */
export type DenyReason =
  | 'missing'
  | 'invalid'
  | 'jwks-unreachable'
  | 'no-config'
  | 'foreign-email'
  | 'foreign-service'
  | 'service-path';

export type VerifyFailure = 'missing' | 'invalid' | 'jwks-unreachable';

/** The verification outcome as the rules see it. */
export type GateAuth = { ok: true; kind: Classification } | { ok: false; reason: VerifyFailure | 'no-config' };

export type Decision = { kind: 'pass' } | { kind: 'deny403'; reason: DenyReason } | { kind: 'notFound404' };

/** A person token has a non-empty `sub` and an `email`; a service token an empty `sub` and a `common_name`. */
export function classify(claims: AccessClaims, config: Pick<AccessConfig, 'ownerEmails' | 'serviceCommonNames'>): Classification {
  if (claims.sub === '') {
    const cn = claims.common_name;
    return typeof cn === 'string' && cn !== '' && config.serviceCommonNames.includes(cn) ? 'service-allowed' : 'service-foreign';
  }
  return isOwnerEmail(config.ownerEmails, claims.email) ? 'person-owner' : 'person-foreign';
}

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** The public API, never gated. */
export const isPublicApiPath = (path: string): boolean => under(path, '/api');

/** Paths served by Payload: the admin UI and its REST API. */
export const isPayloadPath = (path: string): boolean => under(path, '/admin') || under(path, '/cms-api');

/** The verdict for one request. `adminHost` is `undefined` when Access is not configured. */
export function decide(input: { path: string; host: string; adminHost: string | undefined; auth: GateAuth }): Decision {
  const { path, host, adminHost, auth } = input;
  if (isPublicApiPath(path)) return { kind: 'pass' };
  if (adminHost !== undefined && isPayloadPath(path) && host.toLowerCase() !== adminHost.toLowerCase()) {
    return { kind: 'notFound404' };
  }
  if (!auth.ok) return { kind: 'deny403', reason: auth.reason };
  if (auth.kind === 'service-allowed' || auth.kind === 'service-foreign') {
    if (!under(path, '/cms-api')) return { kind: 'deny403', reason: 'service-path' };
    return auth.kind === 'service-allowed' ? { kind: 'pass' } : { kind: 'deny403', reason: 'foreign-service' };
  }
  return auth.kind === 'person-owner' ? { kind: 'pass' } : { kind: 'deny403', reason: 'foreign-email' };
}
