// Public cacheable addresses at the edge (SPEC-08 AC-24 … AC-31, AC-38, NFR-2). The only file that names the
// runtime cache. Source order: red button → cache copy ≤ fresh → origin (stored) → cache copy ≤ fresh + stale
// → R2 copy → the existing 503. A copy older than `freshMs` is served and refreshed in the background once.
// No `fetch` cache options are used; the cache key and the origin request carry the path and allowed params only.
import type { PublicRoute } from '../../../packages/contracts/src/publicRoutes';
import { parseSiteState, type SiteStateLike } from '../../../packages/contracts/src/siteGuard';
import { SITE_CACHE_TAG } from '../../../packages/contracts/src/site';
import type { EdgeCache, EdgeDeps, EdgeEnv } from './env';
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

export type PublicSource = 'red-button' | 'origin' | 'cache' | 'r2';

const JSON_TYPE = 'application/json; charset=utf-8';
/** Browser freshness of every public answer (contract `GET /api/site/state`). */
const CLIENT_CACHE_CONTROL = 'public, max-age=10';

/** The runtime's default cache (`caches.default`); called only by the Worker entry. */
export function defaultCache(): EdgeCache {
  return (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
}

/** Route keys whose background refresh is in flight in this isolate (one at a time per route). */
const refreshing = new Set<string>();

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

  // 1. Red button wins over everything (AC-38).
  const button = await redButtonState(env, route.redButton, deps);
  if (button) return answer(JSON.stringify(button), String(button.version), 'red-button');

  // 2. Cache copy.
  const copy = deps.cache ? await readCopy(deps.cache, key, deps.now()) : null;
  if (copy && copy.age <= route.freshMs) return answer(copy.body, copy.version, 'cache');
  if (copy && copy.age <= route.freshMs + route.staleMs) {
    if (origin && !refreshing.has(route.key)) {
      refreshing.add(route.key);
      const work = fetchOrigin(req, key, origin, deps)
        .then((fresh) => (fresh ? store(deps, key, fresh) : undefined))
        .catch(() => undefined)
        .finally(() => refreshing.delete(route.key));
      if (deps.waitUntil) deps.waitUntil(work);
    }
    return answer(copy.body, copy.version, 'cache');
  }

  // 3. Origin (stored on success).
  const fresh = origin ? await fetchOrigin(req, key, origin, deps) : null;
  if (fresh) {
    const body = JSON.stringify(fresh);
    await store(deps, key, fresh).catch(() => undefined);
    return answer(body, String(fresh.version), 'origin');
  }

  // 4. R2 copy, then the existing 503 (AC-28, AC-29). A copy past fresh + stale was already refused above.
  const r2 = await readR2(env, route.r2Copy);
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

/** The origin's snapshot, or null on any failure: network, non-2xx, non-JSON, or a body the guard refuses. */
async function fetchOrigin(req: Request, key: Request, origin: NonNullable<Origin>, deps: EdgeDeps): Promise<SiteStateLike | null> {
  // Query dropped (key URL); cookies and credentials never reach the origin for a shared answer.
  const headers = new Headers(req.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  const forward = new Request(key.url, { method: 'GET', headers });
  try {
    const res = await proxy(forward, origin.url, origin.secret, deps);
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return parseSiteState(await res.json());
  } catch {
    return null;
  }
}

/** Stores a good origin snapshot: kept 40 s by the cache, tagged for purge, never with `Set-Cookie`. */
function store(deps: EdgeDeps, key: Request, state: SiteStateLike): Promise<void> {
  if (!deps.cache) return Promise.resolve();
  const res = new Response(JSON.stringify(state), {
    status: 200,
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': 'public, s-maxage=40',
      'cache-tag': SITE_CACHE_TAG,
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

/** The R2 copy `<R2_PREFIX><key>` if present and accepted by the guard; any read error → null. */
async function readR2(env: EdgeEnv, key: string): Promise<SiteStateLike | null> {
  if (!env.SITE_BUCKET) return null;
  try {
    const obj = await env.SITE_BUCKET.get(`${env.R2_PREFIX ?? ''}${key}`);
    if (!obj) return null;
    return parseSiteState(JSON.parse(await obj.text()));
  } catch {
    return null;
  }
}
