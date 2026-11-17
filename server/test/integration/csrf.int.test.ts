/**
 * CSRF defence of the admin (S4-01). The session cookie is SameSite=Lax and every `*.time2fest.com`
 * is same-site with the admin, so a write is accepted only from the admin origin:
 * - the proxy refuses a state-changing request whose `Origin` is another origin or whose
 *   `Sec-Fetch-Site` is not `same-origin`/`none` (403, empty body); an agent sends neither header;
 * - Payload's `csrf` accepts the session cookie only from the admin origin;
 * - the JSON custom endpoints refuse a body that is not `application/json`.
 */
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestSigner } from '../../src/adapters/testSigner';
import { payloadOf } from '../../src/container';
import { proxy } from '../../src/proxy';
import { testDeps } from './helpers';
import { ADMIN_HOST, ADMIN_ORIGIN, makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const [MAIN] = String(process.env.T2F_OWNER_EMAILS).split(',') as [string];
const SERVICE_CN = String(process.env.T2F_ACCESS_SERVICE_CNS).split(',')[0] ?? '';
const DEFAULTS = { iss: new URL(String(process.env.T2F_ACCESS_TEAM_DOMAIN)).origin, aud: String(process.env.T2F_ACCESS_AUD) };
const OWNER = 'csrf-owner@example.com';
const PASSWORD = 'csrf-owner-password-0001';
const SAME_SITE = 'https://www.time2fest.com';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function viaProxy(method: Method, path: string, kind: 'person' | 'service', headers: Record<string, string> = {}): Promise<Response> {
  const signer = await getTestSigner();
  const token = kind === 'person' ? await signer.sign({ kind: 'person', email: MAIN }, DEFAULTS) : await signer.sign({ kind: 'service', commonName: SERVICE_CN }, DEFAULTS);
  return proxy(
    new NextRequest(`http://${ADMIN_HOST}${path}`, {
      method,
      headers: { host: ADMIN_HOST, 'Cf-Access-Jwt-Assertion': token, 'content-type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : '{"on":false}',
    }),
  );
}

async function expect403(res: Response, label: string) {
  expect(res.status, label).toBe(403);
  expect(await res.text(), label).toBe('');
  expect(res.headers.get('x-middleware-next'), label).toBeNull();
}

const passed = (res: Response) => res.headers.get('x-middleware-next') === '1';

const CUSTOM = '/cms-api/globals/unattended-state/manual';
const REST_WRITE = '/cms-api/zones/1';

describe('CSRF (S4-01)', () => {
  let payload: Payload;
  let cookie = '';

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    cookie = await sessionCookie(payload, OWNER, PASSWORD);
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER]);
  });

  it('proxy: a foreign Origin → 403 on a custom endpoint and on a Payload REST write', async () => {
    for (const origin of [SAME_SITE, 'https://evil.example.com', 'null', `https://${ADMIN_HOST}.evil.example.com`]) {
      await expect403(await viaProxy('POST', CUSTOM, 'person', { origin }), `custom ${origin}`);
      await expect403(await viaProxy('PATCH', REST_WRITE, 'person', { origin }), `REST ${origin}`);
      await expect403(await viaProxy('DELETE', REST_WRITE, 'person', { origin }), `REST delete ${origin}`);
    }
  });

  it('proxy: Sec-Fetch-Site same-site or cross-site on a write → 403', async () => {
    for (const site of ['same-site', 'cross-site']) {
      await expect403(await viaProxy('POST', CUSTOM, 'person', { 'sec-fetch-site': site }), site);
      await expect403(await viaProxy('POST', CUSTOM, 'person', { origin: ADMIN_ORIGIN, 'sec-fetch-site': site }), `${site} with own origin`);
    }
  });

  it('proxy: same-origin writes, reads from anywhere, and header-less (service) calls pass', async () => {
    expect(passed(await viaProxy('POST', CUSTOM, 'person', { origin: ADMIN_ORIGIN, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(passed(await viaProxy('PATCH', REST_WRITE, 'person', { origin: ADMIN_ORIGIN }))).toBe(true);
    expect(passed(await viaProxy('POST', CUSTOM, 'person', { 'sec-fetch-site': 'none' }))).toBe(true);
    expect(passed(await viaProxy('GET', '/admin', 'person', { origin: SAME_SITE, 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(passed(await viaProxy('POST', '/cms-api/agent-test-posts', 'service'))).toBe(true);
  });

  it('Payload: the session cookie counts only from the admin origin', async () => {
    const owner = { cookie, ...personMark() };
    const me = async (headers: Record<string, string>) => ((await (await rest('GET', '/admins/me', { headers: { ...owner, ...headers } })).json()) as { user: unknown }).user;
    expect(await me({ 'sec-fetch-site': 'same-origin' })).not.toBeNull();
    expect(await me({ origin: SAME_SITE })).toBeNull();
    expect(await me({ 'sec-fetch-site': 'cross-site' })).toBeNull();
    // A body-less owner write: signed in → 404 for an unknown alarm; cookie ignored → 403.
    expect((await rest('POST', '/alarms/999999999/acknowledge', { headers: owner })).status).toBe(404);
    expect((await rest('POST', '/alarms/999999999/acknowledge', { headers: { ...owner, origin: SAME_SITE } })).status).toBe(403);
  });

  it('JSON endpoints: a text/plain body → 400 validation', async () => {
    const owner = { cookie, ...personMark(), 'content-type': 'text/plain' };
    const manual = await rest('POST', '/globals/unattended-state/manual', { headers: owner, body: { on: false } });
    expect(manual.status).toBe(400);
    expect(await manual.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
    const preview = await rest('POST', '/event-patches/preview', { headers: owner, body: { changes: {}, expectedVersions: {} } });
    expect(preview.status).toBe(400);
    expect(await preview.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
