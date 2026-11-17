/**
 * THE one entry point to the process `Deps` for code that Payload or Next calls without our `Deps`: collection
 * and global hooks, Payload endpoints, revert handlers, admin server components. Route handlers do not use it
 * (they have `ctx.deps`), and registries do not import the container at all.
 *
 * The container is loaded lazily: it imports the registries, and some of them (via the collections) reach
 * this module, so a static import would be a cycle.
 */
import type { Deps } from '../endpoints/types';

export async function processDeps(): Promise<Deps> {
  const { getDeps } = await import('../container');
  return getDeps();
}
