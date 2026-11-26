import { describe, expect, it } from 'vitest';
import { PROFILE_REASONS, PROFILE_SETTINGS_KEYS, SPECIAL_FLAG_CODES } from '../src/profile';
import {
  emailChangeBody,
  emailVerifyBody,
  nickCheckBody,
  profileEventSchema,
  profilePatchBody,
  profileSettingsSchema,
  scheduleBody,
  scheduleReplaceBody,
  scheduleToggleBody,
} from '../src/schemas';

const settings = {
  hour12: false,
  homeCountry: 'UA',
  homeZoneId: null,
  showPassport: true,
  showPath: true,
  passportHints: true,
  quietDefault: false,
  reminderEmails: true,
};

// SPEC-11 AC-59 / AC-36 / NFR-4
describe('profile wire schemas', () => {
  it('pins reasons, settings keys and special flags', () => {
    expect([...PROFILE_REASONS]).toEqual(['google-taken', 'last-method', 'same-email', 'schedule-full', 'taken']);
    expect([...PROFILE_SETTINGS_KEYS].sort()).toEqual(Object.keys(settings).sort());
    expect(SPECIAL_FLAG_CODES).toContain('GB-ENG');
  });
  it('settings strict; patch settings partial', () => {
    expect(profileSettingsSchema.safeParse(settings).success).toBe(true);
    expect(profileSettingsSchema.safeParse({ ...settings, extra: 1 }).success).toBe(false);
    expect(profilePatchBody.safeParse({ settings: { hour12: true } }).success).toBe(true);
    expect(profilePatchBody.safeParse({ settings: { hour12: true, extra: 1 } }).success).toBe(false);
    expect(profilePatchBody.safeParse({ settings: { homeCountry: 'ua' } }).success).toBe(false);
  });
  it('patch rejects extra keys, 6-letter flag, 4.1 KB nick; accepts detectedFlag', () => {
    expect(profilePatchBody.safeParse({ nick: 'Ann', flagCode: 'UA', detectedFlag: 'PL' }).success).toBe(true);
    expect(profilePatchBody.safeParse({ flagCode: 'GB-ENG' }).success).toBe(true);
    expect(profilePatchBody.safeParse({ nick: 'a', x: 1 }).success).toBe(false);
    expect(profilePatchBody.safeParse({ flagCode: 'ABCDEF' }).success).toBe(false);
    expect(profilePatchBody.safeParse({ nick: 'a'.repeat(4100) }).success).toBe(false);
  });
  it('schedule bodies', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);
    expect(scheduleBody.safeParse({ eventIds: ids(512) }).success).toBe(true);
    expect(scheduleBody.safeParse({ eventIds: ids(513) }).success).toBe(false);
    expect(scheduleToggleBody.safeParse({ eventId: 'e1' }).success).toBe(true);
    expect(scheduleToggleBody.safeParse({}).success).toBe(false);
    expect(scheduleReplaceBody.safeParse({ outIso: 'PL', eventId: 'e1' }).success).toBe(true);
    expect(scheduleReplaceBody.safeParse({ outIso: 'PL' }).success).toBe(false);
  });
  it('email and nick bodies', () => {
    expect(emailChangeBody.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(emailChangeBody.safeParse({ email: 'a'.repeat(250) + '@b.co' }).success).toBe(false);
    expect(emailVerifyBody.safeParse({ code: '123456' }).success).toBe(true);
    expect(emailVerifyBody.safeParse({ code: '12345a' }).success).toBe(false);
    expect(nickCheckBody.safeParse({ nick: 'Ann' }).success).toBe(true);
  });
  it('profile event', () => {
    expect(profileEventSchema.safeParse({ type: 'profile', id: 'x', data: {} }).success).toBe(true);
    expect(profileEventSchema.safeParse({ type: 'profile', id: 'x', data: { a: 1 } }).success).toBe(false);
  });
});
