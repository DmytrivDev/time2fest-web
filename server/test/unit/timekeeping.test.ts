/**
 * SPEC-07 virtual time (W11, W13): the pure transitions of `domain/timekeeping/virtual.ts`, the
 * shared clock of a process over a clock-state store, and the clock `createDeps` picks per class.
 * The Payload store and the cross-process refresh are covered by `clock-shared.int.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clockFor, realClock } from '../../src/clock';
import { createDeps } from '../../src/container';
import {
  backToReal,
  clockEventId,
  initialState,
  now,
  restartNight,
  setMoment,
  setSpeed,
  testSet,
  type VirtualState,
} from '../../src/domain/timekeeping/virtual';
import type { ClockStateStore } from '../../src/timekeeping/ports';
import { createClockRefreshSubscriber, createSharedClock, startClockRefresh } from '../../src/timekeeping/shared';

const AT = Date.parse('2026-12-31T23:59:00.000Z');
const REAL = 1_000_000;
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const actor = { kind: 'system' as const, id: 'test', label: 'test' };

const fixedClock = (t: { now: number }) => ({ now: () => t.now });

/** A clock-state store in memory; `stored` can be replaced to stand for a change made by another process. */
function memoryStore(start: VirtualState = initialState(REAL)) {
  const box = { stored: start, loads: 0, changes: 0 };
  const store: ClockStateStore = {
    async load() {
      box.loads += 1;
      return box.stored;
    },
    async change(_actor, fn) {
      const next = fn(box.stored, REAL);
      if (next !== box.stored) box.changes += 1;
      box.stored = next;
      return next;
    },
  };
  return { box, store };
}

describe('virtual-time transitions (W11)', () => {
  const real = initialState(REAL);

  it('a never-moved state is real time, epoch 0, seq 0', () => {
    expect(real).toMatchObject({ virtual: false, speed: 1, frozen: false, runEpoch: 0, seq: 0 });
    expect(now(real, REAL + 5_000)).toBe(REAL + 5_000);
  });

  it('setMoment: virtual from `at`, speed 1, running; seq + 1, epoch kept', () => {
    const s = setMoment(real, AT, REAL);
    expect(s).toMatchObject({ virtual: true, anchorVirtual: AT, anchorReal: REAL, speed: 1, frozen: false, runEpoch: 0, seq: 1 });
    expect(now(s, REAL + 1_000)).toBe(AT + 1_000);
    expect(() => setMoment(real, Number.NaN, REAL)).toThrow(/at must be/);
  });

  it('backToReal: real time again, epoch kept, seq + 1', () => {
    const fast = setSpeed(setMoment(real, AT, REAL), 60, REAL);
    const back = backToReal(restartNight(fast, REAL), REAL + 10);
    expect(back).toMatchObject({ virtual: false, speed: 1, frozen: false, runEpoch: 1, seq: 4 });
    expect(now(back, REAL + 999)).toBe(REAL + 999);
  });

  it('restartNight: epoch + 1 and seq + 1, the instant does not jump', () => {
    const s = setSpeed(setMoment(real, AT, REAL), 60, REAL);
    const at = REAL + 2_000;
    const r = restartNight(s, at);
    expect(r).toMatchObject({ runEpoch: 1, seq: s.seq + 1, speed: 60, virtual: true });
    expect(now(r, at)).toBe(now(s, at));
    const fromReal = restartNight(real, at);
    expect(fromReal).toMatchObject({ virtual: false, runEpoch: 1, seq: 1 });
    expect(now(fromReal, at)).toBe(at);
  });

  it('setSpeed: re-anchors at the current instant (no jump), from real or virtual; refuses a negative speed', () => {
    const v = setMoment(real, AT, REAL);
    const at = REAL + 3_000;
    const fast = setSpeed(v, 600, at);
    expect(now(fast, at)).toBe(now(v, at));
    expect(now(fast, at + 1_000)).toBe(now(v, at) + 600_000);
    const fromReal = setSpeed(real, 60, at);
    expect(fromReal.virtual).toBe(true);
    expect(now(fromReal, at)).toBe(at);
    expect(() => setSpeed(v, -1, at)).toThrow(/speed must be/);
  });

  it('testSet: door semantics — re-anchor first, keep what is not given; frozen holds the instant', () => {
    const at = REAL + 500;
    const moved = testSet(real, { at: AT }, at);
    expect(moved).toMatchObject({ virtual: true, anchorVirtual: AT, speed: 1, frozen: false, seq: 1 });
    const frozen = testSet(moved, { frozen: true }, at + 1_000);
    const a = now(frozen, at + 1_000);
    expect(a).toBe(AT + 1_000);
    const faster = testSet(frozen, { speed: 60 }, at + 5_000);
    expect(now(faster, at + 9_000)).toBe(a);
    expect(faster).toMatchObject({ speed: 60, frozen: true, seq: 3 });
    // From real time with no `at`: the current real instant, no jump.
    expect(now(testSet(real, { speed: 10 }, at), at)).toBe(at);
    expect(() => testSet(real, { speed: Number.POSITIVE_INFINITY }, at)).toThrow(/speed must be/);
    expect(() => testSet(real, { at: Number.NaN }, at)).toThrow(/at must be/);
  });

  it('clockEventId: derived from the run epoch and the change number (C3)', () => {
    const s = restartNight(setMoment(real, AT, REAL), REAL);
    expect(clockEventId(s)).toBe('clock:1:2');
  });
});

describe('shared clock of a process (W13)', () => {
  it('now() is real time until the store says virtual; refresh() picks up a change of another process', async () => {
    const t = { now: REAL };
    const { box, store } = memoryStore();
    const shared = createSharedClock({ store, real: fixedClock(t), cache: { state: initialState(REAL) } });
    expect(shared.now()).toBe(REAL);
    box.stored = setMoment(box.stored, AT, REAL); // written by another process
    expect(shared.now()).toBe(REAL);
    await shared.refresh();
    t.now = REAL + 1_000;
    expect(shared.now()).toBe(AT + 1_000);
    expect(shared.view()).toEqual({ now: AT + 1_000, speed: 1, frozen: false });
  });

  it('change() writes through the store and applies at once; apply() never goes back to an older seq', async () => {
    const { box, store } = memoryStore();
    const shared = createSharedClock({ store, real: fixedClock({ now: REAL }), cache: { state: initialState(REAL) } });
    const written = await shared.change(actor, (s, r) => setMoment(s, AT, r));
    expect(box.stored).toBe(written);
    expect(shared.state()).toBe(written);
    shared.apply(initialState(REAL)); // seq 0 < 1: an older state is ignored
    expect(shared.state()).toBe(written);
  });

  it('two shared clocks over one cache (two deps sets of one process) see the same state', async () => {
    const { store } = memoryStore();
    const cache = { state: initialState(REAL) };
    const a = createSharedClock({ store, real: fixedClock({ now: REAL }), cache });
    const b = createSharedClock({ store, real: fixedClock({ now: REAL }), cache });
    await a.change(actor, (s, r) => setMoment(s, AT, r));
    expect(b.now()).toBe(AT);
  });

  it('the clock-refresh subscriber refreshes on clock.changed; startClockRefresh loads at once and reports failures', async () => {
    let refreshed = 0;
    const subscriber = createClockRefreshSubscriber(async () => ({ refresh: async () => void (refreshed += 1) }));
    expect(subscriber).toMatchObject({ key: 'clock-refresh', topic: 'clock.changed' });
    await subscriber.handle({ id: '1', topic: 'clock.changed', version: 1, payload: { seq: 1, runEpoch: 0 }, committedAt: REAL });
    expect(refreshed).toBe(1);
    await createClockRefreshSubscriber(async () => undefined).handle({ id: '2', topic: 'clock.changed', version: 2, payload: null, committedAt: REAL });

    const errors: unknown[] = [];
    const failing = await startClockRefresh({ refresh: () => Promise.reject(new Error('db down')) }, { onError: (e) => errors.push(e), intervalMs: 60_000 });
    failing.stop();
    expect(errors).toHaveLength(1);
    const { box, store } = memoryStore();
    const ok = await startClockRefresh(createSharedClock({ store, real: realClock, cache: { state: initialState(REAL) } }), { onError: () => {}, intervalMs: 60_000 });
    ok.stop();
    expect(box.loads).toBe(1);
  });
});

/** A valid raw environment of `cls` with every variable it requires (no I/O happens in createDeps). */
function rawEnv(cls: 'rehearsal' | 'production'): Record<string, string> {
  const prod = cls === 'production';
  return {
    T2F_ENV: cls,
    DATABASE_URI: `postgres://t2f@postgres:5432/${prod ? 't2f_production' : 't2f_rehearsal'}`,
    REDIS_URL: 'redis://redis:6379/0',
    T2F_REDIS_PREFIX: prod ? 't2f:production:' : 't2f:rehearsal:',
    T2F_CENTRIFUGO_URL: 'https://o-rehearsal.time2fest.com',
    T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex'),
    T2F_CENTRIFUGO_TOKEN_SECRET: randomBytes(24).toString('hex'),
    PAYLOAD_SECRET: randomBytes(24).toString('hex'),
    T2F_EDGE_SECRET: randomBytes(24).toString('hex'),
    T2F_ADMIN_HOST: prod ? 'admin.time2fest.com' : 'admin-rehearsal.time2fest.com',
    T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
    T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
    T2F_ACCESS_AUD: 't2f-test-aud',
    T2F_ACCESS_JWKS_URL: 'https://t2f-test.invalid/cdn-cgi/access/certs',
    T2F_OWNER_EMAILS: 'owner@example.com',
    T2F_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    T2F_R2_BUCKET: prod ? 'time2fest-prod' : 'time2fest-rehearsal',
    T2F_R2_PREFIX: prod ? 'production/' : 'rehearsal/',
    T2F_R2_ACCESS_KEY_ID: 't2f-key',
    T2F_R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'),
    // SPEC-13b AC-67: required in production since the ops wave.
    T2F_TELEGRAM_BOT_TOKEN: randomBytes(16).toString('hex'),
    T2F_TELEGRAM_CHAT_ID: '-1001234567890',
    T2F_BACKUP_KEY: randomBytes(32).toString('base64'),
  };
}

describe('clock per class (AC-1, W13)', () => {
  it('production: the real clock and no shared clock, even when one is offered', () => {
    const { store } = memoryStore(setMoment(initialState(REAL), AT, REAL));
    const offered = createSharedClock({ store, real: realClock, cache: { state: initialState(REAL) } });
    const deps = createDeps(rawEnv('production'), { log: silent, sharedClock: offered });
    expect(deps.clock).toBe(realClock);
    expect(deps.sharedClock).toBeUndefined();
    expect(clockFor('production')).toBe(realClock);
  });

  // The `test` class needs this worktree's database and Redis names; its deps are covered by the integration files.
  it('rehearsal: the deps clock is the shared clock and follows a store change after refresh(); test: clockFor is the shared clock', async () => {
    const { box, store } = memoryStore();
    const shared = createSharedClock({ store, real: realClock, cache: { state: initialState(realClock.now()) } });
    expect(clockFor('test', shared)).toBe(shared);
    const deps = createDeps(rawEnv('rehearsal'), { log: silent, sharedClock: shared });
    expect(deps.sharedClock).toBe(shared);
    expect(deps.clock).toBe(shared);
    expect(Math.abs(deps.clock.now() - realClock.now())).toBeLessThan(1_000);
    box.stored = setMoment(box.stored, AT, realClock.now());
    await deps.sharedClock?.refresh();
    expect(Math.abs(deps.clock.now() - AT)).toBeLessThan(1_000);
  });

  it('test and rehearsal deps built without an override share the process clock (and clockFor without deps reads it)', () => {
    const deps = createDeps(rawEnv('rehearsal'), { log: silent });
    expect(deps.sharedClock).toBeDefined();
    expect(deps.clock).toBe(deps.sharedClock);
    expect(Math.abs(clockFor('rehearsal').now() - (deps.sharedClock?.now() ?? 0))).toBeLessThan(1_000);
  });
});
