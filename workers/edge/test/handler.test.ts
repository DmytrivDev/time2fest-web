// Node-level tests of the edge handler with a recording fake fetch (W5: AC-3, AC-5, AC-7, AC-8, NFR-4).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EdgeDeps, EdgeEnv } from '../src/env';
import { handle } from '../src/handler';
import { NOT_FOUND_BODY, UNAVAILABLE_BODY } from '../src/responses';

// Built at runtime so the secret scanner never sees a credential-like literal.
const SECRET = 's'.repeat(32);
const ORIGIN = 'https://origin.invalid';

type Call = { input: string; init: RequestInit };

function setup(over: Partial<EdgeEnv> = {}, opts: { noCf?: boolean } = {}) {
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
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => 1_767_225_600_000,
    cf,
  };
  return { calls, env, deps };
}

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

  it('uses no Cache API and no cf cache options anywhere in src (AC-7)', () => {
    const dir = new URL('../src/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const banned = /\bcaches\b|cacheTtl|cacheEverything|cacheKey|cacheTtlByStatus|\bcf:/;
    for (const f of files) {
      expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(banned);
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
