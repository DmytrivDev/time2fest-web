/**
 * Test doors as route rows (AC-29, AC-33). This module is loaded only through the dynamic
 * `import()` in `container.ts` after `shouldLoadDoors` — never by a static import — and it is
 * the only importer of `createTestClock`.
 */
import { createTestClock } from '../clock';
import { failure } from '../endpoints/pipeline';
import type { Deps, RouteRow } from '../endpoints/types';
import { doorRegistry, type DoorRow } from './registry';

/**
 * Door rows → route rows. Doors are called by tooling without an `Origin`, so they are exempt
 * from the same-origin check; they exist only in the `test` class.
 * A dependency-breaking door first checks the exclusive lock of this worktree; an unknown slug or
 * an unreadable lock state counts as "not held" (fail closed).
 */
export function doorRoutes(deps: Deps, rows: readonly DoorRow[] = doorRegistry): RouteRow[] {
  const tools = { clock: createTestClock() };
  const slug = deps.env.vars.T2F_SLUG;
  return rows.map((door) => ({
    key: `door-${door.key}`,
    method: door.method,
    path: door.path,
    ...(door.body ? { body: door.body } : {}),
    sameOriginExempt: true,
    async handler(ctx) {
      if (door.dependencyBreaking && !(typeof slug === 'string' && deps.lockState.holdsExclusive(slug))) {
        return failure('forbidden', { reason: 'lock-required' });
      }
      return door.handler(ctx, tools);
    },
  }));
}
