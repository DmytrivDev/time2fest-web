/** Sleep windows and the schedule part of the unattended-mode rule (AC-31, AC-32, AC-33; W41), pure. */
import { describe, expect, it } from 'vitest';
import { desiredState, INITIAL_MODE, manualState, sameMode, transitionCause, type ModeState } from '../../src/domain/unattended/machine';
import { holdActive, holdUntil } from '../../src/domain/unattended/override';
import { activeWindow, nextBoundary, validateWindow, type SleepWindow } from '../../src/domain/unattended/windows';

const H = 3_600_000;
const S = 1_000;
const T = Date.parse('2027-03-01T22:00:00Z');
const W1: SleepWindow = { id: '1', startsAt: T, endsAt: T + 8 * H };
const W2: SleepWindow = { id: '2', startsAt: T + 24 * H, endsAt: T + 32 * H };
const windows = [W1, W2];
const at = (now: number, current: ModeState = INITIAL_MODE) => desiredState({ windows, openPageAlarms: [], now, current });

describe('validateWindow (AC-31)', () => {
  it('end ≤ start → end-not-after-start', () => {
    expect(validateWindow({ startsAt: T, endsAt: T }, [])).toBe('end-not-after-start');
    expect(validateWindow({ startsAt: T, endsAt: T - 1 }, [])).toBe('end-not-after-start');
  });

  it('an overlap with another window → overlaps; touching windows and the row itself do not', () => {
    expect(validateWindow({ startsAt: T + 7 * H, endsAt: T + 9 * H }, windows)).toBe('overlaps');
    expect(validateWindow({ startsAt: T - H, endsAt: T + 1 }, windows)).toBe('overlaps');
    expect(validateWindow({ startsAt: T + H, endsAt: T + 2 * H }, windows)).toBe('overlaps');
    expect(validateWindow({ startsAt: T + 8 * H, endsAt: T + 24 * H }, windows)).toBe('ok');
    expect(validateWindow({ id: '1', startsAt: T + H, endsAt: T + 9 * H }, windows)).toBe('ok');
  });
});

describe('the schedule (AC-32)', () => {
  it('a boundary −1 s → off; a boundary +0 → on; the window end → off', () => {
    expect(at(T - S)).toEqual({ on: false, cause: null, manualAt: null });
    expect(at(T)).toEqual({ on: true, cause: 'schedule', manualAt: null });
    expect(at(W1.endsAt - S)).toEqual({ on: true, cause: 'schedule', manualAt: null });
    expect(at(W1.endsAt)).toEqual({ on: false, cause: null, manualAt: null });
  });

  it('activeWindow and nextBoundary', () => {
    expect(activeWindow(windows, T + H)).toBe(W1);
    expect(activeWindow(windows, W1.endsAt)).toBeNull();
    expect(nextBoundary(windows, T - S)).toBe(T);
    expect(nextBoundary(windows, T)).toBe(W1.endsAt);
    expect(nextBoundary(windows, W1.endsAt)).toBe(W2.startsAt);
    expect(nextBoundary(windows, W2.endsAt)).toBeNull();
  });

  it('the same state again is not a transition', () => {
    const on = at(T);
    expect(sameMode(at(T + H, on), on)).toBe(true);
    expect(transitionCause(on, at(W1.endsAt, on))).toBe('schedule');
  });
});

describe('the manual switch (AC-33, Q5)', () => {
  it('holds until the nearest window boundary, then the schedule applies', () => {
    const off = manualState(false, T + H);
    expect(holdUntil(windows, T + H)).toBe(W1.endsAt);
    expect(at(W1.endsAt - S, off)).toEqual(off);
    expect(at(W1.endsAt, off)).toEqual({ on: false, cause: null, manualAt: null });

    const on = manualState(true, W1.endsAt + H);
    expect(at(W2.startsAt - S, on)).toEqual(on);
    expect(at(W2.startsAt, on)).toEqual({ on: true, cause: 'schedule', manualAt: null });
  });

  it('no boundary after the switch → it holds until the next switch', () => {
    const on = manualState(true, W2.endsAt + H);
    expect(holdActive({ on: true, at: on.manualAt as number }, windows, W2.endsAt + 1000 * H)).toBe(true);
    expect(at(W2.endsAt + 1000 * H, on)).toEqual(on);
  });

  it('a window added after the switch still ends it', () => {
    const on = manualState(true, W2.endsAt + H);
    const later: SleepWindow = { startsAt: W2.endsAt + 5 * H, endsAt: W2.endsAt + 6 * H };
    expect(desiredState({ windows: [...windows, later], openPageAlarms: [], now: later.startsAt, current: on })).toEqual({
      on: true,
      cause: 'schedule',
      manualAt: null,
    });
  });
});
