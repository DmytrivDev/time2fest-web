/**
 * Rate-limit registry (AC-48, AC-62): sorted, unique rows; a route names its row by `key`
 * (`RouteRow.rateLimit`). Empty in SPEC-02; domain waves add their rows.
 */
import type { RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';

export const rateLimitRegistry: readonly RateLimitRow[] = [];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
