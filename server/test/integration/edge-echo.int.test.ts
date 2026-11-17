/**
 * SPEC-05 AC-34 … AC-36: the echo door `GET|POST /api/_test/edge-echo` and its `10-origin`
 * exemption (edge-verified only, this door only). In-process dispatcher, no server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDispatcher } from '../../src/container';
import { BASE, testDeps } from './helpers';

// Built at runtime: the gate of the `test` class is active once a secret is set (AC-16).
const EDGE_SECRET = randomBytes(24).toString('hex');
const ECHO = '/api/_test/edge-echo';
const CLIENT_IP = '203.0.113.77';
const CLIENT = `${CLIENT_IP};UA`;
const TUNNEL = 'http://o-test.time2fest.com';
const COOKIE_LINE = /^t2f_edge_probe=([0-9a-f]{32}); Path=\/; Secure; HttpOnly; SameSite=Lax$/;

type Dispatch = (r: Request) => Promise<Response>;

interface Echo {
  method: string;
  path: string;
  query: string;
  bodyBytes: number;
  bodySha256: string;
  headers: Record<string, string>;
  edgeVerified: boolean;
  client: { country: string; addressPresent: boolean };
  probeCookie: string | null;
  cookieNames: string[];
}

const withSecret = () => buildDispatcher(testDeps({}, { T2F_EDGE_SECRET: EDGE_SECRET }));

/** As the edge Worker sends it: the secret and the trusted client header. */
function viaEdge(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('x-t2f-edge', EDGE_SECRET);
  headers.set('x-t2f-client', CLIENT);
  return new Request(url, { ...init, headers });
}

async function echoOf(res: Response): Promise<Echo> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; value: Echo };
  expect(body.ok).toBe(true);
  return body.value;
}

const names = (res: Response) => [...res.headers.keys()].filter((h) => h !== 'date').sort();

describe('echo door (SPEC-05)', () => {
  it('AC-34: POST form body through the edge → fields, SHA-256, header allow-list; nothing private echoed', async () => {
    const dispatch = await withSecret();
    const form = 'probe=1&word=%D0%BA%D1%80%D0%B0%D0%B9';
    const res = await dispatch(
      viaEdge(`${TUNNEL}${ECHO}?a=1&b=two`, {
        method: 'POST',
        body: form,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'edge-probe/1',
          'x-t2f-probe-signature': 'sig-1',
          'x-forwarded-for': '198.51.100.9',
          'cf-connecting-ip': '198.51.100.10',
        },
      }),
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const text = await res.clone().text();
    const value = await echoOf(res);
    expect(value).toMatchObject({
      method: 'POST',
      path: ECHO,
      query: 'a=1&b=two',
      bodyBytes: Buffer.byteLength(form),
      bodySha256: createHash('sha256').update(form).digest('hex'),
      edgeVerified: true,
      client: { country: 'UA', addressPresent: true },
      probeCookie: null,
      cookieNames: [],
    });
    expect(value.headers).toEqual({
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'edge-probe/1',
      'x-t2f-probe-signature': 'sig-1',
    });
    for (const forbidden of [CLIENT_IP, CLIENT, EDGE_SECRET, 'fp:', 'noaddr:', 'x-t2f-edge', 'x-t2f-client', '198.51.100.']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('AC-34: GET has an empty body; a body over 16 KiB is refused invalid-input', async () => {
    const dispatch = await withSecret();
    const got = await echoOf(await dispatch(viaEdge(`${TUNNEL}${ECHO}`)));
    expect(got).toMatchObject({ method: 'GET', query: '', bodyBytes: 0, bodySha256: createHash('sha256').update('').digest('hex') });

    const big = await dispatch(viaEdge(`${TUNNEL}${ECHO}`, { method: 'POST', body: 'x'.repeat(16 * 1024 + 1), headers: { 'content-type': 'text/plain' } }));
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
  });

  it('AC-35: exact Set-Cookie without Domain; the cookie comes back as probeCookie without a new one', async () => {
    const dispatch = await withSecret();
    const first = await dispatch(viaEdge(`${TUNNEL}${ECHO}`));
    const lines = first.headers.getSetCookie();
    expect(lines).toHaveLength(1);
    const match = COOKIE_LINE.exec(lines[0] ?? '');
    expect(match).not.toBeNull();
    expect(lines[0]).not.toMatch(/domain/i);
    const cookie = match?.[1] ?? '';

    // Another cookie's value (built at runtime) must never be echoed: only its name (S4).
    const otherValue = randomBytes(12).toString('hex');
    const second = await dispatch(viaEdge(`${TUNNEL}${ECHO}`, { headers: { cookie: `other=${otherValue}; t2f_edge_probe=${cookie}` } }));
    expect(second.headers.getSetCookie()).toEqual([]);
    const text = await second.clone().text();
    const value = await echoOf(second);
    expect(value.probeCookie).toBe(cookie);
    expect(value.cookieNames).toEqual(['other']);
    expect(value.headers).not.toHaveProperty('cookie');
    expect(text).not.toContain(otherValue);
  });

  it('the exemption is this door only and needs the edge secret', async () => {
    const dispatch = await withSecret();
    const forbidden = { ok: false, error: { code: 'forbidden' } };

    // Edge-verified, non-loopback Host: the clock door keeps the loopback rule.
    const clock = await dispatch(viaEdge(`${TUNNEL}/api/_test/clock`));
    expect(clock.status).toBe(403);
    expect(await clock.json()).toEqual(forbidden);

    // A present foreign Origin is still refused for the echo door.
    const foreign = await dispatch(viaEdge(`${TUNNEL}${ECHO}`, { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain', origin: 'http://evil.test' } }));
    expect(foreign.status).toBe(403);

    // Without the secret (inactive gate): the echo door gets the ordinary door rules.
    const plain = await buildDispatcher(testDeps({}, { T2F_EDGE_SECRET: undefined }));
    expect((await plain(new Request(`${TUNNEL}${ECHO}`))).status).toBe(403);
    expect((await plain(new Request(`${BASE}${ECHO}`, { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain' } }))).status).toBe(403);
    const local = await echoOf(await plain(new Request(`${BASE}${ECHO}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })));
    expect(local).toMatchObject({ edgeVerified: false, client: { country: 'unknown', addressPresent: false } });
  });

  it('AC-36: rehearsal with the valid secret, and test without doors → both methods answer like /api/nope', async () => {
    const rehearsal = await buildDispatcher(testDeps({}, { T2F_ENV: 'rehearsal', T2F_EDGE_SECRET: EDGE_SECRET }));
    const noDoors = await buildDispatcher(testDeps({}, { T2F_TEST_DOORS: undefined, T2F_EDGE_SECRET: undefined }));
    const cases: [string, Dispatch, (url: string, init?: RequestInit) => Request][] = [
      ['rehearsal', rehearsal, viaEdge],
      ['test without doors', noDoors, (url, init) => new Request(url, init)],
    ];
    for (const [name, dispatch, make] of cases) {
      const nope = await dispatch(make(`${BASE}/api/nope`));
      const nopeText = await nope.clone().text();
      expect(nope.status, name).toBe(404);
      for (const method of ['GET', 'POST']) {
        const init = method === 'POST' ? { method, body: 'a=1', headers: { 'content-type': 'text/plain' } } : { method };
        const res = await dispatch(make(`${BASE}${ECHO}`, init));
        expect(res.status, `${name} ${method}`).toBe(404);
        expect(await res.text(), `${name} ${method}`).toBe(nopeText);
        expect(names(res), `${name} ${method}`).toEqual(names(nope));
      }
    }
  });
});
