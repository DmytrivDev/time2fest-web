/**
 * Access gate rules (AC-1, AC-3, AC-4, AC-6). Ring 1: pure functions, no I/O.
 *
 * - `/api` and `/api/*` are the public API: never gated.
 * - Every other path on a host other than the admin host → 404, like an unknown path.
 * - Any other path needs a valid Access JWT: an owner person, or an allowed service token.
 * - A state-changing request from a browser on another origin → 403 (CSRF, S4-01).
 * - A service token reaches only an allow-list of `/cms-api/*` paths (S4-02).
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
  | 'service-path'
  | 'cross-origin';

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

/** Payload's first-register screen and its REST call: absent in every class (AC-13). */
export const isFirstRegisterPath = (path: string): boolean =>
  under(path, '/admin/create-first-user') || under(path, '/cms-api/admins/first-register');

/** The catalog collections a service identity may read (AC-18). */
export const CATALOG_SLUGS = ['cities', 'countries', 'events', 'seasons', 'traditions', 'zones'] as const;

const READ_METHODS = new Set(['GET', 'HEAD']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The only paths a service identity (agent) may reach (S4-02): reads of the catalog collections
 * and of `/cms-api/admins/me`, and in the `test` class the `agent-test-posts` collection (AC-19).
 * Payload's built-in collections, the admins records and their auth operations, and globals are not
 * on the list.
 */
export function servicePathAllowed(path: string, method: string, testClass: boolean): boolean {
  const m = method.toUpperCase();
  if (testClass && under(path, '/cms-api/agent-test-posts')) return true;
  if (!READ_METHODS.has(m)) return false;
  return path === '/cms-api/admins/me' || CATALOG_SLUGS.some((slug) => under(path, `/cms-api/${slug}`));
}

/**
 * A state-changing request that a browser sent from another origin (S4-01): `Origin`, if present,
 * must be one of `adminOrigins`, and `Sec-Fetch-Site`, if present, `same-origin` or `none`.
 * A client that sends neither (an agent) is not a browser and is not refused here.
 */
export function crossOriginWrite(input: { method: string; origin: string | null; fetchSite: string | null; adminOrigins: readonly string[] }): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (input.origin !== null && !input.adminOrigins.includes(input.origin.toLowerCase())) return true;
  return input.fetchSite !== null && input.fetchSite !== 'same-origin' && input.fetchSite !== 'none';
}

export interface DecideInput {
  path: string;
  host: string;
  /** `undefined` when Access is not configured. */
  adminHost: string | undefined;
  auth: GateAuth;
  /** HTTP method; absent → `GET`. */
  method?: string;
  /** `Origin` and `Sec-Fetch-Site` of the request, `null` when absent. */
  origin?: string | null;
  fetchSite?: string | null;
  /** Origins of the admin (scheme + admin host) that may send state-changing requests. */
  adminOrigins?: readonly string[];
  /** The `test` class: `agent-test-posts` is open to services. */
  testClass?: boolean;
}

/**
 * The verdict for one request. On a host other than the admin host every gated path answers like a
 * path with no route (AC-6): known and unknown paths go through the same rewrite, so they cannot be
 * told apart, not even by their headers.
 */
export function decide(input: DecideInput): Decision {
  const { path, host, adminHost, auth } = input;
  const method = input.method ?? 'GET';
  if (isPublicApiPath(path)) return { kind: 'pass' };
  if (adminHost !== undefined && host.toLowerCase() !== adminHost.toLowerCase()) return { kind: 'notFound404' };
  if (!auth.ok) return { kind: 'deny403', reason: auth.reason };
  // After the JWT check, so without a JWT this path is 403 like every other (AC-1).
  if (isFirstRegisterPath(path)) return { kind: 'notFound404' };
  if (crossOriginWrite({ method, origin: input.origin ?? null, fetchSite: input.fetchSite ?? null, adminOrigins: input.adminOrigins ?? [] })) {
    return { kind: 'deny403', reason: 'cross-origin' };
  }
  if (auth.kind === 'service-allowed' || auth.kind === 'service-foreign') {
    if (!servicePathAllowed(path, method, input.testClass === true)) return { kind: 'deny403', reason: 'service-path' };
    return auth.kind === 'service-allowed' ? { kind: 'pass' } : { kind: 'deny403', reason: 'foreign-service' };
  }
  return auth.kind === 'person-owner' ? { kind: 'pass' } : { kind: 'deny403', reason: 'foreign-email' };
}
