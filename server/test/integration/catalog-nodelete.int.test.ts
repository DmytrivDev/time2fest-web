/** No deletion of catalog records (AC-47, Q7, W26): an owner delete on each of the six kinds is refused and the row stays. */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { createTinyCatalog, KINDS, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'catalog-nodelete-owner@example.com';
const PASSWORD = 'catalog-nodelete-password-1';
const run = `cn${Date.now()}`;

describe('no deletion of catalog records (AC-47)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let tiny: TinyCatalog;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    tiny = await createTinyCatalog(payload, run);
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    await removeTinyCatalog(payload, run);
    await removeAdmins(payload, [OWNER]);
  });

  for (const kind of KINDS) {
    it(`the owner deleting a record of ${kind} is refused and the row is still there`, async () => {
      const res = await rest('DELETE', `/${kind}/${tiny.ids[kind]}`, { headers: owner });
      expect(res.status).toBe(403);
      const still = await payload.findByID({ collection: kind, id: tiny.ids[kind], overrideAccess: true, depth: 0, disableErrors: true });
      expect(still).toBeTruthy();
    });
  }
});
