/**
 * HS256 signer of Centrifugo connection tokens (ring 4, AC-12). The algorithm is fixed here, never taken
 * from input; the payload is exactly `sub`, `iat`, `exp`. Neither the secret nor a token is logged.
 */
import { SignJWT } from 'jose';
import type { TokenSigner } from '../realtime/ports';

export function createHs256Signer(secret: string): TokenSigner {
  const key = new TextEncoder().encode(secret);
  return {
    sign({ sub, iat, exp }) {
      return new SignJWT({ sub, iat, exp }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(key);
    },
  };
}
