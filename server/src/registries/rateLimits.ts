/**
 * Rate-limit registry (AC-48, AC-62): sorted, unique rows; a route names its row by `key`
 * (`RouteRow.rateLimit`). Empty in SPEC-02; domain waves add their rows.
 */
import type { RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';

export const rateLimitRegistry: readonly RateLimitRow[] = [
  // Sign-in codes (SPEC-10 AC-9, [А4], [П-8]): 5 codes per 10 min per email hash / per client (ipDay) / per IPv6 /48.
  // Keyed rows (`checkKeyedLimit` / `peekKeyedLimit` in `auth/codeLimits.ts`, no route names them): `keys: []`
  // because the caller passes the key value. Refused if Redis is down (NFR-4).
  { key: 'auth-code-email', limit: 5, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  { key: 'auth-code-ip', limit: 5, windowMs: 600_000, keys: ['ipDay'], onStoreDown: 'fail-closed' },
  { key: 'auth-code-ip48', limit: 5, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  // Guests created on the first write (SPEC-10 AC-4, [Q2], [П-6]): 60 per 10 min per client; refused if Redis is down.
  { key: 'auth-guest-create', limit: 60, windowMs: 600_000, keys: ['ipDay'], onStoreDown: 'fail-closed' },
  // The public build-time read of the catalog (AC-63): 30 a minute per client (SPEC-05 daily fingerprint),
  // counted in this process if Redis is down.
  { key: 'catalog-read', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The public live chains (SPEC-12 AC-3): mostly answered by the edge cache; 600 a minute per client, counted in
  // this process if Redis is down (a public read never fails closed on the fast store).
  { key: 'live-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Player source-error reports (SPEC-12 NFR-4): 10 a minute per client (SPEC-05 daily fingerprint), 429 beyond;
  // counted in this process if Redis is down.
  { key: 'live-source-errors', limit: 10, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Viewer subscription tokens (SPEC-12 [П-2]): 30 a minute per client, as the connection tokens; counted in this
  // process if Redis is down.
  { key: 'live-viewer-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Realtime connection tokens (SPEC-06 AC-16): 30 a minute per client, counted in this process if Redis is down.
  { key: 'realtime-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The public site snapshot (SPEC-08 AC-3, AC-37): mostly answered by the edge cache, so the origin sees few
  // reads; 600 a minute per client keeps a reload storm or a reader test far below the limit. Counted in this
  // process if Redis is down (a public read never fails closed on the fast store).
  { key: 'site-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The stream agent's proposals (SPEC-21a AC-37, [А13]): 30 a minute per agent record; refused if Redis is down
  // (a write never counts in one process only). The daily cap lives in `LIVE_DEFAULTS.agent`.
  { key: 'stream-agent-propose', limit: 30, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' },
  // The stream agent's reads (SPEC-21a AC-37): 60 a minute per agent record, counted in this process if Redis is down.
  { key: 'stream-agent-read', limit: 60, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // Toast text check (SPEC-09 AC-39, C12): 20 a minute per client, before any AI call; counted in this process if Redis is down.
  { key: 'toasts-check', limit: 20, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
