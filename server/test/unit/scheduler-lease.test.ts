import { describe, expect, it } from 'vitest';
import {
  applyRenew,
  holds,
  LEASE_RENEW_MS,
  LEASE_SAFETY_MS,
  LEASE_TERM_MS,
  mayAct,
  NO_LEASE,
  type LeaseView,
  type RenewOutcome,
} from '../../src/domain/scheduler/lease';
import { initialState, now as serverNow, testSet, type VirtualState } from '../../src/domain/timekeeping/virtual';

const granted = (epoch: number, expiresInMs = LEASE_TERM_MS): RenewOutcome => ({ ok: true, held: true, epoch, expiresInMs });

describe('scheduler lease — term by the monotonic clock only (AC-46, AC-47)', () => {
  it('acts from the grant until term − safety margin, never before the grant', () => {
    const term = { grantedAtMono: 1_000, termMs: LEASE_TERM_MS };
    expect(mayAct({ ...term, nowMono: 999 })).toBe(false);
    expect(mayAct({ ...term, nowMono: 1_000 })).toBe(true);
    expect(mayAct({ ...term, nowMono: 1_000 + LEASE_TERM_MS - LEASE_SAFETY_MS - 1 })).toBe(true);
    expect(mayAct({ ...term, nowMono: 1_000 + LEASE_TERM_MS - LEASE_SAFETY_MS })).toBe(false);
  });

  it('the local term never exceeds what the database granted', () => {
    const { view } = applyRenew(NO_LEASE, granted(1, 3_000), 0);
    expect(view.termMs).toBe(3_000);
    expect(holds(view, 2_499)).toBe(true);
    expect(holds(view, 2_500)).toBe(false);
    expect(applyRenew(NO_LEASE, granted(1, 60_000), 0).view.termMs).toBe(LEASE_TERM_MS);
  });

  /**
   * One simulated process: ticks every 250 ms of real (monotonic) time, renews every 2 s, and asks
   * whether it may act. `virtualAt(mono)` is the server clock, which the lease must ignore.
   */
  function simulate(storeUpTo: number, virtualAt: (mono: number) => number, until = 12_000) {
    let view: LeaseView = NO_LEASE;
    const actable: number[] = [];
    const seen: number[] = [];
    for (let mono = 0; mono <= until; mono += 250) {
      if (mono % LEASE_RENEW_MS === 0) view = applyRenew(view, mono <= storeUpTo ? granted(1) : { ok: false }, mono).view;
      seen.push(virtualAt(mono));
      if (holds(view, mono)) actable.push(mono);
    }
    return { actable, seen };
  }

  it('AC-46: a failing store → no action once the term since the last good renew is over', () => {
    const { actable } = simulate(4_000, (mono) => mono);
    expect(actable.at(-1)).toBe(4_000 + LEASE_TERM_MS - LEASE_SAFETY_MS - 250);
    expect(actable.every((mono) => mono < 4_000 + LEASE_TERM_MS - LEASE_SAFETY_MS)).toBe(true);
  });

  it('AC-47: speed 600 and a +1 h virtual jump do not change the term', () => {
    const real = simulate(4_000, (mono) => mono);
    let state: VirtualState = testSet(initialState(0), { speed: 600 }, 0);
    const fast = simulate(4_000, (mono) => {
      if (mono === 3_000) state = testSet(state, { at: serverNow(state, mono) + 3_600_000 }, mono);
      return serverNow(state, mono);
    });
    expect(fast.seen.at(-1)! - real.seen.at(-1)!).toBeGreaterThan(3_600_000);
    expect(fast.actable).toEqual(real.actable);
  });
});

describe('scheduler lease — renew outcomes (AC-42, AC-48)', () => {
  it('first grant and takeover are `acquired` with the previous holder and the new epoch', () => {
    const first = applyRenew(NO_LEASE, { ok: true, held: true, epoch: 4, expiresInMs: LEASE_TERM_MS, previousHolder: 'node-a' }, 10);
    expect(first.change).toBe('acquired');
    expect(first.takeover).toEqual({ previousHolder: 'node-a', epoch: 4 });
    expect(first.view).toEqual({ held: true, epoch: 4, grantedAtMono: 10, termMs: LEASE_TERM_MS });

    const renewed = applyRenew(first.view, granted(4), 2_010);
    expect(renewed.change).toBe('renewed');
    expect(renewed.takeover).toBeUndefined();
    expect(renewed.view.grantedAtMono).toBe(2_010);

    expect(applyRenew(renewed.view, granted(5), 4_010).change).toBe('acquired');
  });

  it('lost, standby and unreachable', () => {
    const held = applyRenew(NO_LEASE, granted(2), 0).view;
    const lost = applyRenew(held, { ok: true, held: false, epoch: 3, expiresInMs: 0 }, 2_000);
    expect(lost.change).toBe('lost');
    expect(holds(lost.view, 2_000)).toBe(false);
    expect(applyRenew(lost.view, { ok: true, held: false, epoch: 3, expiresInMs: 0 }, 4_000).change).toBe('standby');
    const down = applyRenew(held, { ok: false }, 2_000);
    expect(down.change).toBe('unreachable');
    expect(down.view).toBe(held);
  });
});
