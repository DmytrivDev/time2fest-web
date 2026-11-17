/**
 * The Access gate through the exported Next proxy (AC-1, AC-3, AC-4, AC-6, NFR-1, NFR-8).
 * The proxy is called directly; `x-middleware-next` means "passed to the route" and
 * `x-middleware-rewrite` the rewrite to Next's own 404. Tokens come from the test signer.
 */
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { getTestSigner } from '../../src/adapters/testSigner';
import { buildAccessGate, getIdentityMarker, payloadOf } from '../../src/container';
import { NOT_FOUND_PATH, proxy, proxyWith } from '../../src/proxy';
import { testDeps } from './helpers';

const ADMIN_HOST = String(process.env.T2F_ADMIN_HOST);
const [MAIN, RESERVE] = String(process.env.T2F_OWNER_EMAILS).split(',') as [string, string];
const SERVICE_CN = String(process.env.T2F_ACCESS_SERVICE_CNS).split(',')[0] ?? '';
const DEFAULTS = { iss: new URL(String(process.env.T2F_ACCESS_TEAM_DOMAIN)).origin, aud: String(process.env.T2F_ACCESS_AUD) };
const ADMIN_EMAIL = 'gate-admin@example.com';
const ADMIN_PASSWORD = 'gate-admin-password-0001';

const person = async (email: string) => (await getTestSigner()).sign({ kind: 'person', email }, DEFAULTS);
const service = async (commonName: string) => (await getTestSigner()).sign({ kind: 'service', commonName }, DEFAULTS);

function req(path: string, headers: Record<string, string> = {}, host = ADMIN_HOST): NextRequest {
  return new NextRequest(`http://${host}${path}`, { headers: { host, ...headers } });
}

const jwt = (token: string) => ({ 'Cf-Access-Jwt-Assertion': token });

async function expect403(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.text()).toBe('');
  expect(res.headers.get('x-middleware-next')).toBeNull();
}

const passed = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('Access gate (proxy)', () => {
  let payload: Payload;
  let cookie = '';

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await payload.delete({ collection: 'admins', where: { email: { equals: ADMIN_EMAIL } }, overrideAccess: true });
    await payload.create({ collection: 'admins', data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'owner' }, overrideAccess: true });
    const login = await payload.login({ collection: 'admins', data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    cookie = `payload-token=${login.token ?? ''}`;
  });

  afterAll(async () => {
    await payload.delete({ collection: 'admins', where: { email: { equals: ADMIN_EMAIL } }, overrideAccess: true });
  });

  it('AC-1: a valid Payload cookie or an agent API key without a JWT → 403, empty body', async () => {
    expect(cookie.length).toBeGreaterThan('payload-token='.length);
    for (const path of ['/admin', '/cms-api/admins/me']) await expect403(await proxy(req(path, { cookie })));
    await expect403(await proxy(req('/cms-api/admins/me', { authorization: 'admins API-Key 0123456789abcdef' })));
    await expect403(await proxy(req('/', {})));
    await expect403(await proxy(req('/admin', { ...jwt('not.a.jwt'), cookie })));
  });

  it('AC-1/AC-3: the main and the reserve owner pass with a signed identity marker; a foreign email → 403', async () => {
    for (const email of [MAIN, RESERVE]) {
      const res = await proxy(req('/cms-api/admins/me', { ...jwt(await person(email)), cookie }));
      expect(passed(res)).toBe(true);
      const marker = res.headers.get(`x-middleware-request-${IDENTITY_HEADER}`);
      expect(getIdentityMarker().verify(marker)).toMatchObject({ kind: 'person', subject: email.toLowerCase() });
    }
    expect(passed(await proxy(req('/admin', jwt(await person(MAIN.toUpperCase())))))).toBe(true);
    await expect403(await proxy(req('/admin', jwt(await person('stranger@example.com')))));
  });

  it('an inbound identity marker is never trusted or passed on', async () => {
    const forged = getIdentityMarker().sign({ kind: 'person', subject: MAIN, exp: 4_102_444_800 });
    await expect403(await proxy(req('/admin', { [IDENTITY_HEADER]: forged })));
    const res = await proxy(req('/admin', { ...jwt(await service(SERVICE_CN)), [IDENTITY_HEADER]: forged }));
    await expect403(res);
    const ok = await proxy(req('/cms-api/admins/me', { ...jwt(await service(SERVICE_CN)), [IDENTITY_HEADER]: 'forged' }));
    expect(passed(ok)).toBe(true);
    expect(getIdentityMarker().verify(ok.headers.get(`x-middleware-request-${IDENTITY_HEADER}`))).toMatchObject({
      kind: 'service',
      subject: SERVICE_CN,
    });
  });

  it('AC-4: a service token reaches only /cms-api/* and only with an allowed common_name', async () => {
    await expect403(await proxy(req('/admin', jwt(await service(SERVICE_CN)))));
    await expect403(await proxy(req('/cms-api/admins/me', jwt(await service('foreign-agent.access')))));
    expect(passed(await proxy(req('/cms-api/admins/me', jwt(await service(SERVICE_CN)))))).toBe(true);
    // S4-02: within /cms-api only the allow-list (catalog reads, admins/me, test collection).
    await expect403(await proxy(req('/cms-api/admins', jwt(await service(SERVICE_CN)))));
  });

  it('AC-6: /admin and /cms-api on a foreign host → rewrite to the not-found path, even with a JWT', async () => {
    for (const path of ['/admin', '/cms-api/admins']) {
      for (const headers of [{}, jwt(await person(MAIN))]) {
        const res = await proxy(req(path, headers, 'time2fest.com'));
        expect(res.headers.get('x-middleware-next')).toBeNull();
        expect(new URL(String(res.headers.get('x-middleware-rewrite'))).pathname).toBe(NOT_FOUND_PATH);
      }
    }
  });

  it('AC-6 (B2): on a foreign host /admin and an unknown path leave the proxy with the same status and header names', async () => {
    const shape = async (path: string, headers: Record<string, string>) => {
      const res = await proxy(req(path, headers, 'time2fest.com'));
      return { status: res.status, names: [...res.headers.keys()].filter((h) => h !== 'date').sort(), body: await res.text() };
    };
    const owner = jwt(await person(MAIN));
    for (const headers of [{}, owner]) {
      const unknown = await shape('/no-such-page', headers);
      expect(unknown.names).toContain('x-middleware-rewrite');
      for (const path of ['/admin', '/cms-api/admins']) expect(await shape(path, headers)).toEqual(unknown);
    }
  });

  it('NFR-8: 50 denials in 5 s with one reason → ≤5 log lines without token or email', async () => {
    const lines: Record<string, unknown>[] = [];
    const push = (f: Record<string, unknown>) => void lines.push(f);
    const deps = testDeps({ log: { info: push, warn: push, error: push } });
    const gate = buildAccessGate(deps, process.env);
    const gated = proxyWith(() => gate, getIdentityMarker);
    const email = 'stranger@example.com';
    const token = await person(email);
    // Denial i is sent at t0 + i·98 ms, so all 50 fall within 4.9 s.
    const t0 = Date.now();
    for (let i = 0; i < 50; i += 1) {
      const wait = t0 + i * 98 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await expect403(await gated(req('/admin', jwt(token))));
    }
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.every((l) => l.event === 'access-deny' && l.reason === 'foreign-email')).toBe(true);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(email);
    expect(text).not.toContain(token.slice(0, 20));
  }, 20_000);

  it('NFR-1: the gate adds ≤20 ms at p95 with a warm key set (200 calls, with vs without the gate)', async () => {
    const token = await person(MAIN);
    const open = proxyWith(async () => ({ check: async () => ({ kind: 'pass', identity: undefined }) }), getIdentityMarker);
    await proxy(req('/admin', jwt(token)));
    const gatedTimes: number[] = [];
    const openTimes: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      let t0 = performance.now();
      await proxy(req('/cms-api/admins/me', jwt(token)));
      gatedTimes.push(performance.now() - t0);
      t0 = performance.now();
      await open(req('/cms-api/admins/me', jwt(token)));
      openTimes.push(performance.now() - t0);
    }
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? Infinity;
    const added = p95(gatedTimes) - p95(openTimes);
    console.log(`access gate p95 gated=${p95(gatedTimes).toFixed(2)} ms open=${p95(openTimes).toFixed(2)} ms added=${added.toFixed(2)} ms`);
    expect(added).toBeLessThanOrEqual(20);
  });
});
