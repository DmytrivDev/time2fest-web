/**
 * AC-11 / EC-2, the part an integration test can prove: an admin request that reaches the origin
 * without passing Cloudflare Access is refused in the PRODUCTION class configuration.
 *
 * Channel (docs/backend/cloudflare-notes.md §3, §9): the admin does not go through the site Worker;
 * its channel is its own tunnel name behind Access, which adds `Cf-Access-Jwt-Assertion`. So the
 * origin-side credential of the admin is that JWT, not the Worker's `x-t2f-edge` secret: an edge
 * secret alone must not open the admin either.
 *
 * Two gates, both over the production config parsed by `parseAccessConfig(…, 'production')`:
 * - the process gate as `buildAccessGate` builds it in production (remote Cloudflare key set). Only
 *   tokens refused before any key lookup are sent to it, and a guard on `http(s).get` proves that
 *   no request leaves the machine;
 * - the same config with a local key standing in for Cloudflare's certs, so that signed tokens
 *   (unknown key, the test signer's key, expired, foreign audience) and the positive controls can run.
 * The password and the API key are proven valid by the positive controls, then refused without the JWT.
 * The live repeat against a production build is `test/e2e/origin-bypass.e2e.ts` (W53 step 6).
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT, type JWK, type KeyLike } from 'jose';
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessGate, createDenyLog, type AccessGate } from '../../src/access/gate';
import { createAccessVerifier } from '../../src/adapters/accessJwt';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { getTestSigner } from '../../src/adapters/testSigner';
import { realClock } from '../../src/clock';
import { buildAccessGate, getIdentityMarker, payloadOf } from '../../src/container';
import { parseAccessConfig, type AccessConfig } from '../../src/domain/access/config';
import type { AlarmInput } from '../../src/ports';
import { proxyWith } from '../../src/proxy';
import { silent, testDeps } from './helpers';
import { ADMIN_HOST, apiKeyHeader, makeAdmin, personMark, removeAdmins, rest } from './payload-rest';

const TEAM = 'https://t2f-origin-bypass.cloudflareaccess.com';
const AUD = 't2f-origin-bypass-aud';
const MAIN = (String(process.env.T2F_OWNER_EMAILS).split(',')[0] ?? '').trim();
const SERVICE_CN = (String(process.env.T2F_ACCESS_SERVICE_CNS).split(',')[0] ?? '').trim();
const PROD_RAW = {
  T2F_ADMIN_HOST: ADMIN_HOST,
  T2F_ACCESS_TEAM_DOMAIN: TEAM,
  T2F_ACCESS_AUD: AUD,
  T2F_ACCESS_JWKS_URL: `${TEAM}/cdn-cgi/access/certs`,
  T2F_OWNER_EMAILS: process.env.T2F_OWNER_EMAILS,
  T2F_ACCESS_SERVICE_CNS: process.env.T2F_ACCESS_SERVICE_CNS,
};
const OWNER = 'origin-bypass-owner@example.com';
const AGENT = 'origin-bypass-agent@example.com';
const PASSWORD = 'origin-bypass-password-01';
const CF_KID = 'cf-origin-bypass-kid';

/** Counts and blocks every outbound `http(s).get/request` (jose's key-set fetch uses `get`). */
function blockOutbound(): { calls: () => number; restore: () => void } {
  let calls = 0;
  const saved: [typeof http | typeof https, 'get' | 'request', unknown][] = [];
  for (const mod of [http, https]) {
    for (const name of ['get', 'request'] as const) {
      saved.push([mod, name, mod[name]]);
      (mod as unknown as Record<string, unknown>)[name] = () => {
        calls += 1;
        throw new Error('origin-bypass: outbound request blocked');
      };
    }
  }
  syncBuiltinESMExports();
  return {
    calls: () => calls,
    restore: () => {
      for (const [mod, name, fn] of saved) (mod as unknown as Record<string, unknown>)[name] = fn;
      syncBuiltinESMExports();
    },
  };
}

async function rsKey(): Promise<{ privateKey: KeyLike; jwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid: CF_KID, alg: 'RS256', use: 'sig' } };
}

function claimsOf(kind: 'person' | 'service'): Record<string, unknown> {
  return kind === 'person' ? { sub: 'origin-bypass-sub', email: MAIN } : { sub: '', common_name: SERVICE_CN };
}

async function signed(key: KeyLike, kind: 'person' | 'service', over: { aud?: string; exp?: string | number } = {}): Promise<string> {
  return new SignJWT(claimsOf(kind))
    .setProtectedHeader({ alg: 'RS256', kid: CF_KID })
    .setIssuer(TEAM)
    .setAudience(over.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? '10m')
    .sign(key);
}

/** Tokens that fail before any key lookup: safe against the remote key set. */
async function preKeyForgeries(): Promise<Record<string, string | null>> {
  const unsigned = new UnsecuredJWT(claimsOf('person')).setIssuer(TEAM).setAudience(AUD).setExpirationTime('10m').encode();
  const hs256 = await new SignJWT(claimsOf('person'))
    .setProtectedHeader({ alg: 'HS256', kid: CF_KID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(AUD.padEnd(32, '0')));
  return { none: null, empty: '', garbage: 'not.a.jwt', unsigned, hs256 };
}

interface Attempt {
  name: string;
  path: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

function request(a: Attempt, token: string | null): NextRequest {
  const headers: Record<string, string> = { host: ADMIN_HOST, ...a.headers };
  if (token !== null) headers['Cf-Access-Jwt-Assertion'] = token;
  if (a.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://${ADMIN_HOST}${a.path}`, {
    method: a.method,
    headers,
    body: a.body === undefined ? undefined : JSON.stringify(a.body),
  });
}

async function expectRefused(res: Response, label: string): Promise<void> {
  expect(res.status, label).toBe(403);
  expect(await res.text(), label).toBe('');
  expect(res.headers.get('x-middleware-next'), label).toBeNull();
  expect(res.headers.get(`x-middleware-request-${IDENTITY_HEADER}`), label).toBeNull();
}

describe('AC-11: an admin request straight to the origin is refused (production class)', () => {
  let payload: Payload;
  let config: AccessConfig;
  let processGate: AccessGate;
  let cfGate: AccessGate;
  let cf: { privateKey: KeyLike; jwk: JWK };
  let stranger: { privateKey: KeyLike; jwk: JWK };
  let agentId = 0;
  let cookie = '';
  let apiKey = '';
  const alarms: AlarmInput[] = [];
  let attempts: Attempt[] = [];

  beforeAll(async () => {
    const parsed = parseAccessConfig(PROD_RAW, 'production');
    if (!parsed.ok || parsed.config === undefined) throw new Error(`production Access config refused: ${parsed.ok ? 'none' : parsed.failing.join(', ')}`);
    config = parsed.config;
    const alarm = { raise: (a: AlarmInput) => void alarms.push(a) };
    processGate = await buildAccessGate({ ...testDeps({ alarm }), env: { class: 'production', vars: {} } }, PROD_RAW);

    cf = await rsKey();
    stranger = await rsKey();
    const verifier = createAccessVerifier({
      issuer: config.issuer,
      audience: config.audience,
      keys: createLocalJWKSet({ keys: [cf.jwk] }),
      alarm,
    });
    cfGate = createAccessGate({ config, verifier, denyLog: createDenyLog(silent, realClock) });

    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    const login = await payload.login({ collection: 'admins', data: { email: OWNER, password: PASSWORD } });
    cookie = `payload-token=${login.token ?? ''}`;
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: { cookie, ...personMark() } });
    expect(issued.status).toBe(200);
    apiKey = ((await issued.json()) as { key: string }).key;

    const edgeSecret = randomBytes(24).toString('hex');
    attempts = [
      { name: 'admin page', path: '/admin', method: 'GET', headers: {} },
      { name: 'login page', path: '/admin/login', method: 'GET', headers: {} },
      { name: 'valid password', path: '/cms-api/admins/login', method: 'POST', headers: {}, body: { email: OWNER, password: PASSWORD } },
      { name: 'valid session cookie', path: '/cms-api/admins/me', method: 'GET', headers: { cookie } },
      { name: 'valid session as JWT header', path: '/cms-api/admins/me', method: 'GET', headers: { authorization: `JWT ${cookie.slice('payload-token='.length)}` } },
      { name: 'valid agent API key', path: '/cms-api/agent-test-posts', method: 'GET', headers: apiKeyHeader(apiKey) },
      { name: 'edge secret only', path: '/cms-api/admins', method: 'GET', headers: { 'x-t2f-edge': edgeSecret, 'x-t2f-client': 'UA' } },
    ];
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('the production config is the one tested: Cloudflare key set, admin host, owner list', () => {
    expect(config.jwks).toEqual({ kind: 'remote', url: `${TEAM}/cdn-cgi/access/certs` });
    expect(config.adminHost).toBe(ADMIN_HOST.toLowerCase());
    expect(config.ownerEmails).toContain(MAIN.toLowerCase());
  });

  it('positive controls: the password, the session and the API key are valid once Access passes', async () => {
    const proxy = proxyWith(() => Promise.resolve(cfGate), getIdentityMarker);
    const person = await proxy(request({ name: 'owner', path: '/cms-api/admins/me', method: 'GET', headers: { cookie } }, await signed(cf.privateKey, 'person')));
    expect(person.headers.get('x-middleware-next')).toBe('1');
    const personMarker = String(person.headers.get(`x-middleware-request-${IDENTITY_HEADER}`));
    const login = await rest('POST', '/admins/login', { body: { email: OWNER, password: PASSWORD }, headers: { [IDENTITY_HEADER]: personMarker } });
    expect(login.status).toBe(200);

    const service = await proxy(request({ name: 'agent', path: '/cms-api/agent-test-posts', method: 'GET', headers: apiKeyHeader(apiKey) }, await signed(cf.privateKey, 'service')));
    expect(service.headers.get('x-middleware-next')).toBe('1');
    const serviceMarker = String(service.headers.get(`x-middleware-request-${IDENTITY_HEADER}`));
    const posts = await rest('GET', '/agent-test-posts', { headers: { ...apiKeyHeader(apiKey), [IDENTITY_HEADER]: serviceMarker } });
    expect(posts.status).toBe(200);
  });

  it('the production process gate: no, empty, garbage, unsigned and HS256 tokens → 403 on every admin path; nothing fetched', async () => {
    const proxy = proxyWith(() => Promise.resolve(processGate), getIdentityMarker);
    const forgeries = await preKeyForgeries();
    const outbound = blockOutbound();
    try {
      for (const a of attempts) {
        for (const [label, token] of Object.entries(forgeries)) await expectRefused(await proxy(request(a, token)), `${a.name} / ${label}`);
      }
    } finally {
      outbound.restore();
    }
    expect(outbound.calls()).toBe(0);
    expect(alarms.filter((x) => x.code === 'access-jwks-unreachable')).toEqual([]);
  });

  it('signed but not by Access for this application: unknown key, test signer, expired, foreign audience → 403', async () => {
    const proxy = proxyWith(() => Promise.resolve(cfGate), getIdentityMarker);
    const testSigner = await (await getTestSigner()).sign({ kind: 'person', email: MAIN }, { iss: TEAM, aud: AUD });
    const tokens: Record<string, string> = {
      'unknown key, same kid': await signed(stranger.privateKey, 'person'),
      'unknown key, service': await signed(stranger.privateKey, 'service'),
      'test signer key': testSigner,
      expired: await signed(cf.privateKey, 'person', { exp: Math.floor(Date.now() / 1000) - 60 }),
      'foreign audience': await signed(cf.privateKey, 'person', { aud: 'another-access-app' }),
      ...(await preKeyForgeries()),
    };
    for (const a of attempts) {
      for (const [label, token] of Object.entries(tokens)) await expectRefused(await proxy(request(a, token)), `${a.name} / ${label}`);
    }
  });

  it('even past the proxy, Payload refuses the valid password and API key without the gate marker', async () => {
    const login = await rest('POST', '/admins/login', { body: { email: OWNER, password: PASSWORD } });
    expect(login.status).toBe(403);
    expect(login.headers.getSetCookie().join('')).not.toContain('payload-token=ey');
    expect((await rest('GET', '/agent-test-posts', { headers: apiKeyHeader(apiKey) })).status).toBe(403);
  });
});
