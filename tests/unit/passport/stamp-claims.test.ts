/** AC-60: the claimer removes a local stamp only on forbidden/no-presence, honours retryAfterMs, settles on other final answers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type ApiResult } from '@/lib/api/result';
import type { Stamp } from '@/lib/data/types';
import { createStampClaimer, type PendingClaim } from '@/lib/passport/stampClaims';

const T0 = Date.UTC(2027, 0, 1, 0, 0, 15);
const STAMP: Stamp = { eventId: 'evt_london_2027', grantedAt: T0, presenceSource: 'air', illustrationId: 'gb', cityName: 'London', countryIso: 'GB' };

function setup(answers: (() => ApiResult<unknown>)[], saved: PendingClaim[] = []) {
  let stored: readonly PendingClaim[] = saved;
  const claim = vi.fn(async () => (answers.shift() ?? (() => ok(STAMP)))());
  const make = () =>
    createStampClaimer({
      claim,
      now: () => Date.now(),
      load: () => stored.map((p) => ({ ...p })),
      save: (l) => {
        stored = l.map((p) => ({ ...p }));
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    });
  return { claimer: make(), claim, make, stored: () => stored };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('claimer: final answers', () => {
  it('no-presence removes the stamp', async () => {
    const { claimer } = setup([() => fail('forbidden', { reason: 'no-presence' })]);
    claimer.add(STAMP);
    await flush();
    expect(claimer.snapshot().pending).toEqual([]);
  });

  it.each([
    ['claim-closed', () => fail('conflict', { reason: 'claim-closed' })],
    ['unknown-event', () => fail('not_found', { reason: 'unknown-event' })],
    ['validation', () => fail('validation', { reason: 'invalid-input' })],
    ['forbidden without reason', () => fail('forbidden')],
  ])('%s keeps the stamp and makes no further calls, even after resume', async (_n, answer) => {
    const { claimer, claim, make, stored } = setup([answer]);
    claimer.add(STAMP);
    await flush();
    expect(claimer.snapshot().pending.map((p) => p.stamp.eventId)).toEqual([STAMP.eventId]);
    await vi.advanceTimersByTimeAsync(120_000);
    claimer.retryNow();
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(stored()[0]?.settled).toBe(true);
    // "reload": a fresh claimer reads the persisted entry
    const again = make();
    again.resume();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(again.snapshot().pending).toHaveLength(1);
  });

  it('reads v1 entries (no settled field) and retries them', async () => {
    const saved: PendingClaim[] = [{ stamp: STAMP, since: T0 - 1000, attempts: 2 }];
    const { claimer, claim } = setup([], saved);
    claimer.resume();
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claimer.snapshot().pending).toEqual([]);
  });
});

describe('claimer: retryAfterMs', () => {
  it('9000 ms: next attempt not before 9 s, even on retryNow', async () => {
    const { claimer, claim } = setup([() => fail('unavailable', { retryAfterMs: 9000 })]);
    claimer.add(STAMP);
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    claimer.retryNow();
    await vi.advanceTimersByTimeAsync(8_900);
    expect(claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claimer.snapshot().pending).toEqual([]);
  });

  it('without retryAfterMs: fixed backoff 2 s', async () => {
    const { claim, claimer } = setup([() => fail('network')]);
    claimer.add(STAMP);
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(claim).toHaveBeenCalledTimes(2);
  });
});
