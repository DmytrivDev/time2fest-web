/**
 * No first-register screen in any class; the first owner only from `owner:create` (AC-13).
 * The proxy answers the screen and its REST call with Next's own 404; Payload refuses the REST call
 * even when it is reached directly; the command creates the owner once, and refuses a second time.
 */
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestSigner } from '../../src/adapters/testSigner';
import { createOwner } from '../../src/cli/createOwner';
import { payloadOf } from '../../src/container';
import { NOT_FOUND_PATH, proxy } from '../../src/proxy';
import { testDeps } from './helpers';
import { ADMIN_HOST, personMark, rest } from './payload-rest';

const OWNER = 'first-owner@example.com';
const OWNER_LIST = `${OWNER},reserve-owner@example.com`;
const PASSWORD = 'first-owner-password-0001';
const MAIN = String(process.env.T2F_OWNER_EMAILS).split(',')[0] ?? '';
const DEFAULTS = { iss: new URL(String(process.env.T2F_ACCESS_TEAM_DOMAIN)).origin, aud: String(process.env.T2F_ACCESS_AUD) };

const countAdmins = async (payload: Payload) => (await payload.count({ collection: 'admins', overrideAccess: true })).totalDocs;

describe('no first-register; owner:create (AC-13)', () => {
  let payload: Payload;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await payload.delete({ collection: 'admins', where: { id: { exists: true } }, overrideAccess: true });
  });

  afterAll(async () => {
    await payload.delete({ collection: 'admins', where: { id: { exists: true } }, overrideAccess: true });
  });

  it('on an empty admins, the screen and the REST call through the proxy → Next 404, even for the owner', async () => {
    expect(await countAdmins(payload)).toBe(0);
    const token = await (await getTestSigner()).sign({ kind: 'person', email: MAIN }, DEFAULTS);
    for (const [path, method] of [
      ['/admin/create-first-user', 'GET'],
      ['/cms-api/admins/first-register', 'POST'],
    ] as const) {
      const res = await proxy(
        new NextRequest(`http://${ADMIN_HOST}${path}`, { method, headers: { host: ADMIN_HOST, 'Cf-Access-Jwt-Assertion': token } }),
      );
      expect(res.headers.get('x-middleware-next')).toBeNull();
      expect(new URL(String(res.headers.get('x-middleware-rewrite'))).pathname).toBe(NOT_FOUND_PATH);
    }
    // Without a JWT the path is 403 like every other (AC-1).
    const bare = await proxy(new NextRequest(`http://${ADMIN_HOST}/admin/create-first-user`, { headers: { host: ADMIN_HOST } }));
    expect(bare.status).toBe(403);
  });

  it('REST first-register reached directly, with a valid marker → refused, no record', async () => {
    const res = await rest('POST', '/admins/first-register', {
      body: { email: OWNER, password: PASSWORD, 'confirm-password': PASSWORD },
      headers: personMark(),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await countAdmins(payload)).toBe(0);
  });

  it('owner:create refuses an email outside the list and a short password', async () => {
    expect((await createOwner(payload, { email: 'stranger@example.com', password: PASSWORD, ownerEmailsRaw: OWNER_LIST })).code).toBe(1);
    expect((await createOwner(payload, { email: OWNER, password: 'short', ownerEmailsRaw: OWNER_LIST })).code).toBe(1);
    expect((await createOwner(payload, { email: OWNER, password: PASSWORD, ownerEmailsRaw: undefined })).code).toBe(1);
    expect(await countAdmins(payload)).toBe(0);
  });

  it('owner:create creates the owner (exit 0); a second run → exit 2', async () => {
    expect(await createOwner(payload, { email: OWNER.toUpperCase(), password: PASSWORD, ownerEmailsRaw: OWNER_LIST })).toEqual({
      code: 0,
      message: 'owner created',
    });
    const found = await payload.find({ collection: 'admins', where: { role: { equals: 'owner' } }, overrideAccess: true });
    expect(found.docs.map((d) => d.email)).toEqual([OWNER]);
    // AC-20: the creation is journalled once, by the system, without the password.
    const journal = await payload.find({
      collection: 'audit-log',
      where: { and: [{ 'target.collection': { equals: 'admins' } }, { 'target.ref': { equals: String(found.docs[0]?.id) } }] },
      overrideAccess: true,
      depth: 0,
    });
    expect(journal.docs).toHaveLength(1);
    expect(journal.docs[0]).toMatchObject({ actor: { kind: 'system', ref: 'owner-create' }, action: 'collection.create' });
    expect(JSON.stringify(journal.docs)).not.toContain(PASSWORD);
    const again = await createOwner(payload, { email: 'reserve-owner@example.com', password: PASSWORD, ownerEmailsRaw: OWNER_LIST });
    expect(again.code).toBe(2);
    expect(await countAdmins(payload)).toBe(1);
  });
});
