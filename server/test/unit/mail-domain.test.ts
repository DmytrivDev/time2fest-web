import { describe, expect, it } from 'vitest';
import { brokenUntil } from '../../src/domain/mail/breaker';
import { admit, levelsCrossed } from '../../src/domain/mail/ceiling';
import { classifyMailError } from '../../src/domain/mail/classify';
import { msToUtcMidnight, utcDayKey } from '../../src/domain/mail/day';

describe('classifyMailError', () => {
  it('RCPT TO 550 -> recipient', () => {
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', response: '550 no such user' })).toEqual({ kind: 'recipient' });
  });
  it('EMESSAGE 451 after DATA -> fallback', () => {
    expect(classifyMailError({ code: 'EMESSAGE', responseCode: 451, command: 'DATA' })).toEqual({ kind: 'fallback', broken: 'other' });
  });
  it('5xx daily quota -> fallback quota', () => {
    expect(classifyMailError({ responseCode: 550, command: 'RCPT TO', response: '550 daily quota exceeded' })).toEqual({ kind: 'fallback', broken: 'quota' });
  });
  it('5xx rate text -> fallback other', () => {
    expect(classifyMailError({ responseCode: 554, command: 'DATA', response: 'too many requests' })).toEqual({ kind: 'fallback', broken: 'other' });
  });
  it('EAUTH / ETIMEDOUT / ECONNECTION -> fallback', () => {
    for (const code of ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS']) {
      expect(classifyMailError({ code })).toEqual({ kind: 'fallback', broken: 'other' });
    }
  });
  it('plain 5xx not on RCPT -> fallback', () => {
    expect(classifyMailError({ responseCode: 554, command: 'DATA', response: 'rejected' }).kind).toBe('fallback');
  });
  it('result never carries the response text', () => {
    expect(JSON.stringify(classifyMailError({ responseCode: 550, command: 'RCPT TO', response: 'secret@x.com' }))).not.toContain('secret');
  });
});

describe('breaker and day', () => {
  const now = new Date('2026-12-31T22:30:00Z');
  it('quota until next 00:00 UTC', () => {
    expect(brokenUntil('quota', now)).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
  it('other for 5 minutes', () => {
    expect(brokenUntil('other', now)).toBe(now.getTime() + 300_000);
  });
  it('day key and ms to midnight', () => {
    expect(utcDayKey(now)).toBe('20261231');
    expect(msToUtcMidnight(now)).toBe(90 * 60_000);
    expect(msToUtcMidnight(new Date('2027-01-01T00:00:00Z'))).toBe(86_400_000);
  });
});

describe('admit (ceiling 10)', () => {
  const base = { primaryCeiling: 10, fallbackCeiling: 10, fallbackCount: 0 };
  it('below 80 % both classes primary', () => {
    expect(admit({ ...base, class: 'other', primaryCount: 7 })).toBe('primary');
    expect(admit({ ...base, class: 'code', primaryCount: 7 })).toBe('primary');
  });
  it('at 80 % other refused, code primary', () => {
    expect(admit({ ...base, class: 'other', primaryCount: 8 })).toBe('refuse');
    expect(admit({ ...base, class: 'code', primaryCount: 8 })).toBe('primary');
    expect(admit({ ...base, class: 'code', primaryCount: 9 })).toBe('primary');
  });
  it('at 100 % code goes to fallback, then refuse when both full', () => {
    expect(admit({ ...base, class: 'code', primaryCount: 10 })).toBe('fallback');
    expect(admit({ ...base, class: 'code', primaryCount: 10, fallbackCount: 9 })).toBe('fallback');
    expect(admit({ ...base, class: 'code', primaryCount: 10, fallbackCount: 10 })).toBe('refuse');
    expect(admit({ ...base, class: 'other', primaryCount: 10 })).toBe('refuse');
  });
  it('levelsCrossed fires once at 80 %', () => {
    expect(levelsCrossed(6, 7, 10)).toBe(false);
    expect(levelsCrossed(7, 8, 10)).toBe(true);
    expect(levelsCrossed(8, 9, 10)).toBe(false);
  });
});
