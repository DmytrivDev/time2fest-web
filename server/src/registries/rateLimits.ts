/**
 * Rate-limit registry (AC-48, AC-62): sorted, unique rows; a route names its row by `key`
 * (`RouteRow.rateLimit`). Empty in SPEC-02; domain waves add their rows.
 */
import type { RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';

export const rateLimitRegistry: readonly RateLimitRow[] = [
  // The public build-time read of the catalog (AC-63): 30 a minute, counted in this process if Redis is down.
  { key: 'catalog-read', limit: 30, windowMs: 60_000, keys: ['device'], onStoreDown: 'memory' },
];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
