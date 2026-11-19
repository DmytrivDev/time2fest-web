/**
 * Rate-limit registry (AC-48, AC-62): sorted, unique rows; a route names its row by `key`
 * (`RouteRow.rateLimit`). Empty in SPEC-02; domain waves add their rows.
 */
import type { RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';

export const rateLimitRegistry: readonly RateLimitRow[] = [
  // The public build-time read of the catalog (AC-63): 30 a minute per client (SPEC-05 daily fingerprint),
  // counted in this process if Redis is down.
  { key: 'catalog-read', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Realtime connection tokens (SPEC-06 AC-16): 30 a minute per client, counted in this process if Redis is down.
  { key: 'realtime-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Toast text check (SPEC-09 AC-39, C12): 20 a minute per client, before any AI call; counted in this process if Redis is down.
  { key: 'toasts-check', limit: 20, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
