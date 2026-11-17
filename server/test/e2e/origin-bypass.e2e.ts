/**
 * AC-11 / EC-2 end to end (W51, run in W53 step 6): a request sent straight to the server's own
 * origin port with `Host: <admin host>` — bypassing Cloudflare — is refused in every case: no
 * `Cf-Access-Jwt-Assertion`, a forged unsigned one, an HS256 one, or one signed by an unknown key;
 * also with a valid Payload password, a valid session and a valid agent API key, and with an edge
 * secret header (the admin channel is its own tunnel name behind Access and never carries the
 * Worker's `x-t2f-edge`: docs/backend/cloudflare-notes.md §3, §9). Refusal = 403 with an empty body
 * from the gate (W14).
 *
 * Positive controls first prove the password and the key are valid: with the owner JWT (test door)
 * the login is 200, and the key issued for a throwaway agent works with a service JWT.
 * The production-class half of AC-11 is `test/integration/origin-bypass.int.test.ts`.
 *
 * Needs the step-2 server of W53 (production build, `test` class with doors, owner created).
 * Env: T2F_E2E_SERVER (the server's own URL, e.g. http://127.0.0.1:<port>), T2F_ADMIN_HOST,
 * T2F_OWNER_EMAILS, T2F_E2E_OWNER_PASSWORD, T2F_ACCESS_SERVICE_CNS, T2F_ACCESS_TEAM_DOMAIN, T2F_ACCESS_AUD.
 */
import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';

const server = process.env.T2F_E2E_SERVER ?? '';
const adminHost = process.env.T2F_ADMIN_HOST ?? '';
const owner = (process.env.T2F_OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? '';
const ownerPassword = process.env.T2F_E2E_OWNER_PASSWORD ?? '';
const serviceCn = (process.env.T2F_ACCESS_SERVICE_CNS ?? '').split(',')[0]?.trim() ?? '';
const iss = process.env.T2F_ACCESS_TEAM_DOMAIN ? new URL(process.env.T2F_ACCESS_TEAM_DOMAIN).origin : '';
const aud = process.env.T2F_ACCESS_AUD ?? '';
const configured = Boolean(server && adminHost && owner && ownerPassword && serviceCn && iss && aud);
const SKIP_REASON =
  'set T2F_E2E_SERVER, T2F_ADMIN_HOST, T2F_OWNER_EMAILS, T2F_E2E_OWNER_PASSWORD, T2F_ACCESS_SERVICE_CNS, T2F_ACCESS_TEAM_DOMAIN, T2F_ACCESS_AUD (test class, doors on, owner created)';

const AGENT = `origin-bypass-agent-${Date.now()}@example.com`;
const AGENT_PASSWORD = `ob-${randomBytes(12).toString('hex')}`;
const COLD_MS = 120_000;
/** A write is accepted only from the admin origin (CSRF, S4-01); the test class serves it over http. */
const origin = { Origin: `http://${adminHost.toLowerCase()}` };

async function doorJwt(request: APIRequestContext, data: Record<string, string>): Promise<string> {
  const res = await request.post(`${server}/api/_test/access-token`, { data, timeout: COLD_MS });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { value: { token: string } }).value.token;
}

/** Tokens that must never open the admin. */
async function forgeries(): Promise<Record<string, string | null>> {
  const claims = { sub: 'origin-bypass-sub', email: owner };
  const { privateKey } = await generateKeyPair('RS256');
  return {
    'no token': null,
    'empty token': '',
    'unsigned (alg none)': new UnsecuredJWT(claims).setIssuer(iss).setAudience(aud).setExpirationTime('10m').encode(),
    HS256: await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(iss)
      .setAudience(aud)
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(randomBytes(32).toString('hex'))),
    'unknown key': await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'origin-bypass-unknown' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey),
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('AC-11: admin requests straight to the origin are refused', () => {
  let ownerJwt = '';
  let session = '';
  let agentId = 0;
  let apiKey = '';

  test.beforeAll(async ({ request }) => {
    if (!configured) return;
    ownerJwt = await doorJwt(request, { kind: 'person', email: owner });
    const asOwner = { Host: adminHost, 'Cf-Access-Jwt-Assertion': ownerJwt, ...origin };
    // Positive control 1: the owner password is valid once Access passes.
    const login = await request.post(`${server}/cms-api/admins/login`, {
      headers: asOwner,
      data: { email: owner, password: ownerPassword },
      timeout: COLD_MS,
    });
    expect(login.status()).toBe(200);
    session = String(((await login.json()) as { token?: string }).token ?? '');
    expect(session).not.toBe('');
    const withSession = { ...asOwner, Authorization: `JWT ${session}` };
    const agent = await request.post(`${server}/cms-api/admins`, {
      headers: withSession,
      data: { email: AGENT, password: AGENT_PASSWORD, role: 'content-agent' },
    });
    expect(agent.status()).toBe(201);
    agentId = ((await agent.json()) as { doc: { id: number } }).doc.id;
    const issued = await request.post(`${server}/cms-api/admins/${agentId}/issue-key`, { headers: withSession });
    expect(issued.status()).toBe(200);
    apiKey = ((await issued.json()) as { key: string }).key;
    // Positive control 2: the key is valid with a service JWT.
    const serviceJwt = await doorJwt(request, { kind: 'service', commonName: serviceCn });
    const posts = await request.get(`${server}/cms-api/agent-test-posts`, {
      headers: { Host: adminHost, 'Cf-Access-Jwt-Assertion': serviceJwt, Authorization: `admins API-Key ${apiKey}` },
    });
    expect(posts.status()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    if (!configured || agentId === 0) return;
    await request.delete(`${server}/cms-api/admins/${agentId}`, {
      headers: { Host: adminHost, 'Cf-Access-Jwt-Assertion': ownerJwt, Authorization: `JWT ${session}`, ...origin },
    });
  });

  test('no valid Access JWT → 403 on every admin path, with any credential', async ({ request }) => {
    test.skip(!configured, SKIP_REASON);
    const attempts: { name: string; method: 'GET' | 'POST'; path: string; headers: Record<string, string>; data?: unknown }[] = [
      { name: 'admin page', method: 'GET', path: '/admin', headers: {} },
      { name: 'login page', method: 'GET', path: '/admin/login', headers: {} },
      { name: 'valid password', method: 'POST', path: '/cms-api/admins/login', headers: origin, data: { email: owner, password: ownerPassword } },
      { name: 'valid session', method: 'GET', path: '/cms-api/admins/me', headers: { Authorization: `JWT ${session}` } },
      { name: 'valid session cookie', method: 'GET', path: '/cms-api/admins/me', headers: { Cookie: `payload-token=${session}` } },
      { name: 'valid agent API key', method: 'GET', path: '/cms-api/agent-test-posts', headers: { Authorization: `admins API-Key ${apiKey}` } },
      { name: 'edge secret header only', method: 'GET', path: '/cms-api/admins', headers: { 'x-t2f-edge': randomBytes(24).toString('hex') } },
    ];
    for (const a of attempts) {
      for (const [label, token] of Object.entries(await forgeries())) {
        const headers: Record<string, string> = { Host: adminHost, ...a.headers };
        if (token !== null) headers['Cf-Access-Jwt-Assertion'] = token;
        const res = await request.fetch(`${server}${a.path}`, { method: a.method, headers, data: a.data, maxRedirects: 0, timeout: COLD_MS });
        expect(res.status(), `${a.name} / ${label}`).toBe(403);
        expect(await res.text(), `${a.name} / ${label}`).toBe('');
        expect(res.headers()['set-cookie'] ?? '', `${a.name} / ${label}`).not.toContain('payload-token=ey');
      }
    }
  });
});
