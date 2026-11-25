/** SPEC-10 AC-56: test recipients carry the worktree id and a random suffix, and never repeat. */
import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/domain/auth/email';
import { testEmail, worktreeSlug } from '../support/testEmail';

describe('testEmail (AC-56)', () => {
  it('carries the slug and an 8-character random suffix, passes the email rule', () => {
    const a = testEmail(undefined, 'spec_10_auth_mail');
    expect(a).toMatch(/^t2f-spec_10_auth_mail-[a-z0-9]{8}@t2f\.test$/);
    expect(normalizeEmail(a)).toBe(a);
    expect(testEmail('code', 'spec_10_auth_mail')).toMatch(/^t2f-spec_10_auth_mail-[a-z0-9]{8}\+code@t2f\.test$/);
  });

  it('uses this worktree slug by default', () => {
    const slug = worktreeSlug();
    expect(slug).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(testEmail().startsWith(`t2f-${slug}-`)).toBe(true);
  });

  it('is unique over 1000 calls', () => {
    const all = new Set(Array.from({ length: 1000 }, () => testEmail()));
    expect(all.size).toBe(1000);
  });

  it('refuses a tag outside [a-z0-9-]', () => {
    expect(() => testEmail('A B')).toThrow();
  });
});
