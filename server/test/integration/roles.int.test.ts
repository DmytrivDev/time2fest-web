/**
 * Roles (AC-14, AC-17, AC-18 policy base): one owner, three role names, no password login for
 * agents, and agents refused on admins, settings and test-collection deletion. Every call passed the
 * gate (it carries the marker), so a refusal here comes from the roles, not from the gate.
 * The catalog part of the agent matrix is added with the catalog (W25), the journal part with W22.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'roles-owner@example.com';
const AGENT = 'roles-agent@example.com';
const OTHER = 'roles-stream@example.com';
const NEW = 'roles-new@example.com';
const PASSWORD = 'roles-password-0000001'; // check-secrets: allow test fake

describe('roles (AC-14, AC-17, AC-18)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let agent: Record<string, string>;
  let agentId = 0;
  let otherId = 0;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    otherId = await makeAdmin(payload, OTHER, PASSWORD, 'stream-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    agent = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT, OTHER, NEW]);
  });

  const roleOf = async (id: number) => (await payload.findByID({ collection: 'admins', id, overrideAccess: true })).role;

  it('the owner may not turn another record into an owner, nor create a second owner', async () => {
    expect((await rest('PATCH', `/admins/${otherId}`, { headers: owner, body: { role: 'owner' } })).status).toBe(403);
    expect(await roleOf(otherId)).toBe('stream-agent');
    expect((await rest('POST', '/admins', { headers: owner, body: { email: NEW, password: PASSWORD, role: 'owner' } })).status).toBe(403);
    expect((await rest('POST', '/admins', { headers: owner, body: { email: NEW, password: PASSWORD } })).status).toBe(403);
    expect((await payload.count({ collection: 'admins', where: { email: { equals: NEW } }, overrideAccess: true })).totalDocs).toBe(0);
  });

  it('a role name outside the three → refused by validation', async () => {
    const res = await rest('POST', '/admins', { headers: owner, body: { email: NEW, password: PASSWORD, role: 'admin' } });
    expect(res.status).toBe(400);
    expect((await payload.count({ collection: 'admins', where: { email: { equals: NEW } }, overrideAccess: true })).totalDocs).toBe(0);
  });

  it('the owner may create an agent record (control)', async () => {
    const res = await rest('POST', '/admins', { headers: owner, body: { email: NEW, password: PASSWORD, role: 'stream-agent' } });
    expect(res.status).toBe(201);
    await removeAdmins(payload, [NEW]);
  });

  it('an agent may not create an owner', async () => {
    expect((await rest('POST', '/admins', { headers: agent, body: { email: NEW, password: PASSWORD, role: 'owner' } })).status).toBe(403);
    expect((await payload.count({ collection: 'admins', where: { email: { equals: NEW } }, overrideAccess: true })).totalDocs).toBe(0);
  });

  it('an agent record may not sign in by password (AC-17)', async () => {
    for (const mark of [personMark(), serviceMark()]) {
      const res = await rest('POST', '/admins/login', { headers: mark, body: { email: AGENT, password: PASSWORD } });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie().join('')).not.toContain('payload-token=ey');
    }
  });

  it('agent matrix: admins, admin-settings and test-post deletion → refused', async () => {
    const calls: [Parameters<typeof rest>[0], string, unknown?][] = [
      ['GET', '/admins'],
      ['GET', `/admins/${agentId}`],
      ['GET', '/admins/me'],
      ['POST', '/admins', { email: NEW, password: PASSWORD, role: 'content-agent' }],
      ['PATCH', `/admins/${otherId}`, { role: 'content-agent' }],
      ['PATCH', `/admins/${agentId}`, { role: 'owner' }],
      ['DELETE', `/admins/${otherId}`],
      ['POST', `/admins/${otherId}/issue-key`],
      ['POST', `/admins/${agentId}/revoke-key`],
      ['GET', '/globals/admin-settings'],
      ['POST', '/globals/admin-settings', { agentPublish: false }],
      ['DELETE', '/agent-test-posts?where[id][exists]=true'],
    ];
    for (const [method, path, body] of calls) {
      const res = await rest(method, path, { headers: agent, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await roleOf(otherId)).toBe('stream-agent');
    expect(await roleOf(agentId)).toBe('content-agent');
  });
});
