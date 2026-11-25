import { describe, expect, it } from 'vitest';
import { isSessionEvent, parseCodeInfo, parseGoogleRedirect, parseSession, parseSignInOutcome } from '../src/authGuard';
import { isProfileEvent, parseProfile, parseScheduleIds } from '../src/profileGuard';
import {
  codeInfoSchema,
  googleRedirectSchema,
  profileEventSchema,
  profileSchema,
  sessionEventSchema,
  sessionSchema,
  signInOutcomeSchema,
} from '../src/schemas';

const settings = { hour12: false, homeCountry: null, homeZoneId: 'z1', showPassport: true, showPath: true, passportHints: true, quietDefault: false, reminderEmails: true };
const code = { email: 'a@b.co', intent: 'signin', sentAt: 1, resendAt: 2, expiresAt: 3, attemptsLeft: 5 };
const session = { user: null, guestId: 'g', hasPass: false, passOn: null, passSince: null, devicePass: null, code: null };
const profile = { nick: 'Ann', flagCode: 'UA', detectedFlag: null, settings, schedule: ['e1'], googleLinked: false, pendingEmail: null };
const m = <T extends object>(o: T, p: Record<string, unknown>) => ({ ...o, ...p });

type Case = [string, unknown, boolean];
function agree(guard: (x: unknown) => unknown, schema: { safeParse(x: unknown): { success: boolean } }, cases: Case[]) {
  for (const [name, sample, valid] of cases) {
    expect(schema.safeParse(sample).success, `schema: ${name}`).toBe(valid);
    expect(Boolean(guard(sample)), `guard: ${name}`).toBe(valid);
  }
}

describe('zod-free guards agree with schemas (SPEC-11 P-14)', () => {
  it('codeInfo', () =>
    agree(parseCodeInfo, codeInfoSchema, [
      ['ok', code, true],
      ['intent', m(code, { intent: 'x' }), false],
      ['attempts 6', m(code, { attemptsLeft: 6 }), false],
      ['extra', m(code, { z: 1 }), false],
      ['bad email', m(code, { email: 'a@' }), false],
      ['negative ms', m(code, { sentAt: -1 }), false],
      ['null', null, false],
    ]));
  it('session', () =>
    agree(parseSession, sessionSchema, [
      ['guest', session, true],
      ['user', m(session, { user: { id: 'u', email: 'a@b.co', via: 'email', signedInAt: 1 } }), true],
      ['pass', m(session, { hasPass: true, passOn: 'device', passSince: 5, passNight: '2026-12', devicePass: { email: 'a@b.co', since: 1 } }), true],
      ['code', m(session, { code }), true],
      ['bad passOn', m(session, { passOn: 'x' }), false],
      ['bad night', m(session, { passNight: '2026' }), false],
      ['missing code', { ...session, code: undefined }, false],
      ['extra', m(session, { z: 1 }), false],
      ['bad via', m(session, { user: { id: 'u', email: 'a@b.co', via: 'x', signedInAt: 1 } }), false],
    ]));
  it('sign-in outcome and google redirect', () => {
    agree(parseSignInOutcome, signInOutcomeSchema, [
      ['ok', { isNew: true, email: 'a@b.co' }, true],
      ['no email', { isNew: true }, false],
      ['extra', { isNew: true, email: 'a@b.co', z: 1 }, false],
    ]);
    agree(parseGoogleRedirect, googleRedirectSchema, [
      ['ok', { kind: 'redirect', url: 'https://x' }, true],
      ['kind', { kind: 'signed-in', url: 'x' }, false],
      ['empty url', { kind: 'redirect', url: '' }, false],
    ]);
  });
  it('session event', () =>
    agree(isSessionEvent, sessionEventSchema, [
      ['ok', { type: 'session', id: 'x', data: { reason: 'pass-attached' } }, true],
      ['email-changed', { type: 'session', id: 'x', data: { reason: 'email-changed' } }, true],
      ['reason', { type: 'session', id: 'x', data: { reason: 'nope' } }, false],
      ['long id', { type: 'session', id: 'x'.repeat(65), data: { reason: 'erased' } }, false],
      ['extra', { type: 'session', id: 'x', data: { reason: 'erased', a: 1 } }, false],
    ]));
  it('profile', () =>
    agree(parseProfile, profileSchema, [
      ['ok', profile, true],
      ['special flag', m(profile, { flagCode: 'GB-ENG', detectedFlag: 'earth' }), true],
      ['pending', m(profile, { pendingEmail: { email: 'a@b.co', sentAt: 1, resendAt: 2, expiresAt: 3, attemptsLeft: 4 } }), true],
      ['6-letter flag', m(profile, { flagCode: 'ABCDEF' }), false],
      ['long nick', m(profile, { nick: 'a'.repeat(65) }), false],
      ['extra setting', m(profile, { settings: { ...settings, z: 1 } }), false],
      ['missing setting', m(profile, { settings: { hour12: true } }), false],
      ['bad home', m(profile, { settings: { ...settings, homeCountry: 'ua' } }), false],
      ['513 ids', m(profile, { schedule: Array.from({ length: 513 }, (_, i) => `e${i}`) }), false],
      ['extra', m(profile, { z: 1 }), false],
    ]));
  it('profile event and schedule ids', () => {
    agree(isProfileEvent, profileEventSchema, [
      ['ok', { type: 'profile', id: 'x', data: {} }, true],
      ['data', { type: 'profile', id: 'x', data: { a: 1 } }, false],
      ['type', { type: 'session', id: 'x', data: {} }, false],
    ]);
    expect(parseScheduleIds(['a'])).toEqual(['a']);
    expect(parseScheduleIds([1])).toBeNull();
    expect(parseScheduleIds(Array(513).fill('a'))).toBeNull();
  });
});
