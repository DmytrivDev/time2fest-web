/** Exit rule of the alarm-caused unattended mode (AC-35, Q4; W44), pure. */
import { describe, expect, it } from 'vitest';
import { alarmModeEnds } from '../../src/domain/unattended/alarmExit';
import { desiredState, manualState, transitionCause, type ModeState } from '../../src/domain/unattended/machine';

const MIN = 60_000;
const H = 60 * MIN;
const T = Date.parse('2027-03-10T12:00:00Z');
const ON_ALARM: ModeState = { on: true, cause: 'alarm', manualAt: null };
const a1 = { raisedAt: T, acknowledgedAt: null };
const a2 = { raisedAt: T + 30 * MIN, acknowledgedAt: null };

describe('alarmModeEnds (AC-35)', () => {
  it('ends only when no unacknowledged alarm is left', () => {
    expect(alarmModeEnds([a1, a2])).toBe(false);
    expect(alarmModeEnds([{ ...a1, acknowledgedAt: T + H }, a2])).toBe(false);
    expect(alarmModeEnds([])).toBe(true);
    expect(alarmModeEnds([{ ...a1, acknowledgedAt: T + H }])).toBe(true);
  });
});

describe('the rule in the alarm-caused mode (AC-35)', () => {
  it('+2 h of quiet with the alarm open → still on (no timeout)', () => {
    expect(desiredState({ windows: [], openPageAlarms: [a1], now: T + 2 * H + 15 * MIN, current: ON_ALARM })).toEqual(ON_ALARM);
    expect(desiredState({ windows: [], openPageAlarms: [a1], now: T + 1000 * H, current: ON_ALARM })).toEqual(ON_ALARM);
  });

  it('one of two acknowledged → still on; all acknowledged → off, the event cause is alarm', () => {
    expect(desiredState({ windows: [], openPageAlarms: [a2], now: T + 3 * H, current: ON_ALARM })).toEqual(ON_ALARM);
    const off = desiredState({ windows: [], openPageAlarms: [], now: T + 3 * H, current: ON_ALARM });
    expect(off).toEqual({ on: false, cause: null, manualAt: null });
    expect(transitionCause(ON_ALARM, off)).toBe('alarm');
  });

  it('all acknowledged inside a sleep window → the schedule keeps it on', () => {
    const windows = [{ startsAt: T, endsAt: T + 8 * H }];
    expect(desiredState({ windows, openPageAlarms: [], now: T + 3 * H, current: ON_ALARM })).toEqual({ on: true, cause: 'schedule', manualAt: null });
  });

  it('a manual off with the alarm still open → off, and it stays off', () => {
    const off = manualState(false, T + 20 * MIN);
    expect(desiredState({ windows: [], openPageAlarms: [a1], now: T + 2 * H, current: off })).toEqual(off);
  });
});
