import { describe, expect, it } from 'vitest';
import {
  STAMP_DELAY,
  isPresentByPulses,
  presenceMoment,
  presenceOf,
  presentEvents,
  stampAcceptUntil,
  stampGrantedAt,
} from '@time2fest/rules/time';

const SEC = 1_000;
const MIN = 60 * SEC;
const M = Date.parse('2027-01-01T00:00:00Z');
const I = 20 * SEC;
const D = 1500;

const at = (receivedAt: number) => isPresentByPulses({ moment: M, pulses: [{ receivedAt }], intervalMs: I, delta: D });

describe('AC-24 pulse window [m − 2·I − Δ; m + 15 s + Δ], closed', () => {
  it('lower edge', () => {
    expect(at(M - 41_500)).toBe(true);
    expect(at(M - 41_501)).toBe(false);
  });
  it('upper edge', () => {
    expect(at(M + 16_500)).toBe(true);
    expect(at(M + 16_501)).toBe(false);
  });
  it('no pulses — not present', () => {
    expect(isPresentByPulses({ moment: M, pulses: [], intervalMs: I, delta: D })).toBe(false);
  });
  it('one pulse inside among pulses outside is enough', () => {
    const pulses = [{ receivedAt: M - 10 * MIN }, { receivedAt: M + 5 * SEC }, { receivedAt: M + 10 * MIN }];
    expect(isPresentByPulses({ moment: M, pulses, intervalMs: I, delta: D })).toBe(true);
  });
  it('Δ defaults to 0', () => {
    expect(isPresentByPulses({ moment: M, pulses: [{ receivedAt: M - 40_000 }], intervalMs: I })).toBe(true);
    expect(isPresentByPulses({ moment: M, pulses: [{ receivedAt: M - 40_001 }], intervalMs: I })).toBe(false);
    expect(isPresentByPulses({ moment: M, pulses: [{ receivedAt: M + 15_000 }], intervalMs: I })).toBe(true);
    expect(isPresentByPulses({ moment: M, pulses: [{ receivedAt: M + 15_001 }], intervalMs: I })).toBe(false);
  });
});

describe('AC-25 client time fields never widen the window', () => {
  it('received at m + 30 s with openedAt m − 10 min and at m — not counted', () => {
    const pulses = [{ receivedAt: M + 30 * SEC, openedAt: M - 10 * MIN, at: M }];
    expect(isPresentByPulses({ moment: M, pulses, intervalMs: I, delta: D })).toBe(false);
  });
  it('client fields outside the window do not remove a pulse received inside it', () => {
    const pulses = [{ receivedAt: M, openedAt: M + 10 * MIN, at: M + 10 * MIN }];
    expect(isPresentByPulses({ moment: M, pulses, intervalMs: I, delta: D })).toBe(true);
  });
});

describe('AC-22 Δ and I validation', () => {
  const pulses = [{ receivedAt: M }];
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('Δ = %s throws RangeError', (delta) => {
    expect(() => isPresentByPulses({ moment: M, pulses, intervalMs: I, delta })).toThrow(RangeError);
    expect(() => stampAcceptUntil(M, delta)).toThrow(RangeError);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('I = %s throws RangeError', (intervalMs) => {
    expect(() => isPresentByPulses({ moment: M, pulses, intervalMs })).toThrow(RangeError);
  });
});

describe('AC-26 stamp moment', () => {
  it('grantedAt = m + 15 s for presence at m + 14 s', () => {
    const surface = { source: 'air' as const, eventIds: ['e'], openedAt: M + 14 * SEC };
    const ev = { id: 'e', midnightUtc: '2027-01-01T00:00:00Z' };
    expect(presenceMoment(surface, ev)).toBe(M + 14 * SEC);
    expect(stampGrantedAt(M)).toBe(M + 15 * SEC);
    expect(stampGrantedAt(M)).toBe(M + STAMP_DELAY);
  });
  it('stamp accept bound moves by Δ', () => {
    expect(stampAcceptUntil(M)).toBe(M + STAMP_DELAY);
    expect(stampAcceptUntil(M, D)).toBe(M + STAMP_DELAY + D);
  });
});

describe('AC-23 client surface rule (as on master)', () => {
  const ev = { id: 'e', midnightUtc: '2027-01-01T00:00:00Z' };
  const open = (openedAt: number, closedAt?: number) => ({ source: 'room' as const, eventIds: ['e'], openedAt, closedAt });
  it('present from m when open before midnight', () => {
    expect(presenceOf(open(M - MIN), M - 1, ev)).toBeNull();
    expect(presenceOf(open(M - MIN), M, ev)).toBe('room');
  });
  it('opened within 15 s after midnight counts from opening', () => {
    expect(presenceOf(open(M + 15 * SEC), M + 15 * SEC - 1, ev)).toBeNull();
    expect(presenceOf(open(M + 15 * SEC), M + 15 * SEC, ev)).toBe('room');
    expect(presenceOf(open(M + 15 * SEC + 1), M + MIN, ev)).toBeNull();
  });
  it('closed before midnight — absent; closed at midnight — present', () => {
    expect(presenceOf(open(M - MIN, M - 1), M + SEC, ev)).toBeNull();
    expect(presenceOf(open(M - MIN, M), M + SEC, ev)).toBe('room');
  });
  it('a surface not showing the event — absent', () => {
    expect(presenceOf({ source: 'tv', eventIds: ['x'], openedAt: M - MIN }, M, ev)).toBeNull();
  });
  it('presence moment is max(m, openedAt)', () => {
    expect(presenceMoment(open(M - MIN), ev)).toBe(M);
  });
  it('presentEvents picks the highest-priority source', () => {
    const surfaces = [
      { source: 'tv' as const, eventIds: ['e'], openedAt: M - MIN },
      { source: 'country' as const, eventIds: ['e'], openedAt: M - MIN },
      { source: 'air' as const, eventIds: ['e'], openedAt: M - MIN },
    ];
    expect(presentEvents(surfaces, [ev], M)).toEqual({ e: 'country' });
  });
});
