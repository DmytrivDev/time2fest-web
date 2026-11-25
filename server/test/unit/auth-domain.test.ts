/** SPEC-10 W13 — pure auth rules: email (EC-8), return path (AC-17, AC-18), session expiry (AC-26, EC-9). */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emailKey, normalizeEmail } from '../../src/domain/auth/email';
import { safeReturnPath, withSignInMarks } from '../../src/domain/auth/returnPath';
import { SESSION_TTL_MS, sessionExpiresAt } from '../../src/domain/auth/sessionExpiry';

describe('normalizeEmail / emailKey (EC-8)', () => {
  it('trims and lowercases before comparison', () => {
    expect(normalizeEmail('  Anna.K@Example.COM ')).toBe('anna.k@example.com');
    expect(normalizeEmail('anna.k@example.com')).toBe(normalizeEmail(' ANNA.K@EXAMPLE.COM'));
  });
  it('refuses a broken format or an over-long address', () => {
    for (const bad of ['', 'a', 'no-at.example', 'two@@example.com', 'a@b@c', 'sp ace@example.com', '@']) {
      expect(normalizeEmail(bad), bad).toBeUndefined();
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@x.io`)).toBeUndefined();
    expect(normalizeEmail(`${'a'.repeat(240)}@x.io`)).toBeDefined();
  });
  it('accepts the test-door domain @t2f.test', () => {
    expect(normalizeEmail('user+1@t2f.test')).toBe('user+1@t2f.test');
  });
  it('emailKey is the sha256 hex of the normalized address and never contains it', () => {
    const e = normalizeEmail(' A@Example.com ')!;
    expect(emailKey(e)).toBe(createHash('sha256').update('a@example.com').digest('hex'));
    expect(emailKey(e)).toMatch(/^[0-9a-f]{64}$/);
    expect(emailKey(e)).toBe(emailKey(normalizeEmail('a@EXAMPLE.com')!));
  });
});

describe('safeReturnPath (AC-18)', () => {
  it('keeps a path of our site', () => {
    for (const ok of ['/', '/countries/ua', '/countries/ua?x=1#a', '/account/?tab=pass']) expect(safeReturnPath(ok)).toBe(ok);
  });
  it('unsafe → /', () => {
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/%2F%2Fevil',
      '/%2f%2fevil',
      '/\\evil.example',
      '\\\\evil.example',
      '/a%5Cb',
      '/%2E%2E/admin',
      '/%252F%252Fevil',
      '/../x',
      '/a\nb',
      '/a\u0000b',
      'javascript:alert(1)',
      'countries/ua',
      '',
      '/' + 'a'.repeat(600),
    ]) {
      expect(safeReturnPath(bad), JSON.stringify(bad)).toBe('/');
    }
    expect(safeReturnPath(undefined)).toBe('/');
    expect(safeReturnPath(42)).toBe('/');
  });
});

describe('withSignInMarks (AC-17)', () => {
  it('adds signin=google and new=1, keeps the hash', () => {
    expect(withSignInMarks('/countries/ua?x=1#a', { isNew: true })).toBe('/countries/ua?x=1&signin=google&new=1#a');
  });
  it('no query, no hash, existing account', () => {
    expect(withSignInMarks('/countries/ua', { isNew: false })).toBe('/countries/ua?signin=google');
    expect(withSignInMarks('/', { isNew: true })).toBe('/?signin=google&new=1');
    expect(withSignInMarks('/a#h', { isNew: false })).toBe('/a?signin=google#h');
  });
});

describe('sessionExpiresAt (AC-26, EC-9)', () => {
  const seasonEnd = Date.parse('2027-01-15T00:00:00Z');
  it('before the season end: min(now + 60 d, season end)', () => {
    const now = Date.parse('2026-12-31T22:00:00Z');
    expect(sessionExpiresAt(now, seasonEnd)).toBe(seasonEnd);
    const early = Date.parse('2026-10-01T00:00:00Z');
    expect(sessionExpiresAt(early, seasonEnd)).toBe(early + SESSION_TTL_MS);
  });
  it('at or after the season end: now + 60 d', () => {
    expect(sessionExpiresAt(seasonEnd, seasonEnd)).toBe(seasonEnd + SESSION_TTL_MS);
    const after = Date.parse('2027-02-01T10:00:00Z');
    expect(sessionExpiresAt(after, seasonEnd)).toBe(after + SESSION_TTL_MS);
  });
  it('60 days exactly', () => {
    expect(SESSION_TTL_MS).toBe(60 * 86_400_000);
  });
});
