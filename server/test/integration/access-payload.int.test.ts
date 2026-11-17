/**
 * The second check inside Payload (AC-5): Payload's REST handlers called directly, bypassing the
 * proxy. A valid session cookie without the identity marker the proxy sets is refused; with it, 200.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const EMAIL = 'guard-owner@example.com';
const PASSWORD = 'guard-owner-password-0001';

describe('second check inside Payload (AC-5)', () => {
  let payload: Payload;
  let cookie = '';

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, EMAIL, PASSWORD, 'owner');
    cookie = await sessionCookie(payload, EMAIL, PASSWORD);
  });

  afterAll(async () => {
    await removeAdmins(payload, [EMAIL]);
  });

  it('`me` with a valid cookie and no marker → refused; with the marker → 200', async () => {
    const bare = await rest('GET', '/admins/me', { headers: { cookie } });
    expect(bare.status).toBe(403);
    expect(await bare.text()).not.toContain(EMAIL);
    const marked = await rest('GET', '/admins/me', { headers: { cookie, ...personMark() } });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as { user?: { email?: string } }).user?.email).toBe(EMAIL);
  });

  it('a forged or foreign marker is the same as none', async () => {
    const forged = await rest('GET', '/admins/me', { headers: { cookie, [IDENTITY_HEADER]: 'eyJraW5kIjoicGVyc29uIn0.AAAA' } });
    expect(forged.status).toBe(403);
  });

  it('collection operations without the marker → refused', async () => {
    expect((await rest('GET', '/admins', { headers: { cookie } })).status).toBe(403);
    expect((await rest('GET', '/admins', { headers: { cookie, ...personMark() } })).status).toBe(200);
    expect((await rest('GET', '/globals/admin-settings', { headers: { cookie } })).status).toBe(403);
    expect((await rest('GET', '/globals/admin-settings', { headers: { cookie, ...personMark() } })).status).toBe(200);
  });

  it('login without the marker → refused; a service marker is not a person → refused; a person → 200', async () => {
    const body = { email: EMAIL, password: PASSWORD };
    const bare = await rest('POST', '/admins/login', { body });
    expect(bare.status).toBe(403);
    expect(bare.headers.getSetCookie().join('')).not.toContain('payload-token=ey');
    expect((await rest('POST', '/admins/login', { body, headers: serviceMark() })).status).toBe(403);
    expect((await rest('POST', '/admins/login', { body, headers: personMark() })).status).toBe(200);
  });

  it('custom endpoints without the marker → refused', async () => {
    expect((await rest('POST', '/admins/1/issue-key', { headers: { cookie } })).status).toBe(403);
  });
});
