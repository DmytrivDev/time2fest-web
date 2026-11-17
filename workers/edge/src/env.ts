// Bindings, vars and secrets of the edge Worker (wrangler.json; secret via `wrangler secret put`).
export type EdgeEnvName = 'test' | 'rehearsal' | 'prelaunch' | 'production';

export interface EdgeEnv {
  EDGE_ENV: EdgeEnvName;
  /** Origin base URL; absent in `prelaunch` (no origin at all). */
  ORIGIN_URL?: string;
  /** Shared secret sent to the origin as `x-t2f-edge`; never logged. */
  T2F_EDGE_SECRET?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

/** Runtime capabilities injected by `index.ts`, so the handler stays testable in Node. */
export interface EdgeDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** `request.cf` subset; undefined outside Cloudflare. */
  cf?: { country?: string } | undefined;
}
