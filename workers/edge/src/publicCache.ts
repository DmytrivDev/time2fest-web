// Public cacheable addresses at the edge (SPEC-08 AC-24 … AC-31, AC-38, NFR-2). The only file that names the
// runtime cache. Source order: red button → cache copy ≤ fresh → origin (stored) → cache copy ≤ fresh + stale
// → R2 copy → the existing 503. A copy older than `freshMs` is served and refreshed in the background once.
// No `fetch` cache options are used; the cache key and the origin request carry the path and allowed params only.
import type { PublicRoute } from '../../../packages/contracts/src/publicRoutes';
import { parseChainsResponse } from '../../../packages/contracts/src/liveGuard';
import { parseSiteState } from '../../../packages/contracts/src/siteGuard';
import { SITE_CACHE_TAG } from '../../../packages/contracts/src/site';
import { siteBucketOf, type EdgeCache, type EdgeDeps, type EdgeEnv } from './env';
import { proxy } from './proxy';
import { redButtonState } from './redButton';
import { unavailable } from './responses';

/** Same values as `SITE_SOURCE_HEADER` / `SITE_VERSION_HEADER` in `packages/contracts/src/site.ts` (a test pins them). */
export const SOURCE_HEADER = 'x-t2f-source';
export const VERSION_HEADER = 'x-t2f-site-version';
/** Stored with each cache copy: the edge clock at the moment it was stored (ms). Never sent to clients. */
export const CACHED_AT_HEADER = 'x-t2f-cached-at';
/** Purge tag of the site snapshot (conductor decision А-2), one copy in `packages/contracts/src/site.ts`. Never sent to clients. */
export { SITE_CACHE_TAG };

/** A public body the edge accepts: whatever the route's guard returned (every public body carries `version`). */
type PublicBody = { version: number };
type BodyGuard = (x: unknown) => PublicBody | null;
/** The body guard of each public address by route key (import-free guards); any other key → the site guard. */
const BODY_GUARDS: Readonly<Record<string, BodyGuard>> = { 'live-chains': parseChainsResponse };
const guardOf = (route: PublicRoute): BodyGuard => BODY_GUARDS[route.key] ?? parseSiteState;

export type PublicSource = 'red-button' | 'origin' | 'cache' | 'r2';

const JSON_TYPE = 'application/json; charset=utf-8';
/** Browser freshness of every public answer (contract `GET /api/site/state`). */
const CLIENT_CACHE_CONTROL = 'public, max-age=10';

/** The runtime's default cache (`caches.default`); called only by the Worker entry. */
export function defaultCache(): EdgeCache {
  return (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
}

/** Budget of one public-path origin call; past it the call is aborted and counts as an origin failure. */
export const PUBLIC_ORIGIN_BUDGET_MS = 1500;
/** One R2 fallback read per key per isolate per this window (the memo keeps "absent" too). */
export const R2_COPY_MEMO_MS = 10_000;
/** The only client headers a shared public answer's origin request carries; `proxy()` adds its own on top. */
const FORWARDED_HEADERS = ['accept', 'user-agent', 'cf-connecting-ip'] as const;

/** Route keys whose background refresh is in flight in this isolate (one at a time per route). */
const refreshing = new Set<string>();
/** Cache-miss origin calls in flight in this isolate, one per cache key: every waiter gets the same answer. */
const inflight = new Map<string, Promise<PublicBody | null>>();
/** R2 fallback reads per bucket key: started at `at` (edge clock), shared by every request in the window. */
const r2Memo = new Map<string, { at: number; state: Promise<PublicBody | null> }>();

/** Forgets the isolate state of this module (tests only: every test is a "fresh isolate"). */
export function resetPublicCacheMemo(): void {
  r2Memo.clear();
  inflight.clear();
  refreshing.clear();
}

type Origin = { secret: string; url: string } | null;
type Copy = { body: string; version: string; age: number };

/**
 * Serves a `GET` to a public address. `secret` absent → the origin counts as failed for this path only
 * (red button, cache and R2 still answer). The returned response never carries `Set-Cookie`.
 */
export async function servePublic(
  req: Request,
  route: PublicRoute,
  env: EdgeEnv,
  deps: EdgeDeps,
): Promise<Response> {
  const url = new URL(req.url);
  const kept = new URLSearchParams();
  for (const [k, v] of [...url.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (route.allowedParams.includes(k)) kept.append(k, v);
  }
  const query = kept.toString();
  const search = query ? `?${query}` : '';
  const key = new Request(url.origin + url.pathname + search, { method: 'GET' });
  const origin: Origin =
    env.ORIGIN_URL && env.T2F_EDGE_SECRET ? { url: env.ORIGIN_URL, secret: env.T2F_EDGE_SECRET } : null;

  // 1. Red button wins over everything (AC-38) — only on an address that names one.
  const button = route.redButton ? await redButtonState(env, route.redButton, deps) : null;
  if (button) return answer(JSON.stringify(button), String(button.version), 'red-button');

  // 2. Cache copy.
  const copy = deps.cache ? await readCopy(deps.cache, key, deps.now()) : null;
  if (copy && copy.age <= route.freshMs) return answer(copy.body, copy.version, 'cache');
  if (copy && copy.age <= route.freshMs + route.staleMs) {
    if (origin && !refreshing.has(route.key)) {
      refreshing.add(route.key);
      const work = fetchOrigin(req, key, route, origin, deps)
        .then((fresh) => (fresh ? store(deps, key, route, fresh) : undefined))
        .catch(() => undefined)
        .finally(() => refreshing.delete(route.key));
      if (deps.waitUntil) deps.waitUntil(work);
    }
    return answer(copy.body, copy.version, 'cache');
  }

  // 3. Origin (stored on success); concurrent misses share one origin call.
  const fresh = origin ? await originOnce(req, key, route, origin, deps) : null;
  if (fresh) return answer(JSON.stringify(fresh), String(fresh.version), 'origin');

  // 4. R2 copy, then the existing 503 (AC-28, AC-29). A copy past fresh + stale was already refused above.
  const r2 = await readR2(env, route, deps.now());
  if (r2) return answer(JSON.stringify(r2), String(r2.version), 'r2');
  return unavailable();
}

/** A public answer built from scratch: no origin header (and so no `Set-Cookie`) reaches the client. */
function answer(body: string, version: string, source: PublicSource): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': CLIENT_CACHE_CONTROL,
      [SOURCE_HEADER]: source,
      [VERSION_HEADER]: version,
    },
  });
}

/** One origin call (and store) per cache key in flight; later misses for the same key wait on it. */
function originOnce(
  req: Request,
  key: Request,
  route: PublicRoute,
  origin: NonNullable<Origin>,
  deps: EdgeDeps,
): Promise<PublicBody | null> {
  const running = inflight.get(key.url);
  if (running) return running;
  const work = fetchOrigin(req, key, route, origin, deps)
    .then(async (fresh) => {
      if (fresh) await store(deps, key, route, fresh).catch(() => undefined);
      return fresh;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key.url));
  inflight.set(key.url, work);
  return work;
}

/**
 * The origin's snapshot, or null on any failure: network, non-2xx, non-JSON, a body the guard refuses, or no
 * complete answer within `PUBLIC_ORIGIN_BUDGET_MS` (the call is then aborted).
 */
async function fetchOrigin(
  req: Request,
  key: Request,
  route: PublicRoute,
  origin: NonNullable<Origin>,
  deps: EdgeDeps,
): Promise<PublicBody | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, PUBLIC_ORIGIN_BUDGET_MS);
  });
  try {
    return await Promise.race([askOrigin(req, key, guardOf(route), origin, deps, ctrl.signal), expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function askOrigin(
  req: Request,
  key: Request,
  guard: BodyGuard,
  origin: NonNullable<Origin>,
  deps: EdgeDeps,
  signal: AbortSignal,
): Promise<PublicBody | null> {
  // Query dropped (key URL); only allow-listed client headers are forwarded (no cookie, credential,
  // conditional, range or identity header reaches the origin for a shared answer).
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const forward = new Request(key.url, { method: 'GET', headers });
  try {
    const res = await proxy(forward, origin.url, origin.secret, deps, signal);
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return guard(await res.json());
  } catch {
    return null;
  }
}

/** Stores a good origin body: kept 40 s by the cache, tagged with the route's purge tag, never with `Set-Cookie`. */
function store(deps: EdgeDeps, key: Request, route: PublicRoute, state: PublicBody): Promise<void> {
  if (!deps.cache) return Promise.resolve();
  const res = new Response(JSON.stringify(state), {
    status: 200,
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': 'public, s-maxage=40',
      'cache-tag': route.cacheTag,
      [CACHED_AT_HEADER]: String(Math.trunc(deps.now())),
      [VERSION_HEADER]: String(state.version),
    },
  });
  return deps.cache.put(key, res);
}

/** The stored copy with its age, or null when absent or unreadable. A copy "from the future" has age 0. */
async function readCopy(cache: EdgeCache, key: Request, now: number): Promise<Copy | null> {
  let res: Response | undefined;
  try {
    res = await cache.match(key);
  } catch {
    return null;
  }
  if (!res) return null;
  const at = Number(res.headers.get(CACHED_AT_HEADER));
  const version = res.headers.get(VERSION_HEADER);
  if (!Number.isFinite(at) || version === null || res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  return { body: await res.text(), version, age: Math.max(0, now - at) };
}

/**
 * The R2 copy `<R2_PREFIX><key>` if present and accepted by the guard; any read error → null. Read at most once
 * per key per `R2_COPY_MEMO_MS` in this isolate; no bucket or a bad prefix → never read (fail closed).
 */
function readR2(env: EdgeEnv, route: PublicRoute, now: number): Promise<PublicBody | null> {
  const site = siteBucketOf(env);
  if (!site) return Promise.resolve(null);
  const full = `${site.prefix}${route.r2Copy}`;
  const memo = r2Memo.get(full);
  if (memo && now >= memo.at && now - memo.at < R2_COPY_MEMO_MS) return memo.state;
  const state = readR2Object(site.bucket, full, guardOf(route));
  r2Memo.set(full, { at: now, state });
  return state;
}

async function readR2Object(
  bucket: NonNullable<EdgeEnv['SITE_BUCKET']>,
  key: string,
  guard: BodyGuard,
): Promise<PublicBody | null> {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return guard(JSON.parse(await obj.text()));
  } catch {
    return null;
  }
}
