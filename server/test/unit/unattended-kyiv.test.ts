/** Kyiv wall-clock input of sleep windows (AC-31, Q5; W42), pure. */
import { describe, expect, it } from 'vitest';
import { kyivLocalToUtc, utcToKyivLocal } from '../../src/domain/unattended/kyiv';

const utc = (text: string) => new Date(kyivLocalToUtc(text) as number).toISOString();

describe('kyivLocalToUtc', () => {
  it('31.12 → 01.01 (winter time, UTC+2)', () => {
    expect(utc('2026-12-31T23:00')).toBe('2026-12-31T21:00:00.000Z');
    expect(utc('2027-01-01T01:00')).toBe('2026-12-31T23:00:00.000Z');
    expect(utc('2027-01-01T00:00')).toBe('2026-12-31T22:00:00.000Z');
  });

  it('summer time is UTC+3', () => {
    expect(utc('2027-07-01T12:00')).toBe('2027-07-01T09:00:00.000Z');
  });

  it('spring change (28.03.2027, 03:00 → 04:00): before, the skipped hour, after', () => {
    expect(utc('2027-03-28T02:59')).toBe('2027-03-28T00:59:00.000Z');
    expect(utc('2027-03-28T03:30')).toBe('2027-03-28T01:30:00.000Z');
    expect(utc('2027-03-28T04:00')).toBe('2027-03-28T01:00:00.000Z');
  });

  it('autumn change (31.10.2027, 04:00 → 03:00): the repeated hour takes the earlier instant', () => {
    expect(utc('2027-10-31T02:59')).toBe('2027-10-30T23:59:00.000Z');
    expect(utc('2027-10-31T03:30')).toBe('2027-10-31T00:30:00.000Z');
    expect(utc('2027-10-31T04:00')).toBe('2027-10-31T02:00:00.000Z');
  });

  it('malformed or impossible input → null', () => {
    for (const bad of ['', '2027-02-30T10:00', '2027-13-01T10:00', '2027-01-01T24:00', '2027-01-01 10:00', '2027-01-01T10:00Z', '2027-01-01T10:00:00']) {
      expect(kyivLocalToUtc(bad)).toBeNull();
    }
  });

  it('round trip through utcToKyivLocal', () => {
    for (const text of ['2026-12-31T23:00', '2027-01-01T01:00', '2027-07-01T12:00', '2027-03-28T04:00']) {
      expect(utcToKyivLocal(kyivLocalToUtc(text) as number)).toBe(text);
    }
  });
});
