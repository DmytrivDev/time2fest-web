/**
 * SPEC-14 NFR-1/NFR-2 — the fast subject read verifies better-call's signed session cookie itself
 * (`encodeURIComponent('<token>.<base64 HMAC-SHA256(secret, token)>')`); anything not exactly signed falls back.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { SIGNED_COOKIE_MAX, verifiedToken } from '../../src/adapters/sessionSubjects';
import { realClock } from '../../src/clock';
import { checkLimit } from '../../src/platform/rateLimit';
import { rateLimitRegistry } from '../../src/registries/rateLimits';

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

describe('verifiedToken length cap (S14-04)', () => {
  it('rejects a value over the cap without verifying it, even if correctly signed', () => {
    const token = 'A'.repeat(SIGNED_COOKIE_MAX);
    expect(verifiedToken(sign(token), SECRET)).toBeNull();
    const fits = 'B'.repeat(SIGNED_COOKIE_MAX - 60);
    expect(verifiedToken(sign(fits), SECRET)).toBe(fits);
  });
});

describe('author-path rate row (S14-02)', () => {
  it('limits a client that sends a fresh device every request by its ipDay', async () => {
    const row = rateLimitRegistry.find((r) => r.key === 'author-path');
    expect(row?.keys).toEqual(['device', 'ipDay']);
    if (row === undefined) return;
    const stores = { fast: createMemoryStore(realClock), memory: createMemoryStore(realClock) };
    for (let i = 0; i < row.limit; i += 1) {
      expect((await checkLimit(row, { device: `dev-${i}`, ipDay: 'client-1' }, stores)).ok).toBe(true);
    }
    expect((await checkLimit(row, { device: 'dev-new', ipDay: 'client-1' }, stores)).ok).toBe(false);
    expect((await checkLimit(row, { device: 'dev-other', ipDay: 'client-2' }, stores)).ok).toBe(true);
  });
});
