/**
 * One-step revert of a journal row (AC-22 … AC-25) through `POST /cms-api/audit-log/:id/revert`.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'revert-owner@example.com';
const AGENT = 'revert-agent@example.com';
const PASSWORD = 'revert-password-00000001'; // check-secrets: allow test fake

type Row = { id: number; action: string; revertOf?: string | null; revertible: boolean };

describe('journal revert (AC-22 … AC-25)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let agentKey = '';

  const rowsFor = async (id: number): Promise<Row[]> =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ 'target.collection': { equals: 'agent-test-posts' } }, { 'target.ref': { equals: String(id) } }] },
        sort: 'id',
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];

  const title = async (id: number) => (await payload.findByID({ collection: 'agent-test-posts', id, overrideAccess: true, depth: 0 })).title;
  const patch = async (id: number, t: string) =>
    expect((await rest('PATCH', `/agent-test-posts/${id}`, { headers: owner, body: { title: t } })).status).toBe(200);
  const revert = async (rowId: number, headers = owner) => {
    const res = await rest('POST', `/audit-log/${rowId}/revert`, { headers });
    return { status: res.status, body: (await res.json()) as { ok: boolean; error?: { code: string; reason?: string } } };
  };
  const newPost = async (t: string) =>
    (await payload.create({ collection: 'agent-test-posts', data: { title: t, status: 'draft' }, overrideAccess: true })).id;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    const agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    agentKey = ((await issued.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('AC-22: change → revert → before; revert of the revert → after; three linked rows', async () => {
    const id = await newPost('rv-before');
    await patch(id, 'rv-after');
    const change = (await rowsFor(id)).at(-1) as Row;
    expect(change).toMatchObject({ action: 'collection.update', revertible: true });

    expect(await revert(change.id)).toEqual({ status: 200, body: { ok: true, value: {} } });
    expect(await title(id)).toBe('rv-before');
    const undo = (await rowsFor(id)).at(-1) as Row;
    expect(undo.revertOf).toBe(String(change.id));

    expect((await revert(undo.id)).status).toBe(200);
    expect(await title(id)).toBe('rv-after');
    const redo = (await rowsFor(id)).at(-1) as Row;
    expect(redo.revertOf).toBe(String(undo.id));
    expect((await rowsFor(id)).filter((r) => r.action === 'collection.update')).toHaveLength(3);
  });

  it('AC-23: change A, change B, revert A → changed-since, value stays B', async () => {
    const id = await newPost('rv-0');
    await patch(id, 'rv-A');
    const a = (await rowsFor(id)).at(-1) as Row;
    await patch(id, 'rv-B');
    const before = (await rowsFor(id)).length;
    expect(await revert(a.id)).toEqual({ status: 409, body: { ok: false, error: { code: 'conflict', reason: 'changed-since' } } });
    expect(await title(id)).toBe('rv-B');
    expect(await rowsFor(id)).toHaveLength(before);
  });

  it('AC-24: a kind without a handler is not revertible', async () => {
    const id = await newPost('rv-create');
    const [created] = await rowsFor(id);
    expect(created).toMatchObject({ action: 'collection.create', revertible: false });
    expect(await revert(Number(created?.id))).toEqual({ status: 409, body: { ok: false, error: { code: 'conflict', reason: 'not-revertible' } } });
  });

  it('AC-25: an agent key, or no signed-in owner, is refused', async () => {
    const id = await newPost('rv-agent');
    await patch(id, 'rv-agent-2');
    const row = (await rowsFor(id)).at(-1) as Row;
    expect((await revert(row.id, { ...apiKeyHeader(agentKey), ...serviceMark() })).status).toBe(403);
    expect((await revert(row.id, personMark())).body).toEqual({ ok: false, error: { code: 'forbidden', reason: 'forbidden' } });
    expect(await title(id)).toBe('rv-agent-2');
  });
});
