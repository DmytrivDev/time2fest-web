/** SPEC-11 W30 — sign-in methods and the email-change value codec (AC-43, AC-48). */
import { describe, expect, it } from 'vitest';
import {
  canUnlink,
  decodeEmailChange,
  emailChangeIdentifier,
  encodeEmailChange,
  signInMethods,
} from '../../src/domain/rights/signInMethods';

const HASH = 'a'.repeat(64);

describe('signInMethods', () => {
  it('a verified code account with Google has both methods', () => {
    expect(signInMethods({ isAnonymous: false, emailVerified: true, providerIds: ['google'] })).toEqual(['email', 'google']);
  });
  it('an unverified email is not a method; a guest has no email method', () => {
    expect(signInMethods({ isAnonymous: false, emailVerified: false, providerIds: ['google'] })).toEqual(['google']);
    expect(signInMethods({ isAnonymous: true, emailVerified: true, providerIds: [] })).toEqual([]);
  });
  it('duplicates and empty provider ids collapse', () => {
    expect(signInMethods({ isAnonymous: false, emailVerified: true, providerIds: ['google', 'google', ''] })).toEqual(['email', 'google']);
  });
});

describe('canUnlink', () => {
  it('refuses only when the provider is the sole method', () => {
    expect(canUnlink(['email', 'google'], 'google')).toBe(true);
    expect(canUnlink(['google'], 'google')).toBe(false);
    expect(canUnlink([], 'google')).toBe(false);
  });
});

describe('email change value', () => {
  it('round-trips, including an address with a colon', () => {
    for (const email of ['a@b.c', 'we:ird@b.c']) {
      const v = { email, hash: HASH, attemptsLeft: 3, sentAt: 1_700_000_000_000 };
      expect(decodeEmailChange(encodeEmailChange(v))).toEqual(v);
    }
  });
  it('rejects malformed values', () => {
    expect(decodeEmailChange(undefined)).toBeUndefined();
    expect(decodeEmailChange('a@b.c:zz:1:1')).toBeUndefined();
    expect(decodeEmailChange(`a@b.c:${HASH}:-1:1`)).toBeUndefined();
    expect(decodeEmailChange(`:${HASH}:1:1`)).toBeUndefined();
    expect(decodeEmailChange(`a@b.c:${HASH}:1`)).toBeUndefined();
  });
  it('identifier is per account', () => {
    expect(emailChangeIdentifier('u1')).toBe('t2f-change-email-u1');
  });
});
