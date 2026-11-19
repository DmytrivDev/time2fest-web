/**
 * SPEC-07 W32 (AC-69, AC-67): the scheduler doors over fakes, through the real pipeline. A body
 * outside the strict C7 schema (unknown field, speed outside 1..600, negative or fractional time) is
 * `validation` and changes nothing: no clock change, no scheduler call, no armed fault. Valid bodies
 * do exactly one clock change (new run epoch + jump), pause/resume the scheduler, arm the fault.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { initialState, type VirtualState } from '../../src/domain/timekeeping/virtual';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { Deps } from '../../src/endpoints/types';
import { inactiveEdgeGate } from '../../src/platform/edge';
import { middlewareRegistry } from '../../src/registries/middleware';
import { clearRunFault, runFaultArmed } from '../../src/scheduler/recorder';
import type { SchedulerHandle, SchedulerStatus } from '../../src/scheduler/service';
import type { ClockStateStore } from '../../src/timekeeping/ports';
import { createSharedClock } from '../../src/timekeeping/shared';
import { doorRoutes } from '../../src/test-doors/index';
import { schedulerDoors } from '../../src/test-doors/scheduler';

const BASE = 'http://127.0.0.1:3000';
const JSON_TYPE = { 'content-type': 'application/json' };
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const FROM = Date.parse('2026-12-31T09:59:00Z');

function fakeScheduler() {
  const calls: string[] = [];
  const handle: SchedulerHandle = {
    start: () => void calls.push('start'),
    stop: async () => void calls.push('stop'),
    pause: () => void calls.push('pause'),
    resume: () => void calls.push('resume'),
    recompute: () => void calls.push('recompute'),
    tick: async () => void calls.push('tick'),
    status: () => ({ lease: { held: true, acting: true, epoch: 4, termLeftMs: 5_000, unreachable: false } }) as SchedulerStatus,
  };
  return { handle, calls };
}

function setup() {
  const box: { stored: VirtualState; changes: number } = { stored: { ...initialState(1_000), runEpoch: 3, seq: 9 }, changes: 0 };
  const store: ClockStateStore = {
    async load() {
      return box.stored;
    },
    async change(_actor, fn) {
      box.stored = fn(box.stored, realClock.now());
      box.changes += 1;
      return box.stored;
    },
  };
  const sharedClock = createSharedClock({ store, real: realClock, cache: { state: box.stored } });
  const scheduler = fakeScheduler();
  const deps: Deps = {
    env: { class: 'test', vars: { T2F_TEST_DOORS: '1' } },
    clock: sharedClock,
    log: silent,
    alarm: { raise: () => {} },
    lockState: { holdsExclusive: () => false },
    redis: createMemoryStore(realClock),
    memory: createMemoryStore(realClock),
    orderStore: { begin: () => Promise.reject(new Error('not used')), finish: async () => {}, abort: async () => {} },
    sharedClock,
    scheduler: scheduler.handle,
  };
  const seed = { upsertByKey: async () => {}, count: async () => 0, clear: async () => {} };
  const dispatch = createDispatcher({
    routes: doorRoutes(deps, seed, schedulerDoors),
    middleware: middlewareRegistry,
    deps,
    edge: inactiveEdgeGate(realClock),
  });
  const post = (path: string, body: unknown) =>
    dispatch(new Request(`${BASE}/api/_test/scheduler/${path}`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
  return { box, sharedClock, scheduler, post };
}

async function expectValidation(res: Response, label: string) {
  expect(res.status, label).toBe(400);
  const err = ((await res.json()) as { error: { code: string } }).error;
  expect(err.code, label).toBe('validation');
}

describe('scheduler doors', () => {
  afterEach(() => clearRunFault());

  it('has four rows: night-run POST + GET, lease POST, fault POST', () => {
    expect(schedulerDoors.map((d) => `${d.method} ${d.path}`).sort()).toEqual([
      'GET /api/_test/scheduler/night-run',
      'POST /api/_test/scheduler/fault',
      'POST /api/_test/scheduler/lease',
      'POST /api/_test/scheduler/night-run',
    ]);
  });

  it('AC-69: night-run refuses an unknown field, speed outside 1..600, a negative or fractional time; state unchanged', async () => {
    const { box, sharedClock, scheduler, post } = setup();
    const before = sharedClock.state();
    const bodies = [
      { speed: 60, extra: 1 },
      { speed: 601 },
      { speed: 0 },
      { speed: -1 },
      { speed: 1.5 },
      { from: -1 },
      { from: FROM + 0.5 },
      { to: -5 },
      { speed: '60' },
    ];
    for (const body of bodies) await expectValidation(await post('night-run', body), JSON.stringify(body));
    // `to` not after `from`: refused by the door before any change.
    await expectValidation(await post('night-run', { from: FROM, to: FROM }), 'to = from');
    expect(box.changes).toBe(0);
    expect(sharedClock.state()).toEqual(before);
    expect(scheduler.calls).toEqual([]);
  });

  it('AC-69: lease and fault refuse a body outside their schema; nothing changes', async () => {
    const { scheduler, post } = setup();
    for (const body of [{}, { action: 'stop' }, { action: 'pause', extra: true }]) {
      await expectValidation(await post('lease', body), `lease ${JSON.stringify(body)}`);
    }
    for (const body of [{}, { after: 'done' }, { after: 'publish', extra: 1 }, { after: 'publish', action: '' }, { after: 'publish', action: 'x'.repeat(65) }]) {
      await expectValidation(await post('fault', body), `fault ${JSON.stringify(body)}`);
    }
    expect(scheduler.calls).toEqual([]);
    expect(runFaultArmed()).toBe(false);
  });

  it('night-run: one clock change → new run epoch, virtual at `from`, the given speed; the scheduler recomputes', async () => {
    const { box, sharedClock, scheduler, post } = setup();
    const res = await post('night-run', { from: FROM, speed: 600 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: { epoch: 4 } });
    expect(box.changes).toBe(1);
    const s = sharedClock.state();
    expect(s).toMatchObject({ virtual: true, runEpoch: 4, seq: 10, speed: 600, frozen: false, anchorVirtual: FROM });
    expect(scheduler.calls).toEqual(['recompute']);
  });

  it('night-run: speed defaults to 60', async () => {
    const { sharedClock, post } = setup();
    expect((await post('night-run', { from: FROM })).status).toBe(200);
    expect(sharedClock.state().speed).toBe(60);
  });

  it('lease: pause and resume reach this process scheduler and answer { holder, epoch }', async () => {
    const { scheduler, post } = setup();
    const paused = await post('lease', { action: 'pause' });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ ok: true, value: { holder: true, epoch: 4 } });
    expect((await post('lease', { action: 'resume' })).status).toBe(200);
    expect(scheduler.calls).toEqual(['pause', 'resume']);
  });

  it('fault: arms the one-shot fault', async () => {
    const { post } = setup();
    const res = await post('fault', { after: 'publish', action: 'run-recorder' });
    expect(res.status).toBe(200);
    expect(runFaultArmed()).toBe(true);
  });
});
