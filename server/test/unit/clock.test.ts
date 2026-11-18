import { afterEach, describe, expect, it } from 'vitest';
import { clockFor, createTestClock, processClockCache, realClock, virtualNow } from '../../src/clock';
import { initialState, type VirtualState } from '../../src/domain/timekeeping/virtual';
import type { ClockStateStore } from '../../src/timekeeping/ports';
import { createSharedClock } from '../../src/timekeeping/shared';

const AT = Date.parse('2026-12-31T23:59:00.000Z');

/** The clock-state store in memory (the Payload adapter is covered by `clock-shared.int.test.ts`). */
function memoryStore(): ClockStateStore {
  let stored: VirtualState = initialState(realClock.now());
  return {
    load: async () => stored,
    async change(_actor, fn) {
      stored = fn(stored, realClock.now());
      return stored;
    },
  };
}

// The process cache is shared by every shared clock of this process, as in the server.
const shared = createSharedClock({ store: memoryStore(), real: realClock, cache: processClockCache() });

afterEach(async () => {
  await createTestClock(shared).reset();
});

describe('server clock', () => {
  it('virtualNow: speed 60 over 1 000 ms adds 60 000 ms; frozen stays constant', () => {
    const state = { anchorVirtual: AT, anchorReal: 1_000, speed: 60, frozen: false };
    expect(virtualNow(state, 2_000)).toBe(AT + 60_000);
    const frozen = { ...state, frozen: true };
    expect(virtualNow(frozen, 2_000)).toBe(AT);
    expect(virtualNow(frozen, 999_999)).toBe(AT);
  });

  it('set({ at }) moves now() to that instant, and the test view of clockFor follows', async () => {
    const clock = createTestClock(shared);
    await clock.set({ at: AT });
    expect(Math.abs(clock.now() - AT)).toBeLessThan(1_000);
    expect(Math.abs(clockFor('test').now() - AT)).toBeLessThan(1_000);
    expect(clock.state()).toMatchObject({ speed: 1, frozen: false });

    await clock.set({ frozen: true });
    const a = clock.now();
    await clock.set({ speed: 60 });
    expect(clock.now()).toBe(a);
    expect(clock.state()).toMatchObject({ now: a, speed: 60, frozen: true });
  });

  it('reset() returns to real time', async () => {
    const clock = createTestClock(shared);
    await clock.set({ at: AT, speed: 60, frozen: true });
    await clock.reset();
    expect(Math.abs(clock.now() - realClock.now())).toBeLessThan(1_000);
    expect(clock.state()).toMatchObject({ speed: 1, frozen: false });
  });

  it('AC-41: clockFor(production) is the real clock and exposes no setter', async () => {
    await createTestClock(shared).set({ at: AT, frozen: true });
    const clock = clockFor('production', shared);
    expect(clock).toBe(realClock);
    expect('set' in clock).toBe(false);
    expect(Math.abs(clock.now() - realClock.now())).toBeLessThan(1_000);
    expect(() => {
      // @ts-expect-error — the production clock has no setter in its type.
      clock.set({ at: AT });
    }).toThrow(TypeError);
  });
});
