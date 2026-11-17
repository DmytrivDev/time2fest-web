// The edge Worker in a local workerd via wrangler's test harness, against a loopback origin stub (W6).
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';
import { NOT_FOUND_BODY, UNAVAILABLE_BODY } from '../src/responses';
import { sha256, startOriginStub, STUB_COOKIES_BODY, STUB_JSON503_BODY, type OriginStub } from './support/originStub';
import { writeTempConfig, type TempConfig } from './support/tempConfig';

const SECRET = 'e'.repeat(32); // check-secrets: allow test value
const CF = { country: 'UA' } as const;

let stub: OriginStub;

async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

/** Starts one harness for `env`; closes it (and its temp config) after the enclosing describe. */
function useHarness(env: string, origin: () => string, { withSecret = true, tag = env } = {}) {
  const ref: { h?: TestHarness; cfg?: TempConfig } = {};
  beforeAll(async () => {
    ref.cfg = writeTempConfig(origin(), tag);
    ref.h = createTestHarness({
      workers: [
        {
          configPath: ref.cfg.configPath,
          env,
          ...(withSecret ? { secrets: { T2F_EDGE_SECRET: SECRET } } : {}),
        },
      ],
    });
    await ref.h.listen();
  });
  afterAll(async () => {
    await ref.h?.close();
    ref.cfg?.cleanup();
  });
  return (path: string, init: Parameters<TestHarness['fetch']>[1] = {}) => {
    if (!ref.h) throw new Error('harness not started');
    return ref.h.fetch(path, { cf: CF, ...init });
  };
}

async function expectUnavailable(res: Awaited<ReturnType<TestHarness['fetch']>>, label: string) {
  const body = await res.text();
  expect(res.status, `${label}: ${body.slice(0, 200)}`).toBe(503);
  expect(res.headers.get('retry-after'), label).toBe('5');
  expect(res.headers.get('cache-control'), label).toBe('private, no-store');
  expect(body, label).toBe(UNAVAILABLE_BODY);
}

beforeAll(async () => {
  stub = await startOriginStub();
});
afterAll(async () => {
  await stub?.close();
});
beforeEach(() => {
  stub.calls.length = 0;
});

describe('env test (proxying)', () => {
  const fetchEdge = useHarness('test', () => stub.url);

  it('AC-2: serves static paths and never calls the origin', async () => {
    for (const path of ['/', '/country/ua/']) {
      const res = await fetchEdge(path);
      expect(res.status, path).toBe(200);
      await res.arrayBuffer();
    }
    for (const path of ['/admin/', '/cms-api/x']) {
      const res = await fetchEdge(path);
      expect(res.status, path).toBe(404);
      await res.arrayBuffer();
    }
    expect(stub.calls).toHaveLength(0);
  });

  it('AC-3: /api is the single 404 with private, no-store', async () => {
    const res = await fetchEdge('/api');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe(NOT_FOUND_BODY);
    expect(stub.calls).toHaveLength(0);
  });

  // AC-3 WebSocket case: asserted only in handler.test.ts. The harness cannot dispatch an
  // `Upgrade: websocket` request cleanly (the 404 body arrives garbled and the socket resets).

  it('AC-5: forwards method, path, query, headers and body unchanged', async () => {
    const json = '{"a":1,"b":"два"}';
    const form = 'a=1&b=%D0%B4%D0%B2%D0%B0';
    const cases: { method: string; body?: string; type?: string }[] = [
      { method: 'GET' },
      { method: 'HEAD' },
      { method: 'OPTIONS' },
      { method: 'PUT', body: json, type: 'application/json' },
      { method: 'DELETE' },
      { method: 'POST', body: json, type: 'application/json' },
      { method: 'POST', body: form, type: 'application/x-www-form-urlencoded' },
    ];
    for (const c of cases) {
      stub.calls.length = 0;
      const headers: Record<string, string> = { cookie: 'sid=abc; t=1', 'x-probe': `probe-${c.method}` };
      if (c.type) headers['content-type'] = c.type;
      const res = await fetchEdge('/api/echo/x?q=1&r=%20s', {
        method: c.method,
        headers,
        ...(c.body !== undefined ? { body: c.body } : {}),
      });
      await res.arrayBuffer();
      const label = `${c.method} ${c.type ?? ''}`;
      expect(res.status, label).toBe(200);
      expect(stub.calls, label).toHaveLength(1);
      const seen = stub.calls[0]!;
      expect(seen.method, label).toBe(c.method);
      expect(seen.url, label).toBe('/api/echo/x?q=1&r=%20s');
      expect(seen.headers.cookie, label).toBe('sid=abc; t=1');
      expect(seen.headers['x-probe'], label).toBe(`probe-${c.method}`);
      if (c.type) expect(seen.headers['content-type'], label).toBe(c.type);
      expect(seen.bodySha256, label).toBe(sha256(c.body ?? ''));
    }
  });

  it('AC-6/AC-7: returns status, each Set-Cookie, headers and body of the origin unchanged', async () => {
    const res = await fetchEdge('/api/stub/cookies');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
    expect(res.headers.get('x-custom')).toBe('custom-value');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBeNull();
    expect(await res.text()).toBe(STUB_COOKIES_BODY);
  });

  it("AC-6: passes the server's own JSON 503 byte for byte", async () => {
    const res = await fetchEdge('/api/stub/json503');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.text()).toBe(STUB_JSON503_BODY);
  });

  it('AC-8: forged x-t2f-* never reach the origin; the edge sets secret and client', async () => {
    const res = await fetchEdge('/api/whoami', {
      headers: { 'x-t2f-edge': 'forged', 'x-t2f-client': '203.0.113.9;US' },
    });
    await res.arrayBuffer();
    expect(stub.calls).toHaveLength(1);
    const h = stub.calls[0]!.headers;
    expect(h['x-t2f-edge']).toBe(SECRET);
    expect(h['x-t2f-client']).not.toBe('203.0.113.9;US');
    expect(String(h['x-t2f-client'])).toMatch(/;UA$/);
  });

  // A dropped origin connection cannot reach the Worker as a throw here: the harness routes every
  // outbound fetch through Node (`outboundService` in wrangler-dist/cli.js), and miniflare turns a
  // Node fetch rejection into a plain 500. The throw branch is covered by the describe below.
  it('AC-9: HTML 530 and HTML 502 become the JSON 503', async () => {
    for (const path of ['/api/stub/html530', '/api/stub/html502']) {
      await expectUnavailable(await fetchEdge(path), path);
    }
  });

  it('AC-11: /api/time is proxied to the origin in env test', async () => {
    const res = await fetchEdge('/api/time');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      JSON.stringify({ echo: { method: 'GET', url: '/api/time', sha256: sha256('') } }),
    );
    expect(stub.calls).toHaveLength(1);
  });

  it('NFR-4: a 1 MiB POST body arrives with the same SHA-256', async () => {
    const body = new Uint8Array(1024 * 1024);
    for (let i = 0; i < body.length; i += 1) body[i] = (i * 31 + 7) & 0xff;
    const res = await fetchEdge('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
    await res.arrayBuffer();
    expect(res.status).toBe(200);
    expect(stub.calls[0]?.bodyBytes).toBe(body.length);
    expect(stub.calls[0]?.bodySha256).toBe(sha256(body));
  });
});

describe('env test, fetch rejected inside workerd', () => {
  // workerd refuses a non-HTTP scheme itself, before the harness outbound, so `fetch()` throws in the Worker.
  const fetchEdge = useHarness('test', () => 'ftp://127.0.0.1:9', { tag: 'test-throw' });

  it('AC-9: a fetch that throws becomes the JSON 503', async () => {
    await expectUnavailable(await fetchEdge('/api/me'), 'throw');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('env rehearsal (edge clock, origin unreachable)', () => {
  let origin = '';
  beforeAll(async () => {
    origin = `http://127.0.0.1:${await closedPort()}`;
  });
  const fetchEdge = useHarness('rehearsal', () => origin);

  it('AC-10: GET /api/time is answered at the edge', async () => {
    const res = await fetchEdge('/api/time');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const { now } = (await res.json()) as { now: number };
    expect(Number.isInteger(now)).toBe(true);
    expect(Math.abs(now - Date.now())).toBeLessThanOrEqual(1000);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('env prelaunch (no origin)', () => {
  const fetchEdge = useHarness('prelaunch', () => stub.url, { withSecret: false });

  it('AC-12: other /api paths and POST /api/time are the single 404', async () => {
    for (const [path, method] of [
      ['/api/x', 'GET'],
      ['/api/time', 'POST'],
    ] as const) {
      const res = await fetchEdge(path, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(await res.text()).toBe(NOT_FOUND_BODY);
    }
    expect(stub.calls).toHaveLength(0);
  });
});
