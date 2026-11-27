/**
 * SPEC-14 NFR-1/NFR-2 — the fast subject read verifies better-call's signed session cookie itself
 * (`encodeURIComponent('<token>.<base64 HMAC-SHA256(secret, token)>')`); anything not exactly signed falls back.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifiedToken } from '../../src/adapters/sessionSubjects';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const sign = (token: string, secret = SECRET): string =>
  encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`);

describe('verifiedToken', () => {
  it('returns the token of a correctly signed value', () => {
    expect(verifiedToken(sign('AbCdEf123'), SECRET)).toBe('AbCdEf123');
  });

  it('rejects another secret, a tampered token or signature, and malformed values', () => {
    expect(verifiedToken(sign('AbCdEf123', 'other-secret'), SECRET)).toBeNull();
    const good = decodeURIComponent(sign('AbCdEf123'));
    expect(verifiedToken(encodeURIComponent(`AbCdEf124${good.slice(9)}`), SECRET)).toBeNull();
    expect(verifiedToken(encodeURIComponent(`${good.slice(0, -2)}A=`), SECRET)).toBeNull();
    expect(verifiedToken('AbCdEf123', SECRET)).toBeNull();
    expect(verifiedToken('.abc', SECRET)).toBeNull();
    expect(verifiedToken('%E0%A4%A', SECRET)).toBeNull();
  });
});
