// Routing of the edge Worker. Order matters: static first, then the single 404s,
// the edge clock, the prelaunch 404, the public cacheable addresses, the fail-closed secret check,
// and only then the proxy.
import { PUBLIC_ROUTES } from '../../../packages/contracts/src/publicRoutes';
import type { EdgeDeps, EdgeEnv } from './env';
import { proxy } from './proxy';
import { servePublic } from './publicCache';
import { notFound, timeNow, unavailable } from './responses';

/** Budget of the rehearsal origin clock before the edge answers with its own (SPEC-07 AC-16). */
export const ORIGIN_TIME_BUDGET_MS = 1000;

export async function handle(req: Request, env: EdgeEnv, deps: EdgeDeps): Promise<Response> {
  const { pathname } = new URL(req.url);

  // 1. Static (and the admin / cms paths): never the origin. A miss is ASSETS' own 404.
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

  // 2. `/api` itself and WebSocket upgrades under `/api/` are not served here.
  if (pathname === '/api' || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return notFound();
  }

  // 3. Time: `production` / `prelaunch` answer from the edge clock only (AC-17); `rehearsal` asks the
  //    origin's (virtual) clock and falls back to the edge's (AC-15, AC-16); `test` forwards as any path.
  if (req.method === 'GET' && pathname === '/api/time') {
    if (env.EDGE_ENV === 'rehearsal') return rehearsalTime(req, env, deps);
    if (env.EDGE_ENV !== 'test') return timeNow(deps.now());
  }

  // 4. No origin (prelaunch).
  if (!env.ORIGIN_URL) return notFound();

  // 5. Public cacheable addresses (SPEC-08, one list with the server): red button / cache / origin / R2.
  //    Without the secret the origin counts as failed for this path only; nothing is forwarded.
  const route = req.method === 'GET' ? PUBLIC_ROUTES.find((r) => r.path === pathname) : undefined;
  if (route) return servePublic(req, route, env, deps);

  // 6. Fail closed: never forward without the edge secret.
  if (!env.T2F_EDGE_SECRET) return unavailable();

  return proxy(req, env.ORIGIN_URL, env.T2F_EDGE_SECRET, deps);
}

/** Origin `now` within the budget, else the edge's own; never an error response. */
async function rehearsalTime(req: Request, env: EdgeEnv, deps: EdgeDeps): Promise<Response> {
  const { ORIGIN_URL: origin, T2F_EDGE_SECRET: secret } = env;
  if (!origin || !secret) return timeNow(deps.now());

  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, ORIGIN_TIME_BUDGET_MS);
  });
  try {
    const now = await Promise.race([originNow(req, origin, secret, deps, ctrl.signal), expired]);
    return timeNow(now ?? deps.now());
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The origin's `now` if it answered 2xx with a JSON body `{ now }`, `now` an integer >= 0; else null. */
async function originNow(
  req: Request,
  origin: string,
  secret: string,
  deps: EdgeDeps,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const res = await proxy(req, origin, secret, deps, signal);
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || !('now' in body)) return null;
    const { now } = body as { now: unknown };
    return typeof now === 'number' && Number.isSafeInteger(now) && now >= 0 ? now : null;
  } catch {
    return null;
  }
}
