/** Public cacheable addresses served through the edge cache (SPEC-08). No imports: the Worker imports this file by relative path. */
export interface PublicRoute {
  key: string;
  path: string;
  allowedParams: readonly string[];
  /** Fresh window, ms. */
  freshMs: number;
  /** Stale window after the fresh one, ms. */
  staleMs: number;
  /** R2 copy key (relative to the environment prefix). */
  r2Copy: string;
  /** Cache-Tag the edge stores this answer under; the server purges by it. Never sent to clients. */
  cacheTag: string;
  /** R2 red-button key; absent → the edge never reads a red button for this address. */
  redButton?: string;
  /**
   * Oldest R2 copy the edge serves, ms, judged by the body's `at` against the edge clock; an older copy (or one
   * without a readable `at`) is refused and the address answers 503. Absent → the R2 copy is served at any age.
   */
  r2MaxAgeMs?: number;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    key: 'site-state',
    path: '/api/site/state',
    allowedParams: [],
    freshMs: 10_000,
    staleMs: 30_000,
    r2Copy: 'site/latest.json',
    cacheTag: 't2f-site-state',
    redButton: 'site/red-button.json',
  },
  {
    key: 'live-chains',
    path: '/api/live/chains',
    allowedParams: [],
    freshMs: 10_000,
    staleMs: 600_000,
    r2Copy: 'live/chains.json',
    cacheTag: 't2f-live-chains',
    // YouTube data must not be served from an old fallback copy (YouTube API Services policy, security S12-02).
    r2MaxAgeMs: 86_400_000,
  },
];
