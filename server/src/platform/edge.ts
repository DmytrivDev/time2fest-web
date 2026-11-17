/**
 * Edge gate and trusted client (ring 3, AC-15 … AC-23, AC-27, NFR-5).
 * - Active in `rehearsal` / `production`, and in `test` when `T2F_EDGE_SECRET` is set (AC-16, AC-17).
 * - `x-t2f-edge` is compared with the secret in constant time whatever its length or prefix
 *   (AC-18): both sides are HMAC-ed under a random per-gate key, then `timingSafeEqual`.
 * - Rotation (SPEC-13a AC-35): with a previous secret, both comparisons always run and either admits.
 * - A refusal is `null` (fail closed): the dispatcher answers its single 404 before route lookup.
 * - Address and country come only from `x-t2f-client` (`<ip>;<country>`, set by the Worker);
 *   no forwarding header is read (AC-20). The raw address lives only in a closure: the context
 *   exposes the country and the daily fingerprint, never the address (AC-23).
 * Nothing here logs.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Clock } from '../ports';
import type { EnvClass } from './env';
import { fingerprintOf, networkOf, utcDay, type DaySalts } from './fingerprint';

const EDGE_HEADER = 'x-t2f-edge';
const CLIENT_HEADER = 'x-t2f-client';
const COUNTRY = /^[A-Z]{2}$/;
/** Cloudflare's "unknown" (`XX`) and "Tor" (`T1`) pseudo-countries. */
const NOT_COUNTRIES: ReadonlySet<string> = new Set(['XX', 'T1']);

/** What handlers and middleware learn about the client. No address field (AC-23). */
export interface ClientContext {
  /** ISO 3166-1 alpha-2 country from the edge, or `unknown` (AC-21). */
  country: string;
  /** The request carried the valid edge secret. */
  edgeVerified: boolean;
  /** The edge sent a valid IPv4 / IPv6 address. */
  addressPresent: boolean;
  /** The `ipDay` rate-limit value: `fp:<hex>` of the address, or the no-address bucket (AC-22). */
  ipDay(): Promise<string>;
}

export interface EdgeGate {
  readonly active: boolean;
  /** The client of `req`, or `null` when the edge check refuses it. */
  admit(req: Request): ClientContext | null;
}

export interface EdgeGateDeps {
  envClass: EnvClass;
  secret: string | undefined;
  /** The secret being rotated out (SPEC-13a AC-35); accepted alongside `secret` while set. */
  previousSecret?: string | undefined;
  salts: DaySalts;
  clock: Clock;
}

function noAddress(edgeVerified: boolean, country: string, clock: Clock): ClientContext {
  return {
    country,
    edgeVerified,
    addressPresent: false,
    ipDay: async () => `noaddr:${utcDay(clock.now())}`,
  };
}

function countryOf(part: string): string {
  return COUNTRY.test(part) && !NOT_COUNTRIES.has(part) ? part : 'unknown';
}

/** A gate that checks nothing and trusts no address (class `test` without a secret, AC-17). */
export function inactiveEdgeGate(clock: Clock): EdgeGate {
  return { active: false, admit: () => noAddress(false, 'unknown', clock) };
}

/** The gate of a process. `secret` is never logged, returned or stored. */
export function createEdgeGate({ envClass, secret, previousSecret, salts, clock }: EdgeGateDeps): EdgeGate {
  const known = secret !== undefined && secret !== '';
  const active = envClass !== 'test' || known;
  if (!active) return inactiveEdgeGate(clock);

  const key = randomBytes(32);
  const mac = (value: string) => createHmac('sha256', key).update(value).digest();
  // An active gate without a secret (never built by `loadEnv`) refuses everything.
  const expected = known ? mac(secret) : undefined;
  // The previous secret only extends a gate that has a current one.
  const expectedPrev = known && previousSecret !== undefined && previousSecret !== '' ? mac(previousSecret) : undefined;

  return {
    active,
    admit(req) {
      if (expected === undefined) return null;
      const received = mac(req.headers.get(EDGE_HEADER) ?? '');
      // Both comparisons run on every request; no early return between them.
      const a = timingSafeEqual(received, expected);
      const b = expectedPrev !== undefined ? timingSafeEqual(received, expectedPrev) : false;
      if (!(a || b)) return null;

      const parts = (req.headers.get(CLIENT_HEADER) ?? '').split(';');
      if (parts.length !== 2) return noAddress(true, 'unknown', clock);
      const [ip, countryPart] = parts as [string, string];
      const country = countryOf(countryPart);
      const network = isIP(ip) === 4 || isIP(ip) === 6 ? networkOf(ip) : undefined;
      if (network === undefined) return noAddress(true, country, clock);

      let pending: Promise<string> | undefined;
      return {
        country,
        edgeVerified: true,
        addressPresent: true,
        ipDay: () => (pending ??= salts.saltFor().then((salt) => `fp:${fingerprintOf(network, salt)}`)),
      };
    },
  };
}
