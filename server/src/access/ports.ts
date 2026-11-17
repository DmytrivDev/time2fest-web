/**
 * Ports of the Access gate (ring 2): verifying the Cloudflare Access JWT, marking the request
 * that passed the gate for the second check inside Payload, and the denial log line.
 */
import type { AccessClaims, DenyReason, VerifyFailure } from '../domain/access/classify';

export type VerifyResult =
  | { ok: true; claims: AccessClaims & { iss: string; aud: string | string[] } }
  | { ok: false; reason: VerifyFailure };

/** Verifies `Cf-Access-Jwt-Assertion`: RS256 only, issuer, audience, expiry, key by `kid`. */
export interface AccessVerifier {
  verify(token: string | null | undefined): Promise<VerifyResult>;
}

/** Who passed the gate; `subject` is the owner email or the service `common_name`. */
export interface AccessIdentity {
  kind: 'person' | 'service';
  subject: string;
  /** Expiry of the Access JWT, seconds since the epoch. */
  exp: number;
}

/** Signs the identity into a request header value that only this process can produce. */
export interface IdentityMarker {
  sign(identity: AccessIdentity): string;
  /** The identity, or `null` when the value is absent, forged or expired. */
  verify(value: string | null | undefined): AccessIdentity | null;
}

/** One log line per denial reason, throttled (NFR-8). */
export interface DenyLog {
  deny(reason: DenyReason): void;
}
