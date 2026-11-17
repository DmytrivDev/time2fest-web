/**
 * S4-02: a service identity (agent: Access service token + API key) reaches only an allow-list of
 * `/cms-api` paths — the six catalog collections (read), `agent-test-posts` (test class), and
 * `/cms-api/admins/me`. Payload's built-in collections and the admins auth operations are refused
 * at the gate (`service-path`); `unlock` is owner-only in Payload too.
 */
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestSigner } from '../../src/adapters/testSigner';
import { payloadOf } from '../../src/container';
import { proxy } from '../../src/proxy';
import { testDeps } from './helpers';
import { ADMIN_HOST, apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'svc-paths-owner@example.com';
const AGENT = 'svc-paths-agent@example.com';
const PASSWORD = 'svc-paths-password-0001';
const SERVICE_CN = String(process.env.T2F_ACCESS_SERVICE_CNS).split(',')[0] ?? '';
const DEFAULTS = { iss: new URL(String(process.env.T2F_ACCESS_TEAM_DOMAIN)).origin, aud: String(process.env.T2F_ACCESS_AUD) };

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const BUILT_INS = ['payload-locked-documents', 'payload-preferences', 'payload-migrations'] as const;

async function viaProxy(method: Method, path: string, key: string): Promise<Response> {
  const token = await (await getTestSigner()).sign({ kind: 'service', commonName: SERVICE_CN }, DEFAULTS);
  return proxy(
    new NextRequest(`http://${ADMIN_HOST}/cms-api${path}`, {
      method,
      headers: { host: ADMIN_HOST, 'Cf-Access-Jwt-Assertion': token, ...apiKeyHeader(key), ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
      body: method === 'GET' ? undefined : '{}',
    }),
  );
}

async function expectGate403(res: Response, label: string) {
  expect(res.status, label).toBe(403);
  expect(await res.text(), label).toBe('');
  expect(res.headers.get('x-middleware-next'), label).toBeNull();
}

describe('service identities: path allow-list (S4-02)', () => {
  let payload: Payload;
  let agentId = 0;
  let key = '';

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    const owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    key = ((await issued.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  // Premise, observed before the fix (agent key + service marker, straight into Payload): GET
  // payload-locked-documents 200, GET payload-preferences 200, POST payload-preferences 201,
  // GET payload-migrations 501, POST admins/forgot-password 200, POST admins/unlock 200.
  // Payload offers no setting for the built-ins' access, so the gate allow-list is their control.

  it('Payload: unlock is owner-only — an agent key with a service marker → 403', async () => {
    const res = await rest('POST', '/admins/unlock', { headers: { ...apiKeyHeader(key), ...serviceMark() }, body: { email: OWNER } });
    expect(res.status).toBe(403);
  });

  it('gate: built-in collections and admins auth operations → 403 with an empty body', async () => {
    for (const slug of BUILT_INS) {
      for (const method of ['GET', 'POST', 'DELETE'] as const) await expectGate403(await viaProxy(method, `/${slug}`, key), `${method} /${slug}`);
    }
    for (const op of ['forgot-password', 'unlock', 'refresh-token', 'init', 'login', 'logout', 'reset-password']) {
      await expectGate403(await viaProxy(op === 'init' ? 'GET' : 'POST', `/admins/${op}`, key), op);
    }
    await expectGate403(await viaProxy('GET', '/admins', key), 'GET /admins');
    await expectGate403(await viaProxy('GET', `/admins/${agentId}`, key), 'GET /admins/:id');
    await expectGate403(await viaProxy('GET', '/globals/admin-settings', key), 'GET /globals/admin-settings');
    await expectGate403(await viaProxy('POST', '/zones', key), 'POST /zones (catalog is read-only for services)');
    await expectGate403(await viaProxy('GET', '/zones-extra', key), 'a slug that only starts like a catalog one');
  });

  it('gate: catalog reads and admins/me still pass; the catalog read is 200 end to end', async () => {
    for (const path of ['/zones', '/countries', '/cities', '/events', '/seasons', '/traditions', '/admins/me', '/agent-test-posts']) {
      const res = await viaProxy('GET', path, key);
      expect(res.headers.get('x-middleware-next'), path).toBe('1');
    }
    const zones = await rest('GET', '/zones?limit=1', { headers: { ...apiKeyHeader(key), ...serviceMark() } });
    expect(zones.status).toBe(200);
    // Past the gate Payload still refuses `me` to an agent: the admins records are owner-only (AC-18).
    const me = await rest('GET', '/admins/me', { headers: { ...apiKeyHeader(key), ...serviceMark() } });
    expect(me.status).toBe(403);
  });
});
