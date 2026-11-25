import { describe, expect, it } from 'vitest';
import { AUTH_REASONS } from '../src/auth';
import {
  authExpireCodeDoor,
  authGoogleUserDoor,
  authLastCodeDoor,
  googleBody,
  mailCounterDoor,
  requestCodeBody,
  sessionEventSchema,
  sessionSchema,
  verifyCodeBody,
} from '../src/schemas';

const ok = 'a@b.co';
// SPEC-10 AC-51: additive auth reasons, body schemas and the session event.
describe('auth wire schemas (AC-51)', () => {
  it('AUTH_REASONS members', () => {
    expect([...AUTH_REASONS]).toEqual(['cancelled', 'email', 'expired', 'too-many', 'too-many-attempts', 'wait', 'wrong-code']);
  });
  it('requestCodeBody', () => {
    expect(requestCodeBody.safeParse({ email: ok, intent: 'signin' }).success).toBe(true);
    const long = 'a'.repeat(250) + '@b.co';
    for (const bad of [
      { email: 'a@', intent: 'signin' },
      { email: '', intent: 'signin' },
      { email: long, intent: 'signin' },
      { email: ok, intent: 'other' },
      { email: ok, intent: 'signup', extra: 1 },
    ])
      expect(requestCodeBody.safeParse(bad).success).toBe(false);
  });
  it('verifyCodeBody', () => {
    expect(verifyCodeBody.safeParse({ email: ok, otp: '123456' }).success).toBe(true);
    for (const otp of ['12345a', '12345', '1234567', ''])
      expect(verifyCodeBody.safeParse({ email: ok, otp }).success).toBe(false);
    expect(verifyCodeBody.safeParse({ email: ok, otp: '123456', x: 1 }).success).toBe(false);
  });
  it('googleBody', () => {
    expect(googleBody.safeParse({ returnPath: '/uk/' }).success).toBe(true);
    expect(googleBody.safeParse({ returnPath: 'x'.repeat(513) }).success).toBe(false);
    expect(googleBody.safeParse({ returnPath: '' }).success).toBe(false);
    expect(googleBody.safeParse({ returnPath: '/', extra: 1 }).success).toBe(false);
  });
  it('doors are strict', () => {
    expect(authLastCodeDoor.safeParse({ to: ok }).success).toBe(true);
    expect(authLastCodeDoor.safeParse({ to: ok, x: 1 }).success).toBe(false);
    expect(authExpireCodeDoor.safeParse({ email: ok }).success).toBe(true);
    expect(authExpireCodeDoor.safeParse({ email: 'a@' }).success).toBe(false);
    expect(authGoogleUserDoor.safeParse({ sub: 's', email: ok, emailVerified: true }).success).toBe(true);
    expect(authGoogleUserDoor.safeParse({ sub: 's', email: ok, emailVerified: 'y' }).success).toBe(false);
    expect(mailCounterDoor.safeParse({ provider: 'primary', count: 0 }).success).toBe(true);
    expect(mailCounterDoor.safeParse({ provider: 'third', count: 0 }).success).toBe(false);
    expect(mailCounterDoor.safeParse({ provider: 'fallback', count: -1 }).success).toBe(false);
  });
  it('session with neutral pass fields parses; extra fields do not', () => {
    const s = { user: null, guestId: 'g1', hasPass: false, passOn: null, passSince: null, devicePass: null, code: null };
    expect(sessionSchema.safeParse(s).success).toBe(true);
    const u = { ...s, user: { id: 'u1', email: ok, via: 'email', signedInAt: 1 } };
    expect(sessionSchema.safeParse(u).success).toBe(true);
    expect(sessionSchema.safeParse({ ...s, extra: 1 }).success).toBe(false);
  });
  it('session event', () => {
    expect(sessionEventSchema.safeParse({ type: 'session', id: 'e1', data: { reason: 'erased' } }).success).toBe(true);
    expect(sessionEventSchema.safeParse({ type: 'session', id: 'e1', data: { reason: 'x' } }).success).toBe(false);
  });
});
