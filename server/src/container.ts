/**
 * Composition root: the only module that knows every ring. Builds the process dependencies
 * (lazy singletons on `globalThis`, so every module copy in the process shares them) and the
 * dispatcher of `/api/*`. Payload is initialised only on the first call of `deps.payload()`.
 * Test doors are loaded by dynamic `import()` only when `shouldLoadDoors` is true (AC-29); no
 * request field takes part in that decision (AC-31).
 */
import type { Payload } from 'payload';
import { readHolders, resolveLockDir } from '../scripts/lib/lock.mjs';
import { createPayloadIdempotencyStore } from './adapters/payload';
import { createMemoryStore, createRedisStore } from './adapters/redis';
import { clockFor, realClock } from './clock';
import { createDispatcher } from './endpoints/pipeline';
import type { AppEnv, Deps, RouteRow } from './endpoints/types';
import { loadEnv, type RawEnv } from './platform/env';
import { createAlarm, createLogger } from './platform/logger';
import type { LockState } from './ports';
import { middlewareRegistry } from './registries/middleware';
import { routeRegistry } from './registries/routes';

const DEPS_KEY = Symbol.for('t2f.deps');
const DISPATCHER_KEY = Symbol.for('t2f.dispatcher');

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
export function createDeps(raw: RawEnv, overrides: Partial<Omit<Deps, 'env'>> = {}): Deps {
  const loaded = loadEnv(raw);
  if (!loaded.ok) throw new Error(`env: invalid ${loaded.failing.join(', ')}`);
  const env: AppEnv = { class: loaded.class, vars: loaded.env };
  const log = overrides.log ?? createLogger(loaded.secrets, { clock: realClock });
  const payload = overrides.payload ?? lazyPayload();
  return {
    env,
    clock: overrides.clock ?? clockFor(env.class),
    log,
    alarm: overrides.alarm ?? createAlarm(log),
    payload,
    lockState: overrides.lockState ?? createLockState(undefined, raw),
    redis: overrides.redis ?? createRedisStore(env.vars),
    // Windows of the in-process fallback run on real time, like Redis expiry.
    memory: overrides.memory ?? createMemoryStore(realClock),
    orderStore: overrides.orderStore ?? createPayloadIdempotencyStore(payload),
  };
}

/** The process dependencies, built once from `process.env`. */
export function getDeps(): Deps {
  const g = globalThis as unknown as Record<symbol, Deps | undefined>;
  return (g[DEPS_KEY] ??= createDeps(process.env));
}

/** The dispatcher for `deps`: production routes, plus the doors when `shouldLoadDoors`. */
export async function buildDispatcher(deps: Deps, routes: readonly RouteRow[] = routeRegistry): Promise<Dispatcher> {
  const doors = shouldLoadDoors(deps.env) ? (await import('./test-doors/index')).doorRoutes(deps) : [];
  return createDispatcher({ routes: [...routes, ...doors], middleware: middlewareRegistry, deps });
}

/** The dispatcher of the process, built once. */
export function getDispatcher(): Promise<Dispatcher> {
  const g = globalThis as unknown as Record<symbol, Promise<Dispatcher> | undefined>;
  return (g[DISPATCHER_KEY] ??= buildDispatcher(getDeps()));
}
