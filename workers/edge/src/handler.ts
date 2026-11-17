// Routing of the edge Worker. Order matters: static first, then the single 404s,
// the edge clock, the prelaunch 404, the fail-closed secret check, and only then the proxy.
import type { EdgeDeps, EdgeEnv } from './env';
import { proxy } from './proxy';
import { notFound, timeNow, unavailable } from './responses';

export async function handle(req: Request, env: EdgeEnv, deps: EdgeDeps): Promise<Response> {
  const { pathname } = new URL(req.url);

  // 1. Static (and the admin / cms paths): never the origin. A miss is ASSETS' own 404.
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

  // 2. `/api` itself and WebSocket upgrades under `/api/` are not served here.
  if (pathname === '/api' || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return notFound();
  }

  // 3. The edge clock everywhere except `test`, whose server clock is the only source of time.
  if (env.EDGE_ENV !== 'test' && req.method === 'GET' && pathname === '/api/time') {
    return timeNow(deps.now());
  }

  // 4. No origin (prelaunch).
  if (!env.ORIGIN_URL) return notFound();

  // 5. Fail closed: never forward without the edge secret.
  if (!env.T2F_EDGE_SECRET) return unavailable();

  return proxy(req, env.ORIGIN_URL, env.T2F_EDGE_SECRET, deps);
}
