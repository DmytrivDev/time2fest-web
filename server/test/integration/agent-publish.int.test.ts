/**
 * The `agentPublish` switch (AC-19), on the test-only collection `agent-test-posts`: with the switch
 * on, an agent's publish is published; after the owner turns it off between two requests, the
 * second attempt is stored as `proposal`.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'publish-owner@example.com';
const AGENT = 'publish-agent@example.com';
const PASSWORD = 'publish-password-000001'; // check-secrets: allow test fake
const TITLE = 'agent-publish test';

describe('agentPublish (AC-19)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let agent: Record<string, string>;

  const setSwitch = (agentPublish: boolean) =>
    payload.updateGlobal({ slug: 'admin-settings', data: { agentPublish }, overrideAccess: true });
  const clearPosts = () => payload.delete({ collection: 'agent-test-posts', where: { title: { equals: TITLE } }, overrideAccess: true });

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await setSwitch(true);
    await clearPosts();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    const agentId = await makeAdmin(payload, AGENT, PASSWORD, 'stream-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    agent = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    await setSwitch(true);
    await clearPosts();
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  const publish = async (): Promise<string> => {
    const res = await rest('POST', '/agent-test-posts', { headers: agent, body: { title: TITLE, status: 'published' } });
    expect(res.status).toBe(201);
    return ((await res.json()) as { doc: { status: string } }).doc.status;
  };

  it('on → published; turned off by the owner between two requests → the second is a proposal', async () => {
    expect(await publish()).toBe('published');
    const off = await rest('POST', '/globals/admin-settings', { headers: owner, body: { agentPublish: false } });
    expect(off.status).toBe(200);
    expect(await publish()).toBe('proposal');
    const stored = await payload.find({ collection: 'agent-test-posts', where: { title: { equals: TITLE } }, sort: 'id', overrideAccess: true });
    expect(stored.docs.map((d) => d.status)).toEqual(['published', 'proposal']);
  });

  it('S4-06: switch off → an agent edit of an already published record (no status sent) becomes a proposal; the owner edit stays published', async () => {
    await setSwitch(true);
    const created = await rest('POST', '/agent-test-posts', { headers: agent, body: { title: TITLE, status: 'published' } });
    const id = ((await created.json()) as { doc: { id: number; status: string } }).doc.id;
    await setSwitch(false);
    const edited = await rest('PATCH', `/agent-test-posts/${id}`, { headers: agent, body: { title: TITLE } });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { doc: { status: string } }).doc.status).toBe('proposal');
    const draft = await rest('POST', '/agent-test-posts', { headers: agent, body: { title: TITLE, status: 'draft' } });
    expect(((await draft.json()) as { doc: { status: string } }).doc.status).toBe('draft');
    const byOwner = await rest('PATCH', `/agent-test-posts/${id}`, { headers: owner, body: { title: TITLE, status: 'published' } });
    expect(((await byOwner.json()) as { doc: { status: string } }).doc.status).toBe('published');
    await setSwitch(true);
  });

  it('the owner reads the switch; an agent may not', async () => {
    expect((await rest('GET', '/globals/admin-settings', { headers: owner })).status).toBe(200);
    expect((await rest('GET', '/globals/admin-settings', { headers: agent })).status).toBe(403);
  });
});
