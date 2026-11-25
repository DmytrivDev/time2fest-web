/**
 * Класифікація відмови SMTP (SPEC-10 [П-7], AC-37/38), ring 1.
 * Текст відповіді лише читається; ні він, ні адреса не повертаються.
 */
import type { MailSendError } from './types';

export type MailFailure =
  | { readonly kind: 'recipient' }
  | { readonly kind: 'fallback'; readonly broken: 'quota' | 'other' };

const FALLBACK_TEXT = /quota|rate|too many|limit|not verified/i;
const QUOTA_TEXT = /quota|daily|limit/i;

export function classifyMailError(err: MailSendError): MailFailure {
  const rc = err.responseCode;
  const text = err.response ?? '';
  if (typeof rc === 'number' && rc >= 500 && rc < 600) {
    if (FALLBACK_TEXT.test(text)) {
      return { kind: 'fallback', broken: QUOTA_TEXT.test(text) ? 'quota' : 'other' };
    }
    if (/^RCPT TO/i.test(err.command ?? '') || err.code === 'EENVELOPE') return { kind: 'recipient' };
  }
  return { kind: 'fallback', broken: 'other' };
}
