/**
 * Admin first screen (AC-26 … AC-29): the test slice is registered only in the test class, its
 * action goes through the owner interface, is journalled once and is revertible; the door sets the
 * fail flag the first screen reads.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf } from '../../src/container';
import { envClass } from '../../src/platform/env';
import { ADMIN_TEST_SLICE_FAIL, visibleSlots } from '../../src/registries/adminSlots';
import { post, testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'admin-slots-owner@example.com';
const PASSWORD = 'admin-slots-password-0001'; // check-secrets: allow test fake

type Row = { id: number; action: string; revertible: boolean };

describe('admin first screen (AC-26 … AC-29)', () => {
  let payload: Payload;
  let owner: Record<string, string>;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    delete (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL];
    await removeAdmins(payload, [OWNER]);
  });

  it('AC-28: under T2F_ENV=production there is no 90-test slot; the test class lists it last', () => {
    const production = visibleSlots(envClass({ T2F_ENV: 'production' }));
    expect(production.map((s) => s.key)).toEqual(['10-corrections', '20-unattended']);
    expect(visibleSlots(envClass({ T2F_ENV: 'test' })).at(-1)?.key).toBe('90-test');
  });

  it('AC-27: the door sets and clears the fail flag the first screen reads', async () => {
    const dispatch = await buildDispatcher(testDeps());
    const flag = () => (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL];
    expect((await dispatch(post('/api/_test/admin-test-slice', { fail: true }))).status).toBe(200);
    expect(flag()).toBe(true);
    expect((await dispatch(post('/api/_test/admin-test-slice', { fail: false }))).status).toBe(200);
    expect(flag()).toBe(false);
    expect((await dispatch(post('/api/_test/admin-test-slice', { fail: 'yes' }))).status).toBe(400);
  });

  it('AC-29: the slice action (create, then update through the owner interface) → one revertible journal row, revert succeeds', async () => {
    const created = await rest('POST', '/agent-test-posts', { headers: owner, body: { title: 'slice-1', status: 'draft' } });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { doc: { id: number } }).doc.id;
    expect((await rest('PATCH', `/agent-test-posts/${id}`, { headers: owner, body: { title: 'slice-2' } })).status).toBe(200);

    const rows = (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ 'target.collection': { equals: 'agent-test-posts' } }, { 'target.ref': { equals: String(id) } }, { action: { equals: 'collection.update' } }] },
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revertible).toBe(true);

    const res = await rest('POST', `/audit-log/${rows[0]?.id}/revert`, { headers: owner });
    expect(res.status).toBe(200);
    const title = (await payload.findByID({ collection: 'agent-test-posts', id, overrideAccess: true, depth: 0 })).title;
    expect(title).toBe('slice-1');
  });
});
