/**
 * Idempotency registry (AC-55, AC-62): one row per idempotent method with its retention
 * class, sorted by `method`; a route names its row by `RouteRow.idempotency`. Empty in
 * SPEC-02; domain waves add their rows.
 */
import type { IdempotencyRow } from '../platform/idempotency';
import { assertRegistry } from '../platform/registry';

export const idempotencyRegistry: readonly IdempotencyRow[] = [];

assertRegistry('idempotency', idempotencyRegistry, (r) => r.method);
