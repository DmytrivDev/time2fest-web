/**
 * Audit journal (AC-20, AC-21, NFR-5): one write → exactly one journal row in the same transaction,
 * every field filled; a failing journal rolls the data row back; no role changes or deletes a
 * journal row through `/cms-api`.
 */
import type { Payload } from 'payload';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { overrideJournalForTest } from '../../src/audit/hooks';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'journal-owner@example.com';
const PASSWORD = 'journal-password-0000001';

type Row = {
  id: number;
  actor: { kind: string; ref: string; label: string };
  action: string;
  target: { collection: string; ref: string };
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  revertOf?: string | null;
  revertible: boolean;
};

describe('audit journal (AC-20, AC-21)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let ownerId = 0;

  const rowsFor = async (collection: string, id: string | number): Promise<Row[]> =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ 'target.collection': { equals: collection } }, { 'target.ref': { equals: String(id) } }] },
        sort: 'id',
        limit: 100,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    ownerId = await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterEach(() => overrideJournalForTest(null));

  afterAll(async () => {
    await removeAdmins(payload, [OWNER]);
  });

  it('one write → exactly one journal row with every field filled', async () => {
    const created = await rest('POST', '/agent-test-posts', { headers: owner, body: { title: 'journal-a', status: 'draft' } });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { doc: { id: number } }).doc.id;
    expect(await rowsFor('agent-test-posts', id)).toHaveLength(1);

    expect((await rest('PATCH', `/agent-test-posts/${id}`, { headers: owner, body: { title: 'journal-b' } })).status).toBe(200);
    const rows = await rowsFor('agent-test-posts', id);
    expect(rows).toHaveLength(2);
    const [create, update] = rows;
    expect(create).toMatchObject({ action: 'collection.create', before: null, after: { title: 'journal-a' } });
    expect(update).toMatchObject({
      actor: { kind: 'owner', ref: String(ownerId), label: OWNER },
      action: 'collection.update',
      target: { collection: 'agent-test-posts', ref: String(id) },
      before: { title: 'journal-a', status: 'draft' },
      after: { title: 'journal-b', status: 'draft' },
      revertible: true,
    });
    expect(Number.isNaN(Date.parse(String(update?.at)))).toBe(false);
  });

  it('a failing journal write rolls the data row back', async () => {
    overrideJournalForTest({
      append: async () => {
        throw new Error('journal down (simulated)');
      },
    });
    const title = `journal-rollback-${Date.now()}`;
    await expect(payload.create({ collection: 'agent-test-posts', data: { title, status: 'draft' }, overrideAccess: true })).rejects.toThrow();
    overrideJournalForTest(null);
    const found = await payload.count({ collection: 'agent-test-posts', where: { title: { equals: title } }, overrideAccess: true });
    expect(found.totalDocs).toBe(0);
  });

  it('AC-21: the owner can neither change nor delete a journal row through /cms-api', async () => {
    const [row] = await rowsFor('admins', ownerId);
    expect(row).toBeDefined();
    const id = String(row?.id);
    expect((await rest('PATCH', `/audit-log/${id}`, { headers: owner, body: { action: 'tampered' } })).status).toBe(403);
    expect((await rest('DELETE', `/audit-log/${id}`, { headers: owner })).status).toBe(403);
    expect((await rest('POST', '/audit-log', { headers: owner, body: { action: 'forged' } })).status).toBe(403);
    const after = await payload.findByID({ collection: 'audit-log', id: Number(id), overrideAccess: true, depth: 0 });
    expect(after.action).toBe(row?.action);
    const read = await rest('GET', `/audit-log/${id}`, { headers: owner });
    expect(read.status).toBe(200);
  });

  it('NFR-5: an admin record in the journal carries no password, hash, salt or key field', async () => {
    const rows = await rowsFor('admins', ownerId);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/"(password|hash|salt|apiKey|apiKeyIndex|enableAPIKey)"/);
  });
});
