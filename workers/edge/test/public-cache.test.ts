// Node tests of the public site address at the edge (SPEC-08 W30: AC-23 edge half, AC-24 … AC-31,
// AC-38 … AC-41, NFR-2, NFR-4) with an in-memory cache, an in-memory bucket, a counting origin and a hand clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_ROUTES, type PublicRoute } from '../../../packages/contracts/src/publicRoutes';
import { LIVE_CACHE_TAG, LIVE_R2_KEYS } from '../../../packages/contracts/src/live';
import { SITE_R2_KEYS, SITE_SOURCE_HEADER, SITE_VERSION_HEADER } from '../../../packages/contracts/src/site';
import { parseSiteState } from '../../../packages/contracts/src/siteGuard';
import type { EdgeCache, EdgeDeps, EdgeEnv, SiteBucket } from '../src/env';
import { handle } from '../src/handler';
import {
  CACHED_AT_HEADER,
  PUBLIC_ORIGIN_BUDGET_MS,
  R2_COPY_MEMO_MS,
  resetPublicCacheMemo,
  servePublic,
  SITE_CACHE_TAG,
  SOURCE_HEADER,
  VERSION_HEADER,
} from '../src/publicCache';
import { resetRedButtonMemo } from '../src/redButton';
import { UNAVAILABLE_BODY } from '../src/responses';

// Built at runtime so the secret scanner never sees a credential-like literal.
const SECRET = 'p'.repeat(32); // check-secrets: allow test fake
const ORIGIN = 'https://origin.invalid';
const HOST = 'https://test.time2fest.com';
const SITE = `${HOST}/api/site/state`;
const PREFIX = 'test/';
const T0 = 1_767_225_600_000;
const S = 1000;

function snapshot(version: number, extra: Record<string, unknown> = {}) {
  return {
    version,
    at: '2026-12-31T00:00:00.000Z',
    switches: {
      chat: true,
      toasts: true,
      pass: true,
      passGift: true,
      payments: true,
      viewersMap: true,
      viewersCount: true,
      passOffer: true,
      chatRooms: {},
      toastTiers: { '2': true, '5': true, '10': true },
    },
    products: [],
    catalogVersion: 'cat-1',
    eventPatches: {},
    ...extra,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

type Stored = { status: number; headers: [string, string][]; body: string; storedAt: number };

/** In-memory cache that honours the stored headers like the runtime: no `Set-Cookie` entries, `s-maxage` expiry. */
class MemCache implements EdgeCache {
  readonly entries = new Map<string, Stored>();
  puts = 0;
  constructor(private readonly clock: { t: number }) {}
  async match(key: Request): Promise<Response | undefined> {
    const e = this.entries.get(key.url);
    if (!e) return undefined;
    const maxAge = /s-maxage=(\d+)/.exec(new Headers(e.headers).get('cache-control') ?? '');
    if (maxAge && this.clock.t - e.storedAt > Number(maxAge[1]) * S) return undefined;
    return new Response(e.body, { status: e.status, headers: e.headers });
  }
  async put(key: Request, res: Response): Promise<void> {
    this.puts += 1;
    if (res.headers.has('set-cookie')) return; // the runtime never stores such a response
    this.entries.set(key.url, {
      status: res.status,
      headers: [...res.headers],
      body: await res.text(),
      storedAt: this.clock.t,
    });
  }
}

class MemBucket implements SiteBucket {
  readonly objects = new Map<string, string>();
  readonly gets: string[] = [];
  throws = false;
  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    this.gets.push(key);
    if (this.throws) throw new Error('r2 down');
    const v = this.objects.get(key);
    return v === undefined ? null : { text: async () => v };
  }
  readsOf(key: string): number {
    return this.gets.filter((k) => k === `${PREFIX}${key}`).length;
  }
}

type Respond = (input: string, init: RequestInit) => Promise<Response>;

function setup(over: Partial<EdgeEnv> = {}, opts: { noCache?: boolean } = {}) {
  const clock = { t: T0 };
  const cache = new MemCache(clock);
  const bucket = new MemBucket();
  const calls: { input: string; headers: Headers }[] = [];
  const pending: Promise<unknown>[] = [];
  const origin: { respond: Respond } = { respond: async () => json(snapshot(1)) };
  const env: EdgeEnv = {
    EDGE_ENV: 'test',
    ORIGIN_URL: ORIGIN,
    T2F_EDGE_SECRET: SECRET,
    ASSETS: { fetch: async () => new Response('static') },
    SITE_BUCKET: bucket,
    R2_PREFIX: PREFIX,
    ...over,
  };
  const deps: EdgeDeps = {
    fetch: async (input, init) => {
      calls.push({ input, headers: new Headers(init.headers) });
      return origin.respond(input, init);
    },
    now: () => clock.t,
    cf: { country: 'UA' },
    ...(opts.noCache ? {} : { cache }),
    waitUntil: (p) => pending.push(p),
  };
  const get = (url = SITE, init?: RequestInit) => handle(new Request(url, init), env, deps);
  const flush = async () => {
    await Promise.all(pending.splice(0));
  };
  return { clock, cache, bucket, calls, origin, env, deps, get, flush };
}

async function versionOf(res: Response): Promise<number> {
  return ((await res.json()) as { version: number }).version;
}

function expectHeaders(res: Response, source: string, version: number) {
  expect(res.status).toBe(200);
  expect(res.headers.get(SOURCE_HEADER)).toBe(source);
  expect(res.headers.get(VERSION_HEADER)).toBe(String(version));
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(res.headers.get('cache-tag')).toBeNull();
  expect(res.headers.get(CACHED_AT_HEADER)).toBeNull();
}

let logged: string[] = [];
const events = () => logged;

beforeEach(() => {
  resetRedButtonMemo();
  resetPublicCacheMemo();
  logged = [];
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    logged.push((JSON.parse(String(line)) as { event: string }).event);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('contract pins', () => {
  it('uses the contract header names and R2 keys', () => {
    expect(SOURCE_HEADER).toBe(SITE_SOURCE_HEADER);
    expect(VERSION_HEADER).toBe(SITE_VERSION_HEADER);
    const site = PUBLIC_ROUTES.find((r) => r.key === 'site-state');
    expect(site?.r2Copy).toBe(SITE_R2_KEYS.latest);
    expect(site?.redButton).toBe(SITE_R2_KEYS.redButton);
    expect(parseSiteState(snapshot(1))).not.toBeNull();
  });
});

describe('public list drives the branch (AC-23 edge half)', () => {
  it('serves every listed path through the public branch', async () => {
    // A valid body per route: the edge checks each answer with the guard of its row (BODY_GUARDS).
    const bodyOf = (key: string) => (key === 'live-chains' ? { version: 1, at: '2026-12-31T00:00:00.000Z', chains: [] } : snapshot(1));
    expect(PUBLIC_ROUTES.map((r) => r.key).sort()).toEqual(['live-chains', 'site-state']);
    for (const route of PUBLIC_ROUTES) {
      const { get, origin } = setup();
      origin.respond = async () => json(bodyOf(route.key));
      const res = await get(`${HOST}${route.path}`);
      expect(res.headers.get(SOURCE_HEADER), route.path).toBe('origin');
    }
  });

  it('proxies a path not in the list untouched (query kept, no source headers, nothing cached)', async () => {
    const { get, calls, cache } = setup();
    const res = await get(`${HOST}/api/site/states?a=1`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${ORIGIN}/api/site/states?a=1`);
    expect(res.headers.get(SOURCE_HEADER)).toBeNull();
    expect(cache.puts).toBe(0);
  });

  it('proxies a non-GET to the public path as before', async () => {
    const { get, calls, cache } = setup();
    const res = await get(SITE, { method: 'POST', body: '{}' });
    expect(calls).toHaveLength(1);
    expect(res.headers.get(SOURCE_HEADER)).toBeNull();
    expect(cache.puts).toBe(0);
  });
});

describe('cache key and origin request (AC-24, AC-25)', () => {
  it('20 random params → one origin request without query and without cookies', async () => {
    const { get, calls, clock } = setup();
    for (let i = 0; i < 20; i += 1) {
      const q = `${Math.random().toString(36).slice(2)}=${Math.random()}&_=${i}`;
      const res = await get(`${SITE}?${q}`, { headers: { cookie: `sid=${i}`, authorization: 'Bearer x' } });
      expect(res.status).toBe(200);
      clock.t += 100;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${ORIGIN}/api/site/state`);
    expect(calls[0]?.headers.get('cookie')).toBeNull();
    expect(calls[0]?.headers.get('authorization')).toBeNull();
    expect(calls[0]?.headers.get('x-t2f-edge')).toBe(SECRET);
  });

  it('100 requests within 10 s → one origin call, then the cache', async () => {
    const { get, calls, clock } = setup();
    const sources: (string | null)[] = [];
    for (let i = 0; i < 100; i += 1) {
      clock.t = T0 + i * 100; // last one at 9.9 s
      sources.push((await get()).headers.get(SOURCE_HEADER));
    }
    expect(calls).toHaveLength(1);
    expect(sources[0]).toBe('origin');
    expect(sources.slice(1).every((s) => s === 'cache')).toBe(true);
  });

  it('a copy aged exactly 10 s is still fresh', async () => {
    const { get, calls, clock, flush } = setup();
    await get();
    clock.t = T0 + 10 * S;
    expect((await get()).headers.get(SOURCE_HEADER)).toBe('cache');
    await flush();
    expect(calls).toHaveLength(1);
  });
});

describe('stale copy refreshed in the background (AC-26)', () => {
  it('at 11 s serves the old version, refreshes once, and the next answer has the new one', async () => {
    const { get, calls, clock, origin, flush } = setup();
    await get();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    origin.respond = async () => {
      await gate;
      return json(snapshot(2));
    };
    clock.t = T0 + 11 * S;
    const a = await get();
    const b = await get(); // while the refresh is in flight: no second background call
    expectHeaders(a, 'cache', 1);
    expect(await versionOf(a)).toBe(1);
    expect(await versionOf(b)).toBe(1);
    release();
    await flush();
    expect(calls).toHaveLength(2);
    const c = await get();
    expectHeaders(c, 'cache', 2);
    expect(await versionOf(c)).toBe(2);
    expect(calls).toHaveLength(2);
  });
});

describe('origin failure (AC-27 … AC-29)', () => {
  it('origin 530: cache copy at 39 s of age, the next source at 41 s', async () => {
    const { get, clock, origin, bucket, flush } = setup();
    await get();
    origin.respond = async () => new Response('tunnel error', { status: 530 });
    clock.t = T0 + 39 * S;
    const at39 = await get();
    expectHeaders(at39, 'cache', 1);
    await flush();
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(7)));
    clock.t = T0 + 41 * S;
    const at41 = await get();
    expectHeaders(at41, 'r2', 7);
  });

  const failures: [string, () => Promise<Response>][] = [
    ['network error', async () => Promise.reject(new TypeError('fetch failed'))],
    ['500 with JSON', async () => json({ ok: false }, 500)],
    ['504', async () => new Response('gw', { status: 504 })],
    ['520', async () => new Response('cf', { status: 520 })],
    ['530', async () => new Response('cf', { status: 530 })],
    ['200 without JSON', async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['200 JSON refused by the guard', async () => json({ version: 0 })],
  ];

  it.each(failures)('%s, empty cache, R2 copy → R2 body with x-t2f-source: r2 (AC-28)', async (_n, respond) => {
    const { get, origin, bucket, cache } = setup();
    origin.respond = respond;
    const copy = snapshot(5);
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(copy));
    const res = await get();
    expectHeaders(res, 'r2', 5);
    expect(await res.json()).toEqual(copy);
    expect(cache.entries.size).toBe(0);
  });

  it('nothing anywhere → the existing 503 unavailable (AC-29)', async () => {
    const { get, origin } = setup();
    origin.respond = async () => new Response('cf', { status: 530 });
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE_BODY);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('an invalid R2 copy counts as no copy', async () => {
    const { get, origin, bucket } = setup();
    origin.respond = async () => new Response('cf', { status: 530 });
    bucket.objects.set(`${PREFIX}site/latest.json`, '{not json');
    expect((await get()).status).toBe(503);
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify({ version: 3 }));
    resetRedButtonMemo();
    resetPublicCacheMemo();
    expect((await get()).status).toBe(503);
  });

  it('without the edge secret the origin is never called; cache, R2 and 503 still answer', async () => {
    const { get, calls, bucket, clock } = setup({ T2F_EDGE_SECRET: undefined });
    expect((await get()).status).toBe(503);
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(4)));
    clock.t = T0 + R2_COPY_MEMO_MS; // past the R2 memo window (S8-03)
    expectHeaders(await get(), 'r2', 4);
    expect(calls).toHaveLength(0);
  });

  it('without a cache binding every request asks the origin', async () => {
    const { get, calls } = setup({}, { noCache: true });
    expectHeaders(await get(), 'origin', 1);
    expectHeaders(await get(), 'origin', 1);
    expect(calls).toHaveLength(2);
  });
});

describe('Set-Cookie and what is stored (AC-30, AC-31, А-2)', () => {
  it('origin Set-Cookie is absent from the first and the cached answer, and the copy is stored', async () => {
    const { get, origin, calls } = setup();
    origin.respond = async () => json(snapshot(1), 200, { 'set-cookie': 'sid=abc; Path=/' });
    const first = await get();
    expectHeaders(first, 'origin', 1);
    expect(first.headers.get('cache-control')).toBe('public, max-age=10');
    const second = await get();
    expectHeaders(second, 'cache', 1);
    expect(calls).toHaveLength(1);
  });

  it('stores the copy with s-maxage=40, the purge tag and the edge clock', async () => {
    const { get, cache } = setup();
    await get(`${SITE}?x=1`);
    const stored = cache.entries.get(SITE);
    expect(stored).toBeDefined();
    const h = new Headers(stored?.headers);
    expect(h.get('cache-control')).toBe('public, s-maxage=40');
    expect(h.get('cache-tag')).toBe(SITE_CACHE_TAG);
    expect(SITE_CACHE_TAG).toBe('t2f-site-state');
    expect(h.get(CACHED_AT_HEADER)).toBe(String(T0));
    expect(h.get('set-cookie')).toBeNull();
    expect([...cache.entries.keys()]).toEqual([SITE]);
  });

  it('a private path twice → 2 origin calls, private, no-store kept, nothing cached', async () => {
    const { get, origin, calls, cache } = setup();
    origin.respond = async () => json({ ok: true }, 200, { 'cache-control': 'private, no-store' });
    for (let i = 0; i < 2; i += 1) {
      const res = await get(`${HOST}/api/me`);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get(SOURCE_HEADER)).toBeNull();
    }
    expect(calls).toHaveLength(2);
    expect(cache.puts).toBe(0);
  });
});

describe('red button (AC-38 … AC-41, NFR-4)', () => {
  const BUTTON = `${PREFIX}site/red-button.json`;

  it('present over a warm cache → button body, x-t2f-source: red-button', async () => {
    const { get, bucket } = setup();
    await get();
    resetRedButtonMemo();
    const obj = snapshot(9, { outage: 'technical' });
    bucket.objects.set(BUTTON, JSON.stringify(obj));
    const res = await get();
    expectHeaders(res, 'red-button', 9);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    expect(await res.json()).toEqual(obj);
  });

  it('added and removed → visible by 10 s each time (AC-39)', async () => {
    const { get, bucket, clock } = setup();
    expect((await get()).headers.get(SOURCE_HEADER)).toBe('origin');
    clock.t = T0 + 1 * S;
    bucket.objects.set(BUTTON, JSON.stringify(snapshot(9, { outage: 'technical' })));
    clock.t = T0 + 10 * S;
    expectHeaders(await get(), 'red-button', 9);
    clock.t = T0 + 11 * S;
    bucket.objects.delete(BUTTON);
    clock.t = T0 + 20 * S;
    expect((await get()).headers.get(SOURCE_HEADER)).not.toBe('red-button');
  });

  it('bucket read throws → the origin answer and site/red-button-read-failed (AC-40)', async () => {
    const { get, bucket } = setup();
    bucket.throws = true;
    expectHeaders(await get(), 'origin', 1);
    expect(events()).toEqual(['site/red-button-read-failed']);
  });

  it.each([
    ['broken JSON', '{"outage":'],
    ['no outage', JSON.stringify(snapshot(9))],
    ['refused by the guard', JSON.stringify({ outage: 'technical', version: 9 })],
    ['another outage value', JSON.stringify({ ...snapshot(9), outage: 'other' })],
  ])('%s → the normal answer and site/red-button-invalid (AC-41)', async (_n, body) => {
    const { get, bucket } = setup();
    bucket.objects.set(BUTTON, body);
    expectHeaders(await get(), 'origin', 1);
    expect(events()).toEqual(['site/red-button-invalid']);
  });

  it('1 000 requests in 10 s → at most one bucket read (NFR-4)', async () => {
    const { get, bucket, clock } = setup();
    bucket.objects.set(BUTTON, JSON.stringify(snapshot(9, { outage: 'technical' })));
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) => {
        clock.t = T0 + i * 9;
        return get();
      }),
    );
    expect(bucket.readsOf('site/red-button.json')).toBeLessThanOrEqual(1);
  });

  it('no bucket binding → the button is never read', async () => {
    const { get } = setup({ SITE_BUCKET: undefined });
    expectHeaders(await get(), 'origin', 1);
  });
});

describe('every source sets both headers (NFR-2)', () => {
  it('origin, cache, r2, red-button', async () => {
    const { get, origin, bucket, clock } = setup();
    expectHeaders(await get(), 'origin', 1);
    expectHeaders(await get(), 'cache', 1);
    origin.respond = async () => new Response('cf', { status: 530 });
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(3)));
    clock.t = T0 + 41 * S;
    expectHeaders(await get(), 'r2', 3);
    bucket.objects.set(`${PREFIX}site/red-button.json`, JSON.stringify(snapshot(8, { outage: 'technical' })));
    clock.t = T0 + 52 * S;
    expectHeaders(await get(), 'red-button', 8);
  });
});

describe('security-review fixes (S8-01 … S8-06)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const neverAnswers: Respond = () => new Promise<Response>(() => undefined);

  it('S8-01: an origin that never answers, empty cache → the R2 copy within 1.5 s, the call aborted', async () => {
    const { get, origin, bucket } = setup();
    let signal: AbortSignal | null | undefined;
    origin.respond = (input, init) => {
      signal = init.signal;
      return neverAnswers(input, init);
    };
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(6)));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = get();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(PUBLIC_ORIGIN_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expectHeaders(await pending, 'r2', 6);
    expect(signal?.aborted).toBe(true);
  });

  it('S8-01: an origin that never answers, nothing anywhere → the existing 503 after the budget', async () => {
    const { get, origin } = setup();
    origin.respond = neverAnswers;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = get();
    await vi.advanceTimersByTimeAsync(PUBLIC_ORIGIN_BUDGET_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE_BODY);
  });

  it('S8-01: a hanging background refresh → stale copy at once, and the refresh ends within the budget', async () => {
    const { get, clock, origin, flush } = setup();
    await get();
    origin.respond = neverAnswers;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock.t = T0 + 20 * S;
    expectHeaders(await get(), 'cache', 1);
    const done = flush();
    await vi.advanceTimersByTimeAsync(PUBLIC_ORIGIN_BUDGET_MS);
    await done; // settled as an origin failure instead of hanging
  });

  it('S8-02: 100 concurrent misses → 1 origin call, every waiter gets the same answer', async () => {
    const { get, calls, origin, cache } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    origin.respond = async () => {
      await gate;
      return json(snapshot(4));
    };
    const all = Promise.all(Array.from({ length: 100 }, () => get()));
    await new Promise((r) => setTimeout(r, 0));
    release();
    const answers = await all;
    expect(calls).toHaveLength(1);
    expect(cache.puts).toBe(1);
    for (const res of answers) {
      expectHeaders(res, 'origin', 4);
      expect(await versionOf(res)).toBe(4);
    }
  });

  it('S8-02: a failed shared call is not kept: the next miss asks the origin again', async () => {
    const { get, calls, origin } = setup({}, { noCache: true });
    origin.respond = async () => new Response('cf', { status: 530 });
    await Promise.all([get(), get(), get()]);
    expect(calls).toHaveLength(1);
    origin.respond = async () => json(snapshot(2));
    expectHeaders(await get(), 'origin', 2);
    expect(calls).toHaveLength(2);
  });

  it('S8-03: 1 000 requests while the origin is down → at most one R2 read per 10 s', async () => {
    const { get, bucket, clock, origin } = setup({}, { noCache: true });
    origin.respond = async () => new Response('cf', { status: 530 });
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(5)));
    for (let i = 0; i < 1000; i += 1) {
      clock.t = T0 + i * 20; // 1 000 requests over 20 s → two 10 s windows
      expectHeaders(await get(), 'r2', 5);
    }
    expect(bucket.readsOf('site/latest.json')).toBe(2);
  });

  it('S8-03: the memo keeps "absent" too; a copy added later is seen after 10 s', async () => {
    const { get, bucket, clock, origin } = setup({}, { noCache: true });
    origin.respond = async () => new Response('cf', { status: 530 });
    expect((await get()).status).toBe(503);
    bucket.objects.set(`${PREFIX}site/latest.json`, JSON.stringify(snapshot(5)));
    clock.t = T0 + R2_COPY_MEMO_MS - 1;
    expect((await get()).status).toBe(503);
    clock.t = T0 + R2_COPY_MEMO_MS;
    expectHeaders(await get(), 'r2', 5);
    expect(bucket.readsOf('site/latest.json')).toBe(2);
  });

  it('S8-04: only allow-listed client headers reach the origin', async () => {
    const { get, calls } = setup();
    await get(SITE, {
      headers: {
        accept: 'application/json',
        'user-agent': 'probe/1',
        'cf-connecting-ip': '203.0.113.9',
        'if-none-match': '"abc"',
        range: 'bytes=0-10',
        'accept-language': 'uk',
        'x-t2f-access-identity': 'forged',
        cookie: 'a=b',
        authorization: 'Bearer x',
        'x-probe': '1',
      },
    });
    expect(calls).toHaveLength(1);
    const h = calls[0]!.headers;
    for (const name of [
      'if-none-match',
      'range',
      'accept-language',
      'x-t2f-access-identity',
      'cookie',
      'authorization',
      'x-probe',
    ]) {
      expect(h.get(name), name).toBeNull();
    }
    expect(h.get('accept')).toBe('application/json');
    expect(h.get('user-agent')).toBe('probe/1');
    expect(h.get('x-t2f-client')).toBe('203.0.113.9;UA');
    expect(h.get('x-t2f-edge')).toBe(SECRET);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without the trailing slash', 'test'],
    ['a bare slash', '/'],
    ['uppercase', 'Test/'],
    ['nested', 'a/b/'],
  ])('S8-06: R2_PREFIX %s → the bucket is never read (red button, R2 copy)', async (_n, prefix) => {
    const { get, bucket, origin } = setup({ R2_PREFIX: prefix });
    origin.respond = async () => new Response('cf', { status: 530 });
    bucket.objects.set('site/latest.json', JSON.stringify(snapshot(5)));
    bucket.objects.set('site/red-button.json', JSON.stringify(snapshot(9, { outage: 'technical' })));
    expect((await get()).status).toBe(503);
    expect(bucket.gets).toEqual([]);
  });
});

// SPEC-12 WE2 (AC-12, AC-13): a route row equal to the planned `live-chains` row (it lands in PUBLIC_ROUTES with W23).
describe('live-like route: cache tag, no red button, 10-minute stale window (SPEC-12 AC-12, AC-13)', () => {
  const LIVE_ROUTE: PublicRoute = {
    key: 'live-chains',
    path: '/api/live/chains',
    allowedParams: [],
    freshMs: 10_000,
    staleMs: 600_000,
    r2Copy: LIVE_R2_KEYS.chains,
    cacheTag: LIVE_CACHE_TAG,
  };
  const LIVE = `${HOST}${LIVE_ROUTE.path}`;

  it('the local row equals the live-chains row of PUBLIC_ROUTES (SPEC-12 W23)', () => {
    expect(PUBLIC_ROUTES.find((r) => r.key === 'live-chains')).toEqual(LIVE_ROUTE);
  });
  const chains = (version: number) => ({ version, at: '2026-12-31T00:00:00.000Z', chains: [] });

  function live(over: Partial<EdgeEnv> = {}) {
    const t = setup(over);
    t.origin.respond = async () => json(chains(1));
    const getLive = (url = LIVE) => servePublic(new Request(url), LIVE_ROUTE, t.env, t.deps);
    return { ...t, getLive };
  }

  it('pins the planned row values', () => {
    expect(LIVE_CACHE_TAG).toBe('t2f-live-chains');
    expect(LIVE_R2_KEYS.chains).toBe('live/chains.json');
  });

  it('100 requests in 10 s → 1 origin call, then the cache (AC-12)', async () => {
    const { getLive, calls, clock } = live();
    const sources: (string | null)[] = [];
    for (let i = 0; i < 100; i += 1) {
      clock.t = T0 + i * 100;
      sources.push((await getLive()).headers.get(SOURCE_HEADER));
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${ORIGIN}/api/live/chains`);
    expect(sources[0]).toBe('origin');
    expect(sources.slice(1).every((s) => s === 'cache')).toBe(true);
  });

  it('at 11 s the stale copy is served, then the new one after one background refresh (AC-12)', async () => {
    const { getLive, calls, clock, origin, flush } = live();
    await getLive();
    origin.respond = async () => json(chains(2));
    clock.t = T0 + 11 * S;
    const stale = await getLive();
    expectHeaders(stale, 'cache', 1);
    expect(await versionOf(stale)).toBe(1);
    await flush();
    expect(calls).toHaveLength(2);
    const next = await getLive();
    expectHeaders(next, 'cache', 2);
    expect(await versionOf(next)).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('origin 530: 9:59 past freshness the cache copy, 10:01 past it the R2 copy with x-t2f-source: r2 (AC-13)', async () => {
    const { getLive, clock, origin, bucket, cache, flush } = live();
    await getLive();
    origin.respond = async () => new Response('tunnel error', { status: 530 });
    bucket.objects.set(`${PREFIX}${LIVE_R2_KEYS.chains}`, JSON.stringify(chains(7)));
    // The runtime cache keeps the copy for s-maxage only; age the entry by hand to test the route's own window.
    const stored = cache.entries.get(LIVE);
    if (stored) stored.headers = stored.headers.map(([k, v]) => [k, k === 'cache-control' ? 'public, s-maxage=3600' : v]);
    // AC-13 counts the 10 minutes from the moment freshness ended (copy age freshMs + 10 min).
    clock.t = T0 + LIVE_ROUTE.freshMs + (9 * 60 + 59) * S;
    const at959 = await getLive();
    expectHeaders(at959, 'cache', 1);
    await flush();
    clock.t = T0 + LIVE_ROUTE.freshMs + (10 * 60 + 1) * S;
    const at1001 = await getLive();
    expectHeaders(at1001, 'r2', 7);
    expect(await at1001.json()).toEqual(chains(7));
  });

  it('origin 530, no cache copy and no R2 copy → the existing 503 (AC-13)', async () => {
    const { getLive, origin } = live();
    origin.respond = async () => new Response('tunnel error', { status: 530 });
    const res = await getLive();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE_BODY);
  });

  it('a row without a red button never reads one, even when a site button is present', async () => {
    const { getLive, bucket } = live();
    bucket.objects.set(`${PREFIX}${SITE_R2_KEYS.redButton}`, JSON.stringify(snapshot(9, { outage: 'technical' })));
    const res = await getLive();
    expectHeaders(res, 'origin', 1);
    expect(bucket.gets).toEqual([]);
  });

  it('stores the copy under the row cache tag, never the site tag', async () => {
    const { getLive, cache } = live();
    await getLive();
    const h = new Headers(cache.entries.get(LIVE)?.headers);
    expect(h.get('cache-tag')).toBe(LIVE_CACHE_TAG);
    expect(h.get('cache-tag')).not.toBe(SITE_CACHE_TAG);
  });

  it('a site-state body from the origin is refused by the chains guard → R2 copy', async () => {
    const { getLive, origin, bucket } = live();
    origin.respond = async () => json(snapshot(3));
    bucket.objects.set(`${PREFIX}${LIVE_R2_KEYS.chains}`, JSON.stringify(chains(4)));
    expectHeaders(await getLive(), 'r2', 4);
  });
});
