import { describe, expect, it } from 'vitest';
import { isOwnerEmail, MAX_OWNER_EMAILS, parseOwnerEmails } from '../../src/domain/access/ownerEmails';

describe('owner emails (AC-3, Q2)', () => {
  it('accepts a main and a reserve email, lower-cased', () => {
    expect(MAX_OWNER_EMAILS).toBe(2);
    expect(parseOwnerEmails(' Main@Example.com , reserve@example.com ')).toEqual({
      ok: true,
      emails: ['main@example.com', 'reserve@example.com'],
    });
    expect(parseOwnerEmails('main@example.com')).toEqual({ ok: true, emails: ['main@example.com'] });
  });

  it('fails naming T2F_OWNER_EMAILS for 3 emails, none, a duplicate or a non-email', () => {
    for (const raw of ['a@example.com,b@example.com,c@example.com', '', undefined, 'a@example.com,A@example.com', 'not-an-email']) {
      expect(parseOwnerEmails(raw)).toEqual({ ok: false, failing: ['T2F_OWNER_EMAILS'] });
    }
  });

  it('matches case-insensitively and exactly', () => {
    const list = ['main@example.com', 'reserve@example.com'];
    expect(isOwnerEmail(list, 'MAIN@example.COM')).toBe(true);
    expect(isOwnerEmail(list, 'reserve@example.com')).toBe(true);
    expect(isOwnerEmail(list, 'main@example.com.evil')).toBe(false);
    expect(isOwnerEmail(list, ' main@example.com')).toBe(false);
    expect(isOwnerEmail(list, '')).toBe(false);
    expect(isOwnerEmail(list, undefined)).toBe(false);
  });
});
