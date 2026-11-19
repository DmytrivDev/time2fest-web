/**
 * THE one entry point to the process `Deps` for code that Payload or Next calls without our `Deps`: collection
 * and global hooks, Payload endpoints, revert handlers, admin server components. Route handlers do not use it
 * (they have `ctx.deps`), and registries do not import the container at all.
 *
 * The container is loaded lazily: it imports the registries, and some of them (via the collections) reach
 * this module, so a static import would be a cycle.
 *
 * Also the assembly of the ports the owner's clock slice and the `clock` CLI read through (ring 4, no logic):
 * the clock-control deps and the read-only scheduler readers over a Payload accessor.
 */
import type { Payload } from 'payload';
import { realClock } from '../clock';
import { catalogStoreOf, publisherOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import type { FestivalStateDeps, LeaseReader } from '../scheduler/festival';
import type { MomentSource, RunStore } from '../scheduler/ports';
import type { ClockControlDeps } from '../timekeeping/control';
import type { ChannelPublisher } from '../realtime/ports';
import { createPayloadMomentSource } from './payloadMoments';
import { createPgLeaseReader, createPgRunReader } from './pgScheduler';

export async function processDeps(): Promise<Deps> {
  const { getDeps } = await import('../container');
  return getDeps();
}

/** The control deps of a process, or `undefined` where the class has no shared clock (production). */
export function clockControlDepsOf(deps: Deps): ClockControlDeps | undefined {
  if (!deps.sharedClock) return undefined;
  let publisher: ChannelPublisher | undefined;
  try {
    publisher = publisherOf(deps);
  } catch {
    publisher = undefined;
  }
  return { cls: deps.env.class, clock: deps.sharedClock, real: realClock, log: deps.log, ...(publisher ? { publisher } : {}) };
}

/** What a reader of the scheduler state needs, over `payload` (the slice, the `clock` CLI). Never writes. */
export interface SchedulerReaders {
  lease: LeaseReader;
  runs: Pick<RunStore, 'ledger' | 'missed24h'>;
  source: MomentSource;
}

export function schedulerReadersOf(deps: Deps, payload: () => Promise<Payload>): SchedulerReaders {
  return {
    lease: createPgLeaseReader(payload),
    runs: createPgRunReader(payload),
    source: createPayloadMomentSource({ payload, catalog: catalogStoreOf(deps) }),
  };
}

/** The slice's deps of a process: its clock, scheduler and divergence meter, the stores over `payload`. */
export function festivalDepsOf(deps: Deps, payload: () => Promise<Payload>): FestivalStateDeps {
  const { lease, runs, source } = schedulerReadersOf(deps, payload);
  const shared = deps.sharedClock;
  return {
    clock: deps.clock,
    ...(shared ? { clockState: () => shared.state() } : {}),
    source,
    lease,
    runs,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.divergence ? { divergence: deps.divergence } : {}),
  };
}
