// Node-level tests of the edge handler with a recording fake fetch (W5: AC-3, AC-5, AC-7, AC-8, NFR-4;
// SPEC-07 W18: AC-8, AC-9 `x-t2f-edge-now`, AC-15 … AC-17 rehearsal /api/time).
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDGE_NOW_HEADER as CONTRACT_EDGE_NOW_HEADER } from '../../../packages/contracts/src/clock';
import type { EdgeDeps, EdgeEnv } from '../src/env';
import { handle, ORIGIN_TIME_BUDGET_MS } from '../src/handler';
import { EDGE_NOW_HEADER } from '../src/proxy';
import { resetPublicCacheMemo } from '../src/publicCache';
import { NOT_FOUND_BODY, UNAVAILABLE_BODY } from '../src/responses';

// Built at runtime so the secret scanner never sees a credential-like literal.
const SECRET = 's'.repeat(32); // check-secrets: allow test fake
const ORIGIN = 'https://origin.invalid';
const EDGE_NOW = 1_767_225_600_000;
const ORIGIN_NOW = 1_798_761_599_000;

type Call = { input: string; init: RequestInit };
type Respond = (input: string, init: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(over: Partial<EdgeEnv> = {}, opts: { noCf?: boolean; respond?: Respond } = {}) {
  const cf: EdgeDeps['cf'] = opts.noCf ? undefined : { country: 'UA' };
  const calls: Call[] = [];
  const env: EdgeEnv = {
    EDGE_ENV: 'test',
    ORIGIN_URL: ORIGIN,
    T2F_EDGE_SECRET: SECRET,
    ASSETS: { fetch: async () => new Response('static', { status: 200 }) },
    ...over,
  };
  const deps: EdgeDeps = {
    fetch: async (input, init) => {
      calls.push({ input, init });
      return opts.respond ? opts.respond(input, init) : json({ ok: true });
    },
    now: () => EDGE_NOW,
    cf,
  };
  return { calls, env, deps };
}

async function expectTimeBody(res: Response, now: number) {
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
  expect(await res.text()).toBe(JSON.stringify({ now }));
}

const timeReq = (headers: Record<string, string> = {}) =>
  new Request('https://rehearsal.time2fest.com/api/time', { headers });

function headersOf(call: Call | undefined): Headers {
  if (!call) throw new Error('fetch was not called');
  return new Headers(call.init.headers);
}

describe('edge handler (Node)', () => {
  it('replaces forged x-t2f-* with the secret and "<CF-Connecting-IP>;<country>"', async () => {
    const { calls, env, deps } = setup();
    await handle(
      new Request('https://test.time2fest.com/api/me', {
        headers: {
          'x-t2f-client': '203.0.113.9;US',
          'x-t2f-edge': 'forged',
          'CF-Connecting-IP': '198.51.100.7',
        },
      }),
      env,
      deps,
    );
    expect(calls).toHaveLength(1);
    const h = headersOf(calls[0]);
    expect(h.get('x-t2f-edge')).toBe(SECRET);
    expect(h.get('x-t2f-client')).toBe('198.51.100.7;UA');
  });

  it('strips client-sent address headers and leaves body and other headers as sent', async () => {
    const { calls, env, deps } = setup();
    await handle(
      new Request('https://test.time2fest.com/api/me', {
        method: 'POST',
        body: '{"a":1}',
        headers: {
          'CF-Connecting-IP': '198.51.100.7',
          'X-Forwarded-For': '203.0.113.9',
          'X-Real-IP': '203.0.113.10',
          Forwarded: 'for=203.0.113.11',
          'True-Client-IP': '203.0.113.12',
          'Content-Type': 'application/json',
          'X-Probe': 'p-2',
        },
      }),
      env,
      deps,
    );
    const h = headersOf(calls[0]);
    for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'true-client-ip', 'cf-connecting-ip']) {
      expect(h.has(name), name).toBe(false);
    }
    expect(h.get('x-t2f-client')).toBe('198.51.100.7;UA');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('x-probe')).toBe('p-2');
    expect(await new Response(calls[0]?.init.body).text()).toBe('{"a":1}');
  });

  it('leaves the country empty when request.cf is absent', async () => {
    const { calls, env, deps } = setup({}, { noCf: true });
    await handle(
      new Request('https://test.time2fest.com/api/me', { headers: { 'CF-Connecting-IP': '198.51.100.7' } }),
      env,
      deps,
    );
    expect(headersOf(calls[0]).get('x-t2f-client')).toBe('198.51.100.7;');
  });

  it('passes Cookie, Content-Type, X-Probe, method, path and query unchanged', async () => {
    const { calls, env, deps } = setup();
    await handle(
      new Request('https://test.time2fest.com/api/a/b?x=1&y=%20z', {
        method: 'PUT',
        body: '{"a":1}',
        headers: { Cookie: 'sid=abc; t=1', 'Content-Type': 'application/json', 'X-Probe': 'p-1' },
      }),
      env,
      deps,
    );
    const call = calls[0];
    expect(call?.input).toBe(`${ORIGIN}/api/a/b?x=1&y=%20z`);
    expect(call?.init.method).toBe('PUT');
    expect(call?.init.redirect).toBe('manual');
    const h = headersOf(call);
    expect(h.get('cookie')).toBe('sid=abc; t=1');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('x-probe')).toBe('p-1');
  });

  it('hands the request body stream itself to fetch, unread (NFR-4)', async () => {
    const { calls, env, deps } = setup();
    const req = new Request('https://test.time2fest.com/api/upload', { method: 'POST', body: 'x'.repeat(1024) });
    const stream = req.body;
    await handle(req, env, deps);
    expect(stream).not.toBeNull();
    expect(calls[0]?.init.body).toBe(stream);
    expect(req.bodyUsed).toBe(false);
  });

  it('answers /api and a WebSocket upgrade with the single 404 and never calls the origin', async () => {
    const { calls, env, deps } = setup();
    const bare = await handle(new Request('https://test.time2fest.com/api'), env, deps);
    const ws = await handle(
      new Request('https://test.time2fest.com/api/realtime', { headers: { Upgrade: 'WebSocket' } }),
      env,
      deps,
    );
    for (const res of [bare, ws]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(await res.text()).toBe(NOT_FOUND_BODY);
    }
    expect(calls).toHaveLength(0);
  });

  // SPEC-08 W30 narrows AC-7: the Cache API is allowed in `publicCache.ts` only; cf cache options nowhere.
  it('names the Cache API only in publicCache.ts and uses no cf cache options anywhere in src (AC-7)', () => {
    const dir = new URL('../src/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const cfOptions = /cacheTtl|cacheEverything|cacheKey|cacheTtlByStatus|\bcf:/;
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(text, f).not.toMatch(cfOptions);
      if (f !== 'publicCache.ts') expect(text, f).not.toMatch(/\bcaches\b/);
    }
  });

  it('fails closed with 503 when ORIGIN_URL is set but the secret is missing', async () => {
    const { calls, env, deps } = setup({ T2F_EDGE_SECRET: undefined });
    const res = await handle(new Request('https://test.time2fest.com/api/me'), env, deps);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.text()).toBe(UNAVAILABLE_BODY);
    expect(calls).toHaveLength(0);
  });
});

describe('x-t2f-edge-now on every forward (SPEC-07 AC-8, AC-9)', () => {
  it('uses the header name of the shared contract (C8)', () => {
    expect(EDGE_NOW_HEADER).toBe(CONTRACT_EDGE_NOW_HEADER);
  });

  it('AC-8: a forward carries the edge clock as an integer of ms', async () => {
    const { calls, env, deps } = setup();
    deps.now = () => EDGE_NOW + 0.75;
    await handle(new Request('https://test.time2fest.com/api/me'), env, deps);
    const value = headersOf(calls[0]).get('x-t2f-edge-now');
    expect(value).toMatch(/^\d+$/);
    expect(Number(value)).toBe(EDGE_NOW);
  });

  it('AC-9: a client-sent x-t2f-edge-now never reaches the origin (any case, any method)', async () => {
    const { calls, env, deps } = setup();
    await handle(
      new Request('https://test.time2fest.com/api/me', { headers: { 'X-T2F-Edge-Now': '1' } }),
      env,
      deps,
    );
    await handle(
      new Request('https://test.time2fest.com/api/me', {
        method: 'POST',
        body: '{}',
        headers: { 'x-t2f-edge-now': '9999999999999, 1' },
      }),
      env,
      deps,
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(headersOf(call).get('x-t2f-edge-now')).toBe(String(EDGE_NOW));
  });

  it('AC-9: a forged header with no edge secret still yields 503, never a forward', async () => {
    const { calls, env, deps } = setup({ T2F_EDGE_SECRET: undefined });
    const res = await handle(
      new Request('https://test.time2fest.com/api/me', { headers: { 'x-t2f-edge-now': '1' } }),
      env,
      deps,
    );
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/time per class (SPEC-07 AC-15 … AC-17)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-15: rehearsal forwards to the origin and answers its `now` with the three headers', async () => {
    const { calls, env, deps } = setup({ EDGE_ENV: 'rehearsal' }, { respond: async () => json({ now: ORIGIN_NOW }) });
    const res = await handle(timeReq({ 'x-t2f-edge-now': '1', 'x-t2f-edge': 'forged' }), env, deps);
    await expectTimeBody(res, ORIGIN_NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${ORIGIN}/api/time`);
    expect(calls[0]?.init.method).toBe('GET');
    const h = headersOf(calls[0]);
    expect(h.get('x-t2f-edge')).toBe(SECRET);
    expect(h.get('x-t2f-edge-now')).toBe(String(EDGE_NOW));
  });

  it('AC-15: an origin answer just inside the budget is still used', async () => {
    vi.useFakeTimers();
    const { env, deps } = setup(
      { EDGE_ENV: 'rehearsal' },
      { respond: () => new Promise((r) => setTimeout(() => r(json({ now: ORIGIN_NOW })), ORIGIN_TIME_BUDGET_MS - 100)) },
    );
    const pending = handle(timeReq(), env, deps);
    await vi.advanceTimersByTimeAsync(ORIGIN_TIME_BUDGET_MS - 100);
    await expectTimeBody(await pending, ORIGIN_NOW);
  });

  it('AC-16: an origin silent for 1 100 ms → the edge clock, and the origin call is aborted', async () => {
    vi.useFakeTimers();
    const { calls, env, deps } = setup(
      { EDGE_ENV: 'rehearsal' },
      { respond: () => new Promise((r) => setTimeout(() => r(json({ now: ORIGIN_NOW })), 1100)) },
    );
    const pending = handle(timeReq(), env, deps);
    await vi.advanceTimersByTimeAsync(ORIGIN_TIME_BUDGET_MS);
    await expectTimeBody(await pending, EDGE_NOW);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
  });

  it('AC-16: an origin that never answers → the edge clock after 1 000 ms', async () => {
    vi.useFakeTimers();
    const { env, deps } = setup({ EDGE_ENV: 'rehearsal' }, { respond: () => new Promise<Response>(() => undefined) });
    const pending = handle(timeReq(), env, deps);
    await vi.advanceTimersByTimeAsync(ORIGIN_TIME_BUDGET_MS);
    await expectTimeBody(await pending, EDGE_NOW);
  });

  it.each([
    ['a JSON 500', () => json({ now: ORIGIN_NOW }, 500)],
    ['an HTML 502', () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })],
    ['a 302', () => new Response(null, { status: 302, headers: { location: '/elsewhere' } })],
    ['now = -1', () => json({ now: -1 })],
    ['now = 1.5', () => json({ now: 1.5 })],
    ['now as a string', () => json({ now: String(ORIGIN_NOW) })],
    ['no now', () => json({ ok: true })],
    ['now = null', () => json({ now: null })],
    ['a JSON array', () => json([ORIGIN_NOW])],
    ['a body that is not JSON', () => new Response('not json', { status: 200 })],
  ])('AC-16: %s from the origin → the edge clock', async (_label, make) => {
    const { calls, env, deps } = setup({ EDGE_ENV: 'rehearsal' }, { respond: async () => make() });
    await expectTimeBody(await handle(timeReq(), env, deps), EDGE_NOW);
    expect(calls).toHaveLength(1);
  });

  it('AC-16: a fetch that throws → the edge clock', async () => {
    const { env, deps } = setup(
      { EDGE_ENV: 'rehearsal' },
      {
        respond: async () => {
          throw new Error('connection refused');
        },
      },
    );
    await expectTimeBody(await handle(timeReq(), env, deps), EDGE_NOW);
  });

  it.each([
    ['ORIGIN_URL', { ORIGIN_URL: undefined }],
    ['the edge secret', { T2F_EDGE_SECRET: undefined }],
  ] as const)('rehearsal without %s answers the edge clock and calls nothing', async (_label, over) => {
    const { calls, env, deps } = setup({ EDGE_ENV: 'rehearsal', ...over });
    await expectTimeBody(await handle(timeReq(), env, deps), EDGE_NOW);
    expect(calls).toHaveLength(0);
  });

  it.each(['production', 'prelaunch'] as const)(
    'AC-17: %s answers the edge clock only; the origin gets no request',
    async (EDGE_ENV) => {
      const { calls, env, deps } = setup({ EDGE_ENV }, { respond: async () => json({ now: ORIGIN_NOW }) });
      await expectTimeBody(await handle(timeReq({ 'x-t2f-edge-now': '1' }), env, deps), EDGE_NOW);
      expect(calls).toHaveLength(0);
    },
  );

  it('rehearsal POST /api/time is forwarded as any other path, not answered from a clock', async () => {
    const { calls, env, deps } = setup({ EDGE_ENV: 'rehearsal' });
    const res = await handle(
      new Request('https://rehearsal.time2fest.com/api/time', { method: 'POST', body: '{}' }),
      env,
      deps,
    );
    expect(await res.text()).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
  });
});

// SPEC-12 WE3 (AC-11, AC-12): the real `live-chains` row of PUBLIC_ROUTES behind the handler. Any query is
// dropped before the cache key and the origin request; one origin call serves every request.
describe('GET /api/live/chains through the handler (SPEC-12 AC-11, AC-12)', () => {
  afterEach(() => resetPublicCacheMemo());

  it('AC-11: 20 requests with random params → 1 origin request, path only, no params', async () => {
    const body = { version: 3, at: '2026-12-31T00:00:00.000Z', chains: [] };
    const { calls, env, deps } = setup({}, { respond: async () => json(body) });
    const stored = new Map<string, Response>();
    deps.cache = {
      match: async (key) => stored.get(key.url)?.clone(),
      put: async (key, res) => void stored.set(key.url, res),
    };
    const random = () => `${Math.random().toString(36).slice(2)}=${Math.random().toString(36).slice(2)}`;
    const reqs = Array.from({ length: 20 }, (_, i) => `https://test.time2fest.com/api/live/chains?${random()}&n=${i}`);
    const first = await handle(new Request(reqs[0] ?? ''), env, deps);
    const rest = await Promise.all(reqs.slice(1).map((u) => handle(new Request(u), env, deps)));
    for (const res of [first, ...rest]) {
      expect(res.status).toBe(200);
      expect(JSON.parse(await res.text())).toEqual(body);
    }
    expect(first.headers.get('x-t2f-source')).toBe('origin');
    expect(rest.every((r) => r.headers.get('x-t2f-source') === 'cache')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${ORIGIN}/api/live/chains`);
    expect([...stored.keys()]).toEqual(['https://test.time2fest.com/api/live/chains']);
  });
});
