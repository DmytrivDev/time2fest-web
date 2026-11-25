/**
 * Test doors as route rows (AC-29, AC-33). This module is loaded only through the dynamic
 * `import()` in `container.ts` after `shouldLoadDoors` — never by a static import — and it is
 * the only importer of `createTestClock`. The door clock is a facade over the shared clock of
 * `deps` (SPEC-07): a change goes through the clock-state store, so it persists and reaches every
 * process of the environment.
 */
import { createTestClock } from '../clock';
import { failure } from '../endpoints/pipeline';
import type { Deps, RouteRow } from '../endpoints/types';
import type { SeedStore } from '../ports';
import type { SubjectResolver } from '../realtime/ports';
import { createTestSubjects, type TestSubjects } from './realtimeToken';
import { doorRegistry, type DoorRow } from './registry';

/** The doors of one dispatcher: their route rows and the subject resolver their state feeds (AC-57). */
export interface Doors {
  routes: RouteRow[];
  subjects: SubjectResolver;
}

/**
 * The doors for the composition root: one test-subject state per construction, shared by the
 * realtime-token door (sets it), the reset door (clears it) and the returned resolver (reads it).
 */
export function createDoors(deps: Deps, seed: SeedStore, rows: readonly DoorRow[] = doorRegistry): Doors {
  const subjects = createTestSubjects();
  return { routes: doorRoutes(deps, seed, rows, subjects), subjects: subjects.resolver };
}

/**
 * Door rows → route rows marked `testDoor`: the pipeline lets tooling call them without an
 * `Origin`, but refuses a foreign `Origin`, a non-loopback `Host` and a non-JSON mutating call
 * (see `10-origin`). They exist only in the `test` class.
 * A dependency-breaking door first checks the exclusive lock of this worktree; an unknown slug or
 * an unreadable lock state counts as "not held" (fail closed).
 * `seed` is the row store the composition root builds for the doors; route handlers never get it.
 */
export function doorRoutes(
  deps: Deps,
  seed: SeedStore,
  rows: readonly DoorRow[] = doorRegistry,
  subjects: TestSubjects = createTestSubjects(),
): RouteRow[] {
  // Doors exist only in the `test` class, where `createDeps` always builds the shared clock.
  if (!deps.sharedClock) throw new Error('test doors: deps without a shared clock');
  const tools = { clock: createTestClock(deps.sharedClock), seed, subjects };
  const slug = deps.env.vars.T2F_SLUG;
  return rows.map((door) => ({
    key: `door-${door.key}`,
    method: door.method,
    path: door.path,
    ...(door.body ? { body: door.body } : {}),
    ...(door.edgeProbe ? { edgeProbe: true as const } : {}),
    ...(door.subject ? { subject: door.subject } : {}),
    testDoor: true,
    async handler(ctx) {
      if (door.dependencyBreaking && !(typeof slug === 'string' && deps.lockState.holdsExclusive(slug))) {
        return failure('forbidden', { reason: 'lock-required' });
      }
      return door.handler(ctx, tools);
    },
  }));
}
