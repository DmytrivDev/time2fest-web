/**
 * Access JWT verification (AC-2, AC-8, AC-9, AC-10, NFR-5): the jose verifier over the test
 * signer, a local JWKS HTTP server for key rotation, and the access-token door.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { createAccessVerifier, localKeys, remoteKeys } from '../../src/adapters/accessJwt';
import { getTestSigner } from '../../src/adapters/testSigner';
import { buildAccessGate, buildDispatcher } from '../../src/container';
import { createAlarm } from '../../src/platform/logger';
import { post, testDeps } from './helpers';

const ISS = 'https://t2f-test.invalid';
const AUD = 't2f-test-aud';
const OWNER = 'owner@example.com';

function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const push = (f: Record<string, unknown>) => void lines.push(f);
  return { lines, log: { info: push, warn: push, error: push } };
}

async function rsaKey(kid: string): Promise<{ kid: string; privateKey: KeyLike; jwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

const signWith = (key: { kid: string; privateKey: KeyLike }, claims: Record<string, unknown> = { sub: 's', email: OWNER }) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key.privateKey);

/** A JWKS endpoint on an ephemeral loopback port that serves whatever `keys` holds. */
async function jwksServer(keys: JWK[]) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/cdn-cgi/access/certs`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Access JWT verifier', () => {
  const servers: { close(): Promise<void> }[] = [];
  afterAll(async () => {
    for (const s of servers) await s.close();
  });

  it('AC-2: each of six violations is invalid; the valid token passes', async () => {
    const signer = await getTestSigner();
    const { lines, log } = captureLog();
    const verifier = createAccessVerifier({ issuer: ISS, audience: AUD, keys: localKeys(signer), alarm: createAlarm(log) });
    const defaults = { iss: ISS, aud: AUD };
    const valid = await signer.sign({ kind: 'person', email: OWNER }, defaults);
    const { kid } = decodeProtectedHeader(valid);
    if (!kid) throw new Error('no kid');

    const foreignKey = await rsaKey(kid);
    const hs256 = await new SignJWT({ sub: 's', email: OWNER })
      .setProtectedHeader({ alg: 'HS256', kid })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    const bad = {
      signature: await signWith(foreignKey),
      unknownKid: await signer.sign({ kind: 'person', email: OWNER, kid: 'unknown-kid' }, defaults),
      hs256,
      foreignIss: await signer.sign({ kind: 'person', email: OWNER, iss: 'https://evil.cloudflareaccess.com' }, defaults),
      foreignAud: await signer.sign({ kind: 'person', email: OWNER, aud: 'other-aud' }, defaults),
      pastExp: await signer.sign({ kind: 'person', email: OWNER, expiresInSec: -60 }, defaults),
    };
    for (const [name, token] of Object.entries(bad)) {
      expect([name, await verifier.verify(token)]).toEqual([name, { ok: false, reason: 'invalid' }]);
    }
    expect(await verifier.verify(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifier.verify(valid)).toMatchObject({ ok: true, claims: { email: OWNER, iss: ISS, aud: AUD } });
    expect(lines).toEqual([]);
  });

  it('AC-9: a new kid is accepted on the first call ≥30 s after the last JWKS fetch', async () => {
    const a = await rsaKey('key-a');
    const b = await rsaKey('key-b');
    const served: JWK[] = [a.jwk];
    const srv = await jwksServer(served);
    servers.push(srv);
    const verifier = createAccessVerifier({ issuer: ISS, audience: AUD, keys: remoteKeys(srv.url), alarm: createAlarm(captureLog().log) });

    expect((await verifier.verify(await signWith(a))).ok).toBe(true);
    served.push(b.jwk);
    const tokenB = await signWith(b);
    // Inside the 30 s cooldown the key set is not refetched.
    expect(await verifier.verify(tokenB)).toEqual({ ok: false, reason: 'invalid' });
    await new Promise((r) => setTimeout(r, 30_500));
    expect((await verifier.verify(tokenB)).ok).toBe(true);
  }, 45_000);

  it('AC-10: JWKS unreachable and kid not cached → jwks-unreachable and one alarm line, no token', async () => {
    const srv = await jwksServer([]);
    await srv.close();
    const { lines, log } = captureLog();
    const verifier = createAccessVerifier({ issuer: ISS, audience: AUD, keys: remoteKeys(srv.url), alarm: createAlarm(log) });
    const token = await signWith(await rsaKey('key-c'));
    expect(await verifier.verify(token)).toEqual({ ok: false, reason: 'jwks-unreachable' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'alarm', alarm: 'log', source: 'access', code: 'access-jwks-unreachable' });
    expect(JSON.stringify(lines)).not.toContain(token.slice(0, 20));
  });

  it('AC-8: the door issues a person token that passes the gate on the admin host', async () => {
    const deps = testDeps();
    const dispatch = await buildDispatcher(deps);
    const email = String(process.env.T2F_OWNER_EMAILS ?? '').split(',')[0] ?? '';
    const res = await dispatch(post('/api/_test/access-token', { kind: 'person', email }));
    expect(res.status).toBe(200);
    const { value } = (await res.json()) as { value: { token: string } };
    const gate = await buildAccessGate(deps, { ...process.env, T2F_ENV: 'test' });
    const host = String(process.env.T2F_ADMIN_HOST);
    expect(await gate.check({ path: '/admin', host, token: value.token })).toEqual({
      kind: 'pass',
      identity: { kind: 'person', subject: email.toLowerCase(), exp: expect.any(Number) },
    });
    const service = await dispatch(post('/api/_test/access-token', { kind: 'service', commonName: 'test-agent.access' }));
    const st = ((await service.json()) as { value: { token: string } }).value.token;
    expect((await gate.check({ path: '/cms-api/admins', host, token: st })).kind).toBe('pass');
  });
});
