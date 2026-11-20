/**
 * Catalog rebuild rules and the ticker pass (SPEC-08 AC-61 … AC-66) on an in-memory store and a manual clock:
 * the freeze window's boundaries, the decision at the launch (not at the change), the production flag, the
 * missing token, and the retry schedule with one `page` alarm.
 */
import { describe, expect, it } from 'vitest';
import { decide, dueAfter, freezeEnd, inFreeze, launchGate, REBUILD_DEBOUNCE_MS, REBUILD_RETRY_SCHEDULE } from '../../src/domain/site/rebuild';
import type { AlarmInput } from '../../src/ports';
import {
  REBUILD_DISABLED,
  REBUILD_FAILED,
  REBUILD_FROZEN,
  REBUILD_NOT_CONFIGURED,
  scheduleRebuild,
  tickRebuild,
  type RebuildDeps,
} from '../../src/site/rebuild';
import type { RebuildStore } from '../../src/site/ports';

const utc = (s: string) => Date.parse(`${s}Z`);

function memoryStore(): RebuildStore & { state: { dueAt: number | null; deferred: boolean } } {
  const state = { dueAt: null as number | null, deferred: false };
  return {
    state,
    async schedule(dueAt, keepDeferred) {
      if (keepDeferred && state.deferred && state.dueAt !== null) return;
      state.dueAt = Math.max(state.dueAt ?? dueAt, dueAt);
    },
    async pending() {
      return state.dueAt === null ? null : { dueAt: state.dueAt, deferred: state.deferred };
    },
    async claim(dueAt, next) {
      if (state.dueAt !== dueAt) return false;
      state.dueAt = next;
      state.deferred = next !== null;
      return true;
    },
  };
}

function harness(over: Partial<RebuildDeps> = {}) {
  const lines: { level: string; fields: Record<string, unknown> }[] = [];
  const alarms: AlarmInput[] = [];
  const launches: string[] = [];
  const sleeps: number[] = [];
  const clock = { t: utc('2026-12-30T12:00:00'), now() { return this.t; } };
  const store = memoryStore();
  const deps: RebuildDeps = {
    store,
    clock,
    envClass: 'rehearsal',
    productionFlag: false,
    launcher: { launch: async (v) => void launches.push(v) },
    catalogVersion: async () => 'cat-1',
    alarm: { raise: (a) => void alarms.push(a) },
    log: {
      info: (fields) => void lines.push({ level: 'info', fields }),
      warn: (fields) => void lines.push({ level: 'warn', fields }),
      error: (fields) => void lines.push({ level: 'error', fields }),
    },
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  };
  const events = (name: string) => lines.filter((l) => l.fields.event === name);
  return { deps, clock, store, lines, alarms, launches, sleeps, events };
}

describe('freeze window (AC-62)', () => {
  it.each([
    ['2026-12-31T07:59:59', false],
    ['2026-12-31T08:00:00', true],
    ['2026-12-31T23:59:59', true],
    ['2027-01-01T00:00:00', true],
    ['2027-01-01T13:59:59', true],
    ['2027-01-01T14:00:00', false],
    ['2026-12-30T10:00:00', false],
    ['2027-01-02T10:00:00', false],
  ])('%s UTC → in freeze %s', (at, frozen) => {
    expect(inFreeze(utc(at))).toBe(frozen);
    expect(inFreeze(utc(at) + 999), 'within the same second').toBe(frozen);
  });

  it('the window ends 01.01 14:00:00 UTC of the next year from 31.12, of the same year from 01.01', () => {
    expect(freezeEnd(utc('2026-12-31T08:00:00'))).toBe(utc('2027-01-01T14:00:00'));
    expect(freezeEnd(utc('2027-01-01T13:59:59'))).toBe(utc('2027-01-01T14:00:00'));
    expect(freezeEnd(utc('2027-03-01T10:00:00'))).toBe(utc('2027-03-01T10:00:00'));
  });

  it('decides at the launch moment, not at the change', () => {
    // A change before the window whose due time falls inside it → frozen at the launch.
    const change = utc('2026-12-31T07:59:00');
    expect(inFreeze(change)).toBe(false);
    const due = dueAfter(change);
    expect(due - change).toBe(REBUILD_DEBOUNCE_MS);
    expect(decide(due, due)).toBe('frozen');
    // A change inside the window whose launch is checked after it → launch.
    expect(decide(utc('2027-01-01T14:00:00'), dueAfter(utc('2027-01-01T13:59:00')))).toBe('wait');
    expect(decide(utc('2027-01-01T14:01:30'), dueAfter(utc('2027-01-01T13:59:00')))).toBe('launch');
    expect(decide(due - 1, due)).toBe('wait');
  });
});

describe('launch gate (AC-64, AC-65)', () => {
  it('production launches only with the flag on; a token is needed in every class', () => {
    expect(launchGate({ envClass: 'production', productionFlag: false, hasToken: true })).toBe('disabled');
    expect(launchGate({ envClass: 'production', productionFlag: true, hasToken: true })).toBe('go');
    expect(launchGate({ envClass: 'production', productionFlag: true, hasToken: false })).toBe('not-configured');
    expect(launchGate({ envClass: 'rehearsal', productionFlag: false, hasToken: true })).toBe('go');
    expect(launchGate({ envClass: 'test', productionFlag: false, hasToken: false })).toBe('not-configured');
  });

  it('production without the flag: the claimed launch logs site/rebuild-disabled and calls nothing', async () => {
    const h = harness({ envClass: 'production' });
    await scheduleRebuild(h.deps, h.clock.t);
    h.clock.t += REBUILD_DEBOUNCE_MS;
    expect((await tickRebuild(h.deps)).kind).toBe('disabled');
    expect(h.events(REBUILD_DISABLED)).toHaveLength(1);
    expect(h.launches).toEqual([]);
    expect(h.store.state.dueAt).toBeNull();
  });

  it('production with the flag launches', async () => {
    const h = harness({ envClass: 'production', productionFlag: true });
    await scheduleRebuild(h.deps, h.clock.t);
    h.clock.t += REBUILD_DEBOUNCE_MS;
    const out = await tickRebuild(h.deps);
    if (out.kind !== 'launched') throw new Error(out.kind);
    expect(await out.task).toEqual({ ok: true, attempts: 1 });
    expect(h.launches).toEqual(['cat-1']);
  });

  it('no token: every scheduled launch logs site/rebuild-not-configured', async () => {
    const h = harness();
    delete h.deps.launcher;
    for (let i = 0; i < 2; i += 1) {
      await scheduleRebuild(h.deps, h.clock.t);
      h.clock.t += REBUILD_DEBOUNCE_MS;
      expect((await tickRebuild(h.deps)).kind).toBe('not-configured');
    }
    expect(h.events(REBUILD_NOT_CONFIGURED)).toHaveLength(2);
  });
});

describe('ticker pass (AC-61 … AC-63, AC-66)', () => {
  it('a later change pushes the launch; one launch 150 s after the last', async () => {
    const h = harness();
    const start = h.clock.t;
    for (let i = 0; i < 10; i += 1) await scheduleRebuild(h.deps, start + i * 12_000);
    const last = start + 9 * 12_000;
    h.clock.t = last + REBUILD_DEBOUNCE_MS - 1;
    expect((await tickRebuild(h.deps)).kind).toBe('wait');
    h.clock.t = last + REBUILD_DEBOUNCE_MS;
    expect((await tickRebuild(h.deps)).kind).toBe('launched');
    expect((await tickRebuild(h.deps)).kind).toBe('idle');
    expect(h.launches).toHaveLength(1);
  });

  it('an out-of-order (older) change never brings the launch forward', async () => {
    const h = harness();
    await scheduleRebuild(h.deps, h.clock.t + 60_000);
    await scheduleRebuild(h.deps, h.clock.t);
    expect(h.store.state.dueAt).toBe(h.clock.t + 60_000 + REBUILD_DEBOUNCE_MS);
  });

  it('changes in the window: one site/rebuild-frozen, one launch at the window end', async () => {
    const h = harness();
    h.clock.t = utc('2026-12-31T20:00:00');
    await scheduleRebuild(h.deps, h.clock.t);
    h.clock.t += REBUILD_DEBOUNCE_MS;
    expect(await tickRebuild(h.deps)).toEqual({ kind: 'frozen', until: utc('2027-01-01T14:00:00') });
    for (const at of ['2027-01-01T02:00:00', '2027-01-01T13:30:00']) {
      await scheduleRebuild(h.deps, utc(at));
      h.clock.t = utc(at) + REBUILD_DEBOUNCE_MS;
      expect((await tickRebuild(h.deps)).kind).toBe('wait');
    }
    expect(h.store.state).toEqual({ dueAt: utc('2027-01-01T14:00:00'), deferred: true });
    h.clock.t = utc('2027-01-01T14:00:00');
    expect((await tickRebuild(h.deps)).kind).toBe('launched');
    expect(h.events(REBUILD_FROZEN)).toHaveLength(1);
    expect(h.launches).toHaveLength(1);
  });

  it('a failing launch is retried at 60 s and 300 s; the third failure raises one page alarm', async () => {
    let calls = 0;
    const h = harness({ launcher: {
        launch: async () => {
          calls += 1;
          throw new Error('nope');
        },
      } });
    await scheduleRebuild(h.deps, h.clock.t);
    h.clock.t += REBUILD_DEBOUNCE_MS;
    const out = await tickRebuild(h.deps);
    if (out.kind !== 'launched') throw new Error(out.kind);
    expect(await out.task).toEqual({ ok: false, attempts: 3 });
    expect(calls).toBe(3);
    expect(REBUILD_RETRY_SCHEDULE).toEqual([0, 60_000, 300_000]);
    expect(h.sleeps).toEqual([60_000, 240_000]);
    expect(h.alarms).toEqual([{ level: 'page', source: 'site', code: REBUILD_FAILED, details: { catalogVersion: 'cat-1', attempts: 3 } }]);
    expect(JSON.stringify(h.lines)).not.toContain('nope');
  });

  it('a second instance reading the same due time claims nothing', async () => {
    const h = harness();
    await scheduleRebuild(h.deps, h.clock.t);
    h.clock.t += REBUILD_DEBOUNCE_MS;
    const pending = await h.store.pending();
    const [a, b] = await Promise.all([tickRebuild(h.deps), tickRebuild({ ...h.deps, store: { ...h.store, pending: async () => pending } })]);
    expect([a.kind, b.kind].sort()).toEqual(['launched', 'lost']);
    expect(h.launches).toHaveLength(1);
  });
});
