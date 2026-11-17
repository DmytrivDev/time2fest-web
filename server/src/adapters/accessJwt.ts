/**
 * Cloudflare Access JWT verifier (AC-2, AC-9, AC-10) — the only user of `jose` for Access.
 * RS256 only; `iss` and `aud` must match; `exp` is checked; `nbf` is not required (service tokens
 * lack it). Keys are picked by `kid` from the remote JWKS (cached 10 min, an unknown `kid`
 * refetches at most once per 30 s, fetch timeout 5 s) or, in the `test` class, from the test
 * signer's local key set.
 * A key-set fetch failure → `jwks-unreachable` plus a log-level alarm. No token and no error
 * message is ever logged (NFR-5).
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AccessVerifier, VerifyResult } from '../access/ports';
import type { Alarm } from '../ports';

export const JWKS_COOLDOWN_MS = 30_000;
export const JWKS_CACHE_MAX_AGE_MS = 600_000;
export const JWKS_TIMEOUT_MS = 5_000;

/** Remote Cloudflare key set. */
export function remoteKeys(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url), {
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    timeoutDuration: JWKS_TIMEOUT_MS,
  });
}

/** A local key set that follows a source which may gain keys (the test signer). */
export function localKeys(source: { jwks(): JSONWebKeySet; version(): number }): JWTVerifyGetKey {
  let built: { version: number; get: JWTVerifyGetKey } | undefined;
  return (header, token) => {
    const version = source.version();
    if (built?.version !== version) built = { version, get: createLocalJWKSet(source.jwks()) };
    return built.get(header, token);
  };
}

/** A failure to obtain the key set, as opposed to a token that does not verify. */
function isKeySetUnreachable(err: unknown): boolean {
  if (err instanceof errors.JWKSTimeout) return true;
  if (err instanceof errors.JOSEError) return err.code === 'ERR_JOSE_GENERIC';
  // Any non-jose error inside jwtVerify comes from fetching the key set (network failure).
  return true;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function createAccessVerifier(opts: {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
  alarm: Alarm;
}): AccessVerifier {
  const { issuer, audience, keys, alarm } = opts;
  return {
    async verify(token): Promise<VerifyResult> {
      if (typeof token !== 'string' || token === '') return { ok: false, reason: 'missing' };
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], issuer, audience }));
      } catch (err) {
        if (isKeySetUnreachable(err)) {
          alarm.raise({ level: 'log', source: 'access', code: 'access-jwks-unreachable' });
          return { ok: false, reason: 'jwks-unreachable' };
        }
        return { ok: false, reason: 'invalid' };
      }
      const sub = str(payload.sub);
      const exp = payload.exp;
      // Cloudflare always sets `sub` (empty for service tokens) and `exp`.
      if (sub === undefined || typeof exp !== 'number' || payload.iss === undefined || payload.aud === undefined) {
        return { ok: false, reason: 'invalid' };
      }
      const email = str(payload.email);
      const commonName = str(payload.common_name);
      return {
        ok: true,
        claims: {
          sub,
          exp,
          iss: payload.iss,
          aud: payload.aud,
          ...(email !== undefined ? { email } : {}),
          ...(commonName !== undefined ? { common_name: commonName } : {}),
        },
      };
    },
  };
}
