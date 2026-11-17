/**
 * Payload session of 24 h (AC-12, owner decision Q1): after a password login that passed the gate,
 * the session JWT has `exp − iat` = 86 400 s ± 60, and the session cookie lives 24 h ± 1 min.
 */
import { decodeJwt } from 'jose';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest } from './payload-rest';

const EMAIL = 'session-owner@example.com';
const PASSWORD = 'session-owner-password-0001'; // check-secrets: allow test fake
const DAY = 86_400;

describe('Payload session 24 h (AC-12)', () => {
  let payload: Payload;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, EMAIL, PASSWORD, 'owner');
  });

  afterAll(async () => {
    await removeAdmins(payload, [EMAIL]);
  });

  it('JWT exp − iat = 24 h ± 1 min; the cookie expires in 24 h ± 1 min', async () => {
    const sentAt = Date.now();
    const res = await rest('POST', '/admins/login', { body: { email: EMAIL, password: PASSWORD }, headers: personMark() });
    expect(res.status).toBe(200);

    const { token } = (await res.json()) as { token?: string };
    const claims = decodeJwt(String(token));
    expect(Math.abs(Number(claims.exp) - Number(claims.iat) - DAY)).toBeLessThanOrEqual(60);

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('payload-token='));
    expect(cookie).toBeDefined();
    const maxAge = /;\s*Max-Age=(\d+)/i.exec(String(cookie))?.[1];
    const expires = /;\s*Expires=([^;]+)/i.exec(String(cookie))?.[1];
    const lifetime = maxAge !== undefined ? Number(maxAge) : (Date.parse(String(expires)) - sentAt) / 1000;
    expect(Number.isFinite(lifetime)).toBe(true);
    expect(Math.abs(lifetime - DAY)).toBeLessThanOrEqual(60);
  });
});
