/**
 * Test signer of Access JWTs (AC-8) — `test` class only. Imported statically only by the test
 * doors module (itself loaded by a dynamic `import()` after `shouldLoadDoors`) and dynamically by
 * the `test-signer:` branch of the composition root. Its key material exists nowhere else.
 *
 * One process-wide RS256 key set lives on `globalThis`, so the doors and the verifier of the same
 * process share it. `addKey()` rotates in a new `kid` (AC-9 tests).
 */
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet, type JWK, type KeyLike } from 'jose';

export interface TestTokenInput {
  kind: 'person' | 'service';
  email?: string;
  commonName?: string;
  /** Defaults to the configured audience. */
  aud?: string;
  /** Defaults to the configured issuer. */
  iss?: string;
  /** Seconds from now; negative gives an expired token. Default 3600. */
  expiresInSec?: number;
  /** `kid` header; defaults to the current key. An unknown value makes an "unknown kid" token. */
  kid?: string;
}

export interface TestSigner {
  sign(input: TestTokenInput, defaults: { iss: string; aud: string }): Promise<string>;
  /** Public keys of every key generated so far. */
  jwks(): JSONWebKeySet;
  /** Bumped on every `addKey`, so a verifier can rebuild its local key set. */
  version(): number;
  /** Adds a key and makes it current; returns its `kid`. */
  addKey(): Promise<string>;
}

interface Key {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

const SIGNER_KEY = Symbol.for('t2f.testSigner');

async function newKey(): Promise<Key> {
  const kid = `t2f-test-${randomUUID()}`;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

function createSigner(first: Key): TestSigner {
  const keys: Key[] = [first];
  let current = first;
  return {
    async sign(input, defaults) {
      // Relative times: jose stamps them from real time, like the Access tokens it mimics.
      const claims: Record<string, unknown> =
        input.kind === 'person'
          ? { sub: randomUUID(), email: input.email ?? '', country: 'UA', identity_nonce: randomUUID() }
          : { sub: '', common_name: input.commonName ?? '' };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: input.kid ?? current.kid })
        .setIssuer(input.iss ?? defaults.iss)
        .setAudience(input.aud ?? defaults.aud)
        .setIssuedAt()
        .setExpirationTime(`${input.expiresInSec ?? 3600}s`)
        .sign(current.privateKey);
    },
    jwks: () => ({ keys: keys.map((k) => k.publicJwk) }),
    version: () => keys.length,
    async addKey() {
      const k = await newKey();
      keys.push(k);
      current = k;
      return k.kid;
    },
  };
}

/** The process-wide test signer, created on first use. */
export function getTestSigner(): Promise<TestSigner> {
  const g = globalThis as unknown as Record<symbol, Promise<TestSigner> | undefined>;
  return (g[SIGNER_KEY] ??= newKey().then(createSigner));
}
