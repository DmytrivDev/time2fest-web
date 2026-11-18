import { describe, expect, it } from 'vitest';
import {
  ClockControlBodySchema,
  ClockEventSchema,
  FaultDoorBodySchema,
  LeaseDoorBodySchema,
  NightRunBodySchema,
} from '../src/schemas';
import { EDGE_NOW_HEADER } from '../src';

describe('clock wire schemas (SPEC-07, AC-69)', () => {
  it('parses valid bodies and defaults the night-run speed to 60', () => {
    expect(NightRunBodySchema.parse({})).toEqual({ speed: 60 });
    expect(NightRunBodySchema.parse({ speed: 600, from: 0, to: 10 }).speed).toBe(600);
    expect(LeaseDoorBodySchema.parse({ action: 'pause' })).toEqual({ action: 'pause' });
    expect(FaultDoorBodySchema.parse({ after: 'publish', action: 'x' }).after).toBe('publish');
    expect(ClockControlBodySchema.parse({ action: 'set', at: 5 })).toEqual({ action: 'set', at: 5 });
    expect(ClockControlBodySchema.parse({ action: 'real' })).toEqual({ action: 'real' });
    expect(ClockControlBodySchema.parse({ action: 'restart-night' }).action).toBe('restart-night');
    expect(
      ClockEventSchema.parse({ type: 'clock', id: 'clock:2:7', data: { virtual: true, speed: 60 } }).id,
    ).toBe('clock:2:7');
    expect(EDGE_NOW_HEADER).toBe('x-t2f-edge-now');
  });

  it('rejects unknown fields', () => {
    expect(NightRunBodySchema.safeParse({ speed: 60, extra: 1 }).success).toBe(false);
    expect(LeaseDoorBodySchema.safeParse({ action: 'pause', x: 1 }).success).toBe(false);
    expect(FaultDoorBodySchema.safeParse({ after: 'publish', x: 1 }).success).toBe(false);
    expect(ClockControlBodySchema.safeParse({ action: 'real', x: 1 }).success).toBe(false);
  });

  it('rejects speed 601, speed 0 in night-run and a negative from', () => {
    expect(NightRunBodySchema.safeParse({ speed: 601 }).success).toBe(false);
    expect(NightRunBodySchema.safeParse({ speed: 0 }).success).toBe(false);
    expect(NightRunBodySchema.safeParse({ from: -1 }).success).toBe(false);
    expect(ClockControlBodySchema.safeParse({ action: 'set', at: -1 }).success).toBe(false);
  });
});
