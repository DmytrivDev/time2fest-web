/**
 * AC-6 end to end: `/admin` and `/cms-api/admins` on a foreign host answer exactly like a path
 * with no route (status, body, header names except `date`), with or without an owner JWT; on the
 * admin host with the JWT they reach Payload. Needs the server started in the `test` class with
 * doors (the JWT comes from `POST /api/_test/access-token`). Run in W53.
 * Env: T2F_E2E_SERVER (server URL), T2F_ADMIN_HOST, T2F_OWNER_EMAILS.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const server = process.env.T2F_E2E_SERVER ?? '';
const adminHost = process.env.T2F_ADMIN_HOST ?? '';
const owner = (process.env.T2F_OWNER_EMAILS ?? '').split(',')[0] ?? '';
const FOREIGN_HOST = 'time2fest.com';

async function ownerJwt(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${server}/api/_test/access-token`, { data: { kind: 'person', email: owner } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { value: { token: string } }).value.token;
}

async function probe(request: APIRequestContext, path: string, headers: Record<string, string>) {
  const res = await request.get(`${server}${path}`, { headers, maxRedirects: 0 });
  const names = Object.keys(res.headers())
    .filter((h) => h !== 'date')
    .sort();
  return { status: res.status(), body: await res.text(), names };
}

for (const path of ['/admin', '/cms-api/admins']) {
  test(`AC-6: ${path} on a foreign host is the same 404 as a path with no route`, async ({ request }) => {
    test.skip(!server || !adminHost || !owner, 'set T2F_E2E_SERVER, T2F_ADMIN_HOST, T2F_OWNER_EMAILS (test class, doors on)');
    const jwt = { 'Cf-Access-Jwt-Assertion': await ownerJwt(request) };
    const unknown = await probe(request, '/no-such-page', { Host: FOREIGN_HOST, ...jwt });
    expect(unknown.status).toBe(404);
    for (const headers of [{ Host: FOREIGN_HOST }, { Host: FOREIGN_HOST, ...jwt }]) {
      expect(await probe(request, path, headers)).toEqual(unknown);
    }
    expect((await probe(request, path, { Host: adminHost, ...jwt })).status).not.toBe(404);
  });
}
