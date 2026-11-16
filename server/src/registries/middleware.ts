/**
 * Middleware registry (AC-62): run in key order before every handler.
 * `30-rate-limit` and `40-idempotency` are pass-through until SPEC-02 P5 fills them.
 */
import { originMiddleware, validateMiddleware } from '../endpoints/pipeline';
import type { Middleware } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export const middlewareRegistry: readonly Middleware[] = [
  originMiddleware,
  validateMiddleware,
  { key: '30-rate-limit', run: (_ctx, next) => next() },
  { key: '40-idempotency', run: (_ctx, next) => next() },
];

assertRegistry('middleware', middlewareRegistry, (m) => m.key);
