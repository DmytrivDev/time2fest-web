/** SPEC-11 W15 — the pure blocked verdict (AC-18, AC-21, AC-24). */
import { describe, expect, it } from 'vitest';
import { blockedVerdict, nextUtcMidnight, type BlockedInput } from '../../src/domain/rights/blocked';

const NOW = Date.parse('2026-12-31T18:00:00Z');
const MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
const base: BlockedInput = {
  subjectKind: 'guest',
  subjectBan: null,
  deviceBan: false,
  ipDayMarkAtMs: null,
  guestCreatedAtMs: null,
  nextUtcMidnightMs: MIDNIGHT,
};

describe('blockedVerdict', () => {
  it('nobody banned → not blocked', () => {
    expect(blockedVerdict(base)).toEqual({ blocked: false });
  });

  it('account ban → kind account, no term', () => {
    expect(blockedVerdict({ ...base, subjectKind: 'account', subjectBan: 'account' })).toEqual({ blocked: true, kind: 'account', until: null });
  });

  it('guest ban → kind guest, no term', () => {
    expect(blockedVerdict({ ...base, subjectBan: 'guest' })).toEqual({ blocked: true, kind: 'guest', until: null });
  });

  it('device ban → kind device; the subject ban wins over it', () => {
    expect(blockedVerdict({ ...base, deviceBan: true })).toEqual({ blocked: true, kind: 'device', until: null });
    expect(blockedVerdict({ ...base, subjectKind: 'account', subjectBan: 'account', deviceBan: true })).toMatchObject({ kind: 'account' });
  });

  it('a guest created after the mark → ip-day until the next 00:00 UTC', () => {
    expect(blockedVerdict({ ...base, ipDayMarkAtMs: NOW, guestCreatedAtMs: NOW + 1 })).toEqual({ blocked: true, kind: 'ip-day', until: MIDNIGHT });
  });

  it('a guest created before or at the mark (its own request wrote it) → not blocked', () => {
    expect(blockedVerdict({ ...base, ipDayMarkAtMs: NOW, guestCreatedAtMs: NOW - 1 })).toEqual({ blocked: false });
    expect(blockedVerdict({ ...base, ipDayMarkAtMs: NOW, guestCreatedAtMs: NOW })).toEqual({ blocked: false });
  });

  it('an account on a marked fingerprint → not blocked', () => {
    expect(blockedVerdict({ ...base, subjectKind: 'account', ipDayMarkAtMs: NOW, guestCreatedAtMs: NOW + 1 })).toEqual({ blocked: false });
  });

  it('a guest of unknown creation → not blocked by ip-day', () => {
    expect(blockedVerdict({ ...base, ipDayMarkAtMs: NOW })).toEqual({ blocked: false });
  });

  it('a ban 400 days later still has no term (AC-21)', () => {
    const later = NOW + 400 * 86_400_000;
    expect(blockedVerdict({ ...base, subjectKind: 'account', subjectBan: 'account', nextUtcMidnightMs: nextUtcMidnight(later) })).toEqual({
      blocked: true,
      kind: 'account',
      until: null,
    });
  });

  it('nextUtcMidnight: strictly after, also at 23:59 and at 00:00', () => {
    expect(nextUtcMidnight(NOW)).toBe(MIDNIGHT);
    expect(nextUtcMidnight(MIDNIGHT - 60_000)).toBe(MIDNIGHT);
    expect(nextUtcMidnight(MIDNIGHT)).toBe(MIDNIGHT + 86_400_000);
  });
});
