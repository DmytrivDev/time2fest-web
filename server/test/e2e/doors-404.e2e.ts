/**
 * AC-30 / AC-31: in production every test door answers exactly like an unknown /api path
 * (status, body, header names except `date`), also with the test-door switches on the request.
 * Needs the server started with T2F_ENV=production. Env: T2F_E2E_SERVER (server URL);
 * T2F_E2E_EDGE_SECRET (the server's T2F_EDGE_SECRET) — when set, every request carries `x-t2f-edge`.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const server = process.env.T2F_E2E_SERVER ?? '';
const edgeSecret = process.env.T2F_E2E_EDGE_SECRET ?? '';

/** Equal to the rows of `src/test-doors/registry.ts` (method + path). */
const DOORS: Array<[string, string]> = [
  ['POST', '/api/_test/access-token'],
  ['POST', '/api/_test/admin-test-slice'],
  ['POST', '/api/_test/alarm'],
  ['POST', '/api/_test/auth/expire-code'],
  ['POST', '/api/_test/auth/free-gap'],
  ['POST', '/api/_test/auth/google-user'],
  ['POST', '/api/_test/auth/last-code'],
  ['POST', '/api/_test/auth/write-probe'],
  ['POST', '/api/_test/reset'],
  ['POST', '/api/_test/rights/ban'],
  ['POST', '/api/_test/rights/fixture'],
  ['POST', '/api/_test/rights/link-fault'],
  ['POST', '/api/_test/rights/pass-grant'],
  ['POST', '/api/_test/rights/pass-revoke'],
  ['POST', '/api/_test/rights/profile-seed'],
  ['POST', '/api/_test/fixtures'],
  ['GET', '/api/_test/clock'],
  ['POST', '/api/_test/clock'],
  ['GET', '/api/_test/edge-echo'],
  ['POST', '/api/_test/edge-echo'],
  ['POST', '/api/_test/live'],
  ['POST', '/api/_test/mail/break-delivery'],
  ['POST', '/api/_test/mail/counter'],
  ['POST', '/api/_test/moderation'],
  ['POST', '/api/_test/ops-tick'],
  ['POST', '/api/_test/paypro-webhook'],
  ['POST', '/api/_test/realtime-token'],
  ['POST', '/api/_test/scheduler/fault'],
  ['POST', '/api/_test/scheduler/lease'],
  ['POST', '/api/_test/scheduler/night-run'],
  ['GET', '/api/_test/scheduler/night-run'],
  ['POST', '/api/_test/site'],
];

const VARIANTS: Array<{ name: string; query: string; headers: Record<string, string> }> = [
  { name: 'plain', query: '', headers: {} },
  { name: 'header', query: '', headers: { 'X-T2F-Test-Doors': '1' } },
  { name: 'query', query: '?doors=1', headers: {} },
  { name: 'cookie', query: '', headers: { Cookie: 't2f_env=test' } },
];

async function probe(request: APIRequestContext, method: string, path: string, query: string, headers: Record<string, string>) {
  const res = await request.fetch(`${server}${path}${query}`, {
    method,
    headers: { Origin: server, ...(edgeSecret ? { 'x-t2f-edge': edgeSecret } : {}), ...headers },
    data: method === 'GET' ? undefined : {},
    maxRedirects: 0,
  });
  const names = Object.keys(res.headers())
    .filter((h) => h !== 'date')
    .sort();
  return { status: res.status(), body: await res.text(), names };
}

test('AC-30/31, SPEC-07 AC-68, SPEC-08 W19, SPEC-12 W38, SPEC-13b W18, SPEC-10 (+6), SPEC-11 (+6 rights): the registry has 32 door rows', () => {
  expect(DOORS).toHaveLength(32);
});

for (const v of VARIANTS) {
  for (const [method, path] of DOORS) {
    test(`AC-30/31: ${method} ${path} is indistinguishable from an unknown path (${v.name})`, async ({ request }) => {
      test.skip(!server, 'set T2F_E2E_SERVER (server started with T2F_ENV=production)');
      const door = await probe(request, method, path, v.query, v.headers);
      const nope = await probe(request, method, '/api/nope', v.query, v.headers);
      expect(door.status).toBe(404);
      expect(door).toEqual(nope);
    });
  }
}
