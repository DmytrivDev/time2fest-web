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
  /** R2 red-button key. */
  redButton: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    key: 'site-state',
    path: '/api/site/state',
    allowedParams: [],
    freshMs: 10_000,
    staleMs: 30_000,
    r2Copy: 'site/latest.json',
    redButton: 'site/red-button.json',
  },
];
