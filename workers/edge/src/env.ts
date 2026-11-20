// Bindings, vars and secrets of the edge Worker (wrangler.json; secret via `wrangler secret put`).
export type EdgeEnvName = 'test' | 'rehearsal' | 'prelaunch' | 'production';

export interface EdgeEnv {
  EDGE_ENV: EdgeEnvName;
  /** Origin base URL; absent in `prelaunch` (no origin at all). */
  ORIGIN_URL?: string;
  /** Shared secret sent to the origin as `x-t2f-edge`; never logged. */
  T2F_EDGE_SECRET?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** R2 bucket of the environment (SPEC-08): site copy and red button. Absent → neither is read. */
  SITE_BUCKET?: SiteBucket;
  /** Environment prefix of the bucket keys (same as the server's `T2F_R2_PREFIX`), e.g. `test/`. */
  R2_PREFIX?: string;
}

/** The subset of an R2 binding the edge uses. */
export interface SiteBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

/** The subset of the Workers Cache API the edge uses (the default cache in the runtime, see `publicCache.ts`). */
export interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}

/** Runtime capabilities injected by `index.ts`, so the handler stays testable in Node. */
export interface EdgeDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** `request.cf` subset; undefined outside Cloudflare. */
  cf?: { country?: string } | undefined;
  /** Cache of public addresses (SPEC-08); absent → public addresses are served without a cache. */
  cache?: EdgeCache;
  /** Keeps background work alive after the response (`ctx.waitUntil`); absent → fire and forget. */
  waitUntil?: (work: Promise<unknown>) => void;
}
