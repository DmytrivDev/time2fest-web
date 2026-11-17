/** Auto-on after an unacknowledged `page` alarm (AC-34; W43), pure. */
import { describe, expect, it } from 'vitest';
import { ALARM_GRACE_MS, alarmDue } from '../../src/domain/unattended/alarmTrigger';
import { desiredState, INITIAL_MODE, manualState } from '../../src/domain/unattended/machine';

const MIN = 60_000;
const T = Date.parse('2027-03-10T12:00:00Z');
const alarm = { raisedAt: T, acknowledgedAt: null };

describe('alarmDue (AC-34)', () => {
  it('the grace is 15 minutes', () => {
    expect(ALARM_GRACE_MS).toBe(15 * MIN);
  });

  it('T+14:59 → not due; T+15:00 → due; an acknowledged one never', () => {
    expect(alarmDue([alarm], T + 15 * MIN - 1000)).toBe(false);
    expect(alarmDue([alarm], T + 15 * MIN)).toBe(true);
    expect(alarmDue([{ raisedAt: T, acknowledgedAt: T + MIN }], T + 60 * MIN)).toBe(false);
  });

  it('alarms already due at a manual switch are ignored; one due later is not', () => {
    expect(alarmDue([alarm], T + 60 * MIN, T + 20 * MIN)).toBe(false);
    expect(alarmDue([alarm, { raisedAt: T + 10 * MIN, acknowledgedAt: null }], T + 60 * MIN, T + 20 * MIN)).toBe(true);
  });
});

describe('the rule with alarms (AC-34)', () => {
  it('off → on with the cause alarm at T+15:00', () => {
    expect(desiredState({ windows: [], openPageAlarms: [alarm], now: T + 15 * MIN - 1000, current: INITIAL_MODE }).on).toBe(false);
    expect(desiredState({ windows: [], openPageAlarms: [alarm], now: T + 15 * MIN, current: INITIAL_MODE })).toEqual({ on: true, cause: 'alarm', manualAt: null });
  });

  it('a manual on that holds becomes alarm-caused when an alarm becomes due after it', () => {
    const on = manualState(true, T);
    expect(desiredState({ windows: [], openPageAlarms: [alarm], now: T + 15 * MIN, current: on })).toEqual({ on: true, cause: 'alarm', manualAt: null });
  });
});
