/**
 * Test doors as route rows (AC-29, AC-33). This module is loaded only through the dynamic
 * `import()` in `container.ts` after `shouldLoadDoors` — never by a static import — and it is
 * the only importer of `createTestClock`.
 */
import { createTestClock } from '../clock';
import { failure } from '../endpoints/pipeline';
import type { Deps, RouteRow } from '../endpoints/types';
import type { SeedStore } from '../ports';
import { doorRegistry, type DoorRow } from './registry';

/**
 * Door rows → route rows marked `testDoor`: the pipeline lets tooling call them without an
 * `Origin`, but refuses a foreign `Origin`, a non-loopback `Host` and a non-JSON mutating call
 * (see `10-origin`). They exist only in the `test` class.
 * A dependency-breaking door first checks the exclusive lock of this worktree; an unknown slug or
 * an unreadable lock state counts as "not held" (fail closed).
 * `seed` is the row store the composition root builds for the doors; route handlers never get it.
 */
export function doorRoutes(deps: Deps, seed: SeedStore, rows: readonly DoorRow[] = doorRegistry): RouteRow[] {
  const tools = { clock: createTestClock(), seed };
  const slug = deps.env.vars.T2F_SLUG;
  return rows.map((door) => ({
    key: `door-${door.key}`,
    method: door.method,
    path: door.path,
    ...(door.body ? { body: door.body } : {}),
    testDoor: true,
    async handler(ctx) {
      if (door.dependencyBreaking && !(typeof slug === 'string' && deps.lockState.holdsExclusive(slug))) {
        return failure('forbidden', { reason: 'lock-required' });
      }
      return door.handler(ctx, tools);
    },
  }));
}
