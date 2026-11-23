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
  // The public live chains (SPEC-12 AC-3): mostly answered by the edge cache; 600 a minute per client, counted in
  // this process if Redis is down (a public read never fails closed on the fast store).
  { key: 'live-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Player source-error reports (SPEC-12 NFR-4): 10 a minute per client (SPEC-05 daily fingerprint), 429 beyond;
  // counted in this process if Redis is down.
  { key: 'live-source-errors', limit: 10, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Realtime connection tokens (SPEC-06 AC-16): 30 a minute per client, counted in this process if Redis is down.
  { key: 'realtime-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The public site snapshot (SPEC-08 AC-3, AC-37): mostly answered by the edge cache, so the origin sees few
  // reads; 600 a minute per client keeps a reload storm or a reader test far below the limit. Counted in this
  // process if Redis is down (a public read never fails closed on the fast store).
  { key: 'site-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Toast text check (SPEC-09 AC-39, C12): 20 a minute per client, before any AI call; counted in this process if Redis is down.
  { key: 'toasts-check', limit: 20, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
