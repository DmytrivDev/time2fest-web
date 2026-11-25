/**
 * SPEC-11 W11 — pure pass rules: the holiday of a pass (AC-13, AC-14, AC-15, EC-12, open question 3) and the session
 * view of every FR-ID-14 row (AC-1, AC-3 … AC-9).
 */
import { describe, expect, it } from 'vitest';
import { firstOpenSeason, isActive, nextSeasonKey, passSeason, seasonEndMs, seasonKeyOfEnd } from '../../src/domain/rights/passSeason';
import { passView, type ActiveDevicePass, type ActivePass } from '../../src/domain/rights/passView';

const END = Date.parse('2027-01-15T00:00:00Z');
const ctx = { currentKey: '2026-27', currentEndMs: END };
const DAY = 86_400_000;

describe('pass holiday (FR-ID-15)', () => {
  it('next key and the key of an end instant', () => {
    expect(nextSeasonKey('2026-27')).toBe('2027-28');
    expect(nextSeasonKey('2099-00')).toBe('2100-01');
    expect(seasonKeyOfEnd(END)).toBe('2026-27');
    expect(() => nextSeasonKey('2026')).toThrow();
  });

  it('season ends shift by whole calendar years', () => {
    expect(seasonEndMs('2026-27', ctx)).toBe(END);
    expect(seasonEndMs('2027-28', ctx)).toBe(Date.parse('2028-01-15T00:00:00Z'));
    expect(seasonEndMs('2025-26', ctx)).toBe(Date.parse('2026-01-15T00:00:00Z'));
  });

  it('issued before and during the holiday → current season (AC-13)', () => {
    expect(passSeason(Date.parse('2026-11-26T12:00:00Z'), ctx)).toBe('2026-27');
    expect(passSeason(Date.parse('2027-01-01T00:00:00Z'), ctx)).toBe('2026-27');
    expect(passSeason(END - 1, ctx)).toBe('2026-27');
  });

  it('issued at or after the end → next season (AC-14), active at once (open question 3)', () => {
    expect(passSeason(END, ctx)).toBe('2027-28');
    expect(passSeason(END + 30 * DAY, ctx)).toBe('2027-28');
    const at = END + 1000;
    expect(isActive({ season: passSeason(at, ctx) }, at, ctx)).toBe(true);
    expect(firstOpenSeason(Date.parse('2028-02-01T00:00:00Z'), ctx)).toBe('2028-29');
  });

  it('active until the end of its holiday; +1 s after the end inactive (AC-15)', () => {
    const pass = { season: '2026-27' };
    expect(isActive(pass, END - 1, ctx)).toBe(true);
    expect(isActive(pass, END, ctx)).toBe(false);
    expect(isActive(pass, END + 1000, ctx)).toBe(false);
    expect(isActive({ season: '2026-27', revokedAt: END - DAY }, END - 1, ctx)).toBe(false);
    expect(isActive({ season: '2026-27', erasedAt: END - DAY }, END - 1, ctx)).toBe(false);
  });

  it('expired pass + next purchase → the next one is active (EC-12)', () => {
    const now = END + DAY;
    expect(isActive({ season: '2026-27' }, now, ctx)).toBe(false);
    expect(isActive({ season: passSeason(now, ctx) }, now, ctx)).toBe(true);
  });
});

describe('session pass view — FR-ID-14 rows', () => {
  const acc: ActivePass = { since: 1_000, season: '2026-27' };
  const dev: ActiveDevicePass = { since: 2_000, season: '2026-27', email: 'pay@example.test' };
  const none = { hasPass: false, passOn: null, passSince: null, devicePass: null };

  it('row 1: guest, no device pass', () => {
    expect(passView({ accountPass: null, devicePass: null, signedIn: false })).toEqual(none);
  });
  it('row 2: guest, unattached device pass', () => {
    expect(passView({ accountPass: null, devicePass: dev, signedIn: false })).toEqual({
      hasPass: true, passOn: 'device', passSince: 2_000, passNight: '2026-27', devicePass: { email: dev.email, since: 2_000 },
    });
  });
  it('row 3: account without pass, no device pass', () => {
    expect(passView({ accountPass: null, devicePass: null, signedIn: true })).toEqual(none);
  });
  it('row 4: account signed in on a device with a pass (attached)', () => {
    expect(passView({ accountPass: acc, devicePass: null, signedIn: true })).toEqual({
      hasPass: true, passOn: 'account', passSince: 1_000, passNight: '2026-27', devicePass: null,
    });
  });
  it('row 5: account with own pass on a device with an unattached pass', () => {
    expect(passView({ accountPass: acc, devicePass: dev, signedIn: true })).toEqual({
      hasPass: true, passOn: 'account', passSince: 1_000, passNight: '2026-27', devicePass: { email: dev.email, since: 2_000 },
    });
  });
  it('row 6: signed out of the account the device pass was attached to', () => {
    expect(passView({ accountPass: null, devicePass: null, signedIn: false })).toEqual(none);
  });
  it('row 7: signed out of an account with its own pass; unattached device pass', () => {
    expect(passView({ accountPass: null, devicePass: dev, signedIn: false })).toEqual({
      hasPass: true, passOn: 'device', passSince: 2_000, passNight: '2026-27', devicePass: { email: dev.email, since: 2_000 },
    });
  });
  it('row 8: the device pass was attached by email elsewhere — session on the first device', () => {
    expect(passView({ accountPass: null, devicePass: null, signedIn: false })).toEqual(none);
    expect(passView({ accountPass: null, devicePass: null, signedIn: true })).toEqual(none);
  });
  it('an account pass is never read for a guest; account without pass uses the device pass (AC-4)', () => {
    expect(passView({ accountPass: acc, devicePass: null, signedIn: false })).toEqual(none);
    expect(passView({ accountPass: null, devicePass: dev, signedIn: true }).passOn).toBe('device');
  });
});
