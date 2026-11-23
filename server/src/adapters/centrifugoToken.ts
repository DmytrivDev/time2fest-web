/**
 * HS256 signer of Centrifugo connection tokens (ring 4, AC-12). The algorithm is fixed here, never taken
 * from input; the payload is exactly `sub`, `iat`, `exp`. Subscription tokens (SPEC-12 [П-2]) carry exactly
 * `sub` (always empty: an anonymous subscriber), `channel`, `info`, `iat`, `exp`, signed with the same secret
 * (Centrifugo checks subscription tokens with `client.token.hmac_secret_key` unless a separate key is set).
 * Neither the secret nor a token is logged.
 */
import { SignJWT } from 'jose';
import type { SubscriptionSigner, TokenSigner } from '../realtime/ports';

export function createHs256Signer(secret: string): TokenSigner & SubscriptionSigner {
  const key = new TextEncoder().encode(secret);
  return {
    sign({ sub, iat, exp }) {
      return new SignJWT({ sub, iat, exp }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(key);
    },
    signSubscription({ channel, info, iat, exp }) {
      return new SignJWT({ sub: '', channel, info, iat, exp }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(key);
    },
  };
}
