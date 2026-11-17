/**
 * Composition root: the only module that knows every ring. Builds the process dependencies
 * (lazy singletons on `globalThis`, so every module copy in the process shares them) and the
 * dispatcher of `/api/*`. Payload is initialised only on first use. The raw Payload accessor
 * never enters `Deps` (route handlers see ports only): it is kept on the deps object under a
 * private symbol, read by `payloadOf` for the adapters built here (idempotency, the doors' seed store).
 * Test doors are loaded by dynamic `import()` only when `shouldLoadDoors` is true (AC-29); no
 * request field takes part in that decision (AC-31).
 */
import type { Payload } from 'payload';
import { readHolders, resolveLockDir } from '../scripts/lib/lock.mjs';
import { createPayloadIdempotencyStore, createPayloadSeedStore } from './adapters/payload';
import { createMemoryStore, createRedisStore } from './adapters/redis';
import { clockFor, realClock } from './clock';
import { createDispatcher } from './endpoints/pipeline';
import type { AppEnv, Deps, RouteRow } from './endpoints/types';
import { loadEnv, type RawEnv } from './platform/env';
import { createAlarm, createLogger } from './platform/logger';
import type { LockState, SeedStore } from './ports';
import { envRegistry } from './registries/env';
import { middlewareRegistry } from './registries/middleware';
import { routeRegistry } from './registries/routes';

const DEPS_KEY = Symbol.for('t2f.deps');
const DISPATCHER_KEY = Symbol.for('t2f.dispatcher');
const PAYLOAD_KEY = Symbol.for('t2f.payload');

/** What a caller of `createDeps` may replace: any port, and the lazy Payload accessor. */
export type DepsOverrides = Partial<Omit<Deps, 'env'>> & { payload?: () => Promise<Payload> };

type Dispatcher = (req: Request) => Promise<Response>;

/** Doors exist only in the `test` class with `T2F_TEST_DOORS=1` — never from a request field. */
export function shouldLoadDoors(env: AppEnv): boolean {
  return env.class === 'test' && env.vars.T2F_TEST_DOORS === '1';
}

/**
 * Read-only view of the machine integration lock. The folder is resolved on first use; any
 * failure to resolve or read it means "not held" (fail closed).
 */
export function createLockState(dir?: string, raw: RawEnv = process.env): LockState {
  let resolved = dir;
  return {
    holdsExclusive(owner) {
      try {
        resolved ??= resolveLockDir(process.cwd(), raw);
        return readHolders(resolved).some(
          (h) => h.mode === 'exclusive' && (h.owner === owner || h.owner.startsWith(`${owner}:`)),
        );
      } catch {
        return false;
      }
    },
  };
}

/** Lazy Payload: initialised once on first use; a failed start is retried on the next call. */
function lazyPayload(): () => Promise<Payload> {
  let pending: Promise<Payload> | undefined;
  return () => {
    pending ??= (async () => {
      const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('@payload-config')]);
      return getPayload({ config });
    })().catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}

/** Builds the dependencies from a raw environment. Throws, naming variables only, when it is invalid. */
export function createDeps(raw: RawEnv, overrides: DepsOverrides = {}): Deps {
  const loaded = loadEnv(raw, envRegistry);
  if (!loaded.ok) throw new Error(`env: invalid ${loaded.failing.join(', ')}`);
  const env: AppEnv = { class: loaded.class, vars: loaded.env };
  const log = overrides.log ?? createLogger(loaded.secrets, { clock: realClock });
  const payload = overrides.payload ?? lazyPayload();
  const deps: Deps = {
    env,
    clock: overrides.clock ?? clockFor(env.class),
    log,
    alarm: overrides.alarm ?? createAlarm(log),
    lockState: overrides.lockState ?? createLockState(undefined, raw),
    redis: overrides.redis ?? createRedisStore(env.vars),
    // Windows of the in-process fallback run on real time, like Redis expiry.
    memory: overrides.memory ?? createMemoryStore(realClock),
    orderStore: overrides.orderStore ?? createPayloadIdempotencyStore(payload),
  };
  Object.defineProperty(deps, PAYLOAD_KEY, { value: payload, enumerable: false });
  return deps;
}

/** The lazy Payload accessor of deps built by `createDeps`. For the composition root and tests only. */
export function payloadOf(deps: Deps): () => Promise<Payload> {
  const payload = (deps as unknown as Record<symbol, (() => Promise<Payload>) | undefined>)[PAYLOAD_KEY];
  if (!payload) throw new Error('deps: not built by createDeps');
  return payload;
}

/** The row store the test doors seed through, over the Payload of `deps`. */
export function seedStoreOf(deps: Deps): SeedStore {
  // Resolved on first use, so building the doors never needs Payload.
  return createPayloadSeedStore(() => payloadOf(deps)());
}

/** The process dependencies, built once from `process.env`. */
export function getDeps(): Deps {
  const g = globalThis as unknown as Record<symbol, Deps | undefined>;
  return (g[DEPS_KEY] ??= createDeps(process.env));
}

/** The dispatcher for `deps`: production routes, plus the doors when `shouldLoadDoors`. */
export async function buildDispatcher(deps: Deps, routes: readonly RouteRow[] = routeRegistry): Promise<Dispatcher> {
  const doors = shouldLoadDoors(deps.env) ? (await import('./test-doors/index')).doorRoutes(deps, seedStoreOf(deps)) : [];
  return createDispatcher({ routes: [...routes, ...doors], middleware: middlewareRegistry, deps });
}

/** The dispatcher of the process, built once. */
export function getDispatcher(): Promise<Dispatcher> {
  const g = globalThis as unknown as Record<symbol, Promise<Dispatcher> | undefined>;
  return (g[DISPATCHER_KEY] ??= buildDispatcher(getDeps()));
}
