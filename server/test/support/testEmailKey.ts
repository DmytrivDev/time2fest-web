/**
 * The limit / Redis key of an address as a `test` process computes it (S10-06: HMAC under the pepper derived from
 * `T2F_AUTH_SECRET`, or the fixed test secret when it is unset). Tests use it to free the 30 s gap of an address.
 */
import { emailPepperOf } from '../../src/auth/instance';
import { emailKey } from '../../src/domain/auth/email';

const pepper = emailPepperOf(process.env, 'test');

export const testEmailKey = (email: string): string => emailKey(email, pepper);
