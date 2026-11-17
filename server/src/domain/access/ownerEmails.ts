/**
 * Owner email list of the Access gate (AC-3). Ring 1: pure.
 * Owner decision Q2: one main email and one reserve, so 1–2 entries. A different answer changes
 * only `MAX_OWNER_EMAILS`.
 */
export const MAX_OWNER_EMAILS = 2;

export type OwnerEmailsResult = { ok: true; emails: readonly string[] } | { ok: false; failing: ['T2F_OWNER_EMAILS'] };

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** `a@example.com, b@example.com` → lower-cased list of 1–`MAX_OWNER_EMAILS` distinct emails; else names the variable. */
export function parseOwnerEmails(raw: string | undefined): OwnerEmailsResult {
  const list = (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  const valid =
    list.length >= 1 && list.length <= MAX_OWNER_EMAILS && list.every((e) => EMAIL.test(e)) && new Set(list).size === list.length;
  return valid ? { ok: true, emails: list } : { ok: false, failing: ['T2F_OWNER_EMAILS'] };
}

/** Case-insensitive exact match; an absent or empty email never matches. */
export function isOwnerEmail(list: readonly string[], email: string | undefined): boolean {
  if (typeof email !== 'string' || email === '') return false;
  return list.includes(email.toLowerCase());
}
