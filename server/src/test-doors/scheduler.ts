/**
 * Scheduler test doors (SPEC-07 C7; AC-29, AC-45, AC-67, AC-69). Part of the doors module, so they
 * exist only in the `test` class with `T2F_TEST_DOORS=1` (dynamic import in `container.ts`); in every
 * other class each path answers like an unknown one. Bodies are the strict C7 schemas: a bad body is
 * refused by the pipeline (`validation`) before the handler runs, so nothing changes.
 *
 * - `POST /api/_test/scheduler/night-run` `{ speed?, from?, to? }` → `{ epoch }`: ONE clock change —
 *   new run epoch, virtual clock at `from` (default `celebration-start − 60 s` of the stored season),
 *   running at `speed` (default 60) — then the scheduler reloads its moments.
 * - `GET  /api/_test/scheduler/night-run` → `{ epoch, records }`: the run recorder's rows of the
 *   current run epoch, by real start time.
 * - `POST /api/_test/scheduler/lease` `{ action: 'pause' | 'resume' }` → `{ holder, epoch }`: this
 *   process stops (resumes) renewing and acting without letting the lease go; another instance takes
 *   over once the term ran out (AC-45).
 * - `POST /api/_test/scheduler/fault` `{ after: 'publish', action? }` → `{}`: the next run of that
 *   action (any, by default) in this process throws after publishing and before `done` (AC-29).
 * The doors reach the scheduler only through `deps.scheduler`.
 */
import {
  FaultDoorBodySchema,
  LeaseDoorBodySchema,
  NightRunBodySchema,
  type FaultDoorBody,
  type LeaseDoorBody,
  type NightRunBody,
} from '@time2fest/contracts/schemas';
import type { LeaseDoorValue, NightRunJournal, NightRunValue } from '@time2fest/contracts';
import { seasonMoments } from '@time2fest/rules/time';
import { createPayloadMomentSource } from '../adapters/payloadMoments';
import { createPayloadRunRecordStore } from '../adapters/payloadRunRecords';
import { TEST_DOOR_ACTOR } from '../clock';
import { restartNight, testSet } from '../domain/timekeeping/virtual';
import { catalogStoreOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Deps } from '../endpoints/types';
import { armRunFault } from '../scheduler/recorder';
import type { DoorRow } from './registry';

/** Default start of a night run: one minute before `celebration-start` (C7). */
export const NIGHT_RUN_LEAD_MS = 60_000;

const lazyPayload = async (deps: Deps) => (await import('../container')).payloadOf(deps);

async function celebrationStart(deps: Deps): Promise<number | undefined> {
  const source = createPayloadMomentSource({ payload: await lazyPayload(deps), catalog: catalogStoreOf(deps) });
  return seasonMoments(await source.load()).find((m) => m.kind === 'celebration-start')?.at;
}

export const nightRunStartDoor: DoorRow = {
  key: 'scheduler-night-run',
  method: 'POST',
  path: '/api/_test/scheduler/night-run',
  body: NightRunBodySchema,
  async handler(ctx) {
    const { speed, from: given, to } = ctx.body as NightRunBody;
    const shared = ctx.deps.sharedClock;
    if (!shared || !ctx.deps.scheduler) return failure('unavailable');
    let from = given;
    if (from === undefined) {
      const start = await celebrationStart(ctx.deps);
      if (start === undefined) return failure('conflict', { reason: 'no-season' });
      from = start - NIGHT_RUN_LEAD_MS;
    }
    if (to !== undefined && to <= from) return failure('validation', { reason: 'invalid-input' });
    const at = from;
    // One change = one `seq`: the new epoch and the jump are a single step for every process.
    const state = await shared.change(TEST_DOOR_ACTOR, (s, real) => ({
      ...testSet(restartNight(s, real), { at, speed, frozen: false }, real),
      seq: s.seq + 1,
    }));
    ctx.deps.scheduler.recompute();
    const value: NightRunValue = { epoch: state.runEpoch };
    return { ok: true, value };
  },
};

export const nightRunJournalDoor: DoorRow = {
  key: 'scheduler-night-run-get',
  method: 'GET',
  path: '/api/_test/scheduler/night-run',
  async handler(ctx) {
    const shared = ctx.deps.sharedClock;
    if (!shared) return failure('unavailable');
    const epoch = shared.state().runEpoch;
    const rows = await createPayloadRunRecordStore(await lazyPayload(ctx.deps)).list(epoch);
    const value: NightRunJournal = {
      epoch,
      records: rows.map(({ keys, action, plannedAt, startedAt, at, consequenceId }) => ({ keys, action, plannedAt, startedAt, at, consequenceId })),
    };
    return { ok: true, value };
  },
};

export const leaseDoor: DoorRow = {
  key: 'scheduler-lease',
  method: 'POST',
  path: '/api/_test/scheduler/lease',
  body: LeaseDoorBodySchema,
  async handler(ctx) {
    const scheduler = ctx.deps.scheduler;
    if (!scheduler) return failure('unavailable');
    const { action } = ctx.body as LeaseDoorBody;
    if (action === 'pause') scheduler.pause();
    else scheduler.resume();
    const { lease } = scheduler.status();
    const value: LeaseDoorValue = { holder: lease.held, epoch: lease.epoch ?? 0 };
    return { ok: true, value };
  },
};

export const faultDoor: DoorRow = {
  key: 'scheduler-fault',
  method: 'POST',
  path: '/api/_test/scheduler/fault',
  body: FaultDoorBodySchema,
  async handler(ctx) {
    const { action } = ctx.body as FaultDoorBody;
    armRunFault(action);
    return { ok: true, value: {} };
  },
};

/** The four rows, sorted by key (spread into `doorRegistry`). */
export const schedulerDoors: readonly DoorRow[] = [faultDoor, leaseDoor, nightRunStartDoor, nightRunJournalDoor];
